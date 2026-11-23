import { parseServiceMetadata, type MetadataIndex } from './core';

/**
 * Reads one side of the diff: a file (EDMX or CSDL JSON) or an http(s) URL.
 * A URL without `$metadata` gets it appended, so the service root works too.
 * Headers (for example `Authorization`) go only to that request and are never
 * printed or written anywhere.
 */

export interface LoadIo {
  readFile: (path: string) => Promise<string>;
  fetch: (
    url: string,
    init: { headers: Record<string, string> },
  ) => Promise<{
    ok: boolean;
    status: number;
    statusText: string;
    text: () => Promise<string>;
  }>;
}

export class LoadError extends Error {}

export const isUrl = (source: string): boolean => /^https?:\/\//i.test(source);

/**
 * `https://host/sap/opu/odata/sap/ZSRV` → `…/ZSRV/$metadata`; query strings stay.
 * URLs of a document (`…/metadata.xml`, `…/orders.json`) are taken as they are.
 */
export const metadataUrl = (source: string): string => {
  const url = new URL(source);
  if (!/(?:\$metadata|\.(?:xml|edmx|json))$/i.test(url.pathname))
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/$metadata`;
  return url.toString().replace(/%24metadata/g, '$metadata');
};

/** `Name: value` pairs from `--header`; invalid ones are an error, not silently dropped. */
export const parseHeaders = (values: readonly string[]): Record<string, string> => {
  const headers: Record<string, string> = {};
  for (const [position, value] of values.entries()) {
    const colon = value.indexOf(':');
    const name = colon > 0 ? value.slice(0, colon).trim() : '';
    // Never echo the value: a malformed header is often a pasted token.
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name))
      throw new LoadError(`--header #${position + 1} needs the form "Name: value"`);
    headers[name] = value.slice(colon + 1).trim();
  }
  return headers;
};

/** The URL without user info and query, for messages and the report. */
export const displayName = (source: string): string => {
  if (!isUrl(source)) return source;
  const url = new URL(metadataUrl(source));
  return `${url.origin}${url.pathname}`.replace(/%24metadata/g, '$metadata');
};

export const loadText = async (
  source: string,
  headers: Record<string, string>,
  io: LoadIo,
): Promise<string> => {
  if (!isUrl(source))
    return io.readFile(source).catch((error: NodeJS.ErrnoException) => {
      throw new LoadError(
        error.code === 'ENOENT' ? `${source}: file not found` : `${source}: ${error.message}`,
      );
    });
  const url = metadataUrl(source);
  const response = await io
    .fetch(url, {
      headers: { accept: 'application/xml, application/json;q=0.9', ...headers },
    })
    .catch((error: Error) => {
      throw new LoadError(`${displayName(source)}: ${error.message}`);
    });
  if (!response.ok)
    throw new LoadError(
      `${displayName(source)}: HTTP ${response.status} ${response.statusText}`.trim(),
    );
  return response.text();
};

/** Parses and rejects anything that is not a `$metadata` document. */
export const loadMetadata = async (
  source: string,
  headers: Record<string, string>,
  io: LoadIo,
): Promise<MetadataIndex> => {
  const index = parseServiceMetadata(await loadText(source, headers, io));
  // odata-core: "not an EDMX document", "not a JSON document", "not a CSDL JSON document …"
  const notMetadata = index.warnings.find((warning) => /^not an? /.test(warning));
  if (notMetadata) throw new LoadError(`${displayName(source)}: not a $metadata document`);
  return index;
};
