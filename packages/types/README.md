# @agent-trail/types

> [!NOTE]
> These declarations are generated. Do not hand-edit generated type output.

Generated TypeScript declarations for Agent Trail records.

The declarations are generated from vendored schema artifacts. They are SDK
artifacts, not the format source of truth.

## Public Surface

The package root exports generated schema types and convenience aliases:

- `TrailRecord`
- `TrailEntry`
- `SessionHeader`
- `AgentName`
- `ToolKind`
- `TaskPlanStatus`
- all generated record types from `src/generated.ts`

There is no runtime JavaScript API.

## Boundaries

`types` does not validate data. Use `@agent-trail/core` for parsing and
validation. Do not hand-edit generated declarations.

When schema artifacts change, regenerate types with the repo scripts and review
the resulting public API intentionally.

## Docs

- [`docs/implementation-semantics.md`](../../docs/implementation-semantics.md#boundary)
- [`packages/schema`](../schema)

## Checks

```sh
bun run check:types
bun run check:api
```
