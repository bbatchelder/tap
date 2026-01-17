/**
 * Service discovery utilities for finding .tap directories recursively.
 */

import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

export interface DiscoveredService {
  /** Full service name with prefix (e.g., "frontend:api" or "api" for root) */
  name: string;
  /** Absolute path to the socket file */
  socketPath: string;
  /** Absolute path to the .tap directory */
  tapDir: string;
  /** Relative path prefix (empty string for root .tap) */
  prefix: string;
  /** Base service name without prefix */
  baseName: string;
}

export interface DiscoveredTapDir {
  /** Absolute path to the .tap directory */
  path: string;
  /** Relative path from base directory (empty string for root .tap) */
  prefix: string;
}

/**
 * Find all .tap directories recursively from a base directory.
 * Skips node_modules and hidden directories (except .tap itself).
 */
export function discoverTapDirs(baseDir: string, maxDepth: number = 5): DiscoveredTapDir[] {
  const results: DiscoveredTapDir[] = [];
  const baseDirResolved = resolve(baseDir);

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) return;

    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return; // Can't read directory, skip
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry);

      // Skip node_modules and hidden dirs (except .tap)
      if (entry === 'node_modules') continue;
      if (entry.startsWith('.') && entry !== '.tap') continue;

      try {
        const stat = statSync(fullPath);
        if (!stat.isDirectory()) continue;

        if (entry === '.tap') {
          // Found a .tap directory
          const relativePath = relative(baseDirResolved, dir);
          results.push({
            path: fullPath,
            prefix: relativePath || '', // Empty string for root
          });
        } else {
          // Recurse into subdirectory
          walk(fullPath, depth + 1);
        }
      } catch {
        // Can't stat, skip
      }
    }
  }

  walk(baseDirResolved, 0);
  return results;
}

/**
 * Discover all services across all .tap directories.
 */
export function discoverServices(baseDir: string, maxDepth: number = 5): DiscoveredService[] {
  const tapDirs = discoverTapDirs(baseDir, maxDepth);
  const services: DiscoveredService[] = [];

  for (const tapDir of tapDirs) {
    let entries: string[];
    try {
      entries = readdirSync(tapDir.path);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.endsWith('.sock')) continue;

      const baseName = entry.slice(0, -5); // Remove .sock
      const name = tapDir.prefix ? `${tapDir.prefix}:${baseName}` : baseName;

      services.push({
        name,
        socketPath: join(tapDir.path, entry),
        tapDir: tapDir.path,
        prefix: tapDir.prefix,
        baseName,
      });
    }
  }

  return services;
}

/**
 * Parse a service name into prefix and base name.
 * "frontend:api" → { prefix: "frontend", baseName: "api" }
 * "api" → { prefix: "", baseName: "api" }
 */
export function parseServiceName(name: string): { prefix: string; baseName: string } {
  const colonIndex = name.lastIndexOf(':');
  if (colonIndex === -1) {
    return { prefix: '', baseName: name };
  }
  return {
    prefix: name.slice(0, colonIndex),
    baseName: name.slice(colonIndex + 1),
  };
}

/**
 * Resolve a service name to its socket path.
 * Searches recursively if no explicit tapDir is provided.
 *
 * @param name Service name (e.g., "api" or "frontend:api")
 * @param baseDir Base directory to search from (default: cwd)
 * @param explicitTapDir If provided, only look in this .tap directory
 * @returns Socket path and tap directory, or null if not found
 */
export function resolveService(
  name: string,
  baseDir: string = process.cwd(),
  explicitTapDir?: string
): { socketPath: string; tapDir: string } | null {
  const { prefix, baseName } = parseServiceName(name);

  if (explicitTapDir) {
    // Explicit tap dir - use it directly (original behavior)
    const socketPath = join(resolve(explicitTapDir), `${baseName}.sock`);
    return { socketPath, tapDir: resolve(explicitTapDir) };
  }

  // Recursive discovery
  const services = discoverServices(baseDir);

  // Find exact match
  const match = services.find(s => s.name === name);
  if (match) {
    return { socketPath: match.socketPath, tapDir: match.tapDir };
  }

  // If no prefix given, also check if there's a unique match by base name
  if (!prefix) {
    const matches = services.filter(s => s.baseName === name);
    if (matches.length === 1) {
      return { socketPath: matches[0].socketPath, tapDir: matches[0].tapDir };
    }
  }

  // Not found - return expected path for error messages
  // Default to root .tap directory
  const tapDir = resolve(baseDir, '.tap');
  const socketPath = join(tapDir, `${baseName}.sock`);
  return { socketPath, tapDir };
}

/**
 * Get the tap directory path for a new service.
 * Uses prefix to determine subdirectory.
 */
export function getTapDirForService(name: string, baseDir: string): string {
  const { prefix } = parseServiceName(name);
  if (prefix) {
    return resolve(baseDir, prefix, '.tap');
  }
  return resolve(baseDir, '.tap');
}
