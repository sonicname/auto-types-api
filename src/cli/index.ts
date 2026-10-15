import { readFile, writeFile } from 'node:fs/promises';
import { run } from './run';

process.exitCode = await run(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  readFile: (path) => readFile(path, 'utf8'),
  writeFile: (path, content) => writeFile(path, content, 'utf8'),
  fetch: (url) => fetch(url),
});
