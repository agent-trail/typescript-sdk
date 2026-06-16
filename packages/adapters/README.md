# @agent-trail/adapters

> [!NOTE]
> Concrete adapters are factory-first. There are no singleton adapter exports.

Concrete source-agent adapters that convert native coding-agent session storage
into Agent Trail records.

Verified adapters: `claude-code`, `codex`, `opencode`, and `pi`.

## Public Surface

The package root exports:

- adapter contracts and result types
- `createClaudeCodeAdapter`
- `createCodexAdapter`
- `createOpenCodeAdapter`
- `createPiAdapter`
- `createDefaultTrailAdapters`
- option types for each adapter factory

Parser internals, registry helpers, concurrency helpers, trail-envelope builders,
and validation conveniences are not public root exports.

## Boundaries

Concrete adapters are factory-first. Callers provide source roots, environment
overrides, and optional drivers through factory options. Default exports support
Node 20+ and Bun and must not import Bun globals or `bun:*`.

Adapter-specific mapping policy belongs in this package. Reusable authoring
primitives belong in `@agent-trail/adapter-kit`. Format parsing and validation
belong in `@agent-trail/core`.

## Source Raw

SDK adapters redact known credential patterns in `source.raw` before writing raw
trail artifacts. They do not perform broad path or PII normalization during
parse; that belongs to share-time redaction in `@agent-trail/redact`.

The source-raw helpers in `src/shared` are internal to this package.

## Path Resolution

Adapters resolve source roots from explicit factory options first, then
source-agent environment variables, then platform defaults. Home lookup uses
`HOME`, then `USERPROFILE`, then `HOMEDRIVE` plus `HOMEPATH`.

| Adapter | Factory options | Environment variables | Default |
| --- | --- | --- | --- |
| Claude Code | `configDir`, `projectsRoot` | `CLAUDE_CONFIG_DIR` | `<home>/.claude/projects` |
| Codex | `codexHome`, `sessionsDir`, `sessionIndexPath` | `CODEX_HOME` | `<home>/.codex/sessions`, `<home>/.codex/session_index.jsonl` |
| Pi | `agentDir`, `sessionsDir` | `PI_CODING_AGENT_DIR`, `PI_CODING_AGENT_SESSION_DIR` | `<home>/.pi/agent/sessions` |
| OpenCode | `storageDir`, `dbPath` | `OPENCODE_DATA_DIR`, `OPENCODE_DB` | Linux/macOS: `$XDG_DATA_HOME/opencode` or `<home>/.local/share/opencode`; Windows: `%LOCALAPPDATA%\\opencode`, `%APPDATA%\\opencode`, or `%USERPROFILE%\\AppData\\Local\\opencode` |

## Fixtures And Smoke Tests

> [!WARNING]
> Real local sessions stay out of git. Use only synthetic or manually redacted
> committed fixtures.

Committed fixtures are synthetic or manually redacted. Real local sessions stay
out of git and are used only by opt-in smoke tests.

Run committed adapter coverage with:

```sh
bun test packages/adapters
```

Optional real-session smoke tests use explicit environment variables documented
in [`docs/parser-source-matrix.md`](../../docs/parser-source-matrix.md#real-session-smoke-tests).

## Docs

- [`docs/adapter-authoring.md`](../../docs/adapter-authoring.md)
- [`docs/parser-source-matrix.md`](../../docs/parser-source-matrix.md)
- [`docs/implementation-semantics.md`](../../docs/implementation-semantics.md)

## Checks

```sh
bun test packages/adapters
bun run check:types
bun run check:api
bun run check:exports
```
