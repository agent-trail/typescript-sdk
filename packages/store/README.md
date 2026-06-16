# @agent-trail/store

> [!NOTE]
> Store objects are immutable finalized artifacts. Mutable query state belongs
> in `@agent-trail/catalog`.

Content-addressed local store for finalized Agent Trail artifacts.

Finalized trail files live under
`<storeRoot>/objects/sha256/<content_hash>.trail.jsonl`. The store root defaults
to `~/.local/share/trail` and can be overridden through `AGENT_TRAIL_HOME` or an
explicit `storeRoot` option.

## Public Surface

The package root exports:

- `registerTrail`
- `indexExistingObjects`
- `reconcileIncomingSegment`
- `objectPath`
- `resolveStoreRoot`
- store option, result, and status types

## Boundaries

The store owns immutable object placement and registration. Mutable query
metadata belongs to `@agent-trail/catalog`.

`registerTrail` validates, hashes, and writes finalized trail artifacts.
`indexExistingObjects` rebuilds catalog rows from existing object files.
`reconcileIncomingSegment` handles incoming segment registration policy.

## Docs

- [`docs/implementation-semantics.md`](../../docs/implementation-semantics.md#store-and-catalog)
- [`docs/GLOSSARY.md`](../../docs/GLOSSARY.md)

## Checks

```sh
bun test packages/store
bun run check:types
bun run check:api
```
