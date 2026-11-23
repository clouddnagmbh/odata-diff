import {
  changeCounts,
  metadataDiffMarkdown,
  type ChangeKind,
  type ChangeSeverity,
  type MetadataChange,
} from './core';

/**
 * Reports of the `$metadata` diff for the command line: text for the CI log,
 * Markdown for a pull request comment, JSON for further tools. The change
 * texts are the workbench's (`diff.kind.*` in odata-workbench); a test keeps
 * both in step.
 */

export type Lang = 'en' | 'de';
export type Format = 'text' | 'markdown' | 'json';
/** Lowest severity that fails the run; `never` only reports. */
export type FailOn = ChangeSeverity | 'never';

export const KIND_TEXTS: Record<Lang, Record<ChangeKind, string>> = {
  en: {
    'set-removed': 'Entity set removed',
    'set-added': 'Entity set added',
    'set-type': 'Entity type of the set changed: {before} → {after}',
    'type-removed': 'Type removed',
    'type-added': 'Type added',
    key: 'Key changed: {before} → {after}',
    'base-type': 'Base type changed: {before} → {after}',
    'property-removed': 'Property removed ({before})',
    'property-added': 'Property added ({after})',
    'property-type': 'Type changed: {before} → {after}',
    'max-length': 'MaxLength {before} → {after}',
    precision: 'Precision {before} → {after}',
    scale: 'Scale {before} → {after}',
    nullable: 'Nullable {before} → {after}',
    'navigation-removed': 'Navigation removed ({before})',
    'navigation-added': 'Navigation added ({after})',
    'navigation-target': 'Navigation target changed: {before} → {after}',
    multiplicity: 'Multiplicity {before} → {after}',
    'operation-removed': 'Operation removed',
    'operation-added': 'Operation added',
    'parameter-removed': 'Parameter removed ({before})',
    'parameter-added': 'Parameter added ({after})',
    'parameter-type': 'Parameter type changed: {before} → {after}',
    'return-type': 'Return type changed: {before} → {after}',
    'http-method': 'HTTP method changed: {before} → {after}',
    'member-removed': 'Enum member removed',
    'member-added': 'Enum member added',
    'annotation-removed': 'Annotation removed: {before}',
    'annotation-added': 'Annotation added: {after}',
    'annotation-changed': '{before} → {after}',
    version: 'OData version {before} → {after}',
  },
  de: {
    'set-removed': 'Entitätsmenge entfernt',
    'set-added': 'Entitätsmenge hinzugekommen',
    'set-type': 'Entitätstyp der Menge geändert: {before} → {after}',
    'type-removed': 'Typ entfernt',
    'type-added': 'Typ hinzugekommen',
    key: 'Schlüssel geändert: {before} → {after}',
    'base-type': 'Basistyp geändert: {before} → {after}',
    'property-removed': 'Property entfernt ({before})',
    'property-added': 'Property hinzugekommen ({after})',
    'property-type': 'Typ geändert: {before} → {after}',
    'max-length': 'MaxLength {before} → {after}',
    precision: 'Precision {before} → {after}',
    scale: 'Scale {before} → {after}',
    nullable: 'Nullable {before} → {after}',
    'navigation-removed': 'Navigation entfernt ({before})',
    'navigation-added': 'Navigation hinzugekommen ({after})',
    'navigation-target': 'Ziel der Navigation geändert: {before} → {after}',
    multiplicity: 'Kardinalität {before} → {after}',
    'operation-removed': 'Operation entfernt',
    'operation-added': 'Operation hinzugekommen',
    'parameter-removed': 'Parameter entfernt ({before})',
    'parameter-added': 'Parameter hinzugekommen ({after})',
    'parameter-type': 'Typ des Parameters geändert: {before} → {after}',
    'return-type': 'Rückgabetyp geändert: {before} → {after}',
    'http-method': 'HTTP-Methode geändert: {before} → {after}',
    'member-removed': 'Enum-Wert entfernt',
    'member-added': 'Enum-Wert hinzugekommen',
    'annotation-removed': 'Annotation entfernt: {before}',
    'annotation-added': 'Annotation hinzugekommen: {after}',
    'annotation-changed': '{before} → {after}',
    version: 'OData-Version {before} → {after}',
  },
};

