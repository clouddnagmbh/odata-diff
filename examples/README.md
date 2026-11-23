# Examples

Two states of the same CAP service, compiled with `cds compile srv --to edmx --service OrderService` (`@sap/cds-dk` 10):

- `orders-v1.xml`: the released contract
- `orders-v2.xml`: the next build, where `customer` is shorter, `notes` is removed, `priority` is new and required, `deliveryDate` and the action `cancel` are new, and `decline` gets an optional parameter

```sh
npx odatatailor-diff examples/orders-v1.xml examples/orders-v2.xml
```

Expected: 3 breaking, 3 compatible, 2 annotation only, exit code 1.
