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
  it('reads shorthand keys of serve({ ... })', () => {
    const source = `
      const GET = api.get(() => 1);
      const DELETE = api.delete(() => 2);
      export const loader = api.serve({ GET, DELETE }, { coerce: false });
      export const action = loader;
    `;
    expect(detectServed(source)).toEqual({ handler: 'loader', methods: ['GET', 'DELETE'] });
  });

  it('reads inline keys only at the top level', () => {
    const source = `
      import { serve } from 'auto-types-api';
      export const action = serve({
        POST: api.post({ body: z.object({ GET: z.string() }) }, ({ body }) => [body, 'PUT, }']),
        'PATCH': handler,
        ...shared,
        PUT: \`a \${'}'} b\`,
      });
    `;
    expect(detectServed(source)).toEqual({ handler: 'action', methods: ['POST', 'PUT'] });
  });

  it('ignores files without serve()', () => {
    const source = 'export function loader() { return Response.json({ GET: 1 }) }';
    expect(detectServed(source)).toEqual({ handler: 'loader', methods: [] });
    expect(detectServed('serve({ GET').methods).toEqual(['GET']);
    expect(detectServed("serve({ GET: 'unterminated").methods).toEqual(['GET']);
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

  it('dedupes names and warns about skipped files and splats', () => {
    const result = generateRoutesCode(
      [
        { file: 'api/a.b.ts', path: '/api/a/b', handler: 'loader', methods: ['GET'] },
        { file: 'api/a-b.ts', path: '/api/a-b', handler: 'action', methods: ['GET'] },
        { file: 'api/files.$.ts', path: "/api/it's/*", handler: 'loader', methods: ['GET'] },
        { file: 'api/util.ts', path: '/api/util', handler: 'loader', methods: [] },
      ],
      { importPath, prefix: '/api', routesName: 'api' },
    );
    expect(result.routes.map((r) => r.name)).toEqual(['getAB', 'getAB2', 'getItSAll']);
    expect(result.code).toContain(
      "getAB2: createRoute.get('/api/a-b', clientOptions<typeof api1.action, 'GET'>()),",
    );
    expect(result.code).toContain("getItSAll: createRoute.get('/api/it\\'s/*'");
    expect(result.code).toContain('export const api = {');
    expect(result.code).toContain('export type Api = typeof api;');
    expect(result.warnings).toEqual([
      'api/a-b.ts: route name "getAB" taken, using "getAB2"',
      expect.stringContaining('splat route'),
      expect.stringContaining('api/util.ts: no api.serve({ GET, POST, ... }) found'),
    ]);
  });
});

describe('scanApiFiles', () => {
  it('lists API files only', async () => {
    expect((await scanApiFiles(fixture)).sort()).toEqual([
      'api/health.ts',
      'modules/shop/api/legacy.ts',
      'modules/shop/api/products.$id.ts',
      'modules/shop/api/products.ts',
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
    expect(result.routes).toHaveLength(5);
    expect(result.warnings).toEqual([expect.stringContaining('modules/shop/api/legacy.ts')]);
  });

  it('writes to a custom location relative to cwd', async () => {
    // Inside the repo so the generated file can import the fixture relatively (same drive).
    await mkdir(generated, { recursive: true });
    const dir = await mkdtemp(join(generated, 'codegen-'));
    try {
      const outFile = join(dir, 'nested', 'client.gen.ts');
      const first = await generateRoutes({ appDir: fixture, outFile, routesName: 'endpoints' });
      expect(first.changed).toBe(true);
      const code = await readFile(outFile, 'utf8');
      expect(code).toContain('export const endpoints = {');
      expect(code).toMatch(/import type \* as api0 from '(\.\.\/)+.*fixtures\/app\/api\/health';/);

      await writeFile(join(dir, 'other.gen.ts'), '');
      const local = await generateRoutes({ cwd: dir, appDir: '.', outFile: 'other.gen.ts' });
      expect(local).toMatchObject({ changed: true, routes: [] });
      const again = await generateRoutes({ appDir: fixture, outFile, routesName: 'endpoints' });
      expect(again.changed).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
