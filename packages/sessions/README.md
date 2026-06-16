# @agent-trail/sessions

Workflow orchestration for Agent Trail source sessions.

This package coordinates adapters, catalog rows, local store registration,
redaction, and injected sharing transports. Callers provide runtime-specific
capabilities such as `CatalogDb` and share transports.

## Workflow boundary

- `discover`, `list`, and `load` coordinate adapter, catalog, and local store workflows.
- `share` redacts generated trail bytes before calling the injected transport.
- `export` returns or writes raw finalized store bytes. Callers must redact before publishing exported bytes.

## Parity oracle

ATF-25 sessions tests cover orchestration with injected adapters and transports.
Lower-level adapter, store, catalog, and redaction parity remains covered by
those packages. The old monorepo workflow tests are not present in this
split-repo checkout, so they are not ported in this slice.
