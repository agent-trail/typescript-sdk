# @agent-trail/schema

> [!NOTE]
> This is a vendored asset package. Schema source changes happen in the spec
> repository.

Vendored Agent Trail schema assets and validation fixtures.

This package exposes immutable spec release artifacts to SDK consumers. The
schema source of truth lives in the Agent Trail spec repository.

## Public Surface

The package exports:

- the current schema JSON at `.`
- versioned schema JSON at `./v0.1.0` and `./schema/v0.1.0.json`
- validation fixtures under `./fixtures/validation/*`
- `./package.json`

There is no runtime TypeScript API.

## Boundaries

`schema` is an asset package. It does not own generated TypeScript declarations,
runtime validators, parser behavior, or adapter source schemas.

`@agent-trail/types` generates TypeScript types from schema artifacts.
`@agent-trail/core` validates trail records with these artifacts.
`@agent-trail/source-schemas` describes upstream source-agent records, not Agent
Trail records.

## Docs

- [`packages/schema/fixtures/validation/README.md`](./fixtures/validation/README.md)
- [`docs/implementation-semantics.md`](../../docs/implementation-semantics.md#boundary)

## Checks

```sh
bun run check:spec
bun test packages/schema
```
