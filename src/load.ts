import { parseServiceMetadata, type MetadataIndex } from './core';

/**
 * Loads one side of the diff and turns it into a `MetadataIndex`.
 *
 * A source is either a **file** (EDMX XML or CSDL JSON, detected by content,
 * not by extension) or an **http(s) URL**. A service URL gets `$metadata`
 * appended, so `…/ZAPI_ORDERS_SRV` and `…/ZAPI_ORDERS_SRV/$metadata` are the
 * same. A URL that names a document (`….xml`, `….edmx`, `….json`) is read as
 * it is.
 *
 * Credentials: `--header` values travel only inside the request. This module
 * never puts them into a message. Error texts name the source with
 * {@link displayName}, which strips user info and query string.
 */

/** The file and network access `load.ts` needs. A subset of `CliIo`. */
export interface LoadIo {
  /** Reads a UTF-8 text file. Rejects with a Node.js error (`code: 'ENOENT'` for a missing file). */
  readFile: (path: string) => Promise<string>;
  /** The global `fetch` of Node.js 20+, narrowed to what is used here. */
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

/**
 * An expected failure with a message meant for the user, such as "file not
 * found", "HTTP 401" or "not a $metadata document". `run` prints it and exits with 2.
 */
export class LoadError extends Error {}

/** `true` for `http://` and `https://` sources; everything else is a file path. */
export const isUrl = (source: string): boolean => /^https?:\/\//i.test(source);

/**
 * The URL to request for a source URL.
 *
 * - service root → `$metadata` appended, trailing slashes removed
 * - already `$metadata`, or a document (`.xml`, `.edmx`, `.json`) → unchanged
 * - the query string stays, so `?sap-client=100` reaches the system
 *
 * @example
 * ```ts
 * metadataUrl('https://host/sap/opu/odata/sap/ZSRV/?sap-client=100');
 * // 'https://host/sap/opu/odata/sap/ZSRV/$metadata?sap-client=100'
 * metadataUrl('https://raw.githubusercontent.com/o/r/main/api/metadata.xml'); // unchanged
 * ```
 */
export const metadataUrl = (source: string): string => {
  const url = new URL(source);
  if (!/(?:\$metadata|\.(?:xml|edmx|json))$/i.test(url.pathname))
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/$metadata`;
  // URL serialises `$` as `%24`; systems accept both, but people read the literal one.
  return url.toString().replace(/%24metadata/g, '$metadata');
};

/**
 * Turns the `--header` values into a header object.
 *
 * The name must be an HTTP token (RFC 9110, section 5.6.2). The value is
 * everything after the first colon, trimmed, so `Authorization: Basic a2V5Og==`
 * keeps its inner space and any colons in the value.
 *
 * @throws {LoadError} for a value without a valid `Name:` part. The message
 *   names only the position (`--header #2`), never the value. A malformed
 *   header is usually a token pasted without its name, and the message would
 *   otherwise print it into the CI log.
 */
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

/**
 * How a source appears in messages and reports: files as given, URLs as
 * `origin + path` of the requested `$metadata`, without user info
 * (`https://user:secret@…`) and without query string, since both can carry
 * secrets and the report may be posted to a pull request.
 */
export const displayName = (source: string): string => {
  if (!isUrl(source)) return source;
  const url = new URL(metadataUrl(source));
  return `${url.origin}${url.pathname}`.replace(/%24metadata/g, '$metadata');
};

/**
 * Reads the raw text of a source.
 *
 * @throws {LoadError} file not found or unreadable, network error, or an HTTP
 *   status outside 2xx (`HTTP 401 Unauthorized`). The body of an error
 *   response is not read: it may be a login page or contain session details.
 */
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
      // Prefer EDMX, which every OData service serves; CSDL JSON is accepted as well.
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

/**
 * Loads and parses a source into a `MetadataIndex`.
 *
 * The parsers never throw: they collect warnings and return what they could
 * read. A document they cannot recognise at all, such as an HTML login page or
 * an unrelated JSON file, would therefore look like an empty service, and
 * comparing against an empty service reports everything as removed. Those
 * cases are rejected here instead, so the run exits with 2 rather than
 * failing with dozens of false breaking changes.
 *
 * @throws {LoadError} see {@link loadText}, or "not a $metadata document".
 */
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
