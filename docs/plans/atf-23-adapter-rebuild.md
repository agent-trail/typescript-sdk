# ATF-23 Incremental Adapter Rebuild Plan

## Summary

Rebuild the adapter packages one mergeable slice at a time. The old monorepo is
only a behavior oracle: tests, fixtures, expected JSONL, schemas, and docs intent
may be ported, but implementation code must not be copied.

Each active slice must be Fallow-clean before review. Temporary Fallow ignores
are allowed only for not-yet-rebuilt legacy adapter folders, and those ignores
must shrink with every adapter PR.

## Locked Decisions

- Start a new PR series from `main`; do not merge PR #9 as the adapter rebuild.
- Use one PR per slice.
- Rebuild the active slice fully instead of reshaping copied code in place.
- Rebuild order is bottom-up: source schemas, adapter kit, shared adapter
  substrate, Claude Code, Codex, Pi, OpenCode, final cross-adapter cleanup.
- Keep the ADR package split:
  - `@agent-trail/source-schemas` owns source evidence schemas.
  - `@agent-trail/adapter-kit` owns external adapter authoring primitives.
  - `@agent-trail/adapters` owns concrete source-agent adapters.
- Shrink public APIs where needed. Accidental helper exports are not kept for
  compatibility.
- Store concrete-adapter shared logic under internal `packages/adapters/src/shared`
  modules unless it is deliberately useful to third-party adapter authors.
- Exact checked-in goldens are the regression oracle for supported fixtures.
- Every committed golden trail must pass writer-strict core validation, except
  tests that explicitly cover invalid or quarantined source behavior.
- The canonical emitted Codex adapter name is `codex`.
- Real-session coverage uses sanitized committed fixture pairs plus opt-in local
  live-session tests.
- Default SDK imports must be Node 20 and Bun compatible.
- Bun-specific SQLite convenience stays isolated at
  `@agent-trail/adapter-kit/bun-sqlite`.
- OpenCode SQLite support is optional through an injected driver. Missing driver
  produces a health warning and skips the DB surface.
- Adapter `source.raw` credential handling uses
  `@agent-trail/core/credential-patterns`. Path and home-directory normalization
  remain redaction/share behavior, not adapter parsing behavior.

## Fallow Transition

`main` currently ignores adapter package TypeScript broadly:

- `packages/adapter-kit/src/**`
- `packages/adapters/src/**`

The rebuild removes those broad ignores in stages:

1. The adapter-kit PR removes `packages/adapter-kit/src/**` from duplicate and
   health ignores.
2. The shared substrate PR removes `packages/adapters/src/**` as a broad ignore
   and replaces it with narrow temporary ignores for unreplaced legacy folders
   only.
3. Each concrete adapter PR deletes that adapter's temporary ignore.
4. The final cross-adapter PR removes any remaining adapter TypeScript ignores.

Allowed final ignores are limited to generated files, fixtures, and goldens.
Do not add package-folder replacements or threshold workarounds.

## PR Sequence

### PR 1: Plan

Add this durable plan at `docs/plans/atf-23-adapter-rebuild.md`.

Acceptance:

- Plan records locked decisions, slice sequence, test manifest, Fallow
  transition, and verification gates.
- No product code changes.

Verification:

- `bun run check:fallow`
- `bun run check:types`

### PR 2: Source Schemas

Rebuild `@agent-trail/source-schemas` as a JSON asset package.

Public package interface:

- Export only versioned schema JSON subpaths, metadata JSON subpaths, and
  `./package.json`.
- Do not add a root runtime TypeScript export.
- Keep generated `.d.ts` files for JSON imports.

Implementation:

- Verify all schema JSON assets are the intended source-evidence artifacts.
- Add or restore a declaration-generation check so schema JSON and `.d.ts` files
  cannot drift.
- Keep package license and export map aligned with ADR 0001.

Tests:

- Port `packages/source-schemas/type-smoke.test.ts`.
- Add import smoke for every exported schema and metadata subpath.
- Add drift check for generated declarations.

