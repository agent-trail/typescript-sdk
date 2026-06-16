# @agent-trail/catalog

SQLite catalog primitives for mutable Agent Trail metadata.

The catalog records source sessions discovered by adapters, content-addressed
trail objects registered in the local store, generated trail links, and latest
share state.

## Public Surface

The package root exports:

- `CatalogDb`, `CatalogParams`, and `CatalogValue`
- source-session and trail-object row types
- schema initialization and migration helpers
- upsert, list, link, mark-missing, and share-state functions

Callers inject a SQLite-compatible `CatalogDb`. This package does not choose a
runtime driver.

## Boundaries

Catalog rows are mutable query metadata. They are not part of content-addressed
trail bytes and must not affect trail `content_hash` values.

`@agent-trail/store` owns object registration and local object paths.
`@agent-trail/sessions` coordinates catalog calls with adapters, store,
redaction, and share transports.

## Docs

- [`docs/implementation-semantics.md`](../../docs/implementation-semantics.md#store-and-catalog)
- [`docs/GLOSSARY.md`](../../docs/GLOSSARY.md)

## Checks

```sh
bun test packages/catalog
bun run check:types
bun run check:api
```
