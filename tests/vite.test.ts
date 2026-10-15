import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViteDevServerLike } from '../src/vite';

const generateRoutes = vi.hoisted(() =>
  vi.fn(() => Promise.resolve({ warnings: ['api/x.ts: skipped'] })),
);
vi.mock('../src/codegen', () => ({ generateRoutes }));

const { autoTypesApi } = await import('../src/vite');

const root = fileURLToPath(new URL('./fixtures', import.meta.url));

function createServer() {
  const listeners = new Map<string, (file: string) => void>();
  const warn = vi.fn();
  const server: ViteDevServerLike = {
    watcher: {
      on: (event, listener) => listeners.set(event, listener),
    },
    config: { logger: { warn } },
  };
  return { server, warn, emit: (event: string, file: string) => listeners.get(event)?.(file) };
}

describe('autoTypesApi', () => {
  beforeEach(() => {
    generateRoutes.mockClear();
  });

  it('generates on build start relative to the Vite root', async () => {
    const plugin = autoTypesApi({ prefix: '/rest' });
    plugin.configResolved({ root });
    const warn = vi.fn();
    await plugin.buildStart.call({ warn });
    expect(generateRoutes).toHaveBeenCalledWith({ prefix: '/rest', cwd: root });
    expect(warn).toHaveBeenCalledWith('[auto-types-api] api/x.ts: skipped');
  });

  it('regenerates when API files change in dev', async () => {
    const plugin = autoTypesApi();
    plugin.configResolved({ root });
    const { server, warn, emit } = createServer();
    plugin.configureServer(server);

    emit('change', join(root, 'app', 'modules', 'shop', 'api', 'products.ts'));
    emit('add', join(root, 'app', 'api', 'new.ts'));
    emit('unlink', join(root, 'app', 'modules', 'shop', 'pages', 'index.tsx'));
    emit('change', join(root, 'app', 'api.gen.ts'));
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledTimes(2);
    });
    expect(generateRoutes).toHaveBeenCalledTimes(2);
  });

  it('logs generation errors in dev', async () => {
    generateRoutes.mockImplementationOnce(() => Promise.reject(new Error('boom')));
    const plugin = autoTypesApi({ appDir: 'src' });
    plugin.configResolved({ root });
    const { server, warn, emit } = createServer();
    plugin.configureServer(server);

    emit('change', join(root, 'src', 'api', 'a.ts'));
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith('[auto-types-api] Error: boom');
    });
  });
});
