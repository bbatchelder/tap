import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { getSocketPath, getCursorCacheDir, getDefaultTapDir, ensureTapDir } from './paths.js';

describe('getSocketPath', () => {
  it('returns path with .sock extension', () => {
    const result = getSocketPath('/tmp/.tap', 'my-service');
    expect(result).toBe('/tmp/.tap/my-service.sock');
  });

  it('resolves relative tap directories', () => {
    const result = getSocketPath('.tap', 'api');
    expect(result).toContain('.tap/api.sock');
    expect(result).not.toBe('.tap/api.sock'); // Should be absolute
  });

  it('validates service name', () => {
    expect(() => getSocketPath('/tmp/.tap', '')).toThrow();
    expect(() => getSocketPath('/tmp/.tap', '../etc/passwd')).toThrow();
  });

  it('handles prefixed service names', () => {
    const result = getSocketPath('/tmp/.tap', 'frontend:api');
    expect(result).toBe('/tmp/.tap/frontend:api.sock');
  });
});

describe('getCursorCacheDir', () => {
  it('returns platform-specific path', () => {
    const result = getCursorCacheDir();
    expect(result).toContain('tap');

    if (process.platform === 'darwin') {
      expect(result).toContain('Library/Caches');
    } else {
      expect(result).toContain('.cache');
    }
  });

  it('returns an absolute path', () => {
    const result = getCursorCacheDir();
    expect(result.startsWith('/')).toBe(true);
  });
});

describe('getDefaultTapDir', () => {
  it('returns ./.tap', () => {
    const result = getDefaultTapDir();
    expect(result).toBe('./.tap');
  });
});

describe('ensureTapDir', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'tap-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('creates directory if it does not exist', async () => {
    const tapDir = join(tempDir, '.tap');
    expect(existsSync(tapDir)).toBe(false);

    await ensureTapDir(tapDir);

    expect(existsSync(tapDir)).toBe(true);
  });

  it('sets mode to 0o700', async () => {
    const tapDir = join(tempDir, '.tap');
    await ensureTapDir(tapDir);

    const stats = await stat(tapDir);
    // Check that owner has rwx and others have nothing
    expect(stats.mode & 0o777).toBe(0o700);
  });

  it('is idempotent', async () => {
    const tapDir = join(tempDir, '.tap');

    await ensureTapDir(tapDir);
    await ensureTapDir(tapDir); // Should not throw

    expect(existsSync(tapDir)).toBe(true);
  });

  it('creates nested directories', async () => {
    const tapDir = join(tempDir, 'deep', 'nested', '.tap');

    await ensureTapDir(tapDir);

    expect(existsSync(tapDir)).toBe(true);
  });

  it('handles paths with trailing slashes', async () => {
    const tapDir = join(tempDir, '.tap/');
    await ensureTapDir(tapDir);
    expect(existsSync(join(tempDir, '.tap'))).toBe(true);
  });
});
