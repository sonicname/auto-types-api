import { defineConfig, type Options } from 'tsup';

const shared: Options = {
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  // Cleaning is done by the build script so parallel configs don't wipe each other's output.
  clean: false,
  splitting: false,
  treeshake: true,
  outDir: 'dist',
};

export default defineConfig([
  {
    ...shared,
    // Runs in React Router loaders/actions and in the browser.
    entry: { index: 'src/index.ts', 'client/index': 'src/client.ts' },
    target: 'es2022',
  },
  {
    ...shared,
    // Node-only: file system access at build/dev time.
    entry: { 'codegen/index': 'src/codegen/index.ts', 'vite/index': 'src/vite.ts' },
    target: 'node20',
    platform: 'node',
    removeNodeProtocol: false,
  },
  {
    entry: { cli: 'src/cli/index.ts' },
    format: ['esm'],
    dts: false,
    sourcemap: false,
    splitting: false,
    target: 'node20',
    platform: 'node',
    removeNodeProtocol: false,
    outDir: 'dist',
    banner: { js: '#!/usr/bin/env node' },
  },
]);
