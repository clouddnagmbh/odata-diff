# FAQ

- [A new `not null` field in CAP comes out as compatible. Why?](#cap-draft)
- [New enum members: compatible or breaking?](#new-enum-members)
- [XML and JSON of the same service are not identical?](#xml-and-json)
- [The namespace differs between DEV and PRD. Does that matter?](#namespaces)
- [Can I compare OData V2 with V4?](#v2-and-v4)
- [Does `odata-diff` validate `$metadata`?](#validation)
- [What leaves my machine?](#privacy)
- [The service needs SAML or OAuth, not Basic.](#auth)
- [How does this relate to ODataTailor?](#odatatailor)

<a id="cap-draft"></a>

### A new `not null` field in CAP comes out as compatible. Why?

`odata-diff` judges what `$metadata` says, and for entities with `@odata.draft.enabled`, CAP leaves out `Nullable="false"`. A draft may be saved incomplete, so the field is only required on activation. In `$metadata` the field is then optional, and adding an optional property is compatible.

```cds
entity Orders { priority : Integer not null; }
```

| Entity | `$metadata` | `odata-diff` |
| --- | --- | --- |
| without draft | `<Property Name="priority" Type="Edm.Int32" Nullable="false"/>` | breaking |
| with `@odata.draft.enabled` | `<Property Name="priority" Type="Edm.Int32"/>` | compatible |

Checked with `@sap/cds-dk` 10. `@mandatory` is a runtime check in CAP and does not show up as `Nullable` either. For a draft-enabled API where every new field matters, use `--fail-on compatible`.

<a id="new-enum-members"></a>

### New enum members: compatible or breaking?

A new member is compatible by default, because every request that was valid stays valid. Some API guidelines see it differently: a client with an exhaustive `switch` can meet an unknown value in a response. If your guidelines say so, you have two options:

- `--fail-on compatible` fails on every addition, enum members included.
- Use the JSON report and fail only on what your rules forbid:

  ```sh
  npx odatatailor-diff@1 api/metadata.xml metadata.xml --format json --fail-on never > diff.json
  jq -e '[.changes[] | select(.severity == "breaking" or .kind == "member-added")] | length == 0' diff.json
  ```

  `jq -e` exits with 1 when the expression is `false`.

<a id="xml-and-json"></a>

### XML and JSON of the same service are not identical?

Not quite. The structure, meaning sets, types, properties, navigations and operations, comes out the same: comparing the EDMX and the CSDL JSON of one CAP service gives no breaking and no compatible change. Annotations are written differently in the two formats, though, so a few *annotation only* differences remain. Compare XML with XML and JSON with JSON, or use `--no-annotations`.

<a id="namespaces"></a>

### The namespace differs between DEV and PRD. Does that matter?

No. Types, sets and operations are matched by name without namespace, entity container names are ignored, and annotation targets are shortened the same way. See [Rules: how elements are matched](rules.md#how-elements-are-matched).

<a id="v2-and-v4"></a>

### Can I compare OData V2 with V4?

You can, and the result is one breaking change, `OData version 2.0 → 4.0`, plus whatever else differs. Moving a service from V2 to V4 changes URLs, payloads and query options for every client anyway, so treat it as a new API version.

<a id="validation"></a>

### Does `odata-diff` validate `$metadata`?

No. It reads what is there and compares it. A document that is not `$metadata` at all, such as an HTML login page, is rejected with exit code 2 and the message `not a $metadata document`. When a URL returns a login page instead of `$metadata`, the credentials or the `sap-client` are usually wrong.

<a id="privacy"></a>

### What leaves my machine?

Only the requests to the URLs you pass, with the headers you pass. There is no telemetry and no update check. `npx` itself downloads the package from npm the first time; to avoid that in CI, add `odatatailor-diff` as a dev dependency.

<a id="auth"></a>

### The service needs SAML or OAuth, not Basic.

Pass whatever header the service accepts, for example `--header "Authorization: Bearer $TOKEN"` with a token your pipeline fetched before. For interactive logins such as SAML, download `$metadata` with a tool that can log in, or save it from the browser, and pass the file.

<a id="odatatailor"></a>

### How does this relate to ODataTailor?

[ODataTailor](https://odatatailor.com) is a free browser extension for OData services. It shows a service as a diagram, builds and runs queries, records the OData traffic of an app, and compares `$metadata` interactively, one system against another or a file against a system. `odata-diff` is that comparison for the command line, with the same parser, the same rules and the same texts.
