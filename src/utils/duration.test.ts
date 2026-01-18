import { describe, it, expect } from 'vitest';
import { parseDuration, formatDuration } from './duration.js';

describe('parseDuration', () => {
  it('parses milliseconds', () => {
    expect(parseDuration('500ms')).toBe(500);
    expect(parseDuration('0ms')).toBe(0);
    expect(parseDuration('1ms')).toBe(1);
  });

  it('parses seconds', () => {
    expect(parseDuration('5s')).toBe(5000);
    expect(parseDuration('1s')).toBe(1000);
    expect(parseDuration('0s')).toBe(0);
    expect(parseDuration('120s')).toBe(120000);
  });

  it('parses minutes', () => {
    expect(parseDuration('2m')).toBe(120000);
    expect(parseDuration('1m')).toBe(60000);
    expect(parseDuration('0m')).toBe(0);
    expect(parseDuration('10m')).toBe(600000);
  });

  it('throws on invalid format', () => {
    expect(() => parseDuration('')).toThrow('Invalid duration format');
    expect(() => parseDuration('5')).toThrow('Invalid duration format');
    expect(() => parseDuration('5x')).toThrow('Invalid duration format');
    expect(() => parseDuration('5sec')).toThrow('Invalid duration format');
    expect(() => parseDuration('five seconds')).toThrow('Invalid duration format');
    expect(() => parseDuration('-5s')).toThrow('Invalid duration format');
    expect(() => parseDuration('5.5s')).toThrow('Invalid duration format');
  });
});

describe('formatDuration', () => {
  it('formats milliseconds', () => {
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('formats seconds', () => {
    expect(formatDuration(1000)).toBe('1s');
    expect(formatDuration(5000)).toBe('5s');
    expect(formatDuration(59000)).toBe('59s');
    expect(formatDuration(59999)).toBe('59s');
  });

  it('formats minutes', () => {
    expect(formatDuration(60000)).toBe('1m');
    expect(formatDuration(120000)).toBe('2m');
    expect(formatDuration(300000)).toBe('5m');
    expect(formatDuration(3599000)).toBe('59m');
  });

  it('formats hours', () => {
    expect(formatDuration(3600000)).toBe('1h');
    expect(formatDuration(7200000)).toBe('2h');
    expect(formatDuration(3660000)).toBe('1h1m');
    expect(formatDuration(5400000)).toBe('1h30m');
    expect(formatDuration(36000000)).toBe('10h');
  });
});
