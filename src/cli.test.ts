import { describe, expect, it } from 'vitest';
import { EXIT, HELP, run } from './cli';
import { testIo } from './test-io';

describe('odata-diff', () => {
  it('passes when a new version only adds (default --fail-on breaking)', async () => {
    const t = testIo();
    expect(await run(['v1.xml', 'v2-additive.xml'], t.io)).toBe(EXIT.passed);
    expect(t.out()).toContain('0 breaking, 1 compatible, 1 annotation only');
    expect(t.out()).toMatch(/COMPATIBLE\s+Order\/Currency\s+Property added \(Edm.String\)/);
    expect(t.out()).toContain('✓ no change at or above “breaking”');
  });

  it('fails with exit code 1 on removed properties, shorter MaxLength and new required fields', async () => {
    const t = testIo();
    expect(await run(['v1.xml', 'v2-breaking.xml'], t.io)).toBe(EXIT.failed);
    const out = t.out();
    expect(out).toMatch(/BREAKING\s+Order\/Note\s+Property removed \(Edm.String\)/);
    expect(out).toMatch(/BREAKING\s+Order\/Customer\s+MaxLength 40 → 20/);
    expect(out).toMatch(/BREAKING\s+Order\/Status\s+Property added \(Edm.String, Nullable=false\)/);
    expect(out).toContain('✗ 3 change(s) at or above “breaking”');
  });

  it('--fail-on compatible makes additions fail, never only reports', async () => {
    expect(await run(['v1.xml', 'v2-additive.xml', '--fail-on', 'compatible'], testIo().io)).toBe(
      EXIT.failed,
    );
    expect(await run(['v1.xml', 'v2-breaking.xml', '--fail-on', 'never'], testIo().io)).toBe(
      EXIT.passed,
    );
  });

  it('--no-annotations leaves label changes out, so --fail-on annotation passes', async () => {
    const t = testIo();
    const files = { 'a.xml': await t.io.readFile('v1.xml') };
    const labelOnly = files['a.xml'].replace('sap:label="Customer"', 'sap:label="Kunde"');
    const io = testIo({ files: { ...files, 'b.xml': labelOnly } });
    expect(await run(['a.xml', 'b.xml', '--fail-on', 'annotation'], io.io)).toBe(EXIT.failed);
    expect(
      await run(['a.xml', 'b.xml', '--fail-on', 'annotation', '--no-annotations'], io.io),
    ).toBe(EXIT.passed);
  });

  it('XML and CSDL JSON of the same CAP service have no breaking difference', async () => {
    expect(await run(['cap-orders.xml', 'cap-orders.json'], testIo().io)).toBe(EXIT.passed);
  });

  it('--output writes the Markdown report to a file and prints only the verdict', async () => {
    const t = testIo();
    const code = await run(
      ['v1.xml', 'v2-breaking.xml', '--format', 'markdown', '--output', 'diff.md', '--lang', 'de'],
      t.io,
    );
    expect(code).toBe(EXIT.failed);
    expect(t.written['diff.md']).toContain('## brechend (3)');
    expect(t.out()).toBe('✗ 3 Änderung(en) ab „brechend“ – Abbruch (--fail-on breaking)\n');
  });

  it('--format json for other tools', async () => {
    const t = testIo();
    await run(['v1.xml', 'v2-breaking.xml', '--format', 'json'], t.io);
    expect(JSON.parse(t.out())).toMatchObject({ failed: true, counts: { breaking: 3 } });
  });

  it('compares a live service against a file, with headers only on the request', async () => {
    const t = testIo({
      responses: {
        'https://h/sap/opu/odata/sap/ZAPI_ORDERS_SRV/$metadata': {
          status: 200,
          body: await testIo().io.readFile('v1.xml'),
        },
      },
    });
    const code = await run(
      [
        'https://h/sap/opu/odata/sap/ZAPI_ORDERS_SRV',
        'v2-additive.xml',
        '--header',
        'Authorization: Basic c2VjcmV0',
      ],
      t.io,
    );
    expect(code).toBe(EXIT.passed);
    expect(t.requests[0]!.headers.Authorization).toBe('Basic c2VjcmV0');
    expect(t.out()).toContain(
      'https://h/sap/opu/odata/sap/ZAPI_ORDERS_SRV/$metadata → v2-additive.xml',
    );
    expect(t.out() + t.err()).not.toContain('c2VjcmV0');
  });

  it('exit code 2 with a message for usage and input errors', async () => {
    for (const [argv, message] of [
      [['v1.xml'], 'expected <before> and <after>, got 1 argument(s)'],
      [
        ['v1.xml', 'v2-additive.xml', '--fail-on', 'minor'],
        '--fail-on must be one of breaking, compatible, annotation, never',
      ],
      [
        ['v1.xml', 'v2-additive.xml', '--format', 'html'],
        '--format must be one of text, markdown, json',
      ],
      [['v1.xml', 'v2-additive.xml', '--colour'], "Unknown option '--colour'"],
      [['v1.xml', 'nope.xml'], 'nope.xml: file not found'],
    ] as const) {
      const t = testIo();
      expect(await run(argv, t.io), argv.join(' ')).toBe(EXIT.error);
      expect(t.err()).toContain(message);
      expect(t.err()).toContain('Run "odata-diff --help" for usage.');
    }
  });

  it('--help and --version', async () => {
    const help = testIo();
    expect(await run(['--help'], help.io)).toBe(EXIT.passed);
    expect(help.out()).toBe(`${HELP}\n`);
    const version = testIo();
    expect(await run(['-v'], version.io)).toBe(EXIT.passed);
    expect(version.out()).toBe('0.0.0-test\n');
  });
});