Verification:

- `bun test packages/source-schemas`
- `bun run check:types`
- `bun run check:exports`
- `bun run check:fallow`

### PR 3: Adapter Kit

Rebuild `@agent-trail/adapter-kit` around a small authoring Interface.

Public package interface:

- Root exports:
  - adapter definition and mapping authoring APIs
  - JSONL reader and driver-neutral SQLite reader interfaces
  - source-schema select and validate APIs
  - public authoring types
- `./bun-sqlite` exports `bunSqliteDriver`.
- Root must not import `bun:*`.
- Remove accidental root exports for dispatch, quarantine, direct reconcile
  internals, primitive guards, shell quoting, matchers, ID helpers, and usage
  helpers.

Implementation:

- Build `defineAdapter` as the deep Interface for mapping, override, quarantine,
  and reconciliation behavior.
- Keep internal pipeline complexity behind that Interface.
- Use local relative imports for package-internal tests.
- Recast old tests through public behavior where meaningful. Drop tests that
  only assert removed helper shapes.

Old oracle tests to port or recast:

- `src/mapping/dispatch.test.ts`
- `src/mapping/types.test.ts`
- `src/pipeline/define-adapter.test.ts`
- `src/pipeline/engine.test.ts`
- `src/pipeline/override.test.ts`
- `src/pipeline/quarantine.test.ts`
- `src/primitives/args.test.ts`
- `src/primitives/coerce.test.ts`
- `src/primitives/guards.test.ts`
- `src/primitives/shell.test.ts`
- `src/primitives/usage.test.ts`
- `src/readers/compose.test.ts`
- `src/readers/jsonl-reader.test.ts`
- `src/readers/sqlite-reader.test.ts`
- `src/reconciler/branch.test.ts`
- `src/reconciler/cumulative-tokens.test.ts`
- `src/reconciler/custom.test.ts`
- `src/reconciler/parent-chain.test.ts`
- `src/reconciler/strip-linker.test.ts`
- `src/reconciler/tool-linking.test.ts`
- `src/schema-agent.test.ts`
- `src/source-schemas/corpus.test.ts`
- `src/source-schemas/registry.test.ts`
- `src/source-schemas/select.test.ts`
- `src/source-schemas/validate.test.ts`

New tests:

- Node-safe root import smoke.
- Bun-only `./bun-sqlite` import smoke.
- API report only contains intended authoring surface.

Verification:

- `bun test packages/adapter-kit`
- `bun run check:types`
- `bun run check:api`
- `bun run check:exports`
- `bun run check:fallow`

### PR 4: Shared Adapter Substrate

Add internal shared modules in `@agent-trail/adapters`. This PR does not rebuild
a concrete adapter parser.

Internal modules:

- Local JSONL session discovery and health:
  - missing root
  - unreadable root
  - symlink skip
  - mtime capture
  - cwd filter
  - all-cwd scan
  - JSONL head scan
  - newest source-version probe
  - `AdapterSourceHealth` assembly
- Tool normalization:
  - shell
  - patch
  - edit
  - file
  - search
  - todo
  - permission
  - unknown/custom
- Source raw credential policy:
  - redacts credential patterns using core credential patterns
  - does not normalize paths
- Test support:
  - fixture builders
  - golden comparison helpers
  - writer-strict validation helpers
  - fixture leak scan helpers

Old oracle tests to port or recast:

- `src/shared/concurrency.test.ts`
- `src/shared/jsonl-head.test.ts`
- `src/shared/registry.test.ts`
- shared portions of `source-raw.test.ts`
- shared portions of `vcs.test.ts`
- shared portions of `vcs-commit.test.ts`
- shared portions of `entries.test.ts`
- shared portions of `header-metadata.test.ts`
- shared portions of `parenting.test.ts`
- shared portions of `session-uid.test.ts`

New tests:

