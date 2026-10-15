import { describe, expect, it, vi } from 'vitest';
import { HELP, run, type CliIO } from '../src/cli/run';

function createIO(overrides: Partial<CliIO> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIO = {
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    readFile: vi.fn(() => Promise.resolve('{"id":1}')),
    writeFile: vi.fn(() => Promise.resolve()),
    fetch: vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('[1]') }),
    ),
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

  it('fails without a source', async () => {
    const { io, err } = createIO();
    expect(await run([], io)).toBe(1);
    expect(err.join('')).toBe(HELP);
  });

  it('reads a file and prints types', async () => {
    const { io, out } = createIO();
    expect(await run(['user.json', '-n', 'User'], io)).toBe(0);
    expect(io.readFile).toHaveBeenCalledWith('user.json');
    expect(out.join('')).toBe('export interface User {\n  id: number;\n}\n');
  });

  it('fetches a URL and writes to a file', async () => {
    const { io } = createIO();
    expect(await run(['https://api.test/items', '--out', 'items.ts'], io)).toBe(0);
    expect(io.fetch).toHaveBeenCalledWith('https://api.test/items');
    expect(io.writeFile).toHaveBeenCalledWith('items.ts', 'export type Root = number[];\n');
  });

  it('reports failed requests', async () => {
    const { io, err } = createIO({
      fetch: () => Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') }),
    });
    expect(await run(['http://api.test/missing'], io)).toBe(1);
    expect(err.join('')).toContain('failed with status 404');
  });

  it('reports invalid JSON and non-Error throws', async () => {
    const bad = createIO({ readFile: () => Promise.resolve('{') });
    expect(await run(['bad.json'], bad.io)).toBe(1);
    expect(bad.err.join('')).toMatch(/^auto-types-api: /);

    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- covers non-Error throws
    const odd = createIO({ readFile: () => Promise.reject('boom') });
    expect(await run(['x.json'], odd.io)).toBe(1);
    expect(odd.err.join('')).toBe('auto-types-api: boom\n');
  });
});
