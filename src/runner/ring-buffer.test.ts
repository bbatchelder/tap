import { describe, it, expect, beforeEach } from 'vitest';
import { RingBuffer } from './ring-buffer.js';

describe('RingBuffer', () => {
  describe('append', () => {
    it('appends events with incrementing sequence numbers', () => {
      const buffer = new RingBuffer();
      const e1 = buffer.append('line 1');
      const e2 = buffer.append('line 2');
      const e3 = buffer.append('line 3');

      expect(e1.seq).toBe(1);
      expect(e2.seq).toBe(2);
      expect(e3.seq).toBe(3);
    });

    it('records stream type', () => {
      const buffer = new RingBuffer();
      const e1 = buffer.append('stdout line', 'stdout');
      const e2 = buffer.append('stderr line', 'stderr');
      const e3 = buffer.append('combined line');

      expect(e1.stream).toBe('stdout');
      expect(e2.stream).toBe('stderr');
      expect(e3.stream).toBe('combined');
    });

    it('records timestamps', () => {
      const buffer = new RingBuffer();
      const before = Date.now();
      const event = buffer.append('test');
      const after = Date.now();

      expect(event.ts).toBeGreaterThanOrEqual(before);
      expect(event.ts).toBeLessThanOrEqual(after);
    });
  });

  describe('eviction by line count', () => {
    it('evicts oldest events when exceeding maxLines', () => {
      const buffer = new RingBuffer(3, 10_000_000);
      buffer.append('line 1');
      buffer.append('line 2');
      buffer.append('line 3');
      buffer.append('line 4');

      const result = buffer.query({});
      expect(result.events.length).toBe(3);
      expect(result.events[0].text).toBe('line 2');
      expect(result.events[2].text).toBe('line 4');
    });

    it('updates lowestSeq after eviction', () => {
      const buffer = new RingBuffer(2, 10_000_000);
      buffer.append('line 1');
      buffer.append('line 2');
      expect(buffer.getLowestSeq()).toBe(1);

      buffer.append('line 3');
      expect(buffer.getLowestSeq()).toBe(2);
    });
  });

  describe('eviction by byte size', () => {
    it('evicts oldest events when exceeding maxBytes', () => {
      const buffer = new RingBuffer(1000, 20); // 20 bytes max
      buffer.append('12345'); // 5 bytes
      buffer.append('67890'); // 5 bytes
      buffer.append('abcde'); // 5 bytes
      buffer.append('fghij'); // 5 bytes - should evict first

      const stats = buffer.getStats();
      expect(stats.current_bytes).toBeLessThanOrEqual(20);
    });
  });

  describe('query', () => {
    let buffer: RingBuffer;

    beforeEach(() => {
      buffer = new RingBuffer();
      buffer.append('line 1', 'stdout');
      buffer.append('line 2', 'stderr');
      buffer.append('line 3', 'stdout');
      buffer.append('error: something failed', 'stderr');
      buffer.append('line 5', 'stdout');
    });

    it('returns all events by default', () => {
      const result = buffer.query({ maxLines: 100 });
      expect(result.events.length).toBe(5);
    });

    it('returns last N events', () => {
      const result = buffer.query({ last: 2 });
      expect(result.events.length).toBe(2);
      expect(result.events[0].text).toBe('error: something failed');
      expect(result.events[1].text).toBe('line 5');
    });

    it('filters by stream', () => {
      const result = buffer.query({ stream: 'stderr', maxLines: 100 });
      expect(result.events.length).toBe(2);
      expect(result.events.every(e => e.stream === 'stderr')).toBe(true);
    });

    it('filters by grep substring', () => {
      const result = buffer.query({ grep: 'error', maxLines: 100 });
      expect(result.events.length).toBe(1);
      expect(result.events[0].text).toBe('error: something failed');
    });

    it('filters by grep case-insensitive by default', () => {
      const result = buffer.query({ grep: 'ERROR', maxLines: 100 });
      expect(result.events.length).toBe(1);
    });

    it('filters by grep case-sensitive when specified', () => {
      const result = buffer.query({ grep: 'ERROR', caseSensitive: true, maxLines: 100 });
      expect(result.events.length).toBe(0);
    });

    it('filters by grep regex', () => {
      const result = buffer.query({ grep: 'line \\d', regex: true, maxLines: 100 });
      expect(result.events.length).toBe(4);
    });

    it('inverts grep match', () => {
      const result = buffer.query({ grep: 'error', invert: true, maxLines: 100 });
      expect(result.events.length).toBe(4);
      expect(result.events.every(e => !e.text.includes('error'))).toBe(true);
    });

    it('returns events since cursor', () => {
      const result = buffer.query({ sinceCursor: 3, maxLines: 100 });
      expect(result.events.length).toBe(3);
      expect(result.events[0].seq).toBe(3);
    });

    it('sets dropped flag when cursor is before lowestSeq', () => {
      const smallBuffer = new RingBuffer(2, 10_000_000);
      smallBuffer.append('line 1');
      smallBuffer.append('line 2');
      smallBuffer.append('line 3'); // evicts line 1

      const result = smallBuffer.query({ sinceCursor: 1, maxLines: 100 });
      expect(result.dropped).toBe(true);
    });

    it('truncates results when exceeding maxLines', () => {
      const result = buffer.query({ maxLines: 2 });
      expect(result.events.length).toBe(2);
      expect(result.truncated).toBe(true);
    });

    it('returns cursorNext for subsequent queries', () => {
      const result = buffer.query({ last: 2 });
      expect(result.cursorNext).toBe(6); // seq 5 + 1
    });
  });

  describe('clear', () => {
    it('removes all events', () => {
      const buffer = new RingBuffer();
      buffer.append('line 1');
      buffer.append('line 2');
      buffer.clear();

      const result = buffer.query({});
      expect(result.events.length).toBe(0);
    });

    it('preserves sequence numbering', () => {
      const buffer = new RingBuffer();
      buffer.append('line 1');
      buffer.append('line 2');
      buffer.clear();
      const event = buffer.append('line 3');

      expect(event.seq).toBe(3);
    });
  });

  describe('getStats', () => {
    it('returns current buffer statistics', () => {
      const buffer = new RingBuffer(100, 1000);
      buffer.append('hello');
      buffer.append('world');

      const stats = buffer.getStats();
      expect(stats.max_lines).toBe(100);
      expect(stats.max_bytes).toBe(1000);
      expect(stats.current_lines).toBe(2);
      expect(stats.current_bytes).toBe(10); // 'hello' + 'world'
    });
  });

  describe('getLastLogAt', () => {
    it('returns null for empty buffer', () => {
      const buffer = new RingBuffer();
      expect(buffer.getLastLogAt()).toBeNull();
    });

    it('returns timestamp of last event', () => {
      const buffer = new RingBuffer();
      const before = Date.now();
      buffer.append('line 1');
      buffer.append('line 2');
      const after = Date.now();

      const lastTs = buffer.getLastLogAt();
      expect(lastTs).toBeGreaterThanOrEqual(before);
      expect(lastTs).toBeLessThanOrEqual(after);
    });
  });
});
