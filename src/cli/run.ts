import { parseArgs } from 'node:util';
import { generateTypes } from '../generate';

/** Process I/O the CLI depends on, injectable for tests. */
export interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  fetch: (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;
}

export const HELP = `Usage: auto-types-api <file|url> [options]

Generate TypeScript types from a JSON file or an API endpoint.

Options:
  -n, --name <name>  Name of the generated type (default: Root)
  -o, --out <file>   Write to a file instead of stdout
  -h, --help         Show this help
`;

/** Runs the CLI with the given arguments and returns the process exit code. */
export async function run(argv: string[], io: CliIO): Promise<number> {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        name: { type: 'string', short: 'n' },
        out: { type: 'string', short: 'o' },
        help: { type: 'boolean', short: 'h' },
      },
    });

    const source = positionals[0];
    if (values.help || source === undefined) {
      (values.help ? io.stdout : io.stderr)(HELP);
      return values.help ? 0 : 1;
    }

    const sample: unknown = JSON.parse(await load(source, io));
    const output = generateTypes(sample, values.name === undefined ? {} : { name: values.name });

    if (values.out === undefined) io.stdout(output);
    else await io.writeFile(values.out, output);
    return 0;
  } catch (error) {
    io.stderr(`auto-types-api: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function load(source: string, io: CliIO): Promise<string> {
  if (!/^https?:\/\//.test(source)) return io.readFile(source);
  const response = await io.fetch(source);
  if (!response.ok)
    throw new Error(`Request to ${source} failed with status ${String(response.status)}`);
  return response.text();
}
