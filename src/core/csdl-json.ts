import type {
  AnnotationInfo,
  EntitySetInfo,
  MetadataIndex,
  Multiplicity,
  NavigationInfo,
  OperationInfo,
  ParameterInfo,
  PropertyInfo,
  StructuredTypeInfo,
} from './metadata';
import { parseMetadata } from './metadata';

/**
 * OData CSDL JSON (OData V4.01 "CSDL JSON", also served by CAP for
 * `$metadata?$format=json`) into the same `MetadataIndex` as `parseMetadata`
 * builds from EDMX (docs/spikes/SPIKE-004). The JSON defaults differ from
 * XML: `$Nullable` is false and `$Type` is `Edm.String` when absent.
 * Collections are written `Collection(…)` as in XML. Never throws.
 */

type Json = Record<string, unknown>;

const MAX_VALUE = 400;

const clip = (value: string) =>
  value.length > MAX_VALUE ? `${value.slice(0, MAX_VALUE - 1)}…` : value;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const str = (value: unknown) => (typeof value === 'string' ? value : undefined);
const num = (value: unknown) =>
  typeof value === 'number' || typeof value === 'string' ? String(value) : undefined;

/** Member names of a JSON CSDL object: neither `$keyword` nor `@annotation` (nor `x@annotation`). */
const members = (node: Json) =>
  Object.entries(node).filter(([key]) => !key.startsWith('$') && !key.includes('@'));

const typeOf = (node: Json) => {
  const type = str(node.$Type) ?? 'Edm.String';
  return node.$Collection === true ? `Collection(${type})` : type;
};

const PATHS = [
  '$Path',
  '$PropertyPath',
  '$NavigationPropertyPath',
  '$AnnotationPath',
  '$ModelElementPath',
  '$EnumMember',
  '$UrlRef',
] as const;
const OPERATORS = ['$If', '$Eq', '$Ne', '$Gt', '$Ge', '$Lt', '$Le', '$And', '$Or', '$Not'] as const;

/** Compact text of an annotation value, as `annotationValue` writes it for XML. */
export const jsonAnnotationValue = (value: unknown): string => clip(expression(value));

const expression = (value: unknown): string => {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map(expression).join(', ')}]`;
  if (!isObject(value)) return '';
  for (const key of PATHS) if (key in value) return String(value[key] as string);
  for (const key of OPERATORS)
    if (key in value) {
      const args = value[key];
      return `${key.slice(1)}(${(Array.isArray(args) ? args : [args]).map(expression).join(', ')})`;
    }
  if ('$Apply' in value) {
    const args = Array.isArray(value.$Apply) ? value.$Apply : [];
    return `${str(value.$Function) ?? 'Apply'}(${args.map(expression).join(', ')})`;
  }
  if ('$Null' in value) return 'null';
  if ('$LabeledElement' in value)
    return `${str(value.$Name) ?? ''}=${expression(value.$LabeledElement)}`;
  // Record: `@type` is a URL with the qualified name after `#`; some writers use `$Type`.
  const type = str(value['@type'])?.replace(/^.*#/, '') ?? str(value.$Type);
  const props = members(value).map(([name, inner]) => `${name}: ${expression(inner)}`);
  return `${type ? `${type} ` : ''}{${props.join(', ')}}`;
};

/** `@Term` and `@Term#Qualifier` keys of a node (annotations of annotations are skipped). */
const annotationsOf = (node: Json, target: string): AnnotationInfo[] =>
  Object.entries(node).flatMap(([key, value]): AnnotationInfo[] => {
    if (!key.startsWith('@') || key.indexOf('@', 1) > 0) return [];
    const [term = '', qualifier] = key.slice(1).split('#');
    return [
      {
        target,
        term,
        ...(qualifier ? { qualifier } : {}),
        value: jsonAnnotationValue(value),
        source: 'inline',
      },
    ];
  });

const LABEL_TERMS = /(^|\.)(Label)$/;

const multiplicity = (node: Json): Multiplicity =>
  node.$Collection === true ? '*' : node.$Nullable === true ? '0..1' : '1';