- discovery skips symlinks
- discovery preserves modified time
- health reports missing root
- health reports unreadable root
- newest source version is selected from scanned records
- `allCwds` includes every cwd bucket
- tool normalizer handles shell, patch, edit, file, search, todo, permission,
  and unknown/custom families
- source raw redacts credentials but leaves path-like values unchanged

Verification:

- `bun test packages/adapters/src/shared`
- `bun test packages/adapters/src/source-raw.test.ts`
- `bun run check:types`
- `bun run check:fallow`

### PR 5: Claude Code Adapter

Rebuild `createClaudeCodeAdapter`.

Public behavior:

- factory accepts root and environment overrides without mutating `process.env`
- `detectSessions`
- `parseSession`
- `resumeSession`
- `isAvailable`
- `sourceVersion`
- `sourceHealth`

Behavior coverage:

- discovery under Claude project buckets
- header and envelope emission
- content hash behavior
- user, assistant, tool, and tool-result flow
- child sessions
- hooks
- permissions
- metadata
- VCS metadata
- source raw preservation with credential redaction
- exact goldens

Old oracle tests and fixtures:

- `src/claude-code/index.test.ts`
- `src/claude-code/stateful.test.ts`
- `src/claude-code/real-session.test.ts`
- `tests/fixtures/claude-code/basic-flow.jsonl`
- `tests/fixtures/claude-code/capability-changes.jsonl`
- `tests/fixtures/claude-code/compact-provenance.jsonl`
- `tests/fixtures/claude-code/fidelity-edge-cases.jsonl`
- `tests/fixtures/claude-code/interrupt-and-model-change.jsonl`
- `tests/fixtures/claude-code/permission-mode.jsonl`
- `tests/fixtures/claude-code/usage-first-entry.jsonl`

Real-session fixture pairs:

- `claude-code-v1.source.jsonl`
- `claude-code-v1.trail.jsonl`
- `claude-code-v1-vcs-commit.source.jsonl`
- `claude-code-v1-vcs-commit.trail.jsonl`

Verification:

- `bun test packages/adapters/src/claude-code`
- `bun test packages/adapters/src/contract-goldens.test.ts`
- `bun run check:types`
- `bun run check:fallow`

### PR 6: Codex Adapter

Rebuild `createCodexAdapter`.

Public behavior:

- factory accepts root and environment overrides without mutating `process.env`
- `detectSessions`
- `parseSession`
- `resumeSession`
- `isAvailable`
- `sourceVersion`
- `sourceHealth`

Behavior coverage:

- discovery under dated Codex session directories
- optional `session_index.jsonl` names
- header and envelope emission
- content hash behavior
- v0.128 records
- v0.135 records
- user and assistant messages
- reasoning rollups
- image message rollups
- tool calls and results
- lifecycle events
- capability events
- diagnostic events
- source raw preservation with credential redaction
- exact goldens with canonical `codex` adapter name

Old oracle tests and fixtures:

- `src/codex/index.test.ts`
- `src/codex/stateful.test.ts`
- `src/codex/capture-gaps.test.ts`
- `src/codex/v0_135.test.ts`
- `src/codex/real-session.test.ts`
- `tests/fixtures/codex/apply-patch.jsonl`
- `tests/fixtures/codex/capability-changes-v0_128.jsonl`
- `tests/fixtures/codex/capability-changes.jsonl`
- `tests/fixtures/codex/compact-and-model-change.jsonl`
- `tests/fixtures/codex/desktop-tracer.jsonl`
- `tests/fixtures/codex/diagnostics-v0_128.jsonl`
- `tests/fixtures/codex/diagnostics.jsonl`
- `tests/fixtures/codex/image-message*.jsonl`
- `tests/fixtures/codex/lifecycle.jsonl`
- `tests/fixtures/codex/reasoning-*.jsonl`
- `tests/fixtures/codex/token-usage.jsonl`
- `tests/fixtures/codex/v0_135-events.jsonl`
- `tests/fixtures/codex/web-search.jsonl`

Contract fixtures:

- `tests/fixtures/contracts/codex-refactor-contract.source.jsonl`
- `tests/fixtures/contracts/codex-refactor-contract.trail.jsonl`

Real-session fixture pairs:

- `codex-v0_128.source.jsonl`
- `codex-v0_128.trail.jsonl`
- `codex-v0_135.source.jsonl`
- `codex-v0_135.trail.jsonl`
- `codex-v0_135-vcs-commit.source.jsonl`
- `codex-v0_135-vcs-commit.trail.jsonl`

Verification:

- `bun test packages/adapters/src/codex`
- `bun test packages/adapters/src/contract-goldens.test.ts`
- `bun run check:types`
- `bun run check:fallow`

### PR 7: Pi Adapter

Rebuild `createPiAdapter`.

Public behavior:

- factory accepts root and environment overrides without mutating `process.env`
- `detectSessions`
- `parseSession`
- `resumeSession`
- `isAvailable`
- `sourceVersion`
- `sourceHealth`

Behavior coverage:

- discovery under Pi session buckets
- header and envelope emission
- content hash behavior
- tree parentage
- branch summaries
- user and assistant messages
- bash/tool execution
- edit forms
- usage, model, and cost metadata
- compaction events
- system events
- suppressed entries
- source raw preservation with credential redaction
- exact goldens

Old oracle tests and fixtures:

- `src/pi/index.test.ts`
- `src/pi/suppressed-entries.test.ts`
- `src/pi/real-session.test.ts`
- `tests/fixtures/pi/bash-execution.jsonl`
- `tests/fixtures/pi/branch-flow.jsonl`
- `tests/fixtures/pi/compaction-and-model-change.jsonl`
- `tests/fixtures/pi/custom-message-variants.jsonl`
- `tests/fixtures/pi/leaf-and-label.jsonl`
- `tests/fixtures/pi/linear-flow.jsonl`
- `tests/fixtures/pi/quarantine.jsonl`
- `tests/fixtures/pi/reasoning-and-interrupt.jsonl`
- `tests/fixtures/pi/string-assistant-model-change.jsonl`
- `tests/fixtures/pi/system-events.jsonl`
- `tests/fixtures/pi/tool-result-error.jsonl`
- `tests/fixtures/pi/usage-and-cost.jsonl`
- `tests/fixtures/pi/usage-first-entry.jsonl`

Real-session fixture pairs:

- `pi-v1.source.jsonl`
- `pi-v1.trail.jsonl`
- `pi-v1-edit-forms.source.jsonl`
- `pi-v1-edit-forms.trail.jsonl`
- `pi-v1-vcs-commit.source.jsonl`
- `pi-v1-vcs-commit.trail.jsonl`

Verification:

- `bun test packages/adapters/src/pi`
- `bun test packages/adapters/src/contract-goldens.test.ts`
- `bun run check:types`
- `bun run check:fallow`

### PR 8: OpenCode Adapter

Rebuild `createOpenCodeAdapter`.

Public behavior:

- factory accepts root, environment, and optional SQLite driver overrides without
  mutating `process.env`
- `detectSessions`
- `parseSession`
- `resumeSession`
- `isAvailable`
- `sourceVersion`
- `sourceHealth`

Behavior coverage:

- file storage under OpenCode storage root
- optional SQLite discovery through injected driver
- missing SQLite driver health warning
- duplicate precedence between storage surfaces
- header and envelope emission
- content hash behavior
- enrichment across session/message/part/todo records
- lifecycle events
- tool calls and results
- todos
- permissions
- source raw preservation with credential redaction
- exact goldens

Old oracle tests and fixtures:

- `src/opencode/index.test.ts`
- `src/opencode/real-session.test.ts`

Real-session fixture pairs:

- `opencode-v1.source.jsonl`
- `opencode-v1.trail.jsonl`
- `opencode-v1-vcs-commit.source.jsonl`
- `opencode-v1-vcs-commit.trail.jsonl`

Verification:

