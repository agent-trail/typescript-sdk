# SDK package architecture and public API boundaries

## Status

Accepted.

## Context

The TypeScript SDK repository owns public TypeScript packages and
generated/public TypeScript contracts. It does not own the CLI binary or the web
app. Package boundaries must be locked before porting starts so downstream CLI,
web, and future MCP work build on stable surfaces.

This ADR defines SDK repository package layout, runtime target, and public API
policy. Format-contract decisions remain owned by the spec repository.

## Decision

The SDK publishes leaf packages only. The workspace root remains private, and
there is no umbrella `@agent-trail/sdk` package.

Planned packages:

| Package | Ownership |
| --- | --- |
| `@agent-trail/schema` | Vendored Agent Trail schema assets and format fixtures. |
| `@agent-trail/types` | TypeScript declarations generated from vendored schema artifacts. |
| `@agent-trail/core` | JSONL parsing, writer-strict validation, reader-tolerant parsing, hashing, canonicalization, and reconciliation. |
| `@agent-trail/adapter-kit` | Adapter primitives, mapping helpers, reader interfaces, source schema selection, and source schema validation. |
| `@agent-trail/source-schemas` | JSON evidence packages for verified upstream source-agent formats. |
| `@agent-trail/adapters` | Concrete source-agent parsers and default adapter registry. |
| `@agent-trail/redact` | Redaction rules, detector packs, trail transforms, and mutation accounting. |
| `@agent-trail/store` | Content-addressed local store, object registration, rebuildable index, and store-level lookup helpers. |
| `@agent-trail/render-model` | Shared transcript/rendering model for web and terminal viewers. |
| `@agent-trail/sessions` | Workflow orchestration for discover, load, list, share, and export. |

Dependency direction:

- `schema`, `types`, and `source-schemas` are contract and evidence packages at
  the bottom of the graph.
- `core` depends on `schema` and `types`.
- `adapter-kit` depends on `core` and `source-schemas`.
- `adapters` depends on `adapter-kit`, `core`, and `types`.
- `redact`, `store`, and `render-model` depend on `core` and types where needed.
- `sessions` is the top orchestration package and may depend on `adapters`,
  `redact`, `store`, and `core`.

Runtime and dependency policy:

- SDK default exports support Node 20+ and Bun.
- SDK default exports must not import Bun globals or `bun:*` modules.
- Runtime-specific capabilities use injected interfaces. SQLite-backed source
  readers use injected drivers and are optional storage surfaces by default.
- When an optional storage driver is missing, health reports a warning and
  discovery skips that storage surface rather than crashing unrelated workflows.
- If a future package declares an injected driver as integral to its default
  behavior, the package health check must fail visibly when that driver is
  missing.
- Concrete sharing transports are injected into `@agent-trail/sessions`;
  sessions owns orchestration, not Gist or hosted transport implementations.

Build and packaging policy:

- Runtime packages publish ESM-only `dist` JavaScript and `.d.ts` declarations
  emitted by `tsc`.
- Packages are not bundled for library publication.
- Runtime package exports are minimal and explicit: `.` and `./package.json`
  unless a documented public subpath is required.
- Asset packages such as `schema` and `source-schemas` may expose documented
  JSON and versioned subpaths.
- `src/**` paths are private implementation details.

Public API discipline:

- TypeScript API packages must have committed API Extractor reports.
- API report changes are public API changes and must be intentional.
- Workspace imports must match the target package's `exports` map.
- Deep imports such as `@agent-trail/core/src/hash.ts` are forbidden.
- CI runs package export checks and API Extractor checks before porting work can
  be treated as complete.

License policy:

- Schema and source-schema asset packages use Apache-2.0.
- Implementation packages use MIT.
- Each published package declares its own package license.

## Considered Options

- Preserve the initial package set without changes. Rejected because the CLI is
  outside this repo and planned `sessions` and `render-model` packages need
  explicit ownership.
- Collapse SDK behavior into fewer packages. Rejected because CLI, web, and
  future MCP consumers need different dependency surfaces.
- Keep adapters Bun-only. Rejected because `@agent-trail/adapters` is now an SDK
  package, not CLI implementation code.
- Add an umbrella package. Rejected because leaf packages keep package
  boundaries reviewable and avoid broad accidental public API.
- Export source `.ts` files. Rejected because published packages should expose
  built JavaScript and declarations, not source internals.

## Consequences

- ATF-19 and later package ports must create package manifests, build configs,
  exports maps, and API reports that conform to this ADR.
- Existing implementation code that imported internals must be rewritten to use
  package public APIs or local relative imports before porting.
- Adapters that used Bun APIs directly must move runtime-specific behavior
  behind injected interfaces.
- `@agent-trail/sessions` can provide out-of-box workflow APIs for CLI and
  future MCP consumers while still accepting injected transports and drivers.
- Full SDK implementation docs migration remains separate work under ATF-28.
