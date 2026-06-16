# Parser Source Matrix

This matrix records the source-agent storage formats covered by the SDK
adapters, the verified source versions, and the committed fixture coverage that
locks behavior. It is SDK-scoped: CLI rendering, live discovery workflows, and
real local sessions are outside this document.

## Status Legend

- `verified` means the adapter is implemented and covered by committed
  synthetic fixtures or fixture-building tests.
- `pending verification` means the source agent is not implemented in the SDK
  adapter package.
- Real-session tests are opt-in and skipped unless the caller provides an
  explicit local fixture path through the documented environment variable.

## Matrix

Paths below use platform-aware home resolution: `HOME`, then `USERPROFILE`,
then `HOMEDRIVE` plus `HOMEPATH`.

| Source agent | Storage format | Runtime surface | Verified source version | Fixture coverage | Status |
| --- | --- | --- | --- | --- | --- |
| Claude Code | JSONL under `<projectsRoot>/<mangled-cwd>/<sessionId>.jsonl`; `projectsRoot` comes from factory options, `CLAUDE_CONFIG_DIR`, or `<home>/.claude/projects` | Node 20+ and Bun through `createClaudeCodeAdapter(options?)` | Synthetic v1 / Claude Code 1.0.0-shaped records | `packages/adapters/src/claude-code/*.test.ts`, source-schema corpus under `packages/source-schemas/schemas/claude-code/v1` | verified |
| Codex | JSONL under `<sessionsDir>/YYYY/MM/DD/rollout-<datetime>-<uuid>.jsonl`, with optional `<sessionIndexPath>` names; defaults come from `CODEX_HOME` or `<home>/.codex` | Node 20+ and Bun through `createCodexAdapter(options?)` | Codex 0.128 and 0.135-shaped records | `packages/adapters/src/codex/*.test.ts`, source-schema corpus under `packages/source-schemas/schemas/codex/v0.128` and `v0.135` | verified |
| Pi | JSONL under `<sessionsDir>/<mangled-cwd>/<sessionId>.jsonl`; `sessionsDir` comes from factory options, `PI_CODING_AGENT_SESSION_DIR`, `PI_CODING_AGENT_DIR`, or `<home>/.pi/agent/sessions` | Node 20+ and Bun through `createPiAdapter(options?)` | Synthetic v1 / Pi 3-shaped records | `packages/adapters/src/pi/*.test.ts`, source-schema corpus under `packages/source-schemas/schemas/pi/v1` | verified |
| OpenCode | File storage under `<storageDir>/{session,message,part,todo}` plus optional SQLite `opencode.db`; `storageDir` comes from factory options, `OPENCODE_DATA_DIR`, Linux/macOS XDG data roots, or Windows app data roots | Node 20+ and Bun through `createOpenCodeAdapter(options?)`; SQLite requires injected driver | OpenCode v1-shaped records | `packages/adapters/src/opencode/*.test.ts`, source-schema corpus under `packages/source-schemas/schemas/opencode/v1` | verified |

## Adapter Policy

- Adapter exports are factory-first. There are no default singleton adapters.
- Main SDK adapter exports do not import Bun globals or `bun:*` modules.
- `@agent-trail/adapter-kit/bun-sqlite` is the explicit Bun-only convenience
  subpath for consumers that want a Bun SQLite driver.
- OpenCode SQLite parsing is optional. Without an injected driver, discovery and
  health skip the DB surface with a warning instead of failing package import.
- `codex` is the canonical emitted adapter name. The old monorepo oracle used
  `codex-cli` in some expected output; ATF-23 intentionally diverges and
  restamps adapter fixtures to `codex`.
