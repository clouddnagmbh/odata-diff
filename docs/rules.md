# Rules: what is breaking, and why

`odata-diff` asks one question for every difference: **can a client that works against the old `$metadata` fail against the new one?** If yes, the change is *breaking*. If clients keep working and only gain something, it is *compatible*. Annotations steer UIs and tools but are not part of the data contract, so they get their own level, *annotation only*.

The rules describe what `$metadata` says. A service can of course break clients in ways `$metadata` does not show, such as changed business logic, different values in a field or new authorisation checks. No schema diff can see those.

## How elements are matched

- **By name, without namespace.** `ZAPI_ORDERS_SRV.Order` and `ZAPI_ORDERS_SRV_DEV.Order` are the same type. Entity container names are ignored. This lets you compare the same service across systems where the namespace differs.
- **Entity types and complex types** are matched together by name.
- **Bound operations** are matched by binding type and name (`Orders/approve`), unbound ones by name.
- **OData V4 action and function imports** are not compared on their own, because they point to the actions and functions, which are. In OData V2, function imports are the operations.
- **Annotations** are matched by target, term and qualifier: `Orders/title@Common.Label`, `Orders@UI.LineItem#Compact`. Vocabulary namespaces are shortened, so `com.sap.vocabularies.Common.v1.Label` becomes `Common.Label`. In V2, SAP attributes such as `sap:label` count as annotations.
- **Order does not matter.** Moving a property or reordering the document is not a change.

## The service

| Change | Level | Example output | Why |
| --- | --- | --- | --- |
| OData version changed | breaking | `$metadata  OData version 2.0 → 4.0` | URL conventions, payload format and query options differ between versions. Every client needs to be adapted. |

## Entity sets

| Change | Level | Example output | Why |
| --- | --- | --- | --- |
| set removed | breaking | `Orders  Entity set removed` | Every request to `/Orders` returns 404. |
| set added | compatible | `Invoices  Entity set added` | Nobody calls what they don't know. |
| entity type of the set changed | breaking | `Orders  Entity type of the set changed: Order → SalesOrder` | Clients parse the response as the old type. |

## Entity types and complex types

| Change | Level | Example output | Why |
| --- | --- | --- | --- |
| type removed | breaking | `Address  Type removed` | Everything that uses the type changes with it. |
| type added | compatible | `Invoice  Type added` | |
| key changed | breaking | `Order  Key changed: OrderID → OrderID, Year` | Every read, update and delete by key (`/Orders('4711')`) changes its URL. |
| base type changed | breaking | `SalesOrder  Base type changed: Order → Document` | The inherited properties change, and so does type casting in URLs. |

## Properties

| Change | Level | Example output | Why |
| --- | --- | --- | --- |
| property removed | breaking | `Orders/notes  Property removed (Edm.String)` | `$select=notes` fails, and clients that read or write it get nothing or an error. |
| **optional** property added | compatible | `Orders/deliveryDate  Property added (Edm.Date)` | Readers ignore what they don't know, and writers may leave it out. |
| **required** property added | breaking | `Orders/priority  Property added (Edm.Int32, Nullable=false)` | Every client that creates records without the new field is rejected. |
| type changed | breaking | `Orders/amount  Type changed: Edm.Decimal → Edm.Double` | Parsing, formatting and filter literals change. |
| `MaxLength` smaller, or set where there was none | breaking | `Orders/customer  MaxLength 80 → 40` | Values that were valid yesterday are rejected or truncated. |
| `MaxLength` larger, or removed | compatible | `Orders/customer  MaxLength 40 → 80` | Every value that was valid stays valid. A client with a fixed-length field may still want to know, so use `--fail-on compatible` if that matters to you. |
| `Precision` or `Scale` smaller, or set | breaking | `Orders/amount  Scale 3 → 2` | Values lose digits or are rejected. |
| `Precision` or `Scale` larger, or removed | compatible | `Orders/amount  Precision 13 → 15` | |
| `Nullable` true → false | breaking | `Orders/title  Nullable true → false` | Clients that create or update without the field are rejected. |
| `Nullable` false → true | compatible | `Orders/title  Nullable false → true` | Writers keep working. Readers can now get `null`. Code that never expected `null` may stumble, so the report shows the change. |

A property without a `Nullable` attribute is nullable, as the OData specification says. A missing `MaxLength`, `Precision` or `Scale` means unlimited. `MaxLength="max"` is unlimited too.

## Navigation properties

| Change | Level | Example output | Why |
| --- | --- | --- | --- |
| navigation removed | breaking | `Orders/items  Navigation removed (Collection(OrderItems))` | `$expand=items` and `/Orders(…)/items` fail. |
| navigation added | compatible | `Orders/invoice  Navigation added (Invoice)` | |
| target changed | breaking | `Orders/customer  Navigation target changed: Customer → BusinessPartner` | The expanded data has a different shape. |
| multiplicity changed | breaking | `Orders/items  Multiplicity * → 1` | One object instead of a list, or the other way round. Clients parse it wrongly in both directions. |

## Actions, functions and function imports

| Change | Level | Example output | Why |
| --- | --- | --- | --- |
| operation removed | breaking | `Orders/approve  Operation removed` | The call fails. |
| operation added | compatible | `Orders/cancel  Operation added` | |
| parameter removed | breaking | `Orders/decline(reason)  Parameter removed (Edm.String)` | Callers that pass it get an error. |
| **optional** parameter added | compatible | `Orders/decline(notify)  Parameter added (Edm.Boolean)` | Existing calls stay valid. |
| **required** parameter added | breaking | `Orders/decline(notify)  Parameter added (Edm.Boolean)` | Existing calls lack it. |
| parameter type changed | breaking | `Orders/decline(reason)  Parameter type changed: Edm.String → Edm.Int32` | |
| return type changed | breaking | `GetStatistics  Return type changed: Stats → Collection(Stats)` | Clients parse the result as the old type. |
| HTTP method changed (V2) | breaking | `GetStatistics  HTTP method changed: GET → POST` | Calls with the old method fail. |

The examples show the target and the text. A required and an optional parameter produce the same text; the level tells them apart.

## Enum types

| Change | Level | Example output | Why |
| --- | --- | --- | --- |
| enum type removed | breaking | `Priority  Type removed` | |
| enum type added | compatible | `Priority  Type added` | |
| member removed | breaking | `Priority/Urgent  Enum member removed` | Clients that send it are rejected, and filters on it fail. |
| member added | compatible | `Priority/Critical  Enum member added` | Requests stay valid. A client with an exhaustive `switch` may still meet an unknown value in a response. If your API rules say new members need a new version, run with `--fail-on compatible` or check the JSON report (see the [FAQ](faq.md#new-enum-members)). |

## Annotations

| Change | Level | Example output |
| --- | --- | --- |
| annotation removed | annotation only | `Orders/notes@Common.Label  Annotation removed: "Notes"` |
| annotation added | annotation only | `Orders/title@Common.Label  Annotation added: "Title"` |
| annotation changed | annotation only | `Order/Customer@sap:label  Customer → Customer name` |

Annotations drive Fiori elements, value helps, field control and side effects. Changing them does not break the data contract, but it can change what users see. `--fail-on annotation` fails on any change at all, and `--no-annotations` leaves annotations out of the report.

## Choosing the level

| You want | Use |
| --- | --- |
| only additive changes within a version | `--fail-on breaking` (the default) |
| a frozen contract, any change needs a decision | `--fail-on compatible` |
| also no UI changes without review | `--fail-on annotation` |
| a report, never a failed build | `--fail-on never` |
| your own rules | `--format json`, then filter `changes` by `kind` |
