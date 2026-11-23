import type {
  EnumTypeInfo,
  MetadataIndex,
  NavigationInfo,
  OperationInfo,
  PropertyInfo,
  StructuredTypeInfo,
} from './metadata';

/**
 * `$metadata` diff (KONZEPT 4.6): two states of a service – system A
 * against B, or a file against a system – with every change classified for
 * consumers: breaking, compatible, or annotation only. Types, sets and
 * operations are matched by name, so the same service with another
 * namespace or container name on another system still compares.
 */

export type ChangeSeverity = 'breaking' | 'compatible' | 'annotation';

export type ChangeKind =
  | 'set-removed'
  | 'set-added'
  | 'set-type'
  | 'type-removed'
  | 'type-added'
  | 'key'
  | 'base-type'
  | 'property-removed'
  | 'property-added'
  | 'property-type'
  | 'max-length'
  | 'precision'
  | 'scale'
  | 'nullable'
  | 'navigation-removed'
  | 'navigation-added'
  | 'navigation-target'
  | 'multiplicity'
  | 'operation-removed'
  | 'operation-added'
  | 'parameter-removed'
  | 'parameter-added'
  | 'parameter-type'
  | 'return-type'
  | 'http-method'
  | 'member-removed'
  | 'member-added'
  | 'annotation-removed'
  | 'annotation-added'
  | 'annotation-changed'
  | 'version';

export interface MetadataChange {
  severity: ChangeSeverity;
  kind: ChangeKind;
  /** What changed: `Products`, `Product/Name`, `Product/Name@Common.Label`. */
  target: string;
  before?: string;
  after?: string;
}

const byName = <T extends { name: string }>(list: readonly T[]) =>
  new Map(list.map((entry) => [entry.name, entry]));

/** Short name of a qualified type: `ZSRV.Product` → `Product`, `Collection(ZSRV.Item)` → `Collection(Item)`. */
const shortType = (type: string | undefined) =>
  type?.replace(/(?:[\w]+\.)+(\w+)/g, (full, last: string) =>
    full.startsWith('Edm.') ? full : last,
  );

const length = (value: string | undefined) =>
  value === undefined || value.toLowerCase() === 'max' ? Number.POSITIVE_INFINITY : Number(value);

const compareProperty = (
  owner: string,
  before: PropertyInfo,
  after: PropertyInfo,
  changes: MetadataChange[],
) => {
  const target = `${owner}/${before.name}`;
  if (before.type !== after.type)
    changes.push({
      severity: 'breaking',
      kind: 'property-type',
      target,
      before: shortType(before.type) ?? '',
      after: shortType(after.type) ?? '',
    });
  if (before.maxLength !== after.maxLength)
    changes.push({
      severity: length(after.maxLength) < length(before.maxLength) ? 'breaking' : 'compatible',
      kind: 'max-length',
      target,
      before: before.maxLength ?? '–',
      after: after.maxLength ?? '–',
    });
  for (const facet of ['precision', 'scale'] as const)
    if (before[facet] !== after[facet])
      changes.push({
        severity: length(after[facet]) < length(before[facet]) ? 'breaking' : 'compatible',
        kind: facet,
        target,
        before: before[facet] ?? '–',
        after: after[facet] ?? '–',
      });
  if (before.nullable !== after.nullable)
    changes.push({
      // Required now: creating clients break. Optional now: readers may get null.
      severity: after.nullable ? 'compatible' : 'breaking',
      kind: 'nullable',
      target,
      before: String(before.nullable),
      after: String(after.nullable),
    });
};

const compareNavigation = (
  owner: string,
  before: NavigationInfo,
  after: NavigationInfo,
  changes: MetadataChange[],
) => {
  const target = `${owner}/${before.name}`;
  const beforeType = shortType(before.type);
  const afterType = shortType(after.type);
  if (beforeType !== afterType)
    changes.push({
      severity: 'breaking',
      kind: 'navigation-target',
      target,
      before: beforeType ?? '–',
      after: afterType ?? '–',
    });
  if (before.multiplicity !== after.multiplicity)
    changes.push({
      severity: 'breaking',
      kind: 'multiplicity',
      target,
      before: before.multiplicity ?? '–',
      after: after.multiplicity ?? '–',
    });
};

