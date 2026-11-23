# Contributing

Thanks for helping! Bug reports with a (trimmed) `$metadata` that shows the problem are the most useful contribution.

## Development

Node.js 22 or later for development (the published CLI runs on Node.js 20).

```sh
npm ci
npm test            # Vitest
npm run typecheck   # TypeScript
npm run build       # dist/cli.js
node dist/cli.js src/__fixtures__/v1.xml src/__fixtures__/v2-breaking.xml
```

## Layout

How a run flows through these files, and how to add a rule step by step: [ARCHITECTURE.md](ARCHITECTURE.md).

| Path | Content |
| --- | --- |
| `src/cli.ts` | arguments, exit codes, help |
| `src/load.ts` | reading files and URLs, headers |
| `src/report.ts` | text, Markdown and JSON reports, EN/DE texts |
| `src/core/` | `$metadata` parser (EDMX and CSDL JSON) and the diff with its severity rules – the same code the ODataTailor browser extension runs |
| `src/__fixtures__/` | test documents |
| `docs/` | rules, CI recipes, report formats, FAQ |
| `examples/` | two states of a CAP service to try the tool |

## How changes get in

This repository is generated from the ODataTailor monorepo, where the parser and diff are shared with the browser extension. Each release replaces the content here.

- **Issues** are read and answered here.
- **Pull requests** are welcome. We apply them upstream, credit you as co-author in the commit, and close the pull request with a link to the release that contains it.
- **Severity rules** (`src/core/metadata-diff.ts`): please open an issue first. The extension uses the same rules, so a change there affects both.

## Rules

- Behaviour that users see is documented in `README.md` or `docs/` in the same pull request.
- Every change comes with a test. Tests use the files in `src/__fixtures__` and never touch the network.
- No runtime dependencies: the CLI ships as one file.
- No network calls except to the URLs given on the command line; no telemetry.
- Never print, log or write header values (they carry credentials), not even in error messages.

## Licence

By contributing you agree that your contribution is licensed under the [Apache License 2.0](LICENSE), like the rest of the project.
