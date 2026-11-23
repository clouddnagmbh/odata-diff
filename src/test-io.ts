import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CliIo } from './cli';

/**
 * In-memory `CliIo` for tests: the whole command runs without disk writes or network.
 *
 * - `readFile` serves `files`, else the file of that name in `__fixtures__`
 * - `fetch` answers from `responses` by exact URL, else fails like a DNS error
 * - `requests` records URL and headers of every fetch, so tests can check what was sent
 * - `out()`, `err()` and `written` hold what the command printed and wrote
 */
export const testIo = (
  options: {
    files?: Record<string, string>;
    responses?: Record<string, { status: number; body: string }>;
  } = {},
) => {
  const out: string[] = [];
  const err: string[] = [];
  const written: Record<string, string> = {};
  const requests: { url: string; headers: Record<string, string> }[] = [];
  const io: CliIo = {
    readFile: async (path) =>
      options.files?.[path] ?? readFile(join(import.meta.dirname, '__fixtures__', path), 'utf8'),
    writeFile: async (path, text) => {
      written[path] = text;
    },
    fetch: async (url, init) => {
      requests.push({ url, headers: init.headers });
      const response = options.responses?.[url];
      if (!response) throw new Error('getaddrinfo ENOTFOUND');
      return {
        ok: response.status < 400,
        status: response.status,
        statusText: response.status === 401 ? 'Unauthorized' : '',
        text: async () => response.body,
      };
    },
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    version: '0.0.0-test',
  };
  return { io, out: () => out.join(''), err: () => err.join(''), written, requests };
};
