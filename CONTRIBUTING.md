# Contributing

Thanks for helping improve Agent Trail.

## Before You Start

- Open or pick up a Linear issue before starting larger changes.
- Keep pull requests focused on one problem.
- Avoid committing real local sessions, secrets, credentials, tokens, private logs, or unredacted user data.

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

`mise` installs repo tools and runs tasks. `hk` owns local Git hooks.

## Dependencies and Tools

When adding a package, tool, or GitHub Action, check the latest stable upstream version first. Use the latest version by default; if you pin an older version, explain why in the pull request.

## Pull Requests

Before opening a pull request:

- Run `mise run check`.
- Link the Linear issue.
- Summarize public package API, generated type, or runtime behavior impact.
- Include exact verification commands and results.

Pull requests are squash-merged. Keep branches narrow and delete them after merge.
