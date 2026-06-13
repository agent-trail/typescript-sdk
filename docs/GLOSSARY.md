# Agent Trail TypeScript SDK Glossary

This glossary defines SDK-owned language. Format terms remain owned by the
Agent Trail spec repository.

## Language

**Public API**:
The imports, exported values, exported types, package metadata, and runtime
behavior that consumers can rely on through a package's `exports` map.
Avoid: treating source files or internal module paths as public.

**Package boundary**:
The line between one published SDK package and another. Code crosses this
boundary only through the imported package's declared public exports.
Avoid: workspace convenience imports that bypass package exports.

**Deep import**:
An import into an undeclared package subpath, such as
`@agent-trail/core/src/hash.ts`. Deep imports are forbidden because they turn
internal files into accidental public API.

**Leaf package**:
A directly published package such as `@agent-trail/core` or
`@agent-trail/sessions`. The SDK has no umbrella `@agent-trail/sdk` package.

**Generated types**:
TypeScript declarations generated from the Agent Trail JSON Schema. They are
implementation artifacts, not the format contract.

**Vendored spec artifact**:
A pinned copy of an immutable spec release artifact, such as a schema JSON file
or validation fixture. SDK packages derive generated types and checks from
vendored artifacts.

**API report**:
A committed API Extractor snapshot that records a TypeScript package's public
declaration surface. Changes to API reports are public API changes.

**Adapter**:
Code that reads source-agent storage and emits Agent Trail trail files.
Adapters preserve source evidence while normalizing to the format contract.

**Adapter kit**:
Shared primitives for building adapters, including mapping helpers, reader
interfaces, and source schema validation.

**Source schema**:
A JSON Schema describing normalized upstream source-agent records before they
are mapped to Agent Trail records. Source schemas document adapter evidence;
they are not the Agent Trail format contract.

**Local store**:
The SDK-owned content-addressed store for finalized trail artifacts and a
rebuildable metadata index.

**Redaction**:
SDK behavior that transforms raw trails into redacted trails before sharing or
export. Redaction packages own detector rules and mutation accounting.

**Render model**:
The shared transcript model consumed by web and terminal viewers. It is derived
from trail records and does not change trail validity.

**Sessions orchestration**:
Workflow APIs for discover, load, list, share, and export behavior. The
`@agent-trail/sessions` package coordinates adapters, store, redaction, core
validation, and injected transports.

**Injected driver**:
A runtime capability supplied by the consumer, such as a SQLite driver. SDK
default exports remain Node 20+ and Bun compatible by using injected drivers
instead of importing runtime-specific APIs.

## Relationships

- The spec repository owns the format contract and format glossary.
- The SDK repository owns package APIs, generated artifacts, adapter behavior,
  store behavior, redaction behavior, render models, and orchestration APIs.
- Package boundaries are enforced by `package.json#exports`, API reports, and
  import checks.
- Generated types and validators derive from vendored spec artifacts.
- `@agent-trail/sessions` sits above domain packages and exposes workflow APIs
  for CLI and future MCP consumers.

## Flagged Ambiguities

- "API" can mean public package API or internal helper shape. Use "public API"
  when package consumers can import or rely on it.
- "Schema" can mean the Agent Trail format schema or a source-agent schema. Use
  "format schema" or "source schema" when both are in scope.
- "Adapter support" can mean source discovery, source parsing, or writer-strict
  trail emission. State the behavior being promised.
