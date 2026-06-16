# Agent Trail TypeScript SDK

> [!NOTE]
> This repository owns SDK package behavior. Agent Trail wire-format decisions
> live in the spec repository.

TypeScript packages for Agent Trail schema assets, generated types, core JSONL
utilities, adapter authoring, source-agent adapters, redaction, catalog metadata,
render models, workflow orchestration, and content-addressed local storage.

## Packages

| Package | Purpose |
| --- | --- |
| [`@agent-trail/schema`](./packages/schema) | Vendored Agent Trail schema and validation fixtures. |
| [`@agent-trail/types`](./packages/types) | Generated TypeScript declarations for Agent Trail records. |
| [`@agent-trail/core`](./packages/core) | JSONL parsing, validation, hashing, serialization, and reconciliation. |
| [`@agent-trail/adapter-kit`](./packages/adapter-kit) | Reader, mapping, source-schema, and reconciler primitives for adapters. |
| [`@agent-trail/source-schemas`](./packages/source-schemas) | JSON Schemas for supported upstream source-agent records. |
| [`@agent-trail/adapters`](./packages/adapters) | Concrete adapters for supported coding agents. |
| [`@agent-trail/catalog`](./packages/catalog) | SQLite catalog primitives for source sessions, stored objects, and shares. |
| [`@agent-trail/redact`](./packages/redact) | Redaction APIs and configuration loading for shared trails. |
| [`@agent-trail/store`](./packages/store) | Content-addressed local store for finalized trail artifacts. |
| [`@agent-trail/render-model`](./packages/render-model) | Renderer-agnostic transcript model for viewers. |
| [`@agent-trail/sessions`](./packages/sessions) | Workflow APIs for discover, list, load, share, and export. |

## Contributor Docs

- [`docs/implementation-semantics.md`](./docs/implementation-semantics.md) -
  SDK runtime behavior and package boundaries.
- [`docs/adapter-authoring.md`](./docs/adapter-authoring.md) - checklist for
  external adapter authors and SDK adapter maintainers.
- [`docs/parser-source-matrix.md`](./docs/parser-source-matrix.md) - supported
  source-agent formats, fixture evidence, and update process.
- [`docs/redaction.md`](./docs/redaction.md) - redaction workflow, public API,
  configuration, and safety notes.
- [`docs/GLOSSARY.md`](./docs/GLOSSARY.md) - SDK-owned terminology.
- [`docs/adr/0001-sdk-package-architecture-and-public-api-boundaries.md`](./docs/adr/0001-sdk-package-architecture-and-public-api-boundaries.md) -
  package architecture and public API policy.

## Related Repositories

- [agent-trail/spec](https://github.com/agent-trail/spec) - format contract,
  JSON Schema source, fixtures, and format ADRs.
- [agent-trail/typescript-sdk](https://github.com/agent-trail/typescript-sdk) -
  TypeScript packages for Agent Trail files.
- [agent-trail/cli](https://github.com/agent-trail/cli) - command-line tools for
  Agent Trail workflows.
- [agent-trail/web](https://github.com/agent-trail/web) - docs site and shared
  trail web viewer.

## Development

```sh
mise run setup
mise run check
```

Use `mise run check:actions` after editing GitHub Actions workflows.

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for workflow and PR expectations.

## License

MIT. See [`LICENSE`](./LICENSE).
