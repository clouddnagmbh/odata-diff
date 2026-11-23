import {
  attrLocal,
  childNamed,
  childrenNamed,
  descendantsNamed,
  parseXml,
  type XmlElement,
} from './xml';

// Searchable index of an OData `$metadata` document (V2 or V4) plus annotation files.

/** A structural property of an entity or complex type. */
export interface PropertyInfo {
  name: string;
  /** Qualified type as written, e.g. `Edm.String` or `Collection(ZSRV.Address)`. */
  type: string;
  /** EDMX: `true` unless `Nullable="false"`. CSDL JSON: `true` only with `"$Nullable": true`. */
  nullable: boolean;
  /** Facets as written; absent means unlimited. `MaxLength` may be `max`. */
  maxLength?: string;
  precision?: string;
  scale?: string;
  /** Label from `sap:label` (V2) or `Common.Label` (V4, inline). */
  label?: string;
}

/** Multiplicity of an association or navigation end. */
export type Multiplicity = '1' | '0..1' | '*';

/** One pair of a referential constraint: property of the source type → property of the target type. */
export interface ReferentialConstraintInfo {
  property: string;
  referencedProperty: string;
}

export interface NavigationInfo {
  name: string;
  /** Target type, e.g. `ZSRV.Category` or `Collection(OrderService.OrderItems)`. */
  type?: string;
  /** V2: association; V4: partner. */
  relationship?: string;
  partner?: string;
  /** Multiplicity of the target end (V2: association end, V4: `Collection(…)` / `Nullable`). */
  multiplicity?: Multiplicity;
  /** V2: multiplicity of the source end of the association. */
  sourceMultiplicity?: Multiplicity;
  /** V2: roles of the association ends. */
  fromRole?: string;
  toRole?: string;
  /** V4 containment navigation (`ContainsTarget="true"`). */
  containsTarget?: boolean;
  /** Source property → target property (V4 inline, V2 from the association). */
  referentialConstraints?: ReferentialConstraintInfo[];
  /** V4 `OnDelete` action, e.g. `Cascade`. */
  onDelete?: string;
}

export interface EnumMemberInfo {
  name: string;
  value?: string;
}

/** A V4 enum type with its members. */
export interface EnumTypeInfo {
  name: string;
  qualifiedName: string;
  underlyingType?: string;
  isFlags: boolean;
  members: EnumMemberInfo[];
}

/** An entity type or complex type. */
export interface StructuredTypeInfo {
  /** Name without namespace, e.g. `Order`. */
  name: string;
  /** Name with namespace, e.g. `ZAPI_ORDERS_SRV.Order`. */
  qualifiedName: string;
  kind: 'EntityType' | 'ComplexType';
  /** Key property names in document order; empty for complex types. */
  keys: string[];
  baseType?: string;
  abstract?: boolean;
  properties: PropertyInfo[];
  navigations: NavigationInfo[];
}

/** An entity set or a V4 singleton of the entity container. */
export interface EntitySetInfo {
  name: string;
  entityType: string;
  container: string;
  kind: 'EntitySet' | 'Singleton';
  navigationBindings: Array<{ path: string; target: string }>;
}

/** A parameter of an action, function or V2 function import; `nullable` as in {@link PropertyInfo}. */
export interface ParameterInfo {
  name: string;
  type: string;
  nullable: boolean;
}

/** A V2 function import, or a V4 action, function, action import or function import. */
export interface OperationInfo {
  name: string;
  kind: 'FunctionImport' | 'ActionImport' | 'Action' | 'Function';
  qualifiedName: string;
  isBound: boolean;
  bindingType?: string;
  returnType?: string;
  entitySet?: string;
  /** V2 function imports: `m:HttpMethod`. */
  httpMethod?: string;
  parameters: ParameterInfo[];
}

export interface AnnotationInfo {
  target: string;
  term: string;
  qualifier?: string;
  /** Compact text of the annotation value. */
  value: string;
  /** `inline` ($metadata), `external` (annotation file), `sap` (V2 `sap:*` attributes). */
  source: 'inline' | 'external' | 'sap';
}

