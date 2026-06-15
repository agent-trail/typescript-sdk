const SAMPLE_HEAD = 4;
const SAMPLE_TAIL = 4;
const SAMPLE_MIN_REVEAL = SAMPLE_HEAD + SAMPLE_TAIL + 1;

export function maskSample(secret: string): string {
  if (secret.length === 0) return secret;
  if (secret.length < SAMPLE_MIN_REVEAL) return `<${secret.length} chars>`;
  return `${secret.slice(0, SAMPLE_HEAD)}…${secret.slice(-SAMPLE_TAIL)}`;
}
