import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseServiceName,
  getTapDirForService,
  discoverTapDirs,
  discoverServices,
  resolveService,
} from './discovery.js';

describe('parseServiceName', () => {
  it('parses simple name without prefix', () => {
    const result = parseServiceName('api');
    expect(result).toEqual({ prefix: '', baseName: 'api' });
  });

  it('parses prefixed name', () => {
    const result = parseServiceName('frontend:api');
    expect(result).toEqual({ prefix: 'frontend', baseName: 'api' });
  });

  it('uses last colon for prefix/baseName split', () => {
    const result = parseServiceName('apps/frontend:api');
    expect(result).toEqual({ prefix: 'apps/frontend', baseName: 'api' });
  });

  it('handles name with multiple path segments in prefix', () => {
    const result = parseServiceName('packages/core:worker');
    expect(result).toEqual({ prefix: 'packages/core', baseName: 'worker' });
  });
});

describe('getTapDirForService', () => {
  it('returns .tap for simple names', () => {
    const result = getTapDirForService('api', '/project');
    expect(result).toBe('/project/.tap');
  });

  it('returns prefix/.tap for prefixed names', () => {
    const result = getTapDirForService('frontend:api', '/project');
    expect(result).toBe('/project/frontend/.tap');
  });

  it('handles nested prefixes', () => {
    const result = getTapDirForService('apps/frontend:api', '/project');
    expect(result).toBe('/project/apps/frontend/.tap');
  });
});

describe('discoverTapDirs', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'tap-discovery-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns empty array for directory without .tap', async () => {
    const result = discoverTapDirs(tempDir);
    expect(result).toEqual([]);
  });

  it('finds root .tap directory', async () => {
    await mkdir(join(tempDir, '.tap'));

    const result = discoverTapDirs(tempDir);
    expect(result).toHaveLength(1);
    expect(result[0].prefix).toBe('');
    expect(result[0].path).toBe(join(tempDir, '.tap'));
  });

  it('finds nested .tap directories', async () => {
    await mkdir(join(tempDir, '.tap'));
    await mkdir(join(tempDir, 'frontend', '.tap'), { recursive: true });
    await mkdir(join(tempDir, 'backend', '.tap'), { recursive: true });

    const result = discoverTapDirs(tempDir);
    expect(result).toHaveLength(3);

    const prefixes = result.map(r => r.prefix).sort();
    expect(prefixes).toEqual(['', 'backend', 'frontend']);
  });

  it('respects maxDepth', async () => {
    await mkdir(join(tempDir, '.tap'));
    await mkdir(join(tempDir, 'a', 'b', 'c', 'd', 'e', 'f', '.tap'), { recursive: true });

    // Default maxDepth is 5, so depth 6 should not be found
    const result = discoverTapDirs(tempDir);
    expect(result).toHaveLength(1);
    expect(result[0].prefix).toBe('');
  });

  it('finds directories within maxDepth', async () => {
    await mkdir(join(tempDir, 'a', 'b', 'c', '.tap'), { recursive: true });

    const result = discoverTapDirs(tempDir, 5);
    expect(result).toHaveLength(1);
    expect(result[0].prefix).toBe('a/b/c');
  });

  it('skips node_modules', async () => {
    await mkdir(join(tempDir, '.tap'));
    await mkdir(join(tempDir, 'node_modules', 'pkg', '.tap'), { recursive: true });

    const result = discoverTapDirs(tempDir);
    expect(result).toHaveLength(1);
    expect(result[0].prefix).toBe('');
  });

  it('skips hidden directories except .tap', async () => {
    await mkdir(join(tempDir, '.tap'));
    await mkdir(join(tempDir, '.hidden', '.tap'), { recursive: true });

    const result = discoverTapDirs(tempDir);
    expect(result).toHaveLength(1);
    expect(result[0].prefix).toBe('');
  });
});

