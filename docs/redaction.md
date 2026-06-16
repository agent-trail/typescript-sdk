# Redaction

> [!IMPORTANT]
> `@agent-trail/redact` creates a new redacted artifact. It does not mutate raw
> trail bytes in place. Raw and redacted trails have different content hashes.

## At A Glance

| Topic | Behavior |
| --- | --- |
| Package | `@agent-trail/redact` |
| Main API | `redactTrailJsonl` |
| Config API | `resolveRedactionConfig` |
| Input | Agent Trail JSONL string or async iterable |
| Output | Redacted JSONL, parsed records, mutation summary |
| Consumer | `@agent-trail/sessions` redacts before injected share transport |

## Quick Start

```ts
import { redactTrailJsonl, resolveRedactionConfig } from "@agent-trail/redact";

const config = await resolveRedactionConfig({ projectRoot: process.cwd() });
const result = await redactTrailJsonl(rawJsonl, {
  redactionPacks: config.packs,
  allowedSecrets: config.allowedSecrets,
  pii: config.pii,
});

console.log(result.summary.counts);
console.log(result.jsonl);
```

## Result Shape

| Field | Meaning |
| --- | --- |
| `jsonl` | Redacted Agent Trail JSONL. |
| `trail` | Parsed redacted records grouped by session. |
| `summary.counts` | Mutation counts by pattern or rule. |
| `summary.samples` | Bounded before/after samples for preview. |
| `summary.packs` | Loaded custom pack summaries, when present. |
| `summary.warnings` | Config or pack warnings. |

## Redaction Surface

The redactor walks:

| Surface | Examples |
| --- | --- |
| Text | Session names, descriptions, tags, messages, output strings. |
| Tools | Tool call args, tool result output, shell commands, headers. |
| Metadata | String leaves under `meta`. |
| Attachments | Local URIs and unsafe overflow refs. |
| Source evidence | `source.raw`. |
| User queries | Secret answers and unresolved responses. |
| Repository identity | Local paths and remote URLs, unless explicitly preserved. |

Adapters already redact known credential patterns in `source.raw` before writing
raw artifacts. Share-time redaction adds broader privacy policy, PII handling,
attachment policy, and mutation accounting.

## Configuration

`resolveRedactionConfig` loads project settings first, then user-global
settings. Later scalar values override earlier ones. Arrays merge and dedupe.

| Scope | Files |
| --- | --- |
| Project packs | `.trail/redactors/**/*.{yaml,yml,json}` |
| Project settings | `.trail/settings.json` |
| User packs | `~/.config/trail/redactors/**/*.{yaml,yml,json}` |
| User settings | `~/.config/trail/settings.json` |

Rule packs define custom regex patterns and allowlisted literals. Settings
control allowed secrets and PII detectors.

## Options

| Option | Purpose |
| --- | --- |
| `patterns` | Replace built-in patterns with this exact set. |
| `extendPatterns` | Add patterns on top of defaults. |
| `redactionPacks` | Use loaded custom packs from `resolveRedactionConfig`. |
| `userSecrets` | Literal secret strings to redact. |
| `allowedSecrets` | Literal values that should not be redacted. |
| `pii` | Enable or tune email, phone, SSN, credit card, name, and custom-label detection. |
| `includeSourceRaw` | Keep or drop redacted `source.raw` fields where supported. |
| `outputMaxBytes` | Bound tool-result output bytes and mark truncated output. |
| `maxSamples` | Limit summary samples. |
| `attachmentUriRewrites` | Replace local attachment URIs with safe `sha256:` references. |
| `enableEntropyRedaction` | Enable entropy-based token detection. |
| `keepRemoteUrl` | Preserve repository remote URLs when explicitly allowed. |

## Rule Pack Example

```yaml
name: acme
version: 1
description: ACME internal tokens
allowlist:
  - ACME-PUBLIC-SAMPLE
rules:
  - id: acme_internal_token
    description: ACME internal service token
    regex: 'ACME-[A-Z0-9]{32}'
    placeholder: '[ACME_TOKEN]'
    samples:
      - input: 'ACME-ABCDEF0123456789ABCDEF0123456789'
        redacted: true
      - input: 'ACME-too-short'
        redacted: false
```

Rule ids must be unique within a pack. Malformed packs warn and continue so one
bad local rule does not block unrelated workflows.

## PII

PII detection is opt-in through `PiiConfig`.

| Detector | Config |
| --- | --- |
| Email | `email`, `emailAllowlist` |
| Phone | `phone` |
| SSN | `ssn` |
| Credit card | `creditCard` |
| Name | `name` |
| Custom labels | `customLabels` |

> [!CAUTION]
> PII detection is heuristic. Treat it as a safety layer, not proof that output
> is private.

## Safety Notes

Redaction reduces exposure. It does not make a shared trail private.

Remaining fields can still reveal workflow information:

- timestamps
- event counts
- model names
- tool names
- branch shape
- remaining metadata

Callers should preview `summary.counts`, `summary.samples`, and warnings before
transport. `exportSession` returns raw finalized bytes, so callers must redact
exports before publishing.