export interface MetadataIndex {
  /** `Version` of `edmx:Edmx` (`1.0` for OData V2, `4.0` for V4). */
  edmxVersion?: string;
  odataVersion?: '2.0' | '4.0';
  namespaces: string[];
  aliases: Record<string, string>;
  references: Array<{ uri: string; includes: Array<{ namespace: string; alias?: string }> }>;
  entityTypes: StructuredTypeInfo[];
  complexTypes: StructuredTypeInfo[];
  /** V4 enum types (V2 has none). */
  enumTypes: EnumTypeInfo[];
  entitySets: EntitySetInfo[];
  operations: OperationInfo[];
  annotations: AnnotationInfo[];
  /** Problems while parsing (empty for valid documents). */
  warnings: string[];
}

export type SearchKind =
  | 'EntitySet'
  | 'Singleton'
  | 'EntityType'
  | 'ComplexType'
  | 'Property'
  | 'NavigationProperty'
  | 'FunctionImport'
  | 'ActionImport'
  | 'Action'
  | 'Function'
  | 'Annotation';

export interface SearchEntry {
  kind: SearchKind;
  name: string;
  /** Location, e.g. `ZSRV.Product/Price` or the annotation target. */
  path: string;
  detail: string;
}

const VALUE_ATTRIBUTES = [
  'String',
  'Bool',
  'Int',
  'Decimal',
  'Float',
  'Date',
  'DateTimeOffset',
  'TimeOfDay',
  'Duration',
  'Guid',
  'Binary',
  'Path',
  'PropertyPath',
  'NavigationPropertyPath',
  'AnnotationPath',
  'ModelElementPath',
  'EnumMember',
  'UrlRef',
];

const MAX_VALUE = 400;

const clip = (value: string) =>
  value.length > MAX_VALUE ? `${value.slice(0, MAX_VALUE - 1)}…` : value;

/** Compact, readable text of an annotation (or nested expression) value. */
export const annotationValue = (node: XmlElement): string => {
  for (const name of VALUE_ATTRIBUTES) {
    const value = node.attrs[name];
    if (value !== undefined) return name === 'String' ? JSON.stringify(value) : value;
  }
  const parts = node.children.filter((child) => child.local !== 'Annotation');
  if (parts.length === 0) return node.text.trim() ? JSON.stringify(node.text.trim()) : '';
  return clip(parts.map(expressionText).join(', '));
};

const expressionText = (node: XmlElement): string => {
  switch (node.local) {
    case 'Record': {
      const type = node.attrs.Type ? `${node.attrs.Type} ` : '';
      const props = childrenNamed(node, 'PropertyValue').map(
        (prop) => `${prop.attrs.Property ?? '?'}: ${annotationValue(prop)}`,
      );
      return `${type}{${props.join(', ')}}`;
    }
    case 'Collection':
      return `[${node.children.map(expressionText).join(', ')}]`;
    case 'Apply':
      return `${node.attrs.Function ?? 'Apply'}(${node.children.map(expressionText).join(', ')})`;
    case 'String':
      return JSON.stringify(node.text);
    case 'Null':
      return 'null';
    case 'If':
    case 'Eq':
    case 'Ne':
    case 'And':
    case 'Or':
    case 'Not':
      return `${node.local}(${node.children.map(expressionText).join(', ')})`;
    case 'LabeledElement':
      return `${node.attrs.Name ?? ''}=${annotationValue(node)}`;
    default:
      return node.text.trim() || annotationValue(node);
  }
};

const isTrue = (value: string | undefined, fallback: boolean) =>
  value === undefined ? fallback : value.toLowerCase() === 'true';

const empty = (): MetadataIndex => ({
  namespaces: [],
  aliases: {},
  references: [],
  entityTypes: [],
  complexTypes: [],
  enumTypes: [],
  entitySets: [],
  operations: [],
  annotations: [],
  warnings: [],
});

const annotationOf = (
  node: XmlElement,
  target: string,
  source: AnnotationInfo['source'],
): AnnotationInfo => ({
  target,
  term: node.attrs.Term ?? '',
  ...(node.attrs.Qualifier ? { qualifier: node.attrs.Qualifier } : {}),
  value: annotationValue(node),
  source,
});

/** V2 `sap:*` attributes (sap:label, sap:creatable …) as annotations of their element. */
const sapAttributes = (node: XmlElement, target: string): AnnotationInfo[] =>
  Object.entries(node.attrs)
    .filter(([name]) => name.startsWith('sap:'))
    .map(([name, value]) => ({ target, term: name, value, source: 'sap' as const }));