- `bun test packages/adapters/src/opencode`
- `bun test packages/adapters/src/contract-goldens.test.ts`
- `bun run check:types`
- `bun run check:fallow`

### PR 9: Final Cross-Adapter Cleanup

Rebuild root `@agent-trail/adapters` exports and cross-adapter behavior.

Public package interface:

- adapter types
- `SessionRef`
- `DetectOptions`
- health, resume, and result types
- `createClaudeCodeAdapter`
- `createCodexAdapter`
- `createPiAdapter`
- `createOpenCodeAdapter`
- `createDefaultTrailAdapters`
- `./package.json`

Remove from public root unless explicitly reintroduced:

- `trailRecords`
- `validateAdapterTrail`
- shared concurrency helpers
- internal registry helpers
- internal envelope helpers

Old oracle tests to port or recast:

- `src/contract-goldens.test.ts`
- `src/entries.test.ts`
- `src/header-metadata.test.ts`
- `src/index.test.ts`
- `src/parenting.test.ts`
- `src/real-session-fixtures.test.ts`
- `src/resume.test.ts`
- `src/session-uid.test.ts`
- `src/source-raw.test.ts`
- `src/vcs.test.ts`
- `src/vcs-commit.test.ts`

New tests:

- root import smoke under Node
- factory default registry order
- no singleton adapter exports
- fixture leak scan for usernames, private local paths, private remotes, and
  secret-like tokens
- writer-strict validation for every committed golden trail
- all remaining Fallow adapter ignores removed

Verification:

- `bun test packages/adapters`
- `bun run check:types`
- `bun run check:api`
- `bun run check:exports`
- `bun run check:fallow`
- `mise run check`

## TDD Loop Per Behavior

Each slice follows this loop:

1. Port one old behavior test or add one new gap test.
2. Run focused test and confirm RED.
3. Implement the minimum code for GREEN.
4. Run focused test and confirm GREEN.
5. Refactor only while GREEN.
6. Run the slice verification commands.
7. Commit only when no new Fallow debt exists for the active slice.

Tests should verify public behavior through package Interfaces where practical.
Internal tests are allowed only when the helper is independently complex and not
merely a pass-through.

## Fixture Policy

- Fixture intent may come from the old monorepo.
- Implementation code must not.
- Sanitize every committed fixture and golden.
- Do not commit real local sessions, credentials, private paths, private remotes,
  or unredacted user data.
- Restamp expected output only for documented SDK divergences, such as `codex`
  replacing `codex-cli`.
- Prefer explicit checked-in `.trail.jsonl` goldens over generated snapshots.

## Copy Guard

Every implementation PR should state:

- old oracle files consulted
- behavior intentionally ported
- behavior intentionally changed
- public API impact
- verification commands and results

Fallow duplicate checks are the primary automated guard against copy-shaped
implementation. Review should also reject modules whose structure mirrors old
implementation without a clear SDK-specific design reason.

## Architecture Rules

- The package Interface is the test surface.
- Deep modules should hide mapping, reconciliation, storage probing, and source
  normalization complexity behind small call sites.
- Do not add single-use abstractions only to satisfy tests.
- Do not introduce broad dependency injection seams unless there are at least
  two real adapters.
- Keep adapter-kit for external adapter authors.
- Keep concrete adapter implementation helpers internal to `@agent-trail/adapters`.
- Keep runtime-specific behavior behind injected drivers or explicit subpaths.
- Keep adapter parsing deterministic: no hidden live discovery during parse, no
  content probing during metadata-only paths, and no implicit environment
  mutation.

## Final Acceptance

- All in-scope old tests are ported, recast, or explicitly documented as not
  applicable.
- All new gap tests pass.
- Adapter and adapter-kit source TypeScript are no longer hidden by broad Fallow
  ignores.
- Public API reports show only intended adapter surfaces.
- Root imports work in Node 20 and Bun.
- `@agent-trail/adapter-kit/bun-sqlite` remains Bun-only by explicit subpath.
- All committed goldens are sanitized and writer-strict valid.
- `mise run check` passes.
