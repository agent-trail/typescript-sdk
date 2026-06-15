export function quoteShellArg(value: string): string {
  return /^[A-Za-z0-9_\-./@:+=]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}
