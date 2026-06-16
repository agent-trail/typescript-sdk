# Parser Source Matrix

> [!NOTE]
> This page is SDK-scoped. It records parser support and fixture evidence, not
> CLI UX, website behavior, or external release notes.

This matrix records source-agent storage formats covered by SDK adapters, the
verified source versions, and the committed fixture coverage that locks
behavior. It is SDK-scoped: CLI rendering, live discovery commands, and website
behavior are outside this document.

## Status Legend

- `verified` means the adapter is implemented and covered by committed
  synthetic fixtures, redacted fixtures, or fixture-building tests.
- `pending verification` means the source agent is not implemented in the SDK
  adapter package.
- Real-session tests are opt-in local smoke tests. They are skipped in CI and
  require explicit fixture paths or source roots.

An adapter is supported when its row is `verified`, its root factory is exported
from `@agent-trail/adapters`, and its committed fixtures validate as
writer-strict Agent Trail output.

## Matrix

Paths below use platform-aware home resolution: `HOME`, then `USERPROFILE`,
then `HOMEDRIVE` plus `HOMEPATH`.

| Source agent | Storage format | Runtime surface | Verified source version | Fixture coverage | Status |
| --- | --- | --- | --- | --- | --- |
| Claude Code | JSONL under `<projectsRoot>/<mangled-cwd>/<sessionId>.jsonl`; `projectsRoot` comes from factory options, `CLAUDE_CONFIG_DIR`, or `<home>/.claude/projects` | Node 20+ and Bun through `createClaudeCodeAdapter(options?)` | Synthetic v1 / Claude Code 1.0.0-shaped records | `packages/adapters/src/claude-code/*.test.ts`, `packages/adapters/tests/fixtures/claude-code`, redacted real-session pairs under `packages/adapters/tests/fixtures/real-sessions`, source schemas under `packages/source-schemas/claude-code` | verified |
| Codex | JSONL under `<sessionsDir>/YYYY/MM/DD/rollout-<datetime>-<uuid>.jsonl`, with optional `<sessionIndexPath>` names; defaults come from `CODEX_HOME` or `<home>/.codex` | Node 20+ and Bun through `createCodexAdapter(options?)` | Codex 0.128 and 0.135-shaped records | `packages/adapters/src/codex/*.test.ts`, `packages/adapters/tests/fixtures/codex`, contract fixtures under `packages/adapters/tests/fixtures/contracts`, redacted real-session pairs under `packages/adapters/tests/fixtures/real-sessions`, source schemas under `packages/source-schemas/codex` | verified |
| Pi | JSONL under `<sessionsDir>/<mangled-cwd>/<sessionId>.jsonl`; `sessionsDir` comes from factory options, `PI_CODING_AGENT_SESSION_DIR`, `PI_CODING_AGENT_DIR`, or `<home>/.pi/agent/sessions` | Node 20+ and Bun through `createPiAdapter(options?)` | Synthetic v1 / Pi 3-shaped records | `packages/adapters/src/pi/*.test.ts`, `packages/adapters/tests/fixtures/pi`, redacted real-session pairs under `packages/adapters/tests/fixtures/real-sessions`, source schemas under `packages/source-schemas/pi` | verified |
| OpenCode | File storage under `<storageDir>/{session,message,part,todo}` plus optional SQLite `opencode.db`; `storageDir` comes from factory options, `OPENCODE_DATA_DIR`, Linux/macOS XDG data roots, or Windows app data roots | Node 20+ and Bun through `createOpenCodeAdapter(options?)`; SQLite requires injected driver | OpenCode v1-shaped records | `packages/adapters/src/opencode/*.test.ts`, redacted real-session pairs under `packages/adapters/tests/fixtures/real-sessions`, source schemas under `packages/source-schemas/opencode` | verified |

## Adapter Evidence

### Claude Code

Claude Code coverage exercises project-bucket discovery, source header parsing,
assistant/user/tool flows, thinking blocks, compact summaries, permission and
capability records, model changes, VCS metadata, child-session links, and source
raw credential handling.

Primary evidence:

- `packages/adapters/src/claude-code`
- `packages/adapters/tests/fixtures/claude-code`
- `packages/adapters/tests/fixtures/real-sessions/claude-code-*.source.jsonl`
- `packages/source-schemas/claude-code`

### Codex

Codex coverage exercises dated session discovery, optional session index names,
v0.128 and v0.135 record families, lifecycle and diagnostic events, reasoning
rollups, image messages, tool calls and results, capability changes, VCS
metadata, and source raw credential handling.

