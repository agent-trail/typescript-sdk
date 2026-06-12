# Contributing

Agent Trail work is tracked in Linear and implemented through pull requests.

## Workflow

- Start from a Linear issue or accepted maintainer direction.
- Keep changes scoped to the active issue.
- Use Conventional Commit subjects for commits and pull request titles.
- Do not include agent attribution in commits, pull request bodies, generated docs, or code comments.
- Do not commit real local sessions, secrets, credentials, tokens, private logs, or unredacted user data.

## Local Setup

Install tools and hooks:

```sh
mise run setup
```

Common tasks:

```sh
mise run check
mise run lint
mise run test
```

`mise` is the repo entrypoint for tools and tasks. `hk` owns Git hooks and project lint gates.

## Pull Requests

Before opening a pull request:

- Run `mise run check`.
- Link the Linear issue.
- State public spec, schema, package API, CLI, or URL impact.
- Include exact verification commands and results.

Pull requests are squash-merged. Keep branches narrow and delete them after merge.
