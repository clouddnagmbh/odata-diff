import { readFile, writeFile } from 'node:fs/promises';
import { version } from '../package.json';
import { run } from './cli';

/**
 * Entry point of `npx odatatailor-diff` and `odata-diff`. Vite bundles this
 * file, the CLI and the core into one `dist/cli.js` with a shebang, so the
 * published package has no dependencies.
 *
 * It only connects `run` to Node.js. The exit code goes to `process.exitCode`
 * rather than `process.exit()`, so stdout is flushed completely even when it
 * is a pipe (`odata-diff … --format json | jq`).
 */
process.exitCode = await run(process.argv.slice(2), {
  readFile: (path) => readFile(path, 'utf8'),
  writeFile: (path, text) => writeFile(path, text, 'utf8'),
  fetch: (url, init) => fetch(url, init),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  version,
});
