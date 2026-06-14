import { parseTrailJsonl, type TrailJsonlInput } from "@agent-trail/core";
import { applyRedactionCounts, snapshotToolResultOutputSizes } from "./mutation-accounting.js";
import { DEFAULT_PATTERNS } from "./patterns.js";
import {
  normalizeLineageHashes,
  resetContentHashes,
  stripVcsCommitRepo,
  stripVcsRemoteUrl,
  syncRawRecords,
} from "./record-transforms.js";
import {
  canonicalJsonlFromRecords,
  type RedactionRecord,
  recordsFromTrail,
  trailFromRecords,
} from "./records.js";
import { userSecretsPatterns } from "./rules.js";
import {
  applyAttachmentUriRules,
  stripUnresolvedUserQueryResponses,
  stripUnsafeOverflowRefs,
} from "./share-rules.js";
import { redactVisitedStrings } from "./string-sweep.js";
import { truncateOutputs } from "./truncate.js";
import type {
  PiiConfig,
  RedactionPattern,
  RedactionSummary,
  RedactTrailOptions,
  RedactTrailResult,
} from "./types.js";
import {
  redactUserQueryAnswerKeys,
  redactUserQueryQuestionIds,
  stripSecretUserQueryAnswers,
} from "./user-query.js";
import { visitStrings } from "./visits.js";

type RedactRecordsResult = {
  records: RedactionRecord[];
  summary: RedactionSummary;
};

type RedactionRunConfig = {
  allPatterns: readonly RedactionPattern[];
  userPatterns: ReturnType<typeof userSecretsPatterns>;
  allowedSecrets: readonly string[];
  includeSourceRaw: boolean;
  outputMaxBytes: number;
  maxSamples: number;
  keepRemoteUrl: boolean;
  enableEntropyRedaction: boolean;
  pii: PiiConfig;
};

export async function redactTrailJsonl(
  input: TrailJsonlInput,
  options: RedactTrailOptions = {},
): Promise<RedactTrailResult> {
  const sourceTrail = await parseTrailJsonl(input);
  const { records, summary } = await redactRecords(recordsFromTrail(sourceTrail), options);
  const jsonl = await canonicalJsonlFromRecords(records);
  const trail = await trailFromRecords(records);
  return { jsonl, trail, summary };
}

async function redactRecords(
  records: RedactionRecord[],
  options: RedactTrailOptions = {},
): Promise<RedactRecordsResult> {
  const config = redactionRunConfig(options);
  const out = records.map((record) => structuredClone(record));
  const originalToolResultOutputSizes = snapshotToolResultOutputSizes(out);
  const rawSummary = initialSummary(options);
  const redactionCounts = new Map<number, number>();

  applyVcsPolicy(out, rawSummary, config, redactionCounts);

  applyAttachmentUriRules(
    out,
    options.attachmentUriRewrites,
    rawSummary,
    config.maxSamples,
    redactionCounts,
  );
  stripUnsafeOverflowRefs(out, rawSummary, config.maxSamples, redactionCounts);
  stripUnresolvedUserQueryResponses(out, rawSummary, config.maxSamples, redactionCounts);

  const queryIdMaps = redactUserQueryQuestionIds(
    out,
    config.userPatterns,
    config.allPatterns,
    config.allowedSecrets,
    rawSummary,
    config.maxSamples,
    config.enableEntropyRedaction,
    config.pii,
  );
  redactUserQueryAnswerKeys(
    out,
    queryIdMaps,
    config.userPatterns,
    config.allPatterns,
    config.allowedSecrets,
    rawSummary,
    config.maxSamples,
    config.enableEntropyRedaction,
    config.pii,
  );

  stripSecretUserQueryAnswers(out, rawSummary, config.maxSamples, redactionCounts);

  redactVisitedStrings(
    visitStrings(out, config.includeSourceRaw),
    config.userPatterns,
    config.allPatterns,
    config.allowedSecrets,
    rawSummary,
    config.maxSamples,
    redactionCounts,
    config.enableEntropyRedaction,
    config.pii,
  );

  truncateOutputs(
    out,
    config.outputMaxBytes,
    rawSummary,
    config.maxSamples,
    redactionCounts,
    originalToolResultOutputSizes,
  );
  applyRedactionCounts(out, redactionCounts);

  // Redacted bytes differ from the input artifact, so any finalized
  // content_hash carried on the input is now stale. Reset to the
  // <pending> sentinel (spec §7.3) on every session header and on the trail
  // envelope (spec §7.4, §9.6 multi-session) so strict verifiers do not flag
  // the mismatch and so share tooling recomputes the hashes on the redacted
  // artifact before publishing. Skip the reset on a true no-op pass so a
  // finalized clean trail remains verifiable after this call.
  const changed = Object.keys(rawSummary.counts).some((key) => key !== "allowlisted_skip");
  if (changed) {
    resetContentHashes(out);
    await normalizeLineageHashes(out);
  }

  // Resynchronize RedactionRecord.raw with mutated value so downstream consumers
  // that log or persist `.raw` cannot leak unredacted source text.
  syncRawRecords(out);

  return { records: out, summary: rawSummary };
}

function redactionRunConfig(options: RedactTrailOptions): RedactionRunConfig {
  return {
    allPatterns: configuredPatterns(options),
    userPatterns: userSecretsPatterns(options.userSecrets ?? []),
    allowedSecrets: options.allowedSecrets ?? [],
    includeSourceRaw: optionBoolean(options.includeSourceRaw, true),
    outputMaxBytes: options.outputMaxBytes ?? 10_240,
    maxSamples: options.maxSamples ?? 20,
    keepRemoteUrl: optionBoolean(options.keepRemoteUrl, false),
    enableEntropyRedaction: options.enableEntropyRedaction === true,
    pii: options.pii ?? {},
  };
}

function configuredPatterns(options: RedactTrailOptions): readonly RedactionPattern[] {
  const basePatterns = options.patterns ?? DEFAULT_PATTERNS;
  const patterns = extendPatterns(basePatterns, options.extendPatterns);
  const packPatterns = options.redactionPacks?.flatMap((pack) => pack.patterns) ?? [];
  return [...packPatterns, ...patterns];
}

function extendPatterns(
  basePatterns: readonly RedactionPattern[],
  extraPatterns: readonly RedactionPattern[] | undefined,
): readonly RedactionPattern[] {
  return extraPatterns === undefined ? basePatterns : [...basePatterns, ...extraPatterns];
}

function optionBoolean(value: boolean | undefined, defaultValue: boolean): boolean {
  return value ?? defaultValue;
}

function initialSummary(options: RedactTrailOptions): RedactionSummary {
  const summary: RedactionSummary = { counts: {}, samples: [] };
  const packs = options.redactionPacks;
  if (packs === undefined || packs.length === 0) return summary;
  summary.packs = packs.map((pack) => ({
    name: pack.name,
    version: pack.version,
    contentHash: pack.contentHash,
    source: pack.source,
  }));
  return summary;
}

function applyVcsPolicy(
  records: RedactionRecord[],
  summary: RedactionSummary,
  config: RedactionRunConfig,
  redactionCounts: Map<number, number>,
): void {
  if (config.keepRemoteUrl) return;
  stripVcsRemoteUrl(records, summary, config.maxSamples);
  stripVcsCommitRepo(records, summary, config.maxSamples, redactionCounts);
}