const compareType = (
  before: StructuredTypeInfo,
  after: StructuredTypeInfo,
  changes: MetadataChange[],
) => {
  const owner = before.name;
  if (before.keys.join(',') !== after.keys.join(','))
    changes.push({
      severity: 'breaking',
      kind: 'key',
      target: owner,
      before: before.keys.join(', '),
      after: after.keys.join(', '),
    });
  if (shortType(before.baseType) !== shortType(after.baseType))
    changes.push({
      severity: 'breaking',
      kind: 'base-type',
      target: owner,
      before: shortType(before.baseType) ?? '–',
      after: shortType(after.baseType) ?? '–',
    });
  const old = byName(before.properties);
  const next = byName(after.properties);
  for (const [name, property] of old) {
    const counterpart = next.get(name);
    if (!counterpart)
      changes.push({
        severity: 'breaking',
        kind: 'property-removed',
        target: `${owner}/${name}`,
        before: shortType(property.type) ?? '',
      });
    else compareProperty(owner, property, counterpart, changes);
  }
  for (const [name, property] of next)
    if (!old.has(name))
      changes.push({
        // A new required property breaks clients that create records.
        severity: property.nullable ? 'compatible' : 'breaking',
        kind: 'property-added',
        target: `${owner}/${name}`,
        after: `${shortType(property.type) ?? ''}${property.nullable ? '' : ', Nullable=false'}`,
      });
  const oldNav = byName(before.navigations);
  const nextNav = byName(after.navigations);
  for (const [name, navigation] of oldNav) {
    const counterpart = nextNav.get(name);
    if (!counterpart)
      changes.push({
        severity: 'breaking',
        kind: 'navigation-removed',
        target: `${owner}/${name}`,
        before: shortType(navigation.type) ?? '',
      });
    else compareNavigation(owner, navigation, counterpart, changes);
  }
  for (const [name, navigation] of nextNav)
    if (!oldNav.has(name))
      changes.push({
        severity: 'compatible',
        kind: 'navigation-added',
        target: `${owner}/${name}`,
        after: shortType(navigation.type) ?? '',
      });
};

const operationKey = (operation: OperationInfo) =>
  operation.isBound ? `${shortType(operation.bindingType)}/${operation.name}` : operation.name;

const compareOperation = (
  before: OperationInfo,
  after: OperationInfo,
  changes: MetadataChange[],
) => {
  const target = operationKey(before);
  const old = byName(before.parameters);
  const next = byName(after.parameters);
  for (const [name, parameter] of old) {
    const counterpart = next.get(name);
    if (!counterpart)
      changes.push({
        severity: 'breaking',
        kind: 'parameter-removed',
        target: `${target}(${name})`,
        before: shortType(parameter.type) ?? '',
      });
    else if (parameter.type !== counterpart.type)
      changes.push({
        severity: 'breaking',
        kind: 'parameter-type',
        target: `${target}(${name})`,
        before: shortType(parameter.type) ?? '',
        after: shortType(counterpart.type) ?? '',
      });
  }
  for (const [name, parameter] of next)
    if (!old.has(name))
      changes.push({
        severity: parameter.nullable ? 'compatible' : 'breaking',
        kind: 'parameter-added',
        target: `${target}(${name})`,
        after: shortType(parameter.type) ?? '',
      });
  if (shortType(before.returnType) !== shortType(after.returnType))
    changes.push({
      severity: 'breaking',
      kind: 'return-type',
      target,
      before: shortType(before.returnType) ?? '–',
      after: shortType(after.returnType) ?? '–',
    });
  if ((before.httpMethod ?? '') !== (after.httpMethod ?? ''))
    changes.push({
      severity: 'breaking',
      kind: 'http-method',
      target,
      before: before.httpMethod ?? '–',
      after: after.httpMethod ?? '–',
    });
};

const compareEnum = (before: EnumTypeInfo, after: EnumTypeInfo, changes: MetadataChange[]) => {
  const next = new Set(after.members.map((member) => member.name));
  const old = new Set(before.members.map((member) => member.name));
  for (const name of old)
    if (!next.has(name))
      changes.push({
        severity: 'breaking',
        kind: 'member-removed',
        target: `${before.name}/${name}`,
      });
  for (const name of next)
    if (!old.has(name))
      changes.push({
        severity: 'compatible',
        kind: 'member-added',
        target: `${before.name}/${name}`,
      });
};

/** `ZSRV.Product/Name` → `Product/Name`: the namespace may differ between systems. */
const annotationTarget = (target: string) =>
  target
    .split('/')
    .map((part) => part.replace(/^(?:[\w]+\.)+(\w+)$/, '$1'))
    .join('/');

const termName = (term: string) =>
  term
    .replace(/^com\.sap\.vocabularies\.(\w+)\.v1\./, '$1.')
    .replace(/^Org\.OData\.(\w+)\.V1\./, '$1.');

