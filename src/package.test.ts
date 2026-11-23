import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('package.json publishes as npm expects: bin without "./" (npm 11 drops it), no source exports', async () => {
  const pkg = JSON.parse(await readFile(join(import.meta.dirname, '../package.json'), 'utf8'));
  expect(pkg.bin).toEqual({ 'odata-diff': 'dist/cli.js' });
  expect(pkg.exports).toBeUndefined();
  expect(pkg.repository.url).toBe('git+https://github.com/clouddnagmbh/odata-diff.git');
  expect(pkg.publishConfig).toEqual({ registry: 'https://registry.npmjs.org', access: 'public' });
  expect(pkg.files).toContain('dist');
  expect(pkg.license).toBe('Apache-2.0');
});
