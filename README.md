# odatatailor-diff

[![npm](https://img.shields.io/npm/v/odatatailor-diff)](https://www.npmjs.com/package/odatatailor-diff)
[![CI](https://github.com/clouddnagmbh/odata-diff/actions/workflows/ci.yml/badge.svg)](https://github.com/clouddnagmbh/odata-diff/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/node/v/odatatailor-diff)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](https://github.com/clouddnagmbh/odata-diff/blob/main/LICENSE)

**Catch breaking OData API changes before your consumers do.**

`odata-diff` compares two OData `$metadata` documents, classifies every difference as **breaking**, **compatible** or **annotation only**, and exits with code 1 when something would break a client. Put it in your pipeline and "only additive changes within a version" stops being a review guideline and becomes a check.

```sh
npx odatatailor-diff api/metadata.xml metadata.xml
```

```text
$metadata diff: api/metadata.xml → metadata.xml
3 breaking, 3 compatible, 2 annotation only

BREAKING        Orders/customer                MaxLength 80 → 40
BREAKING        Orders/notes                   Property removed (Edm.String)
BREAKING        Orders/priority                Property added (Edm.Int32, Nullable=false)
COMPATIBLE      Orders/cancel                  Operation added
COMPATIBLE      Orders/decline(notify)         Parameter added (Edm.Boolean)
COMPATIBLE      Orders/deliveryDate            Property added (Edm.Date)
ANNOTATION ONLY Orders/notes@Common.Label      Annotation removed: "Notes"
ANNOTATION ONLY Orders/notes@UI.MultiLineText  Annotation removed: true

✗ 3 change(s) at or above “breaking” – failing (--fail-on breaking)
```

That is real output for a CAP service. Try it yourself with the two files in [`examples/`](https://github.com/clouddnagmbh/odata-diff/tree/main/examples):

```sh
npx odatatailor-diff \
  https://raw.githubusercontent.com/clouddnagmbh/odata-diff/main/examples/orders-v1.xml \
  https://raw.githubusercontent.com/clouddnagmbh/odata-diff/main/examples/orders-v2.xml
```

## Why

- **Knows OData, not just XML.** A text diff of `$metadata` shows that lines moved. `odata-diff` tells you that a shorter `MaxLength` truncates what clients send, that a new `Nullable="false"` property breaks every client that creates records, and that a new optional property is safe.
- **V2 and V4, XML and JSON.** EDMX from SAP Gateway, RAP or CAP, or CSDL JSON, as files or straight from a running service.
- **Compares across systems.** Types, sets and operations are matched by name, so a service with another namespace or container name on DEV and QAS still compares cleanly.
- **Made for pipelines.** Clear exit codes, reports as text for the log, Markdown for the pull request and JSON for your own tooling.
- **Small and private.** One file, no dependencies, Node.js 20 or later. No telemetry. The only network calls go to the URLs you pass.

## What counts as breaking

| Breaking | Compatible |
| --- | --- |
| entity set, type, property, navigation, operation, parameter or enum member **removed** | entity set, type, navigation, operation or enum member **added** |
| type, key, base type, return type, HTTP method, navigation target or multiplicity **changed** | **optional** property or parameter added |
| `MaxLength`, `Precision` or `Scale` made **smaller** (or set where there was none) | `MaxLength`, `Precision` or `Scale` made **larger** (or removed) |
| **required** property or parameter added, `Nullable` true → false, OData version changed | `Nullable` false → true |

Annotations such as `@Common.Label`, `@UI.LineItem` or `sap:label` are reported separately as *annotation only*. They change the UI, not the contract.

Every rule, with the reason behind it: **[docs/rules.md](https://github.com/clouddnagmbh/odata-diff/blob/main/docs/rules.md)**

## In your pipeline

GitHub Actions, CAP service, contract file `api/metadata.xml` in the repository:

```yaml
- run: npx cds compile srv --to edmx --service OrderService > metadata.xml
- run: npx odatatailor-diff api/metadata.xml metadata.xml --format markdown --output metadata-diff.md
- if: always()
  run: cat metadata-diff.md >> "$GITHUB_STEP_SUMMARY"
```

SAP Gateway or RAP, straight from the system:

```sh
npx odatatailor-diff api/metadata.xml \
  "https://my-system.example.com/sap/opu/odata/sap/ZAPI_ORDERS_SRV?sap-client=100" \
  --header "Authorization: Basic $ODATA_AUTH"
```

More recipes, covering pull request comments, GitLab CI, Azure Pipelines, comparing against the last release tag, DEV against QAS before a transport, and a nightly drift check: **[docs/ci.md](https://github.com/clouddnagmbh/odata-diff/blob/main/docs/ci.md)**

## Usage

```text
odata-diff <before> <after> [options]

  <before>, <after>   file (EDMX XML or CSDL JSON) or http(s) URL; a service URL
                      gets $metadata appended, a URL ending in .xml, .edmx or
                      .json is read as it is

  --fail-on <level>   breaking (default) | compatible | annotation | never
                      fails on that severity and everything more severe
  --format <format>   text (default) | markdown | json
  --output <file>     write the report to a file; stdout gets the summary line
  --no-annotations    leave annotation-only changes out of the report
  --header <h>        "Name: value" for URLs, repeatable (e.g. Authorization)
  --lang <lang>       en (default) | de
  -h, --help          help
  -v, --version       version
```

| Exit code | Meaning |
| --- | --- |
| `0` | no change at or above `--fail-on` |
| `1` | at least one change at or above `--fail-on` |
| `2` | usage error, file not found, HTTP error, or not a `$metadata` document |

`--fail-on compatible` turns the tool into a freeze: any change to the contract fails. `--fail-on never` only reports.

Report formats and the JSON fields: **[docs/reports.md](https://github.com/clouddnagmbh/odata-diff/blob/main/docs/reports.md)**

## Credentials

`--header` values are sent with the requests of that call and nowhere else. They never appear in the output, the report or an error message. Even a malformed `--header` is rejected without echoing its value, because a malformed header is usually a pasted token. URLs are shown without user info and query string.

## Questions

Why does a new `not null` field in CAP come out as compatible? Why are XML and JSON of the same service not identical? How do I allow new enum values? **[docs/faq.md](https://github.com/clouddnagmbh/odata-diff/blob/main/docs/faq.md)**

## Versioning

`odata-diff` follows [Semantic Versioning](https://semver.org). The public interface is the command line (options, exit codes), the JSON report and the severity rules.

- **Patch:** bug fixes, including a change that was classified wrongly.
- **Minor:** new options, formats or detected kinds of change.
- **Major:** an option, exit code or JSON field removed or changed, or an existing kind of change classified more strictly.

A minor version can find a change that an older version missed, and so fail a build that passed before. That is the point of the tool. If you need identical results until you choose to update, pin the exact version: `npx odatatailor-diff@1.0.0`.

## The same diff in your browser

`odata-diff` is the command-line edition of the `$metadata` diff in **[ODataTailor](https://odatatailor.com)**, a free browser extension for OData services. In the extension you can compare a system with a system or a file with a system, explore the service as a diagram, and build and run queries. Both use the same parser and the same rules.

## Contributing

Issues and pull requests are welcome, especially a trimmed `$metadata` where the tool gets something wrong. How the code is built: [ARCHITECTURE.md](https://github.com/clouddnagmbh/odata-diff/blob/main/ARCHITECTURE.md). How to contribute: [CONTRIBUTING.md](https://github.com/clouddnagmbh/odata-diff/blob/main/CONTRIBUTING.md). Security issues go through [SECURITY.md](https://github.com/clouddnagmbh/odata-diff/blob/main/SECURITY.md).

## Licence

[Apache License 2.0](LICENSE) · Made by [CloudDNA](https://www.clouddna.at). SAP, SAP Gateway, SAP Fiori and other SAP products are trademarks of SAP SE; this project is not affiliated with SAP.
