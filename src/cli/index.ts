import { watch } from 'node:fs';
import { generateRoutes } from '../codegen';
import { run } from './run';

const code = await run(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  generate: generateRoutes,
  watch: (dir, onChange) => {
    const watcher = watch(dir, { recursive: true }, (_event, file) => {
      // The generated files usually live in the app directory too.
      if (file && !/\.gen(\.server)?\.ts$/.test(file)) onChange();
    });
    return () => {
      watcher.close();
    };
  },
});
if (code !== 0) process.exitCode = code;
