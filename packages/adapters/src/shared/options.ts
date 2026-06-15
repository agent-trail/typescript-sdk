export function uniqueOptionLabelToId(options: Record<string, unknown>[]): Map<string, string> {
  const labelCounts = new Map<string, number>();
  for (const option of options) {
    const label = option.label;
    if (typeof label === "string") labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  }
  const out = new Map<string, string>();
  for (const option of options) {
    const label = option.label;
    const id = option.id;
    if (typeof label === "string" && typeof id === "string" && labelCounts.get(label) === 1) {
      out.set(label, id);
    }
  }
  return out;
}
