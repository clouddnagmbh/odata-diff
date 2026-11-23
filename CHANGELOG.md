# Changelog

All notable changes to `odatatailor-diff`. The project follows [Semantic Versioning](https://semver.org); what counts as the public interface is described in the [README](README.md#versioning).

## 1.0.0 – 2026-11-23

First stable version, with the source code public at https://github.com/clouddnagmbh/odata-diff.

- The command line (options, exit codes), the JSON report and the severity rules are now covered by semantic versioning.
- A URL ending in `.xml`, `.edmx` or `.json` is read as it is, without `$metadata` appended. This means raw files on GitHub or an artifact server work as a source.
- Documentation: every rule with its reason ([docs/rules.md](docs/rules.md)), CI recipes for GitHub Actions, GitLab CI, Azure Pipelines, SAP Gateway, RAP and CAP ([docs/ci.md](docs/ci.md)), report formats ([docs/reports.md](docs/reports.md)) and an FAQ ([docs/faq.md](docs/faq.md)).
- Two example files from a CAP service in [`examples/`](examples).

## 0.1.0 – 2026-11-23

- First version: `odata-diff <before> <after>` compares two OData `$metadata` documents (V2 and V4, EDMX or CSDL JSON, files or URLs) and exits with 1 on breaking changes. Options: `--fail-on`, `--format text|markdown|json`, `--output`, `--no-annotations`, `--header` and `--lang en|de`. It uses the same classification and texts as the `$metadata` diff in the ODataTailor extension.
