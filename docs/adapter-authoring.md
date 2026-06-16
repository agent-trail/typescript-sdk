# Adapter Authoring Guide

> [!TIP]
> Use this guide for new adapters and substantial adapter updates. External
> adapters should build on `@agent-trail/adapter-kit`; SDK adapters live in
> `@agent-trail/adapters`.

## Audience

| Audience | Use this path |
| --- | --- |
| External adapter author | Use public `@agent-trail/adapter-kit` exports. |
| SDK maintainer | Add concrete adapter code under `packages/adapters/src/<agent>`. |

Both paths should emit writer-strict Agent Trail records and keep source drift
visible.

## Done Definition

A supported adapter has:

- [ ] Stable adapter name.
- [ ] Documented source storage roots and override options.
- [ ] Source schemas for verified upstream record shapes.
- [ ] Source discovery or explicit parse input contract.
- [ ] Deterministic Agent Trail entry ids.
- [ ] Writer-strict header, entries, envelope, and content hashes.
- [ ] Synthetic or redacted committed fixtures.
- [ ] Focused tests for mapping, discovery, drift, and health behavior.
- [ ] Parser-source-matrix evidence.
- [ ] No runtime-specific imports from default package roots.

## External Adapter Path

Use public adapter-kit APIs only:

| Need | API |
| --- | --- |
| JSONL source | `JsonlReader` |
| SQLite source | `SqliteReader` with injected driver |
| Sequential readers | `chainReaders` |
| Timestamp merge | `mergeByTimestamp` |
| Pure mapping | `defineMapping` |
| Parse orchestration | `defineAdapter` |
| Source schema selection | `selectSchemaVersion` |
| Source record validation | `validateSourceRecord` |

Avoid:

- importing `@agent-trail/adapters/src/**`
- putting source-specific coercion into adapter-kit
- mutating global environment during parse
- fallback behavior that hides source drift

## SDK Maintainer Path

Concrete SDK adapters belong in `packages/adapters/src/<agent>`.

| Step | Action |
| --- | --- |
| 1 | Survey source storage and document root resolution. |
| 2 | Add or update source schemas in `@agent-trail/source-schemas`. |
| 3 | Register schema selection in `@agent-trail/adapter-kit`. |
| 4 | Add reader and discovery behavior behind factory options. |
| 5 | Map source records to Agent Trail entries with deterministic ids. |
| 6 | Validate emitted trails through `@agent-trail/core`. |
| 7 | Add synthetic or redacted fixtures. |
| 8 | Update `docs/parser-source-matrix.md`. |
| 9 | Keep public exports factory-first and minimal. |

Shared implementation code belongs in `packages/adapters/src/shared` only when
at least two concrete adapters use it.

## Source Survey

Capture source truth before writing mapper code:

| Survey item | Examples |
| --- | --- |
| Storage | File paths, SQLite tables, object trees. |
| Overrides | Env vars, platform defaults, explicit factory options. |
| Versioning | Source version fields and fallback behavior. |
| Identity | Stable source ids, parent ids, branch refs. |
| Event families | Messages, tools, reasoning, compaction, lifecycle, models. |
| Artifacts | Attachments, media, overflow refs. |
| Privacy | Credentials, paths, private repo identity, PII-like fields. |

If upstream writer code is public, use it as evidence. If it is closed, rely on
redacted fixtures and observed source files.

## Source Schemas

Source schemas validate upstream records before mapping.

| Good schema behavior | Bad schema behavior |
| --- | --- |
| Catch new record families. | Reject harmless additive fields without reason. |
| Keep source drift visible. | Replace Agent Trail output validation. |
| Document source evidence. | Encode adapter implementation details. |

For SDK adapters:

1. Add schema files under `packages/source-schemas/<agent>`.
2. Update package exports.
3. Run `bun run generate:source-types`.
4. Register schema in `packages/adapter-kit/src/source-schemas/registry.ts`.
5. Add corpus tests when fixtures exercise the schema.

## Mapping

| Prefer | Avoid |
| --- | --- |
| Facts present in source data. | Invented fields with no source evidence. |
| Pure `defineMapping` functions. | Stateful mapping unless needed. |
| `source.raw` for useful evidence. | Adapter-private temp state in output. |
| Marked synthesized entries. | Pretending synthesized events were source-native. |

Use adapter-kit overrides for stateful source behavior, such as pairing records
without direct ids or collapsing multi-record source events.

## Reconciliation

Enable only passes that match source topology:

| Pass | Use when |
| --- | --- |
| `toolLinking` | Mappings emit linker metadata for call/result pairs. |
| `parentChain` | Transcript is linear. |
| `cumulativeTokens` | Source emits per-turn usage but no running totals. |
| custom passes | Adapter has source-specific relationships. |

Tree-shaped sources should set parent ids directly until a shared branch
reconciler is available for their topology.

## Fixtures

> [!WARNING]
> Never commit real local sessions, credentials, private paths, private remotes,
> repository identity, or unredacted transcript data.

Fixture rules:

- use synthetic fixtures for focused behaviors
- use manually redacted real-source fixtures when source shape matters
- prefer exact checked-in `.trail.jsonl` goldens
- restamp expected output only for documented SDK behavior changes

Storage-tree adapters may use fixture-building tests when one source file is not
the native storage shape.

## Real-Session Smoke Tests

Real-session tests are local-only and opt-in.

| Requirement | Reason |
| --- | --- |
| Skip in CI | Avoid leaking local data or requiring local agents. |
| Require explicit env or root option | Avoid accidental source discovery. |
| Check broad invariants | Real transcripts should not need exact shapes. |
| Keep raw files out of git | Preserve privacy boundary. |

## Public Surface

Package roots expose public API. Concrete adapter internals stay private.

Default package roots must support Node 20+ and Bun. Runtime-specific helpers
belong behind explicit subpaths, like `@agent-trail/adapter-kit/bun-sqlite`.

## Verification

Run focused checks while developing:

```sh
bun test packages/adapter-kit
bun test packages/adapters
bun run check:source-types
bun run check:types
bun run check:api
bun run check:exports
```

Before opening a PR:

```sh
mise run check
```
