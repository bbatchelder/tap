import { Command } from 'commander';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { startRunner } from '../runner/index.js';
import { getTapDirForService, parseServiceName } from '../utils/discovery.js';

/**
 * Parse environment variable from string format "KEY=VALUE"
 */
function parseEnvVar(value: string, previous: Record<string, string>): Record<string, string> {
  const idx = value.indexOf('=');
  if (idx === -1) {
    throw new Error(`Invalid env var format: "${value}". Expected KEY=VALUE`);
  }
  const key = value.slice(0, idx);
  const val = value.slice(idx + 1);
  return { ...previous, [key]: val };
}

/**
 * Process escape sequences in a double-quoted string.
 */
function processEscapes(value: string): string {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

/**
 * Load environment variables from a file.
 * Supports:
 * - Comments (#)
 * - Empty lines
 * - Unquoted values
 * - Single-quoted values (literal, no escape processing)
 * - Double-quoted values (with escape sequence processing)
 */
function loadEnvFile(path: string): Record<string, string> {
  const content = readFileSync(path, 'utf-8');
  const env: Record<string, string> = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue;

    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;

    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1);

    // Validate key contains only valid characters
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
      throw new Error(`Invalid environment variable name: "${key}"`);
    }

    // Handle quoted values
    if (val.startsWith('"')) {
      // Double-quoted: find the closing quote (accounting for escapes)
      let end = 1;
      while (end < val.length) {
        if (val[end] === '\\' && end + 1 < val.length) {
          end += 2; // Skip escaped character
        } else if (val[end] === '"') {
          break;
        } else {
          end++;
        }
      }
      if (val[end] !== '"') {
        throw new Error(`Unterminated double quote in env file for key: "${key}"`);
      }
      val = processEscapes(val.slice(1, end));
    } else if (val.startsWith("'")) {
      // Single-quoted: literal value, no escape processing
      const end = val.lastIndexOf("'");
      if (end <= 0) {
        throw new Error(`Unterminated single quote in env file for key: "${key}"`);
      }
      val = val.slice(1, end);
    } else {
      // Unquoted: take value as-is, trim trailing whitespace
      val = val.trim();
    }

    env[key] = val;
  }

  return env;
}

export function runCommand(program: Command): void {
  program
    .command('run')
    .description('Start a runner server and a child process')
    .argument('<name>', 'Service name (e.g., "api" or "frontend:api")')
    .argument('<command...>', 'Command to run (use -- to separate from options)')
    .option('--tap-dir <path>', 'Override .tap directory (disables prefix-based directory)')
    .option('--cwd <path>', 'Working directory for child', process.cwd())
    .option('--env <KEY=VAL>', 'Add/override env var for child', parseEnvVar, {})
    .option('--env-file <path>', 'Load env vars from file')
    .option('--pty', 'Use PTY for child (may require native module rebuild)')
    .option('--no-pty', 'Use pipes instead of PTY (default)')
    .option('--forward', 'Forward child output to stdout (default)', true)
    .option('--no-forward', 'Do not forward child output')
    .option('--buffer-lines <N>', 'Ring buffer max events', '5000')
    .option('--buffer-bytes <N>', 'Ring buffer max bytes', '10000000')
    .option('--print-connection', 'Print socket path and PID on startup')
    .option('--ready <pattern>', 'Substring readiness indicator')
    .option('--ready-regex <regex>', 'Regex readiness indicator')
    .option('--verbose', 'Verbose output')
    .action(async (name: string, command: string[], opts) => {
      // Load env file if specified
      let env = opts.env;
      if (opts.envFile) {
        try {
          const fileEnv = loadEnvFile(opts.envFile);
          env = { ...fileEnv, ...env };
        } catch (err) {
          console.error(`Failed to load env file: ${err instanceof Error ? err.message : err}`);
          process.exit(1);
        }
      }

      // Parse service name - handle prefixed names like "frontend:api"
      const { baseName } = parseServiceName(name);

      // Determine tap directory
      // If explicit --tap-dir, use it. Otherwise derive from prefix.
      const tapDir = opts.tapDir
        ? resolve(opts.tapDir)
        : getTapDirForService(name, process.cwd());

      // Default to pipes (no PTY) - use PTY only if explicitly requested
      const usePty = opts.pty === true;

      try {
        await startRunner({
          name: baseName,  // Use base name for socket file
          tapDir,
          command,
          cwd: resolve(opts.cwd),
          env,
          usePty,
          forward: opts.forward,
          bufferLines: parseInt(opts.bufferLines),
          bufferBytes: parseInt(opts.bufferBytes),
          printConnection: opts.printConnection || false,
          readyPattern: opts.ready,
          readyRegex: opts.readyRegex,
        });
      } catch (err) {
        console.error(`Failed to start runner: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}
