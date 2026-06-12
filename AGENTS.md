# Agent Instructions

This repo owns the TypeScript SDK for Agent Trail libraries and generated/public TypeScript contracts.

## Workflow

- Start from the linked Linear issue or maintainer direction.
- Keep changes scoped to this repo's TypeScript package surface.
- Treat schema-derived types as generated from the canonical Agent Trail schema, not as the source of truth.
- Do not commit real local sessions, secrets, credentials, private logs, or unredacted user data.
- Do not include agent attribution in commits, pull request bodies, generated docs, or code comments.

## Commands

- Use `mise run setup` for local tool and hook setup.
- Use `mise run check` before opening or updating a pull request.
- Use `mise run check:actions` after editing GitHub Actions workflows.

## Pull Requests

- Use `.github/PULL_REQUEST_TEMPLATE.md`.
- Link the Linear issue.
- State public package API, generated type, or runtime behavior impact.
- Include exact verification commands and results.
