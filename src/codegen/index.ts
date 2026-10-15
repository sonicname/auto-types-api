/**
 * Node-only generator: scans a modules-page-routing app for API files and writes a typed
 * endpoint-kit routes file.
 *
 * @packageDocumentation
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { buildApiModuleRouteConfig, buildApiRouteConfig } from 'modules-page-routing';
import { detectMethods, generateRoutesCode } from './generate';
import type { ApiFile, CodeResult } from './generate';

export { detectMethods, generateRoutesCode, routeName } from './generate';
export type { ApiFile, CodeOptions, CodeResult, GeneratedRoute } from './generate';

/** Options for {@link generateRoutes}. */
export interface GenerateRoutesOptions {
  /** App directory containing `api/` and `modules/`. Defaults to `./app`. */
  appDir?: string;
  /** Generated file. Defaults to `<appDir>/api.gen.ts`. */
  outFile?: string;
  /** URL prefix the API routes are mounted under (`prefix('api', ...)`). Defaults to `/api`. */
  prefix?: string;
  /** Name of the exported routes object. Defaults to `routes`. */
  routesName?: string;
  /** Base directory for relative paths. Defaults to `process.cwd()`. */
  cwd?: string;
}

/** Result of {@link generateRoutes}. */
export interface GenerateRoutesResult extends CodeResult {
  /** Absolute path of the generated file. */
  outFile: string;
  /** Whether the file content changed (it is only written when it did). */
  changed: boolean;
}

/**
 * Lists API files the way `import.meta.glob('./api/**\/*.ts')` and
 * `import.meta.glob('./modules/**\/api/**\/*.ts')` would, relative to `appDir`.
 */
export async function scanApiFiles(appDir: string): Promise<string[]> {
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        files.push(relative(appDir, full).split(sep).join('/'));
      }
    }
  };
  await walk(join(appDir, 'api'));
  await walk(join(appDir, 'modules'));
  return files.filter((file) => file.startsWith('api/') || /^modules\/[^/]+\/api\//.test(file));
}

/** Maps API files to URL patterns with modules-page-routing's own route builders. */
export function resolveApiPaths(
  files: readonly string[],
  prefix = '/api',
): { file: string; path: string }[] {
  const glob = Object.fromEntries(files.map((file) => [`./${file}`, null]));
  const base = `/${prefix.replace(/^\/+|\/+$/g, '')}`.replace(/^\/$/, '');
  return [...buildApiRouteConfig(glob), ...buildApiModuleRouteConfig(glob)].map((node) => ({
    file: node.file,
    path: `${base}/${node.path ?? ''}`,
  }));
}

/** Scans `appDir`, generates the routes file and writes it when it changed. */
export async function generateRoutes(
  options: GenerateRoutesOptions = {},
): Promise<GenerateRoutesResult> {
  const cwd = options.cwd ?? process.cwd();
  const appDir = resolve(cwd, options.appDir ?? 'app');
  const outFile = resolve(cwd, options.outFile ?? join(appDir, 'api.gen.ts'));
  const prefix = options.prefix ?? '/api';

  const apiFiles: ApiFile[] = await Promise.all(
    resolveApiPaths(await scanApiFiles(appDir), prefix).map(async ({ file, path }) => ({
      file,
      path,
      methods: detectMethods(await readFile(join(appDir, file), 'utf8')),
    })),
  );

  const result = generateRoutesCode(apiFiles, {
    prefix,
    ...(options.routesName === undefined ? {} : { routesName: options.routesName }),
    importPath: (file) => {
      const target = relative(dirname(outFile), join(appDir, file.replace(/\.ts$/, '')));
      const posix = target.split(sep).join('/');
      // Different Windows drives have no relative path between them.
      if (isAbsolute(target) || posix.startsWith('.')) return posix;
      return `./${posix}`;
    },
  });

  let previous: string | undefined;
  try {
    previous = await readFile(outFile, 'utf8');
  } catch {
    previous = undefined;
  }
  const changed = previous !== result.code;
  if (changed) {
    await mkdir(dirname(outFile), { recursive: true });
    await writeFile(outFile, result.code, 'utf8');
  }
  return { ...result, outFile, changed };
}