const TEXTS = {
  en: {
    title: (before: string, after: string) => `$metadata diff: ${before} → ${after}`,
    severity: { breaking: 'breaking', compatible: 'compatible', annotation: 'annotation only' },
    none: 'No differences.',
    counts: (c: Record<ChangeSeverity, number>) =>
      `${c.breaking} breaking, ${c.compatible} compatible, ${c.annotation} annotation only`,
    failed: (n: number, failOn: ChangeSeverity) =>
      `✗ ${n} change(s) at or above “${TEXTS.en.severity[failOn]}” – failing (--fail-on ${failOn})`,
    passed: (failOn: FailOn) =>
      failOn === 'never'
        ? '✓ report only (--fail-on never)'
        : `✓ no change at or above “${TEXTS.en.severity[failOn]}”`,
  },
  de: {
    title: (before: string, after: string) => `$metadata-Vergleich: ${before} → ${after}`,
    severity: { breaking: 'brechend', compatible: 'verträglich', annotation: 'nur Annotation' },
    none: 'Keine Unterschiede.',
    counts: (c: Record<ChangeSeverity, number>) =>
      `${c.breaking} brechend, ${c.compatible} verträglich, ${c.annotation} nur Annotation`,
    failed: (n: number, failOn: ChangeSeverity) =>
      `✗ ${n} Änderung(en) ab „${TEXTS.de.severity[failOn]}“ – Abbruch (--fail-on ${failOn})`,
    passed: (failOn: FailOn) =>
      failOn === 'never'
        ? '✓ nur Bericht (--fail-on never)'
        : `✓ keine Änderung ab „${TEXTS.de.severity[failOn]}“`,
  },
} as const;

const RANK: Record<ChangeSeverity, number> = { breaking: 0, compatible: 1, annotation: 2 };

/** Changes that fail the run: the given severity and everything more severe. */
export const failingChanges = (
  changes: readonly MetadataChange[],
  failOn: FailOn,
): MetadataChange[] =>
  failOn === 'never' ? [] : changes.filter((change) => RANK[change.severity] <= RANK[failOn]);

export const describeChange = (change: MetadataChange, lang: Lang): string =>
  KIND_TEXTS[lang][change.kind]
    .replace('{before}', change.before ?? '')
    .replace('{after}', change.after ?? '');

export interface ReportInput {
  changes: readonly MetadataChange[];
  /** How the two sides are named in the report: file name or URL. */
  before: string;
  after: string;
  failOn: FailOn;
  lang: Lang;
}

const textReport = ({ changes, before, after, failOn, lang }: ReportInput): string => {
  const t = TEXTS[lang];
  const lines = [t.title(before, after), t.counts(changeCounts(changes)), ''];
  if (!changes.length) lines.push(t.none, '');
  const width = Math.max(...changes.map((change) => change.target.length), 0);
  for (const change of changes)
    lines.push(
      `${t.severity[change.severity].toUpperCase().padEnd(16)}${change.target.padEnd(width + 2)}${describeChange(change, lang)}`,
    );
  if (changes.length) lines.push('');
  lines.push(summaryLine({ changes, before, after, failOn, lang }));
  return `${lines.join('\n')}\n`;
};

/** The last line of every text report; also printed alone when the report goes to a file. */
export const summaryLine = ({ changes, failOn, lang }: ReportInput): string => {
  const failing = failingChanges(changes, failOn);
  return failing.length && failOn !== 'never'
    ? TEXTS[lang].failed(failing.length, failOn)
    : TEXTS[lang].passed(failOn);
};

export const formatReport = (format: Format, input: ReportInput): string => {
  if (format === 'json')
    return `${JSON.stringify(
      {
        before: input.before,
        after: input.after,
        counts: changeCounts(input.changes),
        failOn: input.failOn,
        failed: failingChanges(input.changes, input.failOn).length > 0,
        changes: input.changes,
      },
      null,
      2,
    )}\n`;
  if (format === 'markdown') {
    const t = TEXTS[input.lang];
    return metadataDiffMarkdown(input.changes, {
      title: t.title(input.before, input.after),
      severity: (severity) => t.severity[severity],
      describe: (change) => describeChange(change, input.lang),
      none: t.none,
    });
  }
  return textReport(input);
};
