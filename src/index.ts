/**
 * Programmatic API, for tools that want the diff without spawning a process.
 * The supported interface is the command line. These exports are used by the
 * tests and are kept stable on a best-effort basis.
 */
export { run, EXIT, HELP, type CliIo } from './cli';
export { formatReport, failingChanges, describeChange, summaryLine, KIND_TEXTS } from './report';
export type { Format, FailOn, Lang, ReportInput } from './report';
export {
  loadMetadata,
  loadText,
  metadataUrl,
  parseHeaders,
  displayName,
  isUrl,
  LoadError,
} from './load';
