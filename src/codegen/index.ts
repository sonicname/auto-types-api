/**
 * Node-only generator: scans a modules-page-routing app for API files and writes a typed
 * endpoint-kit routes file, plus a server file for in-process calls.
 *
 * @packageDocumentation
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isApiFile, resolveApiPaths } from '../paths';
import { detectServed } from './detect';
import { generateRoutesCode } from './generate';
import type { ApiFile, CodeResult } from './generate';

export { detectServed } from './detect';
export type { DetectedEndpoint, ServedEndpoints } from './detect';
export { generateRoutesCode } from './generate';
export type { ApiFile, CodeOptions, CodeResult, GeneratedRoute } from './generate';
export { isApiFile, resolveApiPaths, routeName } from '../paths';

/** Options for {@link generateRoutes}. */
export interface GenerateRoutesOptions {
  /** App directory containing `api/` and `modules/`. Defaults to `./app`. */
  appDir?: string;
  /** Generated client file. Defaults to `<appDir>/api.gen.ts`. */
  outFile?: string;
  /**
   * Generated server file with `localFetch` (in-process calls from loaders). Defaults to
   * `<appDir>/api.gen.server.ts`; `false` skips it.
   */
  serverOutFile?: string | false;
  /** URL prefix the API routes are mounted under (`prefix('api', ...)`). Defaults to `/api`. */
  prefix?: string;
  /** Name of the exported routes object. Defaults to `routes`. */
  routesName?: string;
  /** Base directory for relative paths. Defaults to `process.cwd()`. */
  cwd?: string;
}

/** Result of {@link generateRoutes}. */
export interface GenerateRoutesResult extends CodeResult {
  /** Absolute path of the generated client file. */
  outFile: string;
  /** Absolute path of the generated server file, unless disabled. */
  serverOutFile?: string;
  /** Whether a file content changed (files are only written when they did). */
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
      else files.push(relative(appDir, full).split(sep).join('/'));
    }
  };
  await walk(join(appDir, 'api'));
  await walk(join(appDir, 'modules'));
  return files.filter(isApiFile);
}

/** Scans `appDir`, generates the routes files and writes those that changed. */
export async function generateRoutes(
  options: GenerateRoutesOptions = {},
): Promise<GenerateRoutesResult> {
  const cwd = options.cwd ?? process.cwd();
  const appDir = resolve(cwd, options.appDir ?? 'app');
  const outFile = resolve(cwd, options.outFile ?? join(appDir, 'api.gen.ts'));
  const serverOutFile =
    options.serverOutFile === false
      ? undefined
      : resolve(cwd, options.serverOutFile ?? join(appDir, 'api.gen.server.ts'));
  const prefix = options.prefix ?? '/api';

  const apiFiles: ApiFile[] = await Promise.all(
    resolveApiPaths(await scanApiFiles(appDir), prefix).map(async ({ file, path }) => ({
      file,
      path,
      ...detectServed(await readFile(join(appDir, file), 'utf8')),
    })),
  );

  const result = generateRoutesCode(apiFiles, {
    prefix,
    ...(options.routesName === undefined ? {} : { routesName: options.routesName }),
    importPath: (file) => importPath(outFile, join(appDir, file)),
    ...(serverOutFile
      ? {
          server: {
            importPath: (file: string) => importPath(serverOutFile, join(appDir, file)),
            clientImport: importPath(serverOutFile, outFile),
          },
        }
      : {}),
  });

  const changed = [
    await write(outFile, result.code),
    serverOutFile !== undefined && (await write(serverOutFile, result.serverCode ?? '')),
  ].some(Boolean);
  return { ...result, outFile, ...(serverOutFile ? { serverOutFile } : {}), changed };
}

/** Import specifier of `target` from `from`, without the `.ts` extension. */
function importPath(from: string, target: string): string {
  const path = relative(dirname(from), target.replace(/\.ts$/, ''));
  const posix = path.split(sep).join('/');
  // Different Windows drives have no relative path between them.
  if (isAbsolute(path) || posix.startsWith('.')) return posix;
  return `./${posix}`;
}

/** Writes `content` unless the file already has it. Returns whether it wrote. */
async function write(file: string, content: string): Promise<boolean> {
  let previous: string | undefined;
  try {
    previous = await readFile(file, 'utf8');
  } catch {
    previous = undefined;
  }
  if (previous === content) return false;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content, 'utf8');
  return true;
}
