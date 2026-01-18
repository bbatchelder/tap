import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

// Mock the paths module to use a temp directory for the cache
let mockCachePath: string;

vi.mock('../utils/paths.js', () => ({
  getCursorCachePath: () => mockCachePath,
}));

// Import after mocking
const { getCursorCacheKey, loadCursorCache, saveCursorCache, getCursor, setCursor, clearCursor } = await import('./cursor-cache.js');

describe('cursor-cache', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'tap-cursor-'));
    mockCachePath = join(tempDir, 'cursors.json');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('getCursorCacheKey', () => {
    it('generates key from tapDir and serviceName', () => {
      const key = getCursorCacheKey('/project/.tap', 'api');
      expect(key).toBe('/project/.tap:api');
    });

    it('resolves relative tapDir paths', () => {
      const key = getCursorCacheKey('.tap', 'api');
      expect(key).toContain(':api');
      expect(key).not.toBe('.tap:api'); // Should be resolved to absolute
    });
  });

  describe('loadCursorCache', () => {
    it('returns empty object when cache file does not exist', () => {
      const cache = loadCursorCache();
      expect(cache).toEqual({});
    });

    it('loads existing cache file', async () => {
      await writeFile(mockCachePath, JSON.stringify({ 'key1': 100, 'key2': 200 }));

      const cache = loadCursorCache();
      expect(cache).toEqual({ 'key1': 100, 'key2': 200 });
    });

    it('returns empty object on corrupted JSON', async () => {
      await writeFile(mockCachePath, 'not valid json {{{');

      const cache = loadCursorCache();
      expect(cache).toEqual({});
    });

    it('removes and ignores symlinks for security', async () => {
      // Create a target file
      const targetFile = join(tempDir, 'target.json');
      await writeFile(targetFile, JSON.stringify({ 'compromised': 999 }));

      // Create symlink at cache path
      await symlink(targetFile, mockCachePath);

      const cache = loadCursorCache();
      expect(cache).toEqual({});
      expect(existsSync(mockCachePath)).toBe(false);
    });
  });

  describe('saveCursorCache', () => {
    it('creates cache file with correct content', () => {
      saveCursorCache({ 'key1': 100, 'key2': 200 });

      expect(existsSync(mockCachePath)).toBe(true);
      const content = JSON.parse(readFileSync(mockCachePath, 'utf-8'));
      expect(content).toEqual({ 'key1': 100, 'key2': 200 });
    });

    it('creates parent directory if needed', () => {
      mockCachePath = join(tempDir, 'subdir', 'cursors.json');

      saveCursorCache({ 'key': 42 });

      expect(existsSync(mockCachePath)).toBe(true);
    });

    it('overwrites existing cache', () => {
      saveCursorCache({ 'old': 1 });
      saveCursorCache({ 'new': 2 });

      const content = JSON.parse(readFileSync(mockCachePath, 'utf-8'));
      expect(content).toEqual({ 'new': 2 });
    });

    it('removes symlinks before writing for security', async () => {
      const targetFile = join(tempDir, 'target.json');
      await writeFile(targetFile, '{}');
      await symlink(targetFile, mockCachePath);

      saveCursorCache({ 'safe': 123 });

      // Should have removed symlink and written regular file
      const content = JSON.parse(readFileSync(mockCachePath, 'utf-8'));
      expect(content).toEqual({ 'safe': 123 });
    });
  });

  describe('getCursor', () => {
    it('returns undefined when cursor does not exist', () => {
      const cursor = getCursor('/project/.tap', 'api');
      expect(cursor).toBeUndefined();
    });

    it('returns stored cursor value', () => {
      setCursor('/project/.tap', 'api', 12345);

      const cursor = getCursor('/project/.tap', 'api');
      expect(cursor).toBe(12345);
    });

    it('returns correct cursor for different services', () => {
      setCursor('/project/.tap', 'api', 100);
      setCursor('/project/.tap', 'worker', 200);

      expect(getCursor('/project/.tap', 'api')).toBe(100);
      expect(getCursor('/project/.tap', 'worker')).toBe(200);
    });
  });

  describe('setCursor', () => {
    it('stores new cursor', () => {
      setCursor('/project/.tap', 'api', 999);

      const cursor = getCursor('/project/.tap', 'api');
      expect(cursor).toBe(999);
    });

    it('overwrites existing cursor', () => {
      setCursor('/project/.tap', 'api', 100);
      setCursor('/project/.tap', 'api', 200);

      const cursor = getCursor('/project/.tap', 'api');
      expect(cursor).toBe(200);
    });

    it('persists cursor to disk', () => {
      setCursor('/project/.tap', 'api', 42);

      // Read file directly to verify persistence
      const content = JSON.parse(readFileSync(mockCachePath, 'utf-8'));
      const key = getCursorCacheKey('/project/.tap', 'api');
      expect(content[key]).toBe(42);
    });
  });

  describe('clearCursor', () => {
    it('removes stored cursor', () => {
      setCursor('/project/.tap', 'api', 100);
      clearCursor('/project/.tap', 'api');

      const cursor = getCursor('/project/.tap', 'api');
      expect(cursor).toBeUndefined();
    });

    it('does not affect other cursors', () => {
      setCursor('/project/.tap', 'api', 100);
      setCursor('/project/.tap', 'worker', 200);

      clearCursor('/project/.tap', 'api');

      expect(getCursor('/project/.tap', 'api')).toBeUndefined();
      expect(getCursor('/project/.tap', 'worker')).toBe(200);
    });

    it('handles clearing non-existent cursor', () => {
      // Should not throw
      expect(() => clearCursor('/project/.tap', 'nonexistent')).not.toThrow();
    });
  });
});