describe('discoverServices', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'tap-services-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns empty array when no services exist', async () => {
    const result = discoverServices(tempDir);
    expect(result).toEqual([]);
  });

  it('finds services in root .tap', async () => {
    await mkdir(join(tempDir, '.tap'));
    await writeFile(join(tempDir, '.tap', 'api.sock'), '');
    await writeFile(join(tempDir, '.tap', 'worker.sock'), '');

    const result = discoverServices(tempDir);
    expect(result).toHaveLength(2);

    const names = result.map(s => s.name).sort();
    expect(names).toEqual(['api', 'worker']);

    const apiService = result.find(s => s.name === 'api');
    expect(apiService?.prefix).toBe('');
    expect(apiService?.baseName).toBe('api');
  });

  it('finds services in nested .tap directories', async () => {
    await mkdir(join(tempDir, '.tap'));
    await writeFile(join(tempDir, '.tap', 'root-api.sock'), '');

    await mkdir(join(tempDir, 'frontend', '.tap'), { recursive: true });
    await writeFile(join(tempDir, 'frontend', '.tap', 'api.sock'), '');

    const result = discoverServices(tempDir);
    expect(result).toHaveLength(2);

    const rootService = result.find(s => s.name === 'root-api');
    expect(rootService?.prefix).toBe('');

    const frontendService = result.find(s => s.name === 'frontend:api');
    expect(frontendService?.prefix).toBe('frontend');
    expect(frontendService?.baseName).toBe('api');
  });

  it('ignores non-.sock files', async () => {
    await mkdir(join(tempDir, '.tap'));
    await writeFile(join(tempDir, '.tap', 'api.sock'), '');
    await writeFile(join(tempDir, '.tap', 'config.json'), '');
    await writeFile(join(tempDir, '.tap', 'readme.txt'), '');

    const result = discoverServices(tempDir);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('api');
  });
});

describe('resolveService', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'tap-resolve-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('finds exact match by name', async () => {
    await mkdir(join(tempDir, '.tap'));
    await writeFile(join(tempDir, '.tap', 'api.sock'), '');

    const result = resolveService('api', tempDir);
    expect(result).not.toBeNull();
    expect(result?.socketPath).toBe(join(tempDir, '.tap', 'api.sock'));
  });

  it('finds prefixed service by full name', async () => {
    await mkdir(join(tempDir, 'frontend', '.tap'), { recursive: true });
    await writeFile(join(tempDir, 'frontend', '.tap', 'api.sock'), '');

    const result = resolveService('frontend:api', tempDir);
    expect(result).not.toBeNull();
    expect(result?.socketPath).toBe(join(tempDir, 'frontend', '.tap', 'api.sock'));
  });

  it('finds unique service by basename fallback', async () => {
    await mkdir(join(tempDir, 'frontend', '.tap'), { recursive: true });
    await writeFile(join(tempDir, 'frontend', '.tap', 'api.sock'), '');

    // Search for 'api' without prefix should find 'frontend:api' if unique
    const result = resolveService('api', tempDir);
    expect(result).not.toBeNull();
    expect(result?.socketPath).toBe(join(tempDir, 'frontend', '.tap', 'api.sock'));
  });

  it('returns default path when service not found', async () => {
    const result = resolveService('nonexistent', tempDir);
    expect(result).not.toBeNull();
    expect(result?.socketPath).toBe(join(tempDir, '.tap', 'nonexistent.sock'));
    expect(result?.tapDir).toBe(join(tempDir, '.tap'));
  });

  it('uses explicit tapDir when provided', async () => {
    const explicitDir = join(tempDir, 'custom', '.tap');
    await mkdir(explicitDir, { recursive: true });

    const result = resolveService('api', tempDir, explicitDir);
    expect(result?.socketPath).toBe(join(explicitDir, 'api.sock'));
    expect(result?.tapDir).toBe(explicitDir);
  });

  it('extracts baseName when using explicit tapDir with prefixed name', async () => {
    const explicitDir = join(tempDir, 'custom', '.tap');
    await mkdir(explicitDir, { recursive: true });

    const result = resolveService('frontend:api', tempDir, explicitDir);
    // With explicit tapDir, uses baseName only
    expect(result?.socketPath).toBe(join(explicitDir, 'api.sock'));
  });
});
