# @agent-trail/sessions

Workflow orchestration for Agent Trail source sessions.

This package coordinates adapters, catalog rows, local store registration,
redaction, and injected sharing transports. Callers provide runtime-specific
capabilities such as `CatalogDb` and share transports.

## Parity oracle

ATF-25 uses committed SDK adapter, store, catalog, and redaction fixtures as the
workflow parity oracle. The old monorepo workflow tests are not present in this
split-repo checkout, so they are not ported in this slice.
