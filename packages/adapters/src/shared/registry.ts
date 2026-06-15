import { type ClaudeCodeAdapterOptions, createClaudeCodeAdapter } from "../claude-code/index.js";
import { type CodexAdapterOptions, createCodexAdapter } from "../codex/index.js";
import type { TrailAdapter } from "../index.js";
import { createOpenCodeAdapter, type OpenCodeAdapterOptions } from "../opencode/index.js";
import { createPiAdapter, type PiAdapterOptions } from "../pi/index.js";

export type DefaultTrailAdaptersOptions = {
  "claude-code"?: ClaudeCodeAdapterOptions;
  codex?: CodexAdapterOptions;
  opencode?: OpenCodeAdapterOptions;
  pi?: PiAdapterOptions;
};

// Order is user-visible when discovery timestamps tie and doctor renders checks.
export const DEFAULT_ADAPTER_NAMES = Object.freeze(["claude-code", "codex", "opencode", "pi"]);

export function createAdapterByName(
  name: string,
  options: DefaultTrailAdaptersOptions = {},
): TrailAdapter | undefined {
  switch (name) {
    case "claude-code":
      return createClaudeCodeAdapter(options["claude-code"]);
    case "codex":
      return createCodexAdapter(options.codex);
    case "opencode":
      return createOpenCodeAdapter(options.opencode);
    case "pi":
      return createPiAdapter(options.pi);
    default:
      return undefined;
  }
}

export function createDefaultTrailAdapters(
  options: DefaultTrailAdaptersOptions = {},
): TrailAdapter[] {
  return [
    createClaudeCodeAdapter(options["claude-code"]),
    createCodexAdapter(options.codex),
    createOpenCodeAdapter(options.opencode),
    createPiAdapter(options.pi),
  ];
}
