import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { validateServiceName } from './validation.js';

/**
 * Get the socket path for a service.
 * Validates the service name to prevent path traversal attacks.
 */
export function getSocketPath(tapDir: string, name: string): string {
  validateServiceName(name);
  return join(resolve(tapDir), `${name}.sock`);
}

/**
 * Get the cursor cache directory path based on platform.
 * macOS: ~/Library/Caches/tap
 * Linux: ~/.cache/tap
 */
export function getCursorCacheDir(): string {
  const platform = process.platform;
  if (platform === 'darwin') {
    return join(homedir(), 'Library', 'Caches', 'tap');
  }
  return join(homedir(), '.cache', 'tap');
}

/**
 * Get the cursor cache file path.
 */
export function getCursorCachePath(): string {
  return join(getCursorCacheDir(), 'cursors.json');
}

/**
 * Get the default tap directory.
 */
export function getDefaultTapDir(): string {
  return './.tap';
}

/**
 * Ensure the tap directory exists with proper permissions.
 */
export async function ensureTapDir(tapDir: string): Promise<void> {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(resolve(tapDir), { recursive: true, mode: 0o700 });
}
