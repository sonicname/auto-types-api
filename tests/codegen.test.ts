import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  detectServed,
  generateRoutes,
  generateRoutesCode,
  resolveApiPaths,
  routeName,
  scanApiFiles,
} from '../src/codegen';

const fixture = fileURLToPath(new URL('./fixtures/app', import.meta.url));
const generated = fileURLToPath(new URL('./.generated', import.meta.url));

describe('detectServed', () => {
  it('reads shorthand keys and the config of each endpoint', () => {
    const source = `
      const GET = api.get({ responseType: 'sse' }, async function* () {});
      // const POST = api.post({ bodyType: 'form' }, () => 1);
      const DELETE = authed.delete(
        { errors: { 404: NotFound, '409': Conflict, default: Other }, bodyType: "form" },
        () => 1,
      );
      export const loader = api.serve({ GET, DELETE }, { coerce: false });
      export const action = loader;
    `;
    expect(detectServed(source)).toEqual({
      handler: 'loader',
      endpoints: [
        { method: 'GET', responseType: 'sse' },
        { method: 'DELETE', bodyType: 'form', errors: [404, 409] },
      ],
      warnings: [],
    });
  });

  it('reads inline endpoints, renamed ones and only top-level keys', () => {
    const source = `
      import { serve } from 'auto-types-api';
      const remove = api.delete(() => 1);
      export const action = serve({
        POST: api.post({ body: z.object({ GET: z.string() }), bodyType: 'multipart' }, ({ body }) => [body, 'PUT, }']),
        'PATCH': api.patch({ responseType: \`text\` }, () => 'ok'),
        DELETE: remove,
        PUT: undeclared,
      });
    `;
    expect(detectServed(source)).toEqual({
      handler: 'action',
      endpoints: [
        { method: 'POST', bodyType: 'multipart' },
        { method: 'PUT' },
        { method: 'PATCH', responseType: 'text' },
        { method: 'DELETE' },
      ],
      warnings: [],
    });
  });

  it('resolves endpoints and errors declared as variables', () => {
    const source = `
      const errors = { 404: NotFound };
      const GET = api.get({ errors }, () => 1);
      const POST = api.post({ errors: shared }, () => 1);
      const endpoints: ApiEndpoints = { GET, POST, ...more };
      export const loader = api.serve(endpoints);
    `;
    expect(detectServed(source)).toEqual({
      handler: 'loader',
      endpoints: [{ method: 'GET', errors: [404] }, { method: 'POST' }],
      warnings: [
        'POST: could not read its errors; declare them as an object literal',
        'spread in serve({ ... }) is not supported, list the methods explicitly',
      ],
    });
  });

  it('reports what it cannot read', () => {
    expect(detectServed('export const loader = api.serve(makeEndpoints());').warnings).toEqual([
      'could not read the endpoints passed to serve(); declare them as an object literal',
    ]);
    const plain = 'export function loader() { return Response.json({ GET: 1 }) } /* serve({ GET })';
    expect(detectServed(plain)).toEqual({ handler: 'loader', endpoints: [], warnings: [] });
    expect(detectServed('serve({ GET').endpoints).toEqual([{ method: 'GET' }]);
    expect(detectServed("serve({ GET: 'unterminated").endpoints).toEqual([{ method: 'GET' }]);
    expect(detectServed('serve({ GET: x.get(\n').endpoints).toEqual([{ method: 'GET' }]);
    expect(detectServed('const GET = 1; serve({ GET })').endpoints).toEqual([{ method: 'GET' }]);
  });
});

describe('routeName', () => {
  it('builds camelCase names from method and path', () => {
    expect(routeName('GET', '/api/shop/products/:id', '/api')).toBe('getShopProductsById');
    expect(routeName('POST', '/api/user-profile/:org_id', '/api')).toBe('postUserProfileByOrgId');
    expect(routeName('GET', '/api/docs/*', '/api')).toBe('getDocsAll');
    expect(routeName('DELETE', '/v1/x')).toBe('deleteV1X');
  });
});

describe('resolveApiPaths', () => {
  const files = [
    'api/v1/users.$id.ts',
    'modules/shop/api/(admin)/stats.ts',
    'modules/_core/api/ping.ts',
  ];

  it('uses modules-page-routing URL conventions under the prefix', () => {
    expect(resolveApiPaths(files)).toEqual([
      { file: 'api/v1/users.$id.ts', path: '/api/v1/users/:id' },
      { file: 'modules/_core/api/ping.ts', path: '/api/core/ping' },
      { file: 'modules/shop/api/(admin)/stats.ts', path: '/api/shop/stats' },
    ]);
  });

  it('normalizes the prefix', () => {
    expect(resolveApiPaths(['api/a.ts'], 'rest/')[0]?.path).toBe('/rest/a');
    expect(resolveApiPaths(['api/a.ts'], '/')[0]?.path).toBe('/a');
  });
});

