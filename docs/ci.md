# Recipes for CI

Every recipe has the same core: **a baseline**, which is the contract your consumers rely on, **the current state**, and `odata-diff` between the two. Exit code 1 stops the pipeline.

- [Choosing the baseline](#choosing-the-baseline)
- [Getting the current state](#getting-the-current-state): CAP, SAP Gateway, RAP, any service
- [GitHub Actions](#github-actions): job summary, pull request comment, release tag
- [GitLab CI](#gitlab-ci)
- [Azure Pipelines](#azure-pipelines)
- [DEV against QAS before a transport](#dev-against-qas-before-a-transport)
- [Nightly drift check](#nightly-drift-check)
- [Making breaking changes a decision](#making-breaking-changes-a-decision)

## Choosing the baseline

| Baseline | When | How |
| --- | --- | --- |
| **Contract file** in the repository (recommended) | you build the service (CAP, or RAP with abapGit) | commit `api/metadata.xml`, and update it on purpose when the contract changes |
| **Last release tag** | the rule is "only additive within a version" | `git show v1.4.0:api/metadata.xml > baseline.xml` |
| **Another system** | SAP Gateway or RAP, before a transport | the QAS or PRD URL as `<before>` |

A contract file makes every API change visible in the pull request, because a changed `api/metadata.xml` is right there in the diff for reviewers. See [Making breaking changes a decision](#making-breaking-changes-a-decision).

## Getting the current state

**CAP.** `cds compile` is part of `@sap/cds-dk`, which most CAP projects have as a dev dependency:

```sh
npx cds compile srv --to edmx --service OrderService > metadata.xml      # OData V4
npx cds compile srv --to edmx-v2 --service OrderService > metadata.xml   # OData V2
```

`--service` picks one service when `srv` defines several. Without `@sap/cds-dk` in the project, use `npx -p @sap/cds-dk cds compile …`.

**SAP Gateway (OData V2)** and **RAP (OData V4)**: pass the service URL. `$metadata` is appended:

```sh
npx odatatailor-diff api/metadata.xml \
  "https://my-system.example.com/sap/opu/odata/sap/ZAPI_ORDERS_SRV?sap-client=100" \
  --header "Authorization: Basic $ODATA_AUTH"

npx odatatailor-diff api/metadata.xml \
  "https://my-system.example.com/sap/opu/odata4/sap/zapi_orders_o4/srvd_a2x/sap/zapi_orders/0001/?sap-client=100" \
  --header "Authorization: Basic $ODATA_AUTH"
```

`ODATA_AUTH` is `user:password` in Base64 (`printf '%s' "$USER:$PASSWORD" | base64`) and comes from a CI secret. Use a technical user that may only read `$metadata`.

**Any other service**: a URL ending in `.xml`, `.edmx` or `.json` is read as it is, so a raw file on GitHub or an artifact server works too.

## GitHub Actions

### Check in every pull request, report in the job summary

```yaml
name: API contract
on: pull_request

jobs:
  metadata-diff:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx cds compile srv --to edmx --service OrderService > metadata.xml
      - run: npx odatatailor-diff@1 api/metadata.xml metadata.xml --format markdown --output metadata-diff.md
      - if: always()
        run: cat metadata-diff.md >> "$GITHUB_STEP_SUMMARY"
```

The diff step prints the summary line to the log and writes the full report to the file. Because of `if: always()`, the summary step also runs when the diff fails.

### As a pull request comment

Add the permission and one step. `--edit-last --create-if-none` updates the previous comment instead of adding a new one on every push:

```yaml
    permissions:
      contents: read
      pull-requests: write
    steps:
      # … as above …
      - if: always()
        env:
          GH_TOKEN: ${{ github.token }}
        run: gh pr comment ${{ github.event.pull_request.number }} --body-file metadata-diff.md --edit-last --create-if-none
```

### Against the last release tag

"Only additive changes within a version": compare with the first release of the current major version, or simply with the last tag:

```yaml
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # tags and history
      - run: git show "$(git describe --tags --abbrev=0)":api/metadata.xml > baseline.xml
      - run: npx odatatailor-diff@1 baseline.xml api/metadata.xml
```

### Use the JSON in your own step

```yaml
      - run: npx odatatailor-diff@1 api/metadata.xml metadata.xml --format json --fail-on never > diff.json
      - run: |
          echo "breaking: $(jq '.counts.breaking' diff.json)"
          jq -r '.changes[] | select(.severity == "breaking") | "::error title=Breaking API change::\(.target): \(.kind)"' diff.json
```

The second command turns each breaking change into a GitHub annotation.

## GitLab CI

```yaml
metadata-diff:
  image: node:22
  script:
    - npm ci
    - npx cds compile srv --to edmx --service OrderService > metadata.xml
    - npx odatatailor-diff@1 api/metadata.xml metadata.xml --format markdown --output metadata-diff.md
  artifacts:
    when: always
    paths:
      - metadata-diff.md
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
```

## Azure Pipelines

```yaml
steps:
  - task: NodeTool@0
    inputs:
      versionSpec: 22.x
  - script: npm ci
  - script: npx cds compile srv --to edmx --service OrderService > metadata.xml
  - script: npx odatatailor-diff@1 api/metadata.xml metadata.xml --format markdown --output $(Build.ArtifactStagingDirectory)/metadata-diff.md
    displayName: $metadata diff
  - script: echo "##vso[task.uploadsummary]$(Build.ArtifactStagingDirectory)/metadata-diff.md"
    condition: always()
    displayName: Report in the build summary
```

## DEV against QAS before a transport

For SAP Gateway and RAP, where the service lives in the system and not in a repository: compare the system the transport goes to with the system it comes from.

```sh
npx odatatailor-diff \
  "https://qas.example.com/sap/opu/odata/sap/ZAPI_ORDERS_SRV?sap-client=200" \
  "https://dev.example.com/sap/opu/odata/sap/ZAPI_ORDERS_SRV?sap-client=100" \
  --header "Authorization: Basic $ODATA_AUTH"
```

The namespace may differ between the systems; types are matched by name anyway.

`--header` goes to both URLs. If the systems need different credentials, download one side first and pass the file:

```sh
curl -fsS -u "$QAS_USER:$QAS_PASSWORD" \
  "https://qas.example.com/sap/opu/odata/sap/ZAPI_ORDERS_SRV/\$metadata?sap-client=200" > qas.xml
npx odatatailor-diff qas.xml "https://dev.example.com/sap/opu/odata/sap/ZAPI_ORDERS_SRV?sap-client=100" \
  --header "Authorization: Basic $DEV_AUTH"
```

## Nightly drift check

Is production still serving the contract? A scheduled job compares the production system with the contract file and fails on any change, because nothing should change there without a release:

```yaml
on:
  schedule:
    - cron: '0 5 * * 1-5'
jobs:
  drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - env:
          ODATA_AUTH: ${{ secrets.ODATA_AUTH }}
        run: >
          npx odatatailor-diff@1 api/metadata.xml
          "https://prd.example.com/sap/opu/odata/sap/ZAPI_ORDERS_SRV"
          --header "Authorization: Basic $ODATA_AUTH"
          --fail-on compatible --no-annotations
```

Between merging a contract change and deploying it, this job reports the pending change. That is expected, and it shows what the next deployment will bring.

## Making breaking changes a decision

The check is not meant to forbid breaking changes. It is meant to stop them from happening by accident. A pattern that works well:

1. `api/metadata.xml` is the contract. CI compares the build against it with `--fail-on breaking`.
2. A pull request that changes the contract on purpose updates `api/metadata.xml` in the same commit. The check passes, and reviewers see exactly what changed in the file diff.
3. `CODEOWNERS` protects the file, so the API owner has to approve:

   ```text
   /api/metadata.xml  @your-org/api-owners
   ```

4. A breaking change goes with a new major version of the API (a new service version, `/v2`, `_0002`). The old contract stays as it is.

## Pin the version

`npx odatatailor-diff@1` takes the newest 1.x and with it new detections; `npx odatatailor-diff@1.0.0` gives identical results until you change it. See [Versioning](../README.md#versioning).
