# Agent Instructions

This repo owns the TypeScript SDK for Agent Trail libraries and generated/public TypeScript contracts.

## Workflow

- Start from the linked Linear issue or maintainer direction.
- Keep changes scoped to this repo's TypeScript package surface.
- Treat schema-derived types as generated from the canonical Agent Trail schema, not as the source of truth.
- Do not commit real local sessions, secrets, credentials, private logs, or unredacted user data.

## Commands

- Use `mise run setup` for local tool and hook setup.
- Use `mise run check` before opening or updating a pull request.
- Use `mise run check:actions` after editing GitHub Actions workflows.

## Dependencies and Tools

- Before introducing a package, tool, or GitHub Action, check the latest upstream stable version and use it unless there is a documented reason not to.

## Architecture

- Keep package public surfaces small. Export only deliberate SDK APIs from package roots.
- Put implementation details behind internal modules. Do not export helpers only for tests or convenience.
- Prefer package-local shared modules over duplicated logic across adapters, store, catalog, redact, or core.
- Do not add backward compatibility aliases, legacy fallbacks, or migration shims for unreleased APIs unless explicitly requested.
- Keep adapter policy out of low-level packages. Shared packages should expose primitives, not concrete adapter assumptions.
- Keep filesystem, database, redaction, catalog, and adapter responsibilities separated by package boundary.
- Do not copy implementation code from old monorepos. Use old repos only as behavior, fixture, test, or docs oracles.
- Use Fallow as a maintainability gate. Fix surfaced duplication, dependency hygiene, dead exports, and complexity instead of broad ignores.
- Fallow ignores must be narrow and temporary. Do not ignore TypeScript source or tests by package folder. Fixture and golden asset ignores are acceptable.

## File Organization

- Keep package root `src` small. Prefer `src/index.ts` plus root-level public boundary tests only.
- Move package internals into named modules such as `src/shared`, `src/config`, `src/patterns`, `src/transform`, or domain-specific folders.
- Name modules by current responsibility. Avoid `legacy`, `compat`, or old-system names for unreleased code.
- Test-only helpers should live in the nearest `tests/helpers.ts` or `tests/helpers/*`.

## Test Organization

- Put executable tests in the nearest `tests` folder:
  - `src/foo.ts` -> `src/tests/foo.test.ts`
  - `src/shared/foo.ts` -> `src/shared/tests/foo.test.ts`
  - `src/adapter/foo.ts` -> `src/adapter/tests/foo.test.ts`
- Do not place `*.test.ts` directly beside runtime files.
- Do not use package-level `test/` or `tests/` for executable tests in code packages.
- Package-level fixture directories are allowed when they contain assets, not executable tests.
- Prefer public API tests. Add internal tests only when a helper has meaningful independent complexity.
- Preserve golden output behavior unless an intentional divergence is documented in the test.

## TDD and Verification

- Use TDD for behavior changes: write or port one failing behavior test, implement the minimum, then refactor while green.
- Port old in-scope tests by behavior, not implementation shape.
- Add new tests for SDK-specific divergences, public API changes, and maintainability refactors.
- Run the narrowest relevant package tests during development.
- Run `mise run check` before opening or updating a PR.
- When public API changes, run `bun run check:api` and update API reports deliberately.
- API Extractor public exports need useful TSDoc. Avoid leaving `@public (undocumented)` entries in API reports for hand-written packages.
- Do not add `@internal` TSDoc to implementation helpers solely because they are exported between package-local modules. Use visibility tags for deliberate API Extractor/public-surface needs, not local lint appeasement.

## Pull Requests

- Use `.github/PULL_REQUEST_TEMPLATE.md`.
- Link the Linear issue.
- State public package API, generated type, or runtime behavior impact.
- Include exact verification commands and results.
