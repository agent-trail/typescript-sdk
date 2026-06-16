# Agent Trail SDK Implementation Semantics

> [!NOTE]
> SDK semantics are implementation guidance, not the Agent Trail wire-format
> contract. Format validity belongs to the spec repository and vendored
> `@agent-trail/schema` artifacts.

## At A Glance

| Area | SDK owns | SDK does not own |
| --- | --- | --- |
| Package APIs | Public exports, TSDoc, API reports | Spec-level wire compatibility |
| Adapters | Source parsing, mapping, source schemas | CLI command UX |
| Core | JSONL parsing, validation, hashing, reconciliation | Format policy not present in spec artifacts |
| Redaction | Share-time mutation and summaries | Private hosted transport policy |
| Store/catalog | Local object registration and metadata rows | Remote storage |
| Render model | Renderer-neutral transcript data | Web or terminal UI layout |
| Sessions | Workflow orchestration | Concrete share transports |

## Runtime Flow

```text
source storage
  -> @agent-trail/adapters
  -> @agent-trail/core
  -> @agent-trail/redact
  -> @agent-trail/store + @agent-trail/catalog
  -> @agent-trail/sessions
  -> @agent-trail/render-model
```

| Step | Package | Responsibility |
| --- | --- | --- |
| 1 | `@agent-trail/adapters` | Read source-agent storage and emit Agent Trail records. |
| 2 | `@agent-trail/core` | Parse, validate, hash, serialize, and reconcile trail records. |
| 3 | `@agent-trail/redact` | Transform raw JSONL into a redacted artifact before sharing. |
| 4 | `@agent-trail/store` | Register finalized artifacts by content hash. |
| 5 | `@agent-trail/catalog` | Store mutable query metadata for sessions, objects, and shares. |
| 6 | `@agent-trail/sessions` | Coordinate adapters, catalog, store, redaction, and injected transports. |
| 7 | `@agent-trail/render-model` | Build renderer-neutral transcript data. |

Packages communicate through declared `package.json#exports`. `src/**` paths
are private implementation details.

## Adapter Semantics

Adapters convert source-agent storage into writer-strict Agent Trail files.

| Rule | Why |
| --- | --- |
| Emit deterministic entry ids | Re-parsing same source should produce stable output. |
| Preserve useful source evidence | Debuggability without source-specific consumers. |
| Mark synthesized entries | Do not pretend source data carried facts it did not carry. |
| Surface drift visibly | Unknown source families should be quarantined or tested, not silently dropped. |
| Use factory-first exports | Runtime roots, env, and drivers stay explicit. |

> [!IMPORTANT]
> Concrete SDK adapters are public only through factory exports. Internal parser,
> registry, and source-raw helpers are not compatibility surfaces.

## Source Raw Policy

`source.raw` preserves source-agent evidence. It is not adapter-private state.

| Adapter output should | Adapter output should not |
| --- | --- |
| Redact known credential patterns before writing. | Store unbounded raw objects. |
| Elide or summarize very large raw values. | Normalize broad PII during parse. |
| Preserve path-like values when they are source evidence. | Hide source drift with fallback data. |
| Leave share-time privacy work to `@agent-trail/redact`. | Treat internal helpers as public API. |

External adapter authors should import credential primitives from
`@agent-trail/core/credential-patterns` and implement their own raw-size policy.

## Source Schemas

`@agent-trail/source-schemas` describes upstream records before they are mapped
to Agent Trail records.

| Tool | Use |
| --- | --- |
| `selectSchemaVersion(agent, sourceVersion)` | Choose bundled source schema for known upstream versions. |
| `validateSourceRecord(agent, schemaVersion, record)` | Detect source drift before mapping. |

Source schemas are adapter evidence. They are not the Agent Trail format
contract. Writer-strict output validation still happens through
`@agent-trail/core`.

## Core Validation

| Mode | Purpose |
| --- | --- |
| `strict` | Validate writer output. |
| `tolerant` | Accept future-compatible reader input where possible. |

Core diagnostics are structured SDK API values:

```ts
type TrailDiagnostic = {
  line: number;
  path: string;
  severity: "error" | "warning";
  code: string;
  message: string;
};
```

Content hash APIs operate on canonical trail records, not arbitrary filesystem
bytes. Finalized artifacts should be stamped before store registration.

## Reconciliation

Reconciliation fills relationships that cannot be resolved from one record.

| Layer | Owns |
| --- | --- |
| `@agent-trail/core` | Trail-level reconciliation. |
| `@agent-trail/adapter-kit` | Adapter-authoring passes: tool linking, parent chain, cumulative tokens. |
| `@agent-trail/adapters` | Source-specific reconciliation rules. |

Keep pass-one mappings pure when possible. Use adapter-kit overrides only when
source records require cross-record state or lookback.

## Redaction And Sharing

> [!WARNING]
> Raw and redacted trails are different artifacts. They have different bytes and
> different content hashes.

Share workflows should redact first, then call an injected transport.

`@agent-trail/redact` walks:

- messages, tool args, and tool output
- metadata string leaves
- attachment URIs and unsafe overflow references
- `source.raw`
- user-query answers

`@agent-trail/sessions` redacts before invoking a share transport.
`exportSession` returns raw finalized bytes, so callers must redact before
publishing exports.

## Store And Catalog

| Package | Data model |
| --- | --- |
| `@agent-trail/store` | Immutable finalized artifacts under `objects/sha256/<hash>.trail.jsonl`. |
| `@agent-trail/catalog` | Mutable query metadata for source sessions, generated links, stored objects, and shares. |

Do not put catalog-only state into stored trail bytes. Do not derive content
hashes from catalog rows.

## Sessions Orchestration

`@agent-trail/sessions` coordinates lower layers. It does not own:

- concrete adapter parsing policy
- redaction detector policy
- catalog schema details
- hosted share transport implementations

Consumers inject runtime-specific capabilities such as `CatalogDb`, adapter
options, and `SessionsShareTransport`. Default SDK exports stay portable across
Node 20+ and Bun.

## Public API Discipline

- Package roots are deliberate public surfaces.
- API Extractor reports record TypeScript public declarations.
- Package internals may move without compatibility guarantees.
- Public API changes need TSDoc, package exports, API reports, tests, and README
  guidance in the same change.
