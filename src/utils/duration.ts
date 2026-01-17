/**
 * Parse a duration string into milliseconds.
 * Supported formats: <int><unit> where unit is ms, s, or m
 * Examples: 500ms, 5s, 2m
 */
export function parseDuration(input: string): number {
  const match = input.match(/^(\d+)(ms|s|m)$/);
  if (!match) {
    throw new Error(`Invalid duration format: "${input}". Expected format: <number><unit> (e.g., 500ms, 5s, 2m)`);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 'ms':
      return value;
    case 's':
      return value * 1000;
    case 'm':
      return value * 60 * 1000;
    default:
      throw new Error(`Unknown duration unit: ${unit}`);
  }
}

/**
 * Format milliseconds as a human-readable duration string.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60000) {
    const s = Math.floor(ms / 1000);
    return `${s}s`;
  }
  if (ms < 3600000) {
    const m = Math.floor(ms / 60000);
    return `${m}m`;
  }
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}