const readStructuredType = (
  node: Json,
  name: string,
  namespace: string,
  kind: StructuredTypeInfo['kind'],
  index: MetadataIndex,
): StructuredTypeInfo => {
  const qualifiedName = `${namespace}.${name}`;
  index.annotations.push(...annotationsOf(node, qualifiedName));
  const properties: PropertyInfo[] = [];
  const navigations: NavigationInfo[] = [];
  for (const [memberName, member] of members(node)) {
    if (!isObject(member)) continue;
    const target = `${qualifiedName}/${memberName}`;
    const inline = annotationsOf(member, target);
    index.annotations.push(...inline);
    if (member.$Kind === 'NavigationProperty') {
      const constraints = isObject(member.$ReferentialConstraint)
        ? members(member.$ReferentialConstraint).map(([property, referenced]) => ({
            property,
            referencedProperty: str(referenced) ?? '',
          }))
        : [];
      const onDelete = isObject(member.$OnDelete)
        ? str(member.$OnDelete.$Action)
        : str(member.$OnDelete);
      navigations.push({
        name: memberName,
        type: typeOf(member),
        ...(str(member.$Partner) ? { partner: str(member.$Partner) } : {}),
        multiplicity: multiplicity(member),
        ...(member.$ContainsTarget === true ? { containsTarget: true } : {}),
        ...(constraints.length > 0 ? { referentialConstraints: constraints } : {}),
        ...(onDelete ? { onDelete } : {}),
      });
      continue;
    }
    const label = inline.find((a) => LABEL_TERMS.test(a.term))?.value.replace(/^"|"$/g, '');
    const maxLength = num(member.$MaxLength);
    const precision = num(member.$Precision);
    const scale = num(member.$Scale);
    properties.push({
      name: memberName,
      type: typeOf(member),
      nullable: member.$Nullable === true,
      ...(maxLength ? { maxLength } : {}),
      ...(precision ? { precision } : {}),
      ...(scale ? { scale } : {}),
      ...(label ? { label } : {}),
    });
  }
  // `$Key` entries are names or `{ alias: path }` objects.
  const keys = (Array.isArray(node.$Key) ? node.$Key : []).flatMap((key: unknown) =>
    typeof key === 'string' ? [key] : isObject(key) ? Object.values(key).map(String) : [],
  );
  return {
    name,
    qualifiedName,
    kind,
    keys,
    ...(str(node.$BaseType) ? { baseType: str(node.$BaseType) } : {}),
    ...(node.$Abstract === true ? { abstract: true } : {}),
    properties,
    navigations,
  };
};

const readParameters = (node: Json): ParameterInfo[] =>
  (Array.isArray(node.$Parameter) ? node.$Parameter : []).filter(isObject).map((param) => ({
    name: str(param.$Name) ?? '',
    type: typeOf(param),
    nullable: param.$Nullable === true,
  }));

const readContainer = (
  container: Json,
  containerName: string,
  namespace: string,
  index: MetadataIndex,
) => {
  const imports: OperationInfo[] = [];
  for (const [name, child] of members(container)) {
    if (!isObject(child)) continue;
    const target = `${namespace}.${containerName}/${name}`;
    index.annotations.push(...annotationsOf(child, target));
    if (str(child.$Action) || str(child.$Function)) {
      const kind: OperationInfo['kind'] = child.$Action ? 'ActionImport' : 'FunctionImport';
      imports.push({
        name,
        kind,
        qualifiedName: str(child.$Action) ?? str(child.$Function) ?? target,
        isBound: false,
        ...(str(child.$EntitySet) ? { entitySet: str(child.$EntitySet) } : {}),
        parameters: [],
      });
      continue;
    }
    const bindings = isObject(child.$NavigationPropertyBinding)
      ? members(child.$NavigationPropertyBinding).map(([path, value]) => ({
          path,
          target: str(value) ?? '',
        }))
      : [];
    const set: EntitySetInfo = {
      name,
      entityType: str(child.$Type) ?? '',
      container: containerName,
      kind: child.$Collection === true ? 'EntitySet' : 'Singleton',
      navigationBindings: bindings,
    };
    index.entitySets.push(set);
  }
  // parseMetadata lists function imports before action imports.
  index.operations.push(
    ...imports.filter((operation) => operation.kind === 'FunctionImport'),
    ...imports.filter((operation) => operation.kind === 'ActionImport'),
  );
};

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

