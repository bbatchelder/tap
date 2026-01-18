/**
 * Test utilities for integration tests.
 */

import { spawn, ChildProcess, execSync } from 'node:child_process';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const PROJECT_ROOT = resolve(import.meta.dirname, '..');
const TAP_BIN = join(PROJECT_ROOT, 'bin', 'tap');
const HARNESS_SCRIPT = join(PROJECT_ROOT, 'test', 'harness.ts');

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export interface HarnessOptions {
  lines?: number;
  delay?: number;
  stream?: 'stdout' | 'stderr' | 'both';
  readyAfter?: number;
  readyText?: string;
  forever?: boolean;
  logSignals?: boolean;
  exitCode?: number;
  exitAfter?: number;
}

/**
 * Create an isolated test directory.
 */
export async function createTestDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'tap-integration-'));
}

/**
 * Clean up a test directory.
 */
export async function cleanupTestDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/**
 * Run a tap CLI command and wait for completion.
 */
export async function runTap(
  args: string[],
  options: { cwd?: string; timeout?: number; env?: Record<string, string> } = {}
): Promise<RunResult> {
  const { cwd = process.cwd(), timeout = 30000, env = {} } = options;

  return new Promise((resolve, reject) => {
    const proc = spawn('node', [TAP_BIN, ...args], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`Command timed out after ${timeout}ms`));
    }, timeout);

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Build harness command arguments.
 */
export function buildHarnessArgs(opts: HarnessOptions): string[] {
  const args: string[] = [];

  if (opts.lines !== undefined) {
    args.push('--lines', String(opts.lines));
  }
  if (opts.delay !== undefined) {
    args.push('--delay', String(opts.delay));
  }
  if (opts.stream) {
    args.push('--stream', opts.stream);
  }
  if (opts.readyAfter !== undefined) {
    args.push('--ready-after', String(opts.readyAfter));
  }
  if (opts.readyText) {
    args.push('--ready-text', opts.readyText);
  }
  if (opts.forever) {
    args.push('--forever');
  }
  if (opts.logSignals) {
    args.push('--log-signals');
  }
  if (opts.exitCode !== undefined) {
    args.push('--exit-code', String(opts.exitCode));
  }
  if (opts.exitAfter !== undefined) {
    args.push('--exit-after', String(opts.exitAfter));
  }

  return args;
}

/**
 * Build the full command to run the harness via npx tsx.
 */
export function buildHarnessCommand(opts: HarnessOptions = {}): string[] {
  return ['npx', 'tsx', HARNESS_SCRIPT, ...buildHarnessArgs(opts)];
}

/**
 * Start a service using the harness via tap run.
 * Returns the tap run process.
 */
export async function startHarnessService(
  name: string,
  harnessOpts: HarnessOptions,
  options: { cwd?: string; tapDir?: string } = {}
): Promise<ChildProcess> {
  const { cwd = process.cwd(), tapDir } = options;

  const tapArgs = ['run', '--name', name];
  if (tapDir) {
    tapArgs.push('--tap-dir', tapDir);
  }
  tapArgs.push('--');
  tapArgs.push(...buildHarnessCommand(harnessOpts));

  const proc = spawn('node', [TAP_BIN, ...tapArgs], {
    cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  return proc;
}

/**
 * Wait for a condition to be true with timeout.
 */
export async function waitFor(
  fn: () => boolean | Promise<boolean>,
  timeout: number = 5000,
  interval: number = 100
): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (await fn()) {
      return;
    }
    await sleep(interval);
  }

  throw new Error(`Condition not met within ${timeout}ms`);
}

/**
 * Wait for a socket file to exist.
 */
export async function waitForSocket(socketPath: string, timeout: number = 5000): Promise<void> {
  await waitFor(() => existsSync(socketPath), timeout);
}

/**
 * Sleep for specified milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ensure .tap directory exists.
 */
export async function ensureTapDir(baseDir: string): Promise<string> {
  const tapDir = join(baseDir, '.tap');
  await mkdir(tapDir, { recursive: true, mode: 0o700 });
  return tapDir;
}

/**
 * Stop a service by name.
 */
export async function stopService(name: string, cwd: string): Promise<RunResult> {
  return runTap(['stop', name], { cwd });
}

/**
 * Get service status.
 */
export async function getServiceStatus(
  name: string,
  cwd: string,
  format: 'json' | 'text' = 'json'
): Promise<RunResult> {
  const args = ['status', name];
  if (format === 'json') {
    args.push('--format', 'json');
  }
  return runTap(args, { cwd });
}

/**
 * List services.
 */
export async function listServices(cwd: string, format: 'json' | 'text' = 'json'): Promise<RunResult> {
  const args = ['ls'];
  if (format === 'json') {
    args.push('--format', 'json');
  }
  return runTap(args, { cwd });
}

/**
 * Observe logs.
 */
export async function observeLogs(
  name: string,
  cwd: string,
  options: { last?: number; grep?: string; format?: 'json' | 'text' } = {}
): Promise<RunResult> {
  const args = ['observe', name];
  if (options.last !== undefined) {
    args.push('--last', String(options.last));
  }
  if (options.grep) {
    args.push('--grep', options.grep);
  }
  if (options.format) {
    args.push('--format', options.format);
  }
  return runTap(args, { cwd });
}
