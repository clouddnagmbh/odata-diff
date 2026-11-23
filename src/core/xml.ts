/**
 * Minimal, dependency-free XML reader for EDMX metadata, annotation files and
 * Gateway XML errors. `DOMParser` is not available in the service worker, so
 * this tokenizer runs everywhere (service worker, panels, Node tests).
 *
 * Supported: elements, attributes (single/double quotes), self-closing tags,
 * text, CDATA, comments, processing instructions, DOCTYPE (skipped) and the
 * predefined + numeric entities. Not supported (not needed for OData):
 * DTD-defined entities, validation. Malformed input never throws: unclosed
 * elements are closed at the end, stray end tags are ignored.
 */

export interface XmlElement {
  /** Qualified name as written, e.g. `edmx:Edmx`. */
  name: string;
  /** Name without namespace prefix, e.g. `Edmx`. */
  local: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  /** Concatenated text content of this element (direct text nodes only). */
  text: string;
}

const ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
};

export const decodeEntities = (value: string): string =>
  value.indexOf('&') < 0
    ? value
    : value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match, entity: string) => {
        if (entity.startsWith('#x')) return safeCodePoint(parseInt(entity.slice(2), 16), match);
        if (entity.startsWith('#')) return safeCodePoint(parseInt(entity.slice(1), 10), match);
        return ENTITIES[entity] ?? match;
      });

const safeCodePoint = (code: number, fallback: string): string => {
  try {
    return String.fromCodePoint(code);
  } catch {
    return fallback;
  }
};

const localName = (name: string): string => {
  const colon = name.indexOf(':');
  return colon < 0 ? name : name.slice(colon + 1);
};

const ATTRIBUTE = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

const parseAttributes = (source: string): Record<string, string> => {
  const attrs: Record<string, string> = {};
  for (const match of source.matchAll(ATTRIBUTE)) {
    const name = match[1] as string;
    attrs[name] = decodeEntities(match[3] ?? match[4] ?? '');
  }
  return attrs;
};

const element = (name: string, attrs: Record<string, string>): XmlElement => ({
  name,
  local: localName(name),
  attrs,
  children: [],
  text: '',
});

/** Parses an XML document; returns the root element or `undefined` if there is none. */
export const parseXml = (xml: string): XmlElement | undefined => {
  const root = element('#document', {});
  const stack: XmlElement[] = [root];
  let index = 0;
  const length = xml.length;

  const current = () => stack[stack.length - 1] as XmlElement;

  while (index < length) {
    const open = xml.indexOf('<', index);
    if (open < 0) {
      current().text += decodeEntities(xml.slice(index));
      break;
    }
    if (open > index) current().text += decodeEntities(xml.slice(index, open));

    if (xml.startsWith('<!--', open)) {
      const end = xml.indexOf('-->', open + 4);
      index = end < 0 ? length : end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', open)) {
      const end = xml.indexOf(']]>', open + 9);
      current().text += xml.slice(open + 9, end < 0 ? length : end);
      index = end < 0 ? length : end + 3;
      continue;
    }
    if (xml.startsWith('<?', open)) {
      const end = xml.indexOf('?>', open + 2);
      index = end < 0 ? length : end + 2;
      continue;
    }
    if (xml.startsWith('<!', open)) {
      // DOCTYPE or other declaration; internal subsets are skipped up to the closing bracket.
      const bracket = xml.indexOf('[', open);
      const close = xml.indexOf('>', open);
      if (bracket >= 0 && close >= 0 && bracket < close) {
        const end = xml.indexOf(']>', bracket);
        index = end < 0 ? length : end + 2;
      } else {
        index = close < 0 ? length : close + 1;
      }
      continue;
    }

    const close = findTagEnd(xml, open + 1);
    const inner = xml.slice(open + 1, close < 0 ? length : close);
    index = close < 0 ? length : close + 1;

    if (inner.startsWith('/')) {
      const name = inner.slice(1).trim();
      // Close up to the matching element; ignore stray end tags.
      for (let depth = stack.length - 1; depth > 0; depth--) {
        if ((stack[depth] as XmlElement).name === name) {
          stack.length = depth;
          break;
        }
      }
      continue;
    }

    const selfClosing = inner.endsWith('/');
    const body = selfClosing ? inner.slice(0, -1) : inner;
    const nameMatch = /^[^\s/>]+/.exec(body);
    if (!nameMatch) continue;
    const child = element(nameMatch[0], parseAttributes(body.slice(nameMatch[0].length)));
    current().children.push(child);
    if (!selfClosing) stack.push(child);
  }
  return root.children[0];
};

/** Index of the `>` that ends a tag, skipping `>` inside quoted attribute values. */
const findTagEnd = (xml: string, from: number): number => {
  let quote: string | undefined;
  for (let i = from; i < xml.length; i++) {
    const char = xml[i];
    if (quote) {
      if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return i;
    }
  }
  return -1;
};

/** Direct children with the given local name. */
export const childrenNamed = (parent: XmlElement, local: string): XmlElement[] =>
  parent.children.filter((child) => child.local === local);

export const childNamed = (parent: XmlElement, local: string): XmlElement | undefined =>
  parent.children.find((child) => child.local === local);

/** All descendants (depth first) with the given local name. */
export const descendantsNamed = (parent: XmlElement, local: string): XmlElement[] => {
  const found: XmlElement[] = [];
  const visit = (node: XmlElement) => {
    for (const child of node.children) {
      if (child.local === local) found.push(child);
      visit(child);
    }
  };
  visit(parent);
  return found;
};

/** Attribute by local name (ignores the namespace prefix, e.g. `sap:label` → `label`). */
export const attrLocal = (node: XmlElement, local: string): string | undefined => {
  if (local in node.attrs) return node.attrs[local];
  for (const [name, value] of Object.entries(node.attrs)) {
    if (localName(name) === local) return value;
  }
  return undefined;
};

/** Trimmed text of the element and all descendants. */
export const deepText = (node: XmlElement): string =>
  [node.text, ...node.children.map(deepText)].join(' ').replace(/\s+/g, ' ').trim();