export const diffMetadata = (before: MetadataIndex, after: MetadataIndex): MetadataChange[] => {
  const changes: MetadataChange[] = [];
  if (before.odataVersion !== after.odataVersion)
    changes.push({
      severity: 'breaking',
      kind: 'version',
      target: '$metadata',
      before: before.odataVersion ?? '–',
      after: after.odataVersion ?? '–',
    });

  const oldSets = byName(before.entitySets);
  const nextSets = byName(after.entitySets);
  for (const [name, set] of oldSets) {
    const counterpart = nextSets.get(name);
    if (!counterpart) changes.push({ severity: 'breaking', kind: 'set-removed', target: name });
    else if (shortType(set.entityType) !== shortType(counterpart.entityType))
      changes.push({
        severity: 'breaking',
        kind: 'set-type',
        target: name,
        before: shortType(set.entityType) ?? '',
        after: shortType(counterpart.entityType) ?? '',
      });
  }
  for (const name of nextSets.keys())
    if (!oldSets.has(name))
      changes.push({ severity: 'compatible', kind: 'set-added', target: name });

  const types = (index: MetadataIndex) => byName([...index.entityTypes, ...index.complexTypes]);
  const oldTypes = types(before);
  const nextTypes = types(after);
  for (const [name, type] of oldTypes) {
    const counterpart = nextTypes.get(name);
    if (!counterpart) changes.push({ severity: 'breaking', kind: 'type-removed', target: name });
    else compareType(type, counterpart, changes);
  }
  for (const name of nextTypes.keys())
    if (!oldTypes.has(name))
      changes.push({ severity: 'compatible', kind: 'type-added', target: name });

  const oldEnums = byName(before.enumTypes);
  const nextEnums = byName(after.enumTypes);
  for (const [name, type] of oldEnums) {
    const counterpart = nextEnums.get(name);
    if (!counterpart) changes.push({ severity: 'breaking', kind: 'type-removed', target: name });
    else compareEnum(type, counterpart, changes);
  }
  for (const name of nextEnums.keys())
    if (!oldEnums.has(name))
      changes.push({ severity: 'compatible', kind: 'type-added', target: name });

  const operations = (index: MetadataIndex) =>
    new Map(
      index.operations
        // V4 imports point to actions and functions, which are compared themselves.
        .filter(
          (operation) =>
            index.odataVersion === '2.0' ||
            (operation.kind !== 'ActionImport' && operation.kind !== 'FunctionImport'),
        )
        .map((operation) => [operationKey(operation), operation]),
    );
  const oldOperations = operations(before);
  const nextOperations = operations(after);
  for (const [key, operation] of oldOperations) {
    const counterpart = nextOperations.get(key);
    if (!counterpart)
      changes.push({ severity: 'breaking', kind: 'operation-removed', target: key });
    else compareOperation(operation, counterpart, changes);
  }
  for (const key of nextOperations.keys())
    if (!oldOperations.has(key))
      changes.push({ severity: 'compatible', kind: 'operation-added', target: key });

  const annotations = (index: MetadataIndex) =>
    new Map(
      index.annotations.map((annotation) => [
        `${annotationTarget(annotation.target)}@${termName(annotation.term)}${annotation.qualifier ? `#${annotation.qualifier}` : ''}`,
        annotation.value,
      ]),
    );
  const oldAnnotations = annotations(before);
  const nextAnnotations = annotations(after);
  for (const [key, value] of oldAnnotations) {
    const counterpart = nextAnnotations.get(key);
    if (counterpart === undefined)
      changes.push({
        severity: 'annotation',
        kind: 'annotation-removed',
        target: key,
        before: value,
      });
    else if (counterpart !== value)
      changes.push({
        severity: 'annotation',
        kind: 'annotation-changed',
        target: key,
        before: value,
        after: counterpart,
      });
  }
  for (const [key, value] of nextAnnotations)
    if (!oldAnnotations.has(key))
      changes.push({ severity: 'annotation', kind: 'annotation-added', target: key, after: value });

  const rank: Record<ChangeSeverity, number> = { breaking: 0, compatible: 1, annotation: 2 };
  return changes.sort(
    (a, b) => rank[a.severity] - rank[b.severity] || a.target.localeCompare(b.target),
  );
};

/** Counts per severity, for the summary. */
export const changeCounts = (
  changes: readonly MetadataChange[],
): Record<ChangeSeverity, number> => ({
  breaking: changes.filter((change) => change.severity === 'breaking').length,
  compatible: changes.filter((change) => change.severity === 'compatible').length,
  annotation: changes.filter((change) => change.severity === 'annotation').length,
});

/**
 * The diff as a Markdown report; texts come from the caller (UI language),
 * so the core stays free of i18n.
 */
export const metadataDiffMarkdown = (
  changes: readonly MetadataChange[],
  texts: {
    title: string;
    severity: (severity: ChangeSeverity) => string;
    describe: (change: MetadataChange) => string;
    none: string;
  },
): string => {
  const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const lines = [`# ${texts.title}`, ''];
  if (!changes.length) return [...lines, texts.none, ''].join('\n');
  for (const severity of ['breaking', 'compatible', 'annotation'] as const) {
    const group = changes.filter((change) => change.severity === severity);
    if (!group.length) continue;
    lines.push(`## ${texts.severity(severity)} (${group.length})`, '', '| | |', '| --- | --- |');
    for (const change of group)
      lines.push(`| \`${cell(change.target)}\` | ${cell(texts.describe(change))} |`);
    lines.push('');
  }
  return lines.join('\n');
};
