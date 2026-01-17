import type { LogEvent } from '../protocol/types.js';
import { createSafeRegex } from '../utils/validation.js';

export interface QueryOptions {
  // Window selectors (exactly one)
  sinceCursor?: number;
  sinceMs?: number;
  last?: number;

  // Filters
  grep?: string;
  regex?: boolean;
  caseSensitive?: boolean;
  invert?: boolean;
  stream?: 'combined' | 'stdout' | 'stderr';

  // Limits
  maxLines?: number;
  maxBytes?: number;
}

export interface QueryResult {
  events: LogEvent[];
  cursorNext: number;
  truncated: boolean;
  dropped: boolean;
}

/**
 * In-memory ring buffer for log events.
 * Supports max_lines and max_bytes limits with automatic eviction.
 */
export class RingBuffer {
  private events: LogEvent[] = [];
  private nextSeq = 1;
  private totalBytes = 0;
  private lowestSeq = 1;

  constructor(
    private maxLines: number = 5000,
    private maxBytes: number = 10_000_000
  ) {}

  /**
   * Append a log line to the buffer.
   */
  append(text: string, stream: LogEvent['stream'] = 'combined'): LogEvent {
    const event: LogEvent = {
      seq: this.nextSeq++,
      ts: Date.now(),
      stream,
      text,
    };

    const eventBytes = Buffer.byteLength(text, 'utf-8');
    this.events.push(event);
    this.totalBytes += eventBytes;

    // Evict oldest events while over limits
    while (
      (this.events.length > this.maxLines || this.totalBytes > this.maxBytes) &&
      this.events.length > 0
    ) {
      const evicted = this.events.shift()!;
      this.totalBytes -= Buffer.byteLength(evicted.text, 'utf-8');
      this.lowestSeq = this.events[0]?.seq ?? this.nextSeq;
    }

    return event;
  }

  /**
   * Insert a marker event (e.g., for restart).
   */
  insertMarker(text: string): LogEvent {
    return this.append(text, 'combined');
  }

  /**
   * Query events from the buffer.
   */
  query(opts: QueryOptions): QueryResult {
    let candidates = this.events;
    let dropped = false;

    // Apply window selection
    if (opts.sinceCursor !== undefined) {
      const requestedSeq = opts.sinceCursor;
      if (requestedSeq < this.lowestSeq) {
        dropped = true;
      }
      candidates = candidates.filter(e => e.seq >= requestedSeq);
    } else if (opts.sinceMs !== undefined) {
      const cutoff = Date.now() - opts.sinceMs;
      candidates = candidates.filter(e => e.ts >= cutoff);
    } else if (opts.last !== undefined) {
      candidates = candidates.slice(-opts.last);
    }

    // Apply stream filter
    if (opts.stream && opts.stream !== 'combined') {
      candidates = candidates.filter(e => e.stream === opts.stream);
    }

    // Apply grep filter
    if (opts.grep) {
      let matcher: (text: string) => boolean;

      if (opts.regex) {
        const flags = opts.caseSensitive ? '' : 'i';
        const re = createSafeRegex(opts.grep, flags);
        matcher = (text: string) => re.test(text);
      } else {
        const pattern = opts.caseSensitive ? opts.grep : opts.grep.toLowerCase();
        matcher = opts.caseSensitive
          ? (text: string) => text.includes(pattern)
          : (text: string) => text.toLowerCase().includes(pattern);
      }

      candidates = candidates.filter(e => {
        const matches = matcher(e.text);
        return opts.invert ? !matches : matches;
      });
    }

    // Apply limits
    let truncated = false;
    const maxLines = opts.maxLines ?? 80;
    const maxBytes = opts.maxBytes ?? 32768;

    let resultBytes = 0;
    const result: LogEvent[] = [];

    for (const event of candidates) {
      if (result.length >= maxLines) {
        truncated = true;
        break;
      }
      const eventBytes = Buffer.byteLength(event.text, 'utf-8');
      if (resultBytes + eventBytes > maxBytes && result.length > 0) {
        truncated = true;
        break;
      }
      result.push(event);
      resultBytes += eventBytes;
    }

    return {
      events: result,
      cursorNext: result.length > 0
        ? result[result.length - 1].seq + 1
        : this.nextSeq,
      truncated,
      dropped,
    };
  }

  /**
   * Clear all events from the buffer.
   */
  clear(): void {
    this.events = [];
    this.totalBytes = 0;
    this.lowestSeq = this.nextSeq;
  }

  /**
   * Get buffer statistics.
   */
  getStats() {
    return {
      max_lines: this.maxLines,
      max_bytes: this.maxBytes,
      current_lines: this.events.length,
      current_bytes: this.totalBytes,
    };
  }

  /**
   * Get the next sequence number.
   */
  getNextSeq(): number {
    return this.nextSeq;
  }

  /**
   * Get the lowest retained sequence number.
   */
  getLowestSeq(): number {
    return this.lowestSeq;
  }

  /**
   * Wait for an event matching a pattern after a given cursor.
   * Used for readiness checks during restart.
   */
  async waitForMatch(
    pattern: string,
    isRegex: boolean,
    caseSensitive: boolean,
    afterCursor: number,
    timeoutMs: number,
    pollIntervalMs: number = 100
  ): Promise<{ matched: boolean; matchText?: string; snippet: string[] }> {
    const deadline = Date.now() + timeoutMs;

    let matcher: (text: string) => boolean;
    if (isRegex) {
      const flags = caseSensitive ? '' : 'i';
      const re = createSafeRegex(pattern, flags);
      matcher = (text: string) => re.test(text);
    } else {
      const p = caseSensitive ? pattern : pattern.toLowerCase();
      matcher = caseSensitive
        ? (text: string) => text.includes(p)
        : (text: string) => text.toLowerCase().includes(p);
    }

    while (Date.now() < deadline) {
      const events = this.events.filter(e => e.seq >= afterCursor);
      for (const event of events) {
        if (matcher(event.text)) {
          const snippet = events.slice(-10).map(e => e.text);
          return { matched: true, matchText: event.text, snippet };
        }
      }

      await new Promise(r => setTimeout(r, pollIntervalMs));
    }

    // Timeout - return last events as snippet
    const events = this.events.filter(e => e.seq >= afterCursor);
    const snippet = events.slice(-10).map(e => e.text);
    return { matched: false, snippet };
  }
}
