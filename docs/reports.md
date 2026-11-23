# Reports

Three formats, one content: `--format text` (default) for the CI log, `markdown` for pull requests and job summaries, `json` for your own tools. Changes are always sorted by level (breaking, compatible, annotation only), then by target.

## Text

```text
$metadata diff: examples/orders-v1.xml → examples/orders-v2.xml
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

The output has five parts:

1. **Title:** the two sources. URLs are shown without user info and query string.
2. **Counts per level.**
3. **One line per change:** level, target, description.
4. **Verdict.** It starts with `✗` when the run fails and `✓` when it passes. This is the line that goes to stdout when the report is written with `--output`.
5. **No differences.** When nothing changed, the report says `No differences.`

### Targets

| Target | Means |
| --- | --- |
| `Orders` | entity set, type or unbound operation |
| `Orders/customer` | property or navigation of a type |
| `Orders/decline(notify)` | parameter `notify` of the bound operation `decline` |
| `Priority/Urgent` | enum member |
| `Orders/notes@Common.Label` | annotation term on a target, shortened vocabulary |
| `Orders@UI.LineItem#Compact` | annotation with qualifier |
| `$metadata` | the document itself (OData version) |

Types are shown without namespace (`Edm.` types keep it): `Collection(OrderItems)`, `Edm.Decimal`.

## Markdown

```sh
npx odatatailor-diff api/metadata.xml metadata.xml --format markdown --output metadata-diff.md
```

```markdown
# $metadata diff: api/metadata.xml → metadata.xml

## breaking (3)

| | |
| --- | --- |
| `Orders/customer` | MaxLength 80 → 40 |
| `Orders/notes` | Property removed (Edm.String) |
| `Orders/priority` | Property added (Edm.Int32, Nullable=false) |

## compatible (3)

| | |
| --- | --- |
| `Orders/cancel` | Operation added |
| `Orders/decline(notify)` | Parameter added (Edm.Boolean) |
| `Orders/deliveryDate` | Property added (Edm.Date) |
```

Empty groups are left out. The format is the same as the Markdown export of the diff in the ODataTailor extension.

## JSON

```sh
npx odatatailor-diff api/metadata.xml metadata.xml --format json
```

```json
{
  "before": "api/metadata.xml",
  "after": "metadata.xml",
  "counts": { "breaking": 3, "compatible": 3, "annotation": 2 },
  "failOn": "breaking",
  "failed": true,
  "changes": [
    {
      "severity": "breaking",
      "kind": "max-length",
      "target": "Orders/customer",
      "before": "80",
      "after": "40"
    },
    {
      "severity": "breaking",
      "kind": "property-added",
      "target": "Orders/priority",
      "after": "Edm.Int32, Nullable=false"
    }
  ]
}
```

| Field | Type | Content |
| --- | --- | --- |
| `before`, `after` | string | the sources as shown in the title |
| `counts` | object | number of changes per level: `breaking`, `compatible`, `annotation` |
| `failOn` | string | the `--fail-on` value of the run |
| `failed` | boolean | `true` when the run exits with 1 |
| `changes[].severity` | string | `breaking`, `compatible` or `annotation` |
| `changes[].kind` | string | kind of change, see below |
| `changes[].target` | string | what changed, see [Targets](#targets) |
| `changes[].before` | string? | old value, if the change has one |
| `changes[].after` | string? | new value, if the change has one |

`kind` is one of the following:

`version` · `set-removed` · `set-added` · `set-type` · `type-removed` · `type-added` · `key` · `base-type` · `property-removed` · `property-added` · `property-type` · `max-length` · `precision` · `scale` · `nullable` · `navigation-removed` · `navigation-added` · `navigation-target` · `multiplicity` · `operation-removed` · `operation-added` · `parameter-removed` · `parameter-added` · `parameter-type` · `return-type` · `http-method` · `member-removed` · `member-added` · `annotation-removed` · `annotation-added` · `annotation-changed`

What each kind means and why it has its level is in [rules.md](rules.md). New kinds can come in minor versions. Fields are only removed or changed in a major version.

## German

`--lang de` writes the report in German, with the same texts as the ODataTailor extension:

```text
✗ 3 Änderung(en) ab „brechend“ – Abbruch (--fail-on breaking)
```

`--lang` changes only the texts. The JSON keys and values (`severity`, `kind`) stay English.

## Options that change the report

- `--no-annotations` leaves annotation-only changes out of the lines, the counts and the JSON.
- `--output <file>` writes the report to the file and prints only the verdict. The exit code is the same.
- `--fail-on` changes the verdict and the exit code, not the content.
