import ms from "ms";

/** Parse duration strings (5m, 30s, 1h) to seconds — uses `ms` package, not hand-rolled regex. */
export function parseDurationToSeconds(input: string): number | null {
  const raw = input.trim();
  if (!raw) return null;
  const millis = ms(raw as ms.StringValue);
  if (millis == null || typeof millis !== "number" || millis < 0) return null;
  return Math.round(millis / 1000);
}

export function expiresAtUtcFromDuration(duration: string): string | null {
  const millis = ms(duration.trim() as ms.StringValue);
  if (millis == null || typeof millis !== "number") return null;
  return new Date(Date.now() + millis).toISOString();
}
