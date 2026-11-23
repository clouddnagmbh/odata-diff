import { readFile, writeFile } from 'node:fs/promises';
import { version } from '../package.json';
import { run } from './cli';

// Entry of `npx odatatailor-diff` / `odata-diff`; vite bundles it to dist/cli.js.
process.exitCode = await run(process.argv.slice(2), {
  readFile: (path) => readFile(path, 'utf8'),
  writeFile: (path, text) => writeFile(path, text, 'utf8'),
  fetch: (url, init) => fetch(url, init),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  version,
});
