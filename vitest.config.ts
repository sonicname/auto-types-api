import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (file: string): string => fileURLToPath(new URL(`./src/${file}`, import.meta.url));

export default defineConfig({
  resolve: {
    // Same aliases as tsconfig `paths`: the fixture app imports this package by name.
    alias: [
      { find: /^auto-types-api\/client$/, replacement: src('client.ts') },
      { find: /^auto-types-api$/, replacement: src('index.ts') },
    ],
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      // The CLI entry only wires `run` to process I/O; `run` itself is covered.
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts', 'src/cli/index.ts', 'src/server/types.ts'],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
  },
});
