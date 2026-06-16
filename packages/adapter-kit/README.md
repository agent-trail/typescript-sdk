# @agent-trail/adapter-kit

Shared authoring primitives for Agent Trail adapters. Concrete adapters compose
source readers, source-schema validation, mapping definitions, and reconciler
passes without reaching into package internals.

## Public Surface

- `JsonlReader`, `SqliteReader`, `chainReaders`, and `mergeByTimestamp`
- `defineMapping` and `defineAdapter`
- source-schema helpers: `selectSchemaVersion`, `validateSourceRecord`
- adapter authoring types such as `SourceReader`, `RawRecord`, `AdapterDef`,
  `TrailEntryDraft`, `ReconcilerConfig`, and `ReconcilerRule`
- `@agent-trail/adapter-kit/bun-sqlite` for the Bun-only SQLite driver helper

The root export supports Node 20+ and Bun. It must not import `bun:*`.

## Boundaries

`adapter-kit` owns reusable primitives for adapter authors. It does not own
concrete source-agent policy, source-specific coercion, local storage defaults,
or concrete adapter registries. Those belong in `@agent-trail/adapters` or in an
external adapter package.

Source schemas come from `@agent-trail/source-schemas`; Agent Trail output
validation comes from `@agent-trail/core`.

## Reader Model

`SourceReader` exposes three operations:

```ts
interface SourceReader {
  records(source: SourcePointer): AsyncIterable<RawRecord>;
  schemaVersion(source: SourcePointer): Promise<string | undefined>;
  identityHash(source: SourcePointer): Promise<string>;
}
```

`JsonlReader` reads newline-delimited JSON. `SqliteReader` uses an injected
SQLite driver. Compose readers only when their ordering semantics are clear.

## Mapping Model

`defineAdapter` runs a two-pass model:

1. per-record mappings and overrides emit `TrailEntryDraft[]`
2. reconciler passes fill cross-record relationships and strip transient linker
   metadata

Use pure `defineMapping` functions for direct record-to-entry conversion. Use
overrides only for stateful source behavior.

## Docs

- [`docs/adapter-authoring.md`](../../docs/adapter-authoring.md)
- [`docs/implementation-semantics.md`](../../docs/implementation-semantics.md)
- [`docs/parser-source-matrix.md`](../../docs/parser-source-matrix.md)

## Checks

```sh
bun test packages/adapter-kit
bun run check:types
bun run check:api
bun run check:exports
```
