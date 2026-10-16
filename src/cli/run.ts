import { parseArgs } from 'node:util';
import type { GenerateRoutesOptions, GenerateRoutesResult } from '../codegen';

/** Process I/O and side effects the CLI depends on, injectable for tests. */
export interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  generate: (options: GenerateRoutesOptions) => Promise<GenerateRoutesResult>;
  /** Calls `onChange` when anything under `dir` changes; returns a stop function. */
  watch: (dir: string, onChange: () => void) => () => void;
}

export const HELP = `Usage: auto-types-api generate [options]

Scan a modules-page-routing app for API files and generate typed endpoint-kit routes.

Options:
  -a, --app <dir>      App directory with api/ and modules/ (default: ./app)
  -o, --out <file>     Generated client file (default: <app>/api.gen.ts)
  -s, --server-out <file|false>
                       Generated server file (default: <app>/api.gen.server.ts)
  -p, --prefix <path>  URL prefix of the API routes (default: /api)
  -n, --name <name>    Name of the exported routes object (default: routes)
  -w, --watch          Regenerate when files change
  -h, --help           Show this help
`;

/**
 * Runs the CLI and resolves with the exit code. In watch mode it resolves once the first
 * generation is done and keeps watching.
 */
export async function run(argv: string[], io: CliIO): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        app: { type: 'string', short: 'a' },
        out: { type: 'string', short: 'o' },
        'server-out': { type: 'string', short: 's' },
        prefix: { type: 'string', short: 'p' },
        name: { type: 'string', short: 'n' },
        watch: { type: 'boolean', short: 'w' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (error) {
    io.stderr(`auto-types-api: ${(error as Error).message}\n\n${HELP}`);
    return 1;
  }

  const { values, positionals } = parsed;
  if (values.help) {
    io.stdout(HELP);
    return 0;
  }
  if (positionals[0] !== 'generate') {
    io.stderr(HELP);
    return 1;
  }

  const options: GenerateRoutesOptions = {};
  if (values.app !== undefined) options.appDir = values.app;
  if (values.out !== undefined) options.outFile = values.out;
  const serverOut = values['server-out'];
  if (serverOut !== undefined) options.serverOutFile = serverOut === 'false' ? false : serverOut;
  if (values.prefix !== undefined) options.prefix = values.prefix;
  if (values.name !== undefined) options.routesName = values.name;

  const once = async (): Promise<boolean> => {
    try {
      const result = await io.generate(options);
      for (const warning of result.warnings) io.stderr(`warn: ${warning}\n`);
      if (result.changed) {
        io.stdout(`Generated ${String(result.routes.length)} routes → ${result.outFile}\n`);
      }
      return true;
    } catch (error) {
      io.stderr(`auto-types-api: ${error instanceof Error ? error.message : String(error)}\n`);
      return false;
    }
  };

  const ok = await once();
  if (!values.watch) return ok ? 0 : 1;

  let timer: ReturnType<typeof setTimeout> | undefined;
  io.watch(options.appDir ?? 'app', () => {
    clearTimeout(timer);
    timer = setTimeout(() => void once(), 50);
  });
  io.stdout('Watching for changes...\n');
  return 0;
}
