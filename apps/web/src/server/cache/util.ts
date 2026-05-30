/** Tiny shared helpers — kept separate so circular imports stay impossible. */
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Parse the friendly TTL string "5m" / "30s" / "1h" / "200ms" into ms. */
export function parseTtl(input: string | number): number {
  if (typeof input === 'number') return input;
  const m = String(input).trim().match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/i);
  if (!m) throw new Error(`Invalid TTL: ${input}`);
  const n = Number(m[1]);
  switch ((m[2] ?? 'ms').toLowerCase()) {
    case 'ms': return n;
    case 's':  return n * 1_000;
    case 'm':  return n * 60_000;
    case 'h':  return n * 3_600_000;
    case 'd':  return n * 86_400_000;
    default:   return n;
  }
}