The canonical emitted SDK adapter name is `codex`. Earlier Agent Trail fixtures
and notes used `codex-cli`; SDK fixtures use `codex`.

Primary evidence:

- `packages/adapters/src/codex`
- `packages/adapters/tests/fixtures/codex`
- `packages/adapters/tests/fixtures/contracts`
- `packages/adapters/tests/fixtures/real-sessions/codex-*.source.jsonl`
- `packages/source-schemas/codex`

### Pi

Pi coverage exercises bucket discovery, tree parentage, branch summaries,
assistant/user/tool flows, reasoning and redacted reasoning blocks, edit forms,
usage and cost metadata, compaction, model changes, system events, suppressed
entries, and source raw credential handling.

Primary evidence:

- `packages/adapters/src/pi`
- `packages/adapters/tests/fixtures/pi`
- `packages/adapters/tests/fixtures/real-sessions/pi-*.source.jsonl`
- `packages/source-schemas/pi`

### OpenCode

OpenCode coverage exercises file-storage parsing, optional SQLite parsing
through injected drivers, missing-driver health warnings, session/message/part
and todo record enrichment, lifecycle events, permissions, tool calls and
results, VCS metadata, and source raw credential handling.

Primary evidence:

- `packages/adapters/src/opencode`
- `packages/adapters/tests/fixtures/real-sessions/opencode-*.source.jsonl`
- `packages/source-schemas/opencode`

## Adapter Policy

- Adapter exports are factory-first. There are no default singleton adapters.
- Main SDK adapter exports do not import Bun globals or `bun:*` modules.
- `@agent-trail/adapter-kit/bun-sqlite` is the explicit Bun-only convenience
  subpath for consumers that want a Bun SQLite driver.
- OpenCode SQLite parsing is optional. Without an injected driver, discovery and
  health skip the DB surface with a warning instead of failing package import.
- Source schemas describe upstream records, not Agent Trail records.
- Writer-strict validation of emitted trail files remains the final output gate.

## Fixture Policy

> [!WARNING]
> Raw local sessions stay out of git. Commit only synthetic fixtures or manually
> redacted source fixtures plus matching expected trail output.

Committed fixtures must be synthetic or manually redacted. They may preserve
safe source schema structure, enum values, model ids, tool names, and source
record families. They must not preserve credentials, private local paths, private
remotes, repository identity, contributor identity, raw transcript text, or
opaque encrypted reasoning blobs.

Adapter fixtures should lock one behavior per synthetic scenario where possible.
Redacted real-source fixtures should include both source input and expected
Agent Trail output so drift can be reviewed as a normal diff.

Do not regenerate source fixtures directly from local raw sessions. Redact first,
then generate matching expected trail output from the redacted source.

## Real-Session Smoke Tests

Real-session smoke tests are local-only checks. They must be hard-skipped when
`CI` is set. They should run only when the caller provides an explicit
environment variable or source root.

Current adapter-specific inputs:

```sh
AGENT_TRAIL_REAL_CLAUDE_CODE_SESSION=/abs/path/to/session.jsonl bun test packages/adapters/src/claude-code/real-session.test.ts
AGENT_TRAIL_REAL_CODEX_SESSION=/abs/path/to/rollout.jsonl bun test packages/adapters/src/codex/real-session.test.ts
AGENT_TRAIL_REAL_PI_SESSION=/abs/path/to/session.jsonl bun test packages/adapters/src/pi/real-session.test.ts
AGENT_TRAIL_REAL_OPENCODE_ROOT=/abs/path/to/opencode bun test packages/adapters/src/opencode/real-session.test.ts
AGENT_TRAIL_REAL_OPENCODE_DB_SESSION=/abs/path/to/opencode.db#ses_... bun test packages/adapters/src/opencode/real-session.test.ts
```

Smoke tests should validate emitted trail records and broad feature invariants.
They should not require one exact transcript shape.

## Update Procedure

Use this checklist when source support changes:

- [ ] Update or add source schemas when upstream record shape changed.
- [ ] Add focused mapping, discovery, health, or drift tests.
- [ ] Add or update synthetic or redacted fixtures.
- [ ] Confirm emitted trail output validates writer-strict.
- [ ] Update the matrix row and adapter evidence section.
- [ ] Run focused package tests and repo check.

Useful commands:

```sh
bun test packages/adapters
bun run check:source-types
bun run check:types
mise run check
```
