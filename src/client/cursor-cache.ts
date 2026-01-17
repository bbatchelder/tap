import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { getCursorCachePath } from '../utils/paths.js';

interface CursorCache {
  // Key: `${absoluteTapDir}:${serviceName}`
  [key: string]: number;
}

/**
 * Generate a cache key for a tap directory and service name.
 */
export function getCursorCacheKey(tapDir: string, serviceName: string): string {
  return `${resolve(tapDir)}:${serviceName}`;
}

/**
 * Load the cursor cache from disk.
 */
export function loadCursorCache(): CursorCache {
  const path = getCursorCachePath();
  try {
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, 'utf-8'));
    }
  } catch {
    // Corrupted cache, start fresh
  }
  return {};
}

/**
 * Save the cursor cache to disk.
 */
export function saveCursorCache(cache: CursorCache): void {
  const path = getCursorCachePath();
  const dir = dirname(path);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  writeFileSync(path, JSON.stringify(cache, null, 2), { mode: 0o600 });
}

/**
 * Get the stored cursor for a service.
 */
export function getCursor(tapDir: string, serviceName: string): number | undefined {
  const cache = loadCursorCache();
  const key = getCursorCacheKey(tapDir, serviceName);
  return cache[key];
}

/**
 * Store a cursor for a service.
 */
export function setCursor(tapDir: string, serviceName: string, cursor: number): void {
  const cache = loadCursorCache();
  const key = getCursorCacheKey(tapDir, serviceName);
  cache[key] = cursor;
  saveCursorCache(cache);
}

/**
 * Clear the cursor for a service.
 */
export function clearCursor(tapDir: string, serviceName: string): void {
  const cache = loadCursorCache();
  const key = getCursorCacheKey(tapDir, serviceName);
  delete cache[key];
  saveCursorCache(cache);
}
