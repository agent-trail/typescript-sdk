import type { SessionGroup, TrailDiagnostic } from "../index.js";
import { diagnostic, isHeader } from "../shared.js";
import type { SessionGraph } from "./session-graph/index.js";

export function streamDiagnostics(group: SessionGroup, graph: SessionGraph): TrailDiagnostic[] {
  if (!isHeader(group.header.record) || group.header.record.stream?.state !== "open") return [];
  const diagnostics: TrailDiagnostic[] = [];
  if (
    group.header.record.content_hash !== undefined &&
    group.header.record.content_hash !== "<pending>"
  ) {
    diagnostics.push(
      diagnostic(group.header.line, "/content_hash", "warning", "stream_open_with_content_hash"),
    );
  }
  const terminal = graph.firstTerminalEvent();
  if (terminal !== undefined)
    diagnostics.push(
      diagnostic(terminal.line, "/type", "warning", "stream_open_with_terminal_event"),
    );
  return diagnostics;
}
