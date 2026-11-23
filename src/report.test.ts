import { describe, expect, it } from 'vitest';
import type { MetadataChange } from './core';
import { describeChange, failingChanges, formatReport, summaryLine } from './report';

const changes: MetadataChange[] = [
  { severity: 'breaking', kind: 'property-removed', target: 'Order/Note', before: 'String' },
  { severity: 'compatible', kind: 'property-added', target: 'Order/Currency', after: 'String' },
  {
    severity: 'annotation',
    kind: 'annotation-changed',
    target: 'Order/Customer@Common.Label',
    before: 'Customer',
    after: 'Customer name',
  },
];
const input = {
  changes,
  before: 'v1.xml',
  after: 'v2.xml',
  failOn: 'breaking' as const,
  lang: 'en' as const,
};

describe('describeChange', () => {
  it('fills before and after', () => {
    expect(describeChange(changes[2]!, 'de')).toBe('Customer → Customer name');
    expect(describeChange(changes[0]!, 'en')).toBe('Property removed (String)');
  });
});

describe('failingChanges', () => {
  it('fails on the given severity and everything more severe', () => {
    expect(failingChanges(changes, 'breaking')).toHaveLength(1);
    expect(failingChanges(changes, 'compatible')).toHaveLength(2);
    expect(failingChanges(changes, 'annotation')).toHaveLength(3);
    expect(failingChanges(changes, 'never')).toHaveLength(0);
  });
});

describe('formatReport', () => {
  it('text: title, counts, one line per change, verdict', () => {
    const text = formatReport('text', input);
    expect(text).toContain('$metadata diff: v1.xml → v2.xml');
    expect(text).toContain('1 breaking, 1 compatible, 1 annotation only');
    expect(text).toMatch(/BREAKING\s+Order\/Note\s+Property removed \(String\)/);
    expect(text).toMatch(
      /ANNOTATION ONLY\s+Order\/Customer@Common.Label\s+Customer → Customer name/,
    );
    expect(text.trimEnd().split('\n').at(-1)).toBe(
      '✗ 1 change(s) at or above “breaking” – failing (--fail-on breaking)',
    );
  });

  it('text: no differences', () => {
    const text = formatReport('text', { ...input, changes: [] });
    expect(text).toContain('No differences.');
    expect(text).toContain('✓ no change at or above “breaking”');
  });

  it('markdown: grouped tables for a pull request comment, in German too', () => {
    const md = formatReport('markdown', { ...input, lang: 'de' });
    expect(md).toContain('# $metadata-Vergleich: v1.xml → v2.xml');
    expect(md).toContain('## brechend (1)');
    expect(md).toContain('| `Order/Note` | Property entfernt (String) |');
    expect(md).toContain('## nur Annotation (1)');
  });

  it('json: counts, verdict and the raw changes', () => {
    const json = JSON.parse(formatReport('json', { ...input, failOn: 'compatible' }));
    expect(json).toMatchObject({
      before: 'v1.xml',
      after: 'v2.xml',
      counts: { breaking: 1, compatible: 1, annotation: 1 },
      failOn: 'compatible',
      failed: true,
    });
    expect(json.changes).toHaveLength(3);
  });

  it('summaryLine: report only with --fail-on never, German verdicts', () => {
    expect(summaryLine({ ...input, failOn: 'never' })).toBe('✓ report only (--fail-on never)');
    expect(summaryLine({ ...input, lang: 'de' })).toBe(
      '✗ 1 Änderung(en) ab „brechend“ – Abbruch (--fail-on breaking)',
    );
    expect(summaryLine({ ...input, changes: [], lang: 'de' })).toBe(
      '✓ keine Änderung ab „brechend“',
    );
  });
});