describe('generateRoutesCode', () => {
  const importPath = (file: string): string => `./${file.replace(/\.ts$/, '')}`;

  it('dedupes names, passes wire options and warns about skipped files and splats', () => {
    const result = generateRoutesCode(
      [
        {
          file: 'api/a.b.ts',
          path: '/api/a/b',
          handler: 'loader',
          endpoints: [{ method: 'GET', responseType: 'sse', bodyType: 'form', errors: [404, 409] }],
        },
        {
          file: 'api/a-b.ts',
          path: '/api/a-b',
          handler: 'action',
          endpoints: [{ method: 'GET' }],
          warnings: ['spread ignored'],
        },
        {
          file: 'api/files.$.ts',
          path: "/api/it's/*",
          handler: 'loader',
          endpoints: [{ method: 'GET' }],
        },
        { file: 'api/util.ts', path: '/api/util', handler: 'loader', endpoints: [] },
      ],
      {
        importPath,
        prefix: '/api',
        routesName: 'api',
        server: { importPath: (file) => `../${file}`, clientImport: './client' },
      },
    );
    expect(result.routes.map((r) => r.name)).toEqual(['getAB', 'getAB2', 'getItSAll']);
    expect(result.code).toContain(
      "getAB: createRoute.get('/api/a/b', clientOptions<typeof api0.loader, 'GET'>({ bodyType: 'form', responseType: 'sse', errors: [404, 409] })),",
    );
    expect(result.code).toContain(
      "getAB2: createRoute.get('/api/a-b', clientOptions<typeof api1.action, 'GET'>()),",
    );
    expect(result.code).toContain("getItSAll: createRoute.get('/api/it\\'s/*'");
    expect(result.code).toContain('export const api = {');
    expect(result.code).toContain('export type Api = typeof api;');
    expect(result.serverCode).toContain("import { api } from './client';");
    expect(result.serverCode).toContain("import { action as api1 } from '../api/a-b.ts';");
    expect(result.serverCode).toContain('  getAB2: api1,');
    expect(result.serverCode).toContain(
      'export const localFetch = createLocalFetch(api, handlers);',
    );
    expect(result.warnings).toEqual([
      'api/a-b.ts: spread ignored',
      'api/a-b.ts: route name "getAB" taken, using "getAB2"',
      expect.stringContaining('splat route'),
      expect.stringContaining('api/util.ts: no api.serve({ GET, POST, ... }) found'),
    ]);
  });

  it('skips the server file unless asked', () => {
    expect(generateRoutesCode([], { importPath }).serverCode).toBeUndefined();
  });
});

describe('scanApiFiles', () => {
  it('lists API files only', async () => {
    expect((await scanApiFiles(fixture)).sort()).toEqual([
      'api/health.ts',
      'api/version.ts',
      'modules/shop/api/events.ts',
      'modules/shop/api/legacy.ts',
      'modules/shop/api/products.$id.ts',
      'modules/shop/api/products.ts',
      'modules/shop/api/upload.ts',
    ]);
  });

  it('returns nothing for a missing directory', async () => {
    expect(await scanApiFiles(join(fixture, 'missing'))).toEqual([]);
  });
});

describe('generateRoutes', () => {
  it('keeps the committed fixture output up to date', async () => {
    const result = await generateRoutes({ appDir: fixture });
    expect(result.changed).toBe(false);
    expect(result.routes).toHaveLength(8);
    expect(result.serverOutFile).toBe(join(fixture, 'api.gen.server.ts'));
    expect(result.warnings).toEqual([expect.stringContaining('modules/shop/api/legacy.ts')]);
  });

  it('writes to custom locations relative to cwd', async () => {
    // Inside the repo so the generated files can import the fixture relatively (same drive).
    await mkdir(generated, { recursive: true });
    const dir = await mkdtemp(join(generated, 'codegen-'));
    try {
      const outFile = join(dir, 'nested', 'client.gen.ts');
      const serverOutFile = join(dir, 'server', 'client.gen.server.ts');
      const options = { appDir: fixture, outFile, serverOutFile, routesName: 'endpoints' };
      const first = await generateRoutes(options);
      expect(first.changed).toBe(true);
      const code = await readFile(outFile, 'utf8');
      expect(code).toContain('export const endpoints = {');
      expect(code).toMatch(/import type \* as api0 from '(\.\.\/)+.*fixtures\/app\/api\/health';/);
      const server = await readFile(serverOutFile, 'utf8');
      expect(server).toContain("import { endpoints } from '../nested/client.gen';");

      await writeFile(join(dir, 'other.gen.ts'), '');
      const local = await generateRoutes({
        cwd: dir,
        appDir: '.',
        outFile: 'other.gen.ts',
        serverOutFile: false,
      });
      expect(local).toMatchObject({ changed: true, routes: [] });
      expect(local.serverOutFile).toBeUndefined();
      expect((await generateRoutes(options)).changed).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
