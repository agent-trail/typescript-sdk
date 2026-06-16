# @agent-trail/core

Core Agent Trail JSONL parsing, validation, hashing, serialization, and
reconciliation APIs.

## Public Surface

The package root exports:

- `parseTrailJsonl`
- `validateTrailJsonl`
- `validateWriterStrictRecord`
- `computeContentHashes`
- `stampContentHashes`
- `serializeTrailJsonl`
- `reconcileSegments`
- diagnostic, parsed-trail, validation, and reconciliation types

Documented subpaths:

- `@agent-trail/core/credential-patterns`
- `@agent-trail/core/identity`

## Boundaries

`core` owns Agent Trail record parsing and SDK diagnostic shapes. It does not
own concrete adapter policy, local store layout, catalog metadata, redaction
configuration, or renderer-specific display behavior.

Format validity comes from vendored schema artifacts and spec-derived validation
rules. SDK implementation semantics are documented separately.

## Docs

- [`docs/implementation-semantics.md`](../../docs/implementation-semantics.md#core-validation)
- [`docs/redaction.md`](../../docs/redaction.md)
- [`packages/schema/fixtures/validation/README.md`](../schema/fixtures/validation/README.md)

## Checks

```sh
bun test packages/core
bun run check:types
bun run check:api
```
