/**
 * Vite plugin: regenerates the endpoint-kit routes files (`api.gen.ts`, `api.gen.server.ts`)
 * on startup and whenever an API file changes in dev.
 *
 * ```ts
 * // vite.config.ts
 * import { reactRouter } from '@react-router/dev/vite';
 * import { autoTypesApi } from 'auto-types-api/vite';
 *
 * export default defineConfig({ plugins: [autoTypesApi(), reactRouter()] });
 * ```
 *
 * @packageDocumentation
 */
import { relative, resolve, sep } from 'node:path';
import { generateRoutes } from './codegen';
import type { GenerateRoutesOptions } from './codegen';
import { isApiFile } from './paths';

/** The part of Vite's dev server this plugin uses. */
export interface ViteDevServerLike {
  watcher: { on(event: 'add' | 'change' | 'unlink', listener: (file: string) => void): unknown };
  config: { logger: { warn(message: string): void } };
}

/** The part of a Vite plugin this module returns. */
export interface VitePluginLike {
  name: string;
  configResolved(config: { root: string }): void;
  buildStart(this: { warn(message: string): void }): Promise<void>;
  configureServer(server: ViteDevServerLike): void;
}

/** Options for {@link autoTypesApi}. Paths are relative to Vite's `root`. */
export type AutoTypesApiOptions = Omit<GenerateRoutesOptions, 'cwd'>;

/** Generates typed endpoint-kit routes from modules-page-routing API files. */
export function autoTypesApi(options: AutoTypesApiOptions = {}): VitePluginLike {
  let root = process.cwd();
  const inApp = (file: string): string =>
    relative(resolve(root, options.appDir ?? 'app'), file)
      .split(sep)
      .join('/');
  const run = async (warn: (message: string) => void): Promise<void> => {
    const result = await generateRoutes({ ...options, cwd: root });
    for (const warning of result.warnings) warn(`[auto-types-api] ${warning}`);
  };

  return {
    name: 'auto-types-api',
    configResolved(config) {
      root = config.root;
    },
    async buildStart() {
      await run((message) => {
        this.warn(message);
      });
    },
    configureServer(server) {
      const onFile = (file: string): void => {
        if (!isApiFile(inApp(file))) return;
        run((message) => {
          server.config.logger.warn(message);
        }).catch((error: unknown) => {
          server.config.logger.warn(`[auto-types-api] ${String(error)}`);
        });
      };
      server.watcher.on('add', onFile);
      server.watcher.on('change', onFile);
      server.watcher.on('unlink', onFile);
    },
  };
}
