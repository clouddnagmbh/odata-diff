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
 * The command `odata-diff <before> <after> [options]`.
 *
 * One run has five steps:
 *
 * 1. **Arguments.** `node:util` `parseArgs` reads them, then each value is
 *    checked against its allowed set. Unknown options are an error, not ignored.
 * 2. **Load.** Both sides are loaded in parallel (`load.ts`): a file or a
 *    URL, EDMX or CSDL JSON, each parsed into a `MetadataIndex`.
 * 3. **Diff.** `diffMetadata` from the core returns every change with
 *    its severity.
 * 4. **Report.** `report.ts` renders the report as text, Markdown or JSON,
 *    to stdout or to `--output`.
 * 5. **Exit code.** 1 if any change is at or above `--fail-on`.
 *
 * `run` never throws and never calls `process.exit`. It returns the exit code,
 * and all I/O goes through `CliIo`, so the tests drive the complete command
 * in memory (see `test-io.ts`).
 */

/**
 * Everything the command touches outside itself. `bin.ts` wires it to Node.js;
 * the tests pass an in-memory version.
 */
export interface CliIo extends LoadIo {
  /** The report, or the verdict line when the report goes to `--output`. */
  stdout: (text: string) => void;
  /** Error messages only, so that `--format json > diff.json` stays valid JSON. */
  stderr: (text: string) => void;
  /** Writes the report for `--output`. */
  writeFile: (path: string, text: string) => Promise<void>;
  /** Printed by `--version`; `bin.ts` takes it from package.json. */
  version: string;
}

/**
 * Exit codes. They are part of the public interface: pipelines rely on them,
 * so changing one requires a major version.
 *
 * - `passed` (0): no change at or above `--fail-on`, or `--fail-on never`
 * - `failed` (1): at least one change at or above `--fail-on`
 * - `error` (2): the comparison did not happen. A usage error, a missing file,
 *   an HTTP error, or a document that is not `$metadata`. Kept apart from 1, so
 *   a pipeline can tell "the API breaks" from "the check could not run".
 */
export const EXIT = { passed: 0, failed: 1, error: 2 } as const;

// Allowed values, in the order the help lists them.
const FAIL_ON: readonly FailOn[] = ['breaking', 'compatible', 'annotation', 'never'];
const FORMATS: readonly Format[] = ['text', 'markdown', 'json'];
const LANGS: readonly Lang[] = ['en', 'de'];

/** Text of `--help`. README.md repeats the usage part; keep the two in step. */
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

/** Narrows an option value to its allowed set, or fails with a message that lists the set. */
const oneOf = <T extends string>(name: string, value: string, allowed: readonly T[]): T => {
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new LoadError(`--${name} must be one of ${allowed.join(', ')}, got "${value}"`);
};

/**
 * Runs the command and returns its exit code (see {@link EXIT}).
 *
 * @param argv The arguments without `node` and the script, as in `process.argv.slice(2)`.
 * @param io Everything the command reads and writes.
 *
 * @example
 * ```ts
 * const code = await run(['api/metadata.xml', 'metadata.xml', '--format', 'json'], io);
 * // 0 when nothing breaks, 1 when something does, 2 when the check could not run
 * ```
 */
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
    // --help and --version win over everything else, even missing arguments.
    if (values.help) {
      io.stdout(`${HELP}\n`);
      return EXIT.passed;
    }
    if (values.version) {
      io.stdout(`${io.version}\n`);
      return EXIT.passed;
    }
    // Validate everything before the first request, so that a typo never costs a network round trip.
    if (positionals.length !== 2)
      throw new LoadError(`expected <before> and <after>, got ${positionals.length} argument(s)`);
    const failOn = oneOf('fail-on', values['fail-on'], FAIL_ON);
    const format = oneOf('format', values.format, FORMATS);
    const lang = oneOf('lang', values.lang, LANGS);
    const headers = parseHeaders(values.header);
    const [before, after] = positionals as [string, string];

    // Both sides at once: against two systems this halves the waiting time. The first error wins.
    const [oldIndex, newIndex] = await Promise.all([
      loadMetadata(before, headers, io),
      loadMetadata(after, headers, io),
    ]);
    const all = diffMetadata(oldIndex, newIndex);
    // --no-annotations filters before the report, so the counts and the JSON leave them out too.
    const changes = values['no-annotations']
      ? all.filter((change) => change.severity !== 'annotation')
      : all;
    // displayName drops user info and query from URLs: the report may end up in a public PR.
    const input = { changes, before: displayName(before), after: displayName(after), failOn, lang };
    const report = formatReport(format, input);
    if (values.output) {
      // The file gets the report and the log gets the verdict, so the CI log still says why the job failed.
      await io.writeFile(values.output, report);
      io.stdout(`${summaryLine(input)}\n`);
    } else io.stdout(report);
    return failingChanges(changes, failOn).length ? EXIT.failed : EXIT.passed;
  } catch (error) {
    // Every failure ends here, whether from parseArgs (TypeError with code ERR_PARSE_ARGS_*),
    // a LoadError of ours or an unexpected error. Messages never contain header values:
    // parseHeaders never echoes them, and fetch errors carry no request headers.
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`odata-diff: ${message}\nRun "odata-diff --help" for usage.\n`);
    return EXIT.error;
  }
};
