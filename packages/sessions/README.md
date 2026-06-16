# @agent-trail/sessions

Workflow orchestration for Agent Trail source sessions.

This package coordinates adapters, catalog rows, local store registration,
redaction, and injected sharing transports. Callers provide runtime-specific
capabilities such as `CatalogDb` and share transports.

## Public Surface

The package root exports:

- `createSessionsClient`
- `discoverSessions`
- `listSessions`
- `loadSession`
- `shareSession`
- `exportSession`
- session workflow option, result, selector, warning, and transport types
- selected adapter, catalog, store, and redaction types used by the workflows

## Workflow Boundary

- `discover`, `list`, and `load` coordinate adapter, catalog, and local store
  workflows.
- `share` redacts generated trail bytes before calling the injected transport.
- `export` returns or writes raw finalized store bytes. Callers must redact
  before publishing exported bytes.

This package does not own concrete adapter parsing policy, catalog schema
details, redaction detector policy, or concrete hosted share transports.

## Docs

- [`docs/implementation-semantics.md`](../../docs/implementation-semantics.md#sessions-orchestration)
- [`docs/redaction.md`](../../docs/redaction.md)
- [`docs/parser-source-matrix.md`](../../docs/parser-source-matrix.md)

## Checks

```sh
bun test packages/sessions
bun run check:types
bun run check:api
```
