import { readFileSync, writeFileSync, mkdirSync, existsSync, lstatSync, unlinkSync } from 'node:fs';
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
 * Check if a path is a regular file (not a symlink or other special file).
 * Returns false if the file doesn't exist.
 */
function isRegularFile(filePath: string): boolean {
  try {
    const stat = lstatSync(filePath);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Load the cursor cache from disk.
 * Validates that the cache file is a regular file (not a symlink) for security.
 */
export function loadCursorCache(): CursorCache {
  const path = getCursorCachePath();
  try {
    if (existsSync(path)) {
      // Security: ensure it's a regular file, not a symlink
      if (!isRegularFile(path)) {
        // Remove suspicious file and start fresh
        try {
          unlinkSync(path);
        } catch {
          // Ignore removal errors
        }
        return {};
      }
      return JSON.parse(readFileSync(path, 'utf-8'));
    }
  } catch {
    // Corrupted cache, start fresh
  }
  return {};
}

/**
 * Save the cursor cache to disk.
 * Ensures the file is not a symlink before writing for security.
 */
export function saveCursorCache(cache: CursorCache): void {
  const path = getCursorCachePath();
  const dir = dirname(path);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  // Security: if file exists and is a symlink, remove it first
  if (existsSync(path) && !isRegularFile(path)) {
    try {
      unlinkSync(path);
    } catch {
      // If we can't remove the symlink, refuse to write
      throw new Error('Cannot save cursor cache: suspicious file detected');
    }
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
