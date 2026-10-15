import { describe, expect, it, vi } from 'vitest';
import type { GenerateRoutesResult } from '../src/codegen';
import { HELP, run } from '../src/cli/run';
import type { CliIO } from '../src/cli/run';

const result: GenerateRoutesResult = {
  code: '',
  routes: [{ name: 'getA', method: 'GET', path: '/api/a', file: 'api/a.ts' }],
  warnings: ['api/b.ts: skipped'],
  outFile: '/app/api.gen.ts',
  changed: true,
};

function createIO(overrides: Partial<CliIO> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIO = {
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    generate: vi.fn(() => Promise.resolve(result)),
    watch: vi.fn(() => () => undefined),
    ...overrides,
  };
  return { io, out, err };
}

describe('cli', () => {
  it('prints help', async () => {
    const { io, out } = createIO();
    expect(await run(['--help'], io)).toBe(0);
    expect(out.join('')).toBe(HELP);
  });

  it('fails without the generate command or with unknown flags', async () => {
    const missing = createIO();
    expect(await run([], missing.io)).toBe(1);
    expect(missing.err.join('')).toBe(HELP);

    const unknown = createIO();
    expect(await run(['generate', '--nope'], unknown.io)).toBe(1);
    expect(unknown.err.join('')).toContain("Unknown option '--nope'");
  });

  it('generates with options and reports warnings', async () => {
    const { io, out, err } = createIO();
    const args = ['generate', '-a', 'src/app', '-o', 'out.ts', '-p', '/rest', '-n', 'api'];
    expect(await run(args, io)).toBe(0);
    expect(io.generate).toHaveBeenCalledWith({
      appDir: 'src/app',
      outFile: 'out.ts',
      prefix: '/rest',
      routesName: 'api',
    });
    expect(err.join('')).toBe('warn: api/b.ts: skipped\n');
    expect(out.join('')).toBe('Generated 1 routes → /app/api.gen.ts\n');
  });

  it('stays quiet when nothing changed', async () => {
    const { io, out } = createIO({
      generate: () => Promise.resolve({ ...result, warnings: [], changed: false }),
    });
    expect(await run(['generate'], io)).toBe(0);
    expect(out).toEqual([]);
  });

  it('reports errors', async () => {
    const failing = createIO({ generate: () => Promise.reject(new Error('boom')) });
    expect(await run(['generate'], failing.io)).toBe(1);
    expect(failing.err.join('')).toBe('auto-types-api: boom\n');

    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- covers non-Error throws
    const odd = createIO({ generate: () => Promise.reject('bad') });
    expect(await run(['generate'], odd.io)).toBe(1);
    expect(odd.err.join('')).toBe('auto-types-api: bad\n');
  });

  it('regenerates on changes in watch mode', async () => {
    vi.useFakeTimers();
    try {
      let onChange: () => void = () => undefined;
      const { io, out } = createIO({
        watch: vi.fn((_dir: string, listener: () => void) => {
          onChange = listener;
          return () => undefined;
        }),
      });
      expect(await run(['generate', '--watch'], io)).toBe(0);
      expect(io.watch).toHaveBeenCalledWith('app', expect.any(Function));
      expect(out).toContain('Watching for changes...\n');

      onChange();
      onChange();
      await vi.runAllTimersAsync();
      expect(io.generate).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
