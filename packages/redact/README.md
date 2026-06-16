# @agent-trail/redact

> [!IMPORTANT]
> Redaction creates a new artifact. Raw exports must be redacted before
> publishing.

Redaction APIs for transforming raw Agent Trail JSONL into redacted JSONL before
sharing or publishing.

## Public Surface

The package root exports:

- `redactTrailJsonl`
- `resolveRedactionConfig`
- `DEFAULT_PATTERNS`
- redaction option, summary, pack, PII, and result types

`redactTrailJsonl` accepts a string or async JSONL input and returns redacted
JSONL, parsed redacted records, and mutation summary data.

## Boundaries

This package owns share-time redaction behavior and configuration loading. It
does not own adapter emission-time source-raw policy, local store registration,
or concrete share transports.

`@agent-trail/sessions` calls this package before invoking an injected share
transport. `exportSession` returns raw finalized bytes, so callers must redact
before publishing exports.

## Docs

- [`docs/redaction.md`](../../docs/redaction.md)
- [`docs/implementation-semantics.md`](../../docs/implementation-semantics.md#redaction-and-sharing)

## Checks

```sh
bun test packages/redact
bun run check:types
bun run check:api
```
