# @agent-trail/render-model

Renderer-agnostic transcript model APIs for Agent Trail viewers.

## Public Surface

The package root exports:

- `buildRenderModel`
- transcript helpers such as `buildTranscriptItems`, `filterTranscriptItems`,
  `renderItemLabel`, and `renderItemPreview`
- render model, event, transcript item, filter, and tool-info types

## Boundaries

`render-model` transforms already parsed trail data into a display-friendly
model. It does not parse JSONL, validate trail bytes, fetch attachments,
dereference local files, or own web/terminal UI behavior.

Viewer packages should consume this model and make their own presentation
choices.

## Docs

- [`docs/implementation-semantics.md`](../../docs/implementation-semantics.md#package-flow)
- [`docs/GLOSSARY.md`](../../docs/GLOSSARY.md)

## Checks

```sh
bun test packages/render-model
bun run check:types
bun run check:api
```
