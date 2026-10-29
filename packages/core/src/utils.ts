export function generateReferralCode(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return (`${timestamp}${random}`).toUpperCase().substring(0, 8);
}

/**
 * Coerce a stored numeric value (bigint, Mongo Long, number, or string) to a
 * bigint. Mongo documents may hold raw numeric fields as plain numbers even
 * when the schema declares BigInt, so arithmetic against `0n` would otherwise
 * throw "Cannot mix BigInt and other types".
 */
export function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (value === null || value === undefined) return 0n;
  if (typeof value === "number") {
    return Number.isFinite(value) ? BigInt(Math.trunc(value)) : 0n;
  }
  if (typeof value === "boolean") return value ? 1n : 0n;
  if (typeof value === "string") {
    const s = value.trim();
    if (s.endsWith("n")) {
      try {
        return BigInt(s.slice(0, -1));
      } catch {}
    }
    try {
      return BigInt(s);
    } catch {
      return 0n;
    }
  }
  try {
    const s = String(value);
    if (s.endsWith("n")) return BigInt(s.slice(0, -1));
    return BigInt(s);
  } catch {
    return 0n;
  }
}