const inlineAnnotations = (node: XmlElement, target: string): AnnotationInfo[] =>
  childrenNamed(node, 'Annotation').map((annotation) => annotationOf(annotation, target, 'inline'));

const LABEL_TERMS = /(^|\.)(Label)$/;

interface AssociationEnd {
  type: string;
  multiplicity?: Multiplicity;
}

interface AssociationInfo {
  ends: Map<string, AssociationEnd>;
  principal?: { role: string; properties: string[] };
  dependent?: { role: string; properties: string[] };
}

const asMultiplicity = (value: string | undefined): Multiplicity | undefined =>
  value === '1' || value === '0..1' || value === '*' ? value : undefined;

const propertyRefs = (node: XmlElement | undefined): string[] =>
  node ? childrenNamed(node, 'PropertyRef').map((ref) => ref.attrs.Name ?? '') : [];

const readAssociation = (node: XmlElement): AssociationInfo => {
  const ends = new Map(
    childrenNamed(node, 'End').map((end) => {
      const multiplicity = asMultiplicity(end.attrs.Multiplicity);
      return [
        end.attrs.Role ?? '',
        { type: end.attrs.Type ?? '', ...(multiplicity ? { multiplicity } : {}) },
      ] as const;
    }),
  );
  const constraint = childNamed(node, 'ReferentialConstraint');
  const principal = constraint ? childNamed(constraint, 'Principal') : undefined;
  const dependent = constraint ? childNamed(constraint, 'Dependent') : undefined;
  return {
    ends,
    ...(principal
      ? { principal: { role: principal.attrs.Role ?? '', properties: propertyRefs(principal) } }
      : {}),
    ...(dependent
      ? { dependent: { role: dependent.attrs.Role ?? '', properties: propertyRefs(dependent) } }
      : {}),
  };
};

/** V2: constraint pairs seen from the navigation's source end. */
const v2Constraints = (
  association: AssociationInfo | undefined,
  fromRole: string | undefined,
): ReferentialConstraintInfo[] => {
  const { principal, dependent } = association ?? {};
  if (!principal || !dependent || !fromRole) return [];
  const [own, other] =
    fromRole === dependent.role
      ? [dependent.properties, principal.properties]
      : fromRole === principal.role
        ? [principal.properties, dependent.properties]
        : [[], []];
  return own.map((property, position) => ({
    property,
    referencedProperty: other[position] ?? '',
  }));
};