/** Parses a CSDL JSON document (text or parsed object) into a `MetadataIndex`. */
export const parseCsdlJson = (input: string | unknown): MetadataIndex => {
  const index = empty();
  let doc: unknown = input;
  if (typeof input === 'string') {
    try {
      doc = JSON.parse(input);
    } catch {
      index.warnings.push('not a JSON document');
      return index;
    }
  }
  if (!isObject(doc) || typeof doc.$Version !== 'string') {
    index.warnings.push('not a CSDL JSON document ($Version missing)');
    return index;
  }
  index.edmxVersion = doc.$Version;
  index.odataVersion = '4.0';

  if (isObject(doc.$Reference))
    for (const [uri, reference] of Object.entries(doc.$Reference)) {
      const includes = (
        isObject(reference) && Array.isArray(reference.$Include) ? reference.$Include : []
      )
        .filter(isObject)
        .map((include) => ({
          namespace: str(include.$Namespace) ?? '',
          ...(str(include.$Alias) ? { alias: str(include.$Alias) } : {}),
        }));
      for (const include of includes)
        if (include.alias) index.aliases[include.alias] = include.namespace;
      index.references.push({ uri, includes });
    }

  const schemas = members(doc).filter((entry): entry is [string, Json] => isObject(entry[1]));
  for (const [namespace, schema] of schemas) {
    index.namespaces.push(namespace);
    if (str(schema.$Alias)) index.aliases[str(schema.$Alias) as string] = namespace;
  }

  for (const [namespace, schema] of schemas) {
    // Same order as parseMetadata: actions, functions, then the container's imports.
    const operations: OperationInfo[] = [];
    const containers: Array<[string, Json]> = [];
    for (const [name, element] of members(schema)) {
      // Actions and functions are arrays of overloads.
      if (Array.isArray(element)) {
        for (const overload of element.filter(isObject)) {
          const kind = overload.$Kind === 'Function' ? 'Function' : 'Action';
          const parameters = readParameters(overload);
          const isBound = overload.$IsBound === true;
          const returnType = isObject(overload.$ReturnType)
            ? typeOf(overload.$ReturnType)
            : undefined;
          index.annotations.push(...annotationsOf(overload, `${namespace}.${name}`));
          operations.push({
            name,
            kind,
            qualifiedName: `${namespace}.${name}`,
            isBound,
            ...(isBound && parameters[0] ? { bindingType: parameters[0].type } : {}),
            ...(returnType ? { returnType } : {}),
            parameters,
          });
        }
        continue;
      }
      if (!isObject(element)) continue;
      switch (element.$Kind) {
        case 'EntityType':
        case 'ComplexType':
          (element.$Kind === 'EntityType' ? index.entityTypes : index.complexTypes).push(
            readStructuredType(element, name, namespace, element.$Kind, index),
          );
          break;
        case 'EnumType':
          index.annotations.push(...annotationsOf(element, `${namespace}.${name}`));
          index.enumTypes.push({
            name,
            qualifiedName: `${namespace}.${name}`,
            ...(str(element.$UnderlyingType)
              ? { underlyingType: str(element.$UnderlyingType) }
              : {}),
            isFlags: element.$IsFlags === true,
            members: members(element).map(([member, value]) => ({
              name: member,
              ...(num(value) !== undefined ? { value: num(value) } : {}),
            })),
          });
          break;
        case 'EntityContainer':
          containers.push([name, element]);
          break;
        default:
          // TypeDefinition, Term: not part of the index (as in parseMetadata).
          break;
      }
    }
    index.operations.push(
      ...operations.filter((operation) => operation.kind === 'Action'),
      ...operations.filter((operation) => operation.kind === 'Function'),
    );
    for (const [name, container] of containers) readContainer(container, name, namespace, index);
    if (isObject(schema.$Annotations))
      for (const [target, block] of Object.entries(schema.$Annotations))
        if (isObject(block)) index.annotations.push(...annotationsOf(block, target));
  }
  return index;
};

/** `$metadata` in either format: CSDL JSON when the text starts with `{`, else EDMX. */
export const parseServiceMetadata = (text: string): MetadataIndex =>
  text.trimStart().startsWith('{') ? parseCsdlJson(text) : parseMetadata(text);
