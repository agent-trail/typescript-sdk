import type { TrailDiagnostic } from "../index.js";
import { diagnostic, isHeader, isJsonObject, readString } from "../shared.js";
import type { GroupValidationContext } from "./context.js";

export function vcsDiagnostics(context: GroupValidationContext): TrailDiagnostic[] {
  const { group } = context;
  const header = group.header.record;
  if (!isHeader(header) || !isJsonObject(header.vcs)) return [];
  const remoteUrl = readString(header.vcs, "remote_url");
  if (remoteUrl === undefined || !hasUrlCredentials(remoteUrl)) return [];
  return [
    diagnostic(group.header.line, "/vcs/remote_url", "warning", "vcs_remote_url_with_credentials"),
  ];
}

function hasUrlCredentials(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.username !== "" || parsed.password !== "";
  } catch {
    return /^[a-z][a-z0-9+.-]*:\/\/[^/@]+@/i.test(value);
  }
}
