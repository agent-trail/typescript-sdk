# @agent-trail/source-schemas

Bundled JSON Schemas for upstream coding-agent source records consumed by SDK
adapters.

These schemas describe adapter inputs such as Codex rollout JSONL lines, Claude
Code session JSONL lines, Pi session JSONL lines, and OpenCode records
normalized from file storage or SQLite rows. They do not describe Agent Trail
output. The trail format contract is exposed by `@agent-trail/schema`.

## Public Surface

The package exports JSON assets and generated import declarations:

- `./codex/v0.128`, `./codex/v0.135`, `./codex/meta`
- `./pi/v1`, `./pi/meta`
- `./claude-code/v1`, `./claude-code/meta`
- `./opencode/v1`, `./opencode/meta`
- `./package.json`

There is no root runtime TypeScript export.

## Boundaries

`source-schemas` owns upstream evidence schemas. It does not own mapping logic,
source discovery, Agent Trail validation, or generated Agent Trail record types.

`@agent-trail/adapter-kit` loads these schemas through its static registry.
`@agent-trail/adapters` uses them while parsing concrete source-agent storage.

## Adding A Version

1. Add or update `<agent>/meta.json` and the versioned schema JSON.
2. Register new package exports.
3. Run `bun run generate:source-types`.
4. Register the schema in `packages/adapter-kit/src/source-schemas/registry.ts`.
5. Update adapter tests and `docs/parser-source-matrix.md`.

## Docs

- [`docs/parser-source-matrix.md`](../../docs/parser-source-matrix.md)
- [`docs/adapter-authoring.md`](../../docs/adapter-authoring.md#source-schemas)
- [`docs/implementation-semantics.md`](../../docs/implementation-semantics.md#source-schemas)

## Checks

```sh
bun run check:source-types
bun test packages/adapter-kit/src/source-schemas
```