/** V4: `Collection(…)` is many, `Nullable="false"` exactly one, otherwise zero or one. */
const v4Multiplicity = (type: string, nullable: string | undefined): Multiplicity =>
  /^Collection\(/.test(type) ? '*' : nullable?.toLowerCase() === 'false' ? '1' : '0..1';

const readStructuredType = (
  node: XmlElement,
  namespace: string,
  kind: StructuredTypeInfo['kind'],
  index: MetadataIndex,
  associations: Map<string, AssociationInfo>,
): StructuredTypeInfo => {
  const name = node.attrs.Name ?? '';
  const qualifiedName = `${namespace}.${name}`;
  index.annotations.push(
    ...inlineAnnotations(node, qualifiedName),
    ...sapAttributes(node, qualifiedName),
  );
  const key = childNamed(node, 'Key');
  const properties = childrenNamed(node, 'Property').map((prop): PropertyInfo => {
    const propName = prop.attrs.Name ?? '';
    const target = `${qualifiedName}/${propName}`;
    const inline = inlineAnnotations(prop, target);
    index.annotations.push(...inline, ...sapAttributes(prop, target));
    const label =
      attrLocal(prop, 'label') ??
      inline.find((a) => LABEL_TERMS.test(a.term))?.value.replace(/^"|"$/g, '');
    return {
      name: propName,
      type: prop.attrs.Type ?? '',
      nullable: isTrue(prop.attrs.Nullable, true),
      ...(prop.attrs.MaxLength ? { maxLength: prop.attrs.MaxLength } : {}),
      ...(prop.attrs.Precision ? { precision: prop.attrs.Precision } : {}),
      ...(prop.attrs.Scale ? { scale: prop.attrs.Scale } : {}),
      ...(label ? { label } : {}),
    };
  });
  const navigations = childrenNamed(node, 'NavigationProperty').map((nav): NavigationInfo => {
    const navName = nav.attrs.Name ?? '';
    index.annotations.push(...inlineAnnotations(nav, `${qualifiedName}/${navName}`));
    const relationship = nav.attrs.Relationship;
    const fromRole = nav.attrs.FromRole;
    const toRole = nav.attrs.ToRole;
    const association = relationship ? associations.get(relationship) : undefined;
    const type =
      nav.attrs.Type ?? (toRole ? association?.ends.get(toRole)?.type || undefined : undefined);
    const multiplicity = nav.attrs.Type
      ? v4Multiplicity(nav.attrs.Type, nav.attrs.Nullable)
      : toRole
        ? association?.ends.get(toRole)?.multiplicity
        : undefined;
    const sourceMultiplicity = fromRole ? association?.ends.get(fromRole)?.multiplicity : undefined;
    const constraints = nav.attrs.Type
      ? childrenNamed(nav, 'ReferentialConstraint').map((constraint) => ({
          property: constraint.attrs.Property ?? '',
          referencedProperty: constraint.attrs.ReferencedProperty ?? '',
        }))
      : v2Constraints(association, fromRole);
    const onDelete = childNamed(nav, 'OnDelete')?.attrs.Action;
    return {
      name: navName,
      ...(type ? { type } : {}),
      ...(relationship ? { relationship } : {}),
      ...(nav.attrs.Partner ? { partner: nav.attrs.Partner } : {}),
      ...(multiplicity ? { multiplicity } : {}),
      ...(sourceMultiplicity ? { sourceMultiplicity } : {}),
      ...(fromRole ? { fromRole } : {}),
      ...(toRole ? { toRole } : {}),
      ...(isTrue(nav.attrs.ContainsTarget, false) ? { containsTarget: true } : {}),
      ...(constraints.length > 0 ? { referentialConstraints: constraints } : {}),
      ...(onDelete ? { onDelete } : {}),
    };
  });
  return {
    name,
    qualifiedName,
    kind,
    keys: key ? childrenNamed(key, 'PropertyRef').map((ref) => ref.attrs.Name ?? '') : [],
    ...(node.attrs.BaseType ? { baseType: node.attrs.BaseType } : {}),
    ...(isTrue(node.attrs.Abstract, false) ? { abstract: true } : {}),
    properties,
    navigations,
  };
};

const readParameters = (node: XmlElement): ParameterInfo[] =>
  childrenNamed(node, 'Parameter').map((param) => ({
    name: param.attrs.Name ?? '',
    type: param.attrs.Type ?? '',
    nullable: isTrue(param.attrs.Nullable, true),
  }));

const readAnnotationsBlocks = (
  schema: XmlElement,
  index: MetadataIndex,
  source: AnnotationInfo['source'],
) => {
  for (const block of childrenNamed(schema, 'Annotations')) {
    const target = block.attrs.Target ?? '';
    const qualifier = block.attrs.Qualifier;
    for (const annotation of childrenNamed(block, 'Annotation')) {
      const info = annotationOf(annotation, target, source);
      index.annotations.push(qualifier && !info.qualifier ? { ...info, qualifier } : info);
    }
  }
};

const readReferences = (root: XmlElement, index: MetadataIndex) => {
  for (const reference of childrenNamed(root, 'Reference')) {
    const includes = childrenNamed(reference, 'Include').map((include) => ({
      namespace: include.attrs.Namespace ?? '',
      ...(include.attrs.Alias ? { alias: include.attrs.Alias } : {}),
    }));
    for (const include of includes)
      if (include.alias) index.aliases[include.alias] = include.namespace;
    index.references.push({ uri: reference.attrs.Uri ?? '', includes });
  }
};

/**
 * Parses `$metadata` (EDMX, OData V2 or V4) into a searchable index: entity
 * sets, entity/complex types with properties and navigations, function
 * imports / actions / functions and annotations (inline, `Annotations`
 * blocks and V2 `sap:*` attributes). Never throws.
 */
export const parseMetadata = (xml: string): MetadataIndex => {
  const index = empty();
  const root = parseXml(xml);
  if (!root || root.local !== 'Edmx') {
    index.warnings.push('not an EDMX document');
    return index;
  }
  index.edmxVersion = root.attrs.Version;
  readReferences(root, index);
  const dataServices = childNamed(root, 'DataServices');
  const schemas = dataServices ? childrenNamed(dataServices, 'Schema') : [];
  const dsv = dataServices ? attrLocal(dataServices, 'DataServiceVersion') : undefined;
  index.odataVersion = root.attrs.Version?.startsWith('4')
    ? '4.0'
    : dsv || root.attrs.Version
      ? '2.0'
      : undefined;

  for (const schema of schemas) {
    const namespace = schema.attrs.Namespace ?? '';
    index.namespaces.push(namespace);
    if (schema.attrs.Alias) index.aliases[schema.attrs.Alias] = namespace;
  }

  for (const schema of schemas) {
    const namespace = schema.attrs.Namespace ?? '';
    // V2: association ends resolve the navigation target type.
    const associations = new Map<string, AssociationInfo>();
    for (const association of childrenNamed(schema, 'Association')) {
      const info = readAssociation(association);
      associations.set(`${namespace}.${association.attrs.Name ?? ''}`, info);
      if (schema.attrs.Alias)
        associations.set(`${schema.attrs.Alias}.${association.attrs.Name ?? ''}`, info);
    }
    for (const node of childrenNamed(schema, 'EntityType'))
      index.entityTypes.push(
        readStructuredType(node, namespace, 'EntityType', index, associations),
      );
    for (const node of childrenNamed(schema, 'ComplexType'))
      index.complexTypes.push(
        readStructuredType(node, namespace, 'ComplexType', index, associations),
      );
    for (const node of childrenNamed(schema, 'EnumType')) {
      const name = node.attrs.Name ?? '';
      index.annotations.push(...inlineAnnotations(node, `${namespace}.${name}`));
      index.enumTypes.push({
        name,
        qualifiedName: `${namespace}.${name}`,
        ...(node.attrs.UnderlyingType ? { underlyingType: node.attrs.UnderlyingType } : {}),
        isFlags: isTrue(node.attrs.IsFlags, false),
        members: childrenNamed(node, 'Member').map((member) => ({
          name: member.attrs.Name ?? '',
          ...(member.attrs.Value !== undefined ? { value: member.attrs.Value } : {}),
        })),
      });
    }

    for (const node of [...childrenNamed(schema, 'Action'), ...childrenNamed(schema, 'Function')]) {
      const parameters = readParameters(node);
      const isBound = isTrue(node.attrs.IsBound, false);
      const returnType = childNamed(node, 'ReturnType')?.attrs.Type;
      const name = node.attrs.Name ?? '';
      index.annotations.push(...inlineAnnotations(node, `${namespace}.${name}`));
      index.operations.push({
        name,
        kind: node.local as 'Action' | 'Function',
        qualifiedName: `${namespace}.${name}`,
        isBound,
        ...(isBound && parameters[0] ? { bindingType: parameters[0].type } : {}),
        ...(returnType ? { returnType } : {}),
        parameters,
      });
    }

    for (const container of childrenNamed(schema, 'EntityContainer')) {
      const containerName = container.attrs.Name ?? '';
      for (const node of [
        ...childrenNamed(container, 'EntitySet'),
        ...childrenNamed(container, 'Singleton'),
      ]) {
        const name = node.attrs.Name ?? '';
        const target = `${namespace}.${containerName}/${name}`;
        index.annotations.push(...inlineAnnotations(node, target), ...sapAttributes(node, target));
        index.entitySets.push({
          name,
          entityType: node.attrs.EntityType ?? node.attrs.Type ?? '',
          container: containerName,
          kind: node.local === 'Singleton' ? 'Singleton' : 'EntitySet',
          navigationBindings: childrenNamed(node, 'NavigationPropertyBinding').map((binding) => ({
            path: binding.attrs.Path ?? '',
            target: binding.attrs.Target ?? '',
          })),
        });
      }
      for (const node of [
        ...childrenNamed(container, 'FunctionImport'),
        ...childrenNamed(container, 'ActionImport'),
      ]) {
        const name = node.attrs.Name ?? '';
        const kind = node.local as 'FunctionImport' | 'ActionImport';
        const httpMethod = attrLocal(node, 'HttpMethod');
        const returnType = node.attrs.ReturnType;
        const operation = node.attrs.Action ?? node.attrs.Function;
        index.annotations.push(...sapAttributes(node, `${namespace}.${containerName}/${name}`));
        index.operations.push({
          name,
          kind,
          qualifiedName: operation ?? `${namespace}.${containerName}/${name}`,
          isBound: false,
          ...(returnType ? { returnType } : {}),
          ...(node.attrs.EntitySet ? { entitySet: node.attrs.EntitySet } : {}),
          ...(httpMethod ? { httpMethod } : {}),
          parameters: readParameters(node),
        });
      }
    }
    readAnnotationsBlocks(schema, index, 'inline');
  }
  return index;
};

/**
 * Adds the annotations of an annotation file (`annotations.xml`, CDS/Gateway
 * annotation service) to an index. Returns a new index.
 */
export const mergeAnnotations = (index: MetadataIndex, annotationsXml: string): MetadataIndex => {
  const root = parseXml(annotationsXml);
  const extra = empty();
  if (!root || root.local !== 'Edmx') {
    return { ...index, warnings: [...index.warnings, 'annotation file is not an EDMX document'] };
  }
  readReferences(root, extra);
  for (const schema of descendantsNamed(root, 'Schema'))
    readAnnotationsBlocks(schema, extra, 'external');
  return {
    ...index,
    aliases: { ...extra.aliases, ...index.aliases },
    annotations: [...index.annotations, ...extra.annotations],
  };
};

/** Flat list for the metadata browser search (one entry per element). */
export const searchEntries = (index: MetadataIndex): SearchEntry[] => {
  const entries: SearchEntry[] = [];
  for (const set of index.entitySets) {
    entries.push({ kind: set.kind, name: set.name, path: set.container, detail: set.entityType });
  }
  for (const type of [...index.entityTypes, ...index.complexTypes]) {
    entries.push({
      kind: type.kind,
      name: type.name,
      path: type.qualifiedName,
      detail: type.keys.length > 0 ? `key: ${type.keys.join(', ')}` : '',
    });
    for (const prop of type.properties) {
      entries.push({
        kind: 'Property',
        name: prop.name,
        path: `${type.qualifiedName}/${prop.name}`,
        detail: [
          prop.type,
          prop.maxLength ? `(${prop.maxLength})` : '',
          prop.label ? `"${prop.label}"` : '',
        ]
          .filter(Boolean)
          .join(' '),
      });
    }
    for (const nav of type.navigations) {
      entries.push({
        kind: 'NavigationProperty',
        name: nav.name,
        path: `${type.qualifiedName}/${nav.name}`,
        detail: nav.type ?? nav.relationship ?? '',
      });
    }
  }
  for (const op of index.operations) {
    entries.push({
      kind: op.kind,
      name: op.name,
      path: op.qualifiedName,
      detail: [
        op.httpMethod,
        `(${op.parameters.map((p) => `${p.name}: ${p.type}`).join(', ')})`,
        op.returnType ? `→ ${op.returnType}` : '',
      ]
        .filter(Boolean)
        .join(' '),
    });
  }
  for (const annotation of index.annotations) {
    entries.push({
      kind: 'Annotation',
      name: annotation.qualifier ? `${annotation.term}#${annotation.qualifier}` : annotation.term,
      path: annotation.target,
      detail: annotation.value,
    });
  }
  return entries;
};

/**
 * Case-insensitive search over name, path and detail; all words must match.
 * Exact name matches come first.
 */
export const searchMetadata = (
  entries: readonly SearchEntry[],
  query: string,
  limit = 200,
): SearchEntry[] => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return entries.slice(0, limit);
  const scored: Array<{ entry: SearchEntry; score: number }> = [];
  for (const entry of entries) {
    const haystack = `${entry.kind} ${entry.name} ${entry.path} ${entry.detail}`.toLowerCase();
    if (!words.every((word) => haystack.includes(word))) continue;
    const name = entry.name.toLowerCase();
    const score = name === words[0] ? 0 : name.startsWith(words[0] as string) ? 1 : 2;
    scored.push({ entry, score });
  }
  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map(({ entry }) => entry);
};
