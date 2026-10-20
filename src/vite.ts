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
  /** Vite 6+: runs before Vite reloads, so the generated files never import a deleted file. */
  hotUpdate(options: { file: string }): Promise<void>;
}

/** Options for {@link autoTypesApi}. Paths are relative to Vite's `root`. */
export type AutoTypesApiOptions = Omit<GenerateRoutesOptions, 'cwd'>;

type Warn = (message: string) => void;

/** Generates typed endpoint-kit routes from modules-page-routing API files. */
export function autoTypesApi(options: AutoTypesApiOptions = {}): VitePluginLike {
  let root = process.cwd();
  let logger: Warn = (message) => {
    console.warn(message);
  };
  // Generations run one at a time; a second one for the same change finds nothing to write.
  let queue: Promise<unknown> = Promise.resolve();

  const touchesApi = (file: string): boolean =>
    isApiFile(
      relative(resolve(root, options.appDir ?? 'app'), file)
        .split(sep)
        .join('/'),
    );

  const generate = (warn: Warn): Promise<void> => {
    const next = queue.then(async () => {
      const result = await generateRoutes({ ...options, cwd: root });
      for (const warning of result.warnings) warn(`[auto-types-api] ${warning}`);
    });
    queue = next.catch(() => undefined);
    return next;
  };

  const regenerate = async (file: string): Promise<void> => {
    if (!touchesApi(file)) return;
    try {
      await generate(logger);
    } catch (error) {
      logger(`[auto-types-api] ${String(error)}`);
    }
  };

  return {
    name: 'auto-types-api',
    configResolved(config) {
      root = config.root;
    },
    async buildStart() {
      await generate((message) => {
        this.warn(message);
      });
    },
    configureServer(server) {
      logger = (message) => {
        server.config.logger.warn(message);
      };
      // Vite 5 has no `hotUpdate` for added and deleted files; on Vite 6+ this is a no-op rerun.
      const onFile = (file: string): void => {
        void regenerate(file);
      };
      server.watcher.on('add', onFile);
      server.watcher.on('change', onFile);
      server.watcher.on('unlink', onFile);
    },
    async hotUpdate({ file }) {
      await regenerate(file);
    },
  };
}
