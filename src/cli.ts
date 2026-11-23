import { parseArgs } from 'node:util';
import { diffMetadata } from './core';
import { displayName, LoadError, loadMetadata, parseHeaders, type LoadIo } from './load';
import {
  failingChanges,
  formatReport,
  summaryLine,
  type FailOn,
  type Format,
  type Lang,
} from './report';

/**
 * `odata-diff <before> <after>`: compares two `$metadata` states and exits
 * with 1 when a change at or above `--fail-on` (default: breaking) is found.
 * Exit codes: 0 passed, 1 failing changes, 2 usage or input error.
 */

export interface CliIo extends LoadIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  writeFile: (path: string, text: string) => Promise<void>;
  version: string;
}

export const EXIT = { passed: 0, failed: 1, error: 2 } as const;

const FAIL_ON: readonly FailOn[] = ['breaking', 'compatible', 'annotation', 'never'];
const FORMATS: readonly Format[] = ['text', 'markdown', 'json'];
const LANGS: readonly Lang[] = ['en', 'de'];

export const HELP = `odata-diff – compare two OData $metadata documents and fail on breaking changes

Usage
  odata-diff <before> <after> [options]

  <before>, <after>   file (EDMX XML or CSDL JSON) or http(s) URL; a service URL
                      gets $metadata appended, a URL ending in .xml, .edmx or
                      .json is read as it is

Options
  --fail-on <level>   breaking (default) | compatible | annotation | never
                      fails on that severity and everything more severe
  --format <format>   text (default) | markdown | json
  --output <file>     write the report to a file; stdout gets the summary line
  --no-annotations    leave annotation-only changes out of the report
  --header <h>        "Name: value" for URLs, repeatable (e.g. Authorization)
  --lang <lang>       en (default) | de
  -h, --help          this help
  -v, --version       version

Exit codes
  0  no change at or above --fail-on      1  changes at or above --fail-on
  2  usage error, file not found, HTTP error or not a $metadata document

Examples
  odata-diff main/metadata.xml metadata.xml
  odata-diff https://host/sap/opu/odata/sap/ZSRV_SRV metadata.xml \\
    --header "Authorization: Basic $ODATA_AUTH" --format markdown --output diff.md

Severity: removing or retyping sets, types, properties, navigations or
operations, a changed key, shorter MaxLength/Precision/Scale, Nullable=false
and new required properties or parameters are breaking; new optional elements
and enum members are compatible; annotations are reported separately.

https://odatatailor.com · Apache-2.0`;

const oneOf = <T extends string>(name: string, value: string, allowed: readonly T[]): T => {
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new LoadError(`--${name} must be one of ${allowed.join(', ')}, got "${value}"`);
};

export const run = async (argv: readonly string[], io: CliIo): Promise<number> => {
  try {
    const { values, positionals } = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        'fail-on': { type: 'string', default: 'breaking' },
        format: { type: 'string', default: 'text' },
        output: { type: 'string' },
        'no-annotations': { type: 'boolean', default: false },
        header: { type: 'string', multiple: true, default: [] },
        lang: { type: 'string', default: 'en' },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
    });
    if (values.help) {
      io.stdout(`${HELP}\n`);
      return EXIT.passed;
    }
    if (values.version) {
      io.stdout(`${io.version}\n`);
      return EXIT.passed;
    }
    if (positionals.length !== 2)
      throw new LoadError(`expected <before> and <after>, got ${positionals.length} argument(s)`);
    const failOn = oneOf('fail-on', values['fail-on'], FAIL_ON);
    const format = oneOf('format', values.format, FORMATS);
    const lang = oneOf('lang', values.lang, LANGS);
    const headers = parseHeaders(values.header);
    const [before, after] = positionals as [string, string];

    const [oldIndex, newIndex] = await Promise.all([
      loadMetadata(before, headers, io),
      loadMetadata(after, headers, io),
    ]);
    const all = diffMetadata(oldIndex, newIndex);
    const changes = values['no-annotations']
      ? all.filter((change) => change.severity !== 'annotation')
      : all;
    const input = { changes, before: displayName(before), after: displayName(after), failOn, lang };
    const report = formatReport(format, input);
    if (values.output) {
      await io.writeFile(values.output, report);
      io.stdout(`${summaryLine(input)}\n`);
    } else io.stdout(report);
    return failingChanges(changes, failOn).length ? EXIT.failed : EXIT.passed;
  } catch (error) {
    // parseArgs throws TypeError with code ERR_PARSE_ARGS_*; LoadError is ours.
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`odata-diff: ${message}\nRun "odata-diff --help" for usage.\n`);
    return EXIT.error;
  }
};
