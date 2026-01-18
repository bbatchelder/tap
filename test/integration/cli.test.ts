/**
 * Integration tests for tap CLI.
 * Uses the test harness for controllable, predictable behavior.
 *
 * Note: tap run is a daemon that doesn't exit on its own.
 * Tests start services, perform assertions, then stop them.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { existsSync, writeFileSync } from 'node:fs';
import { ChildProcess, spawn } from 'node:child_process';
import {
  createTestDir,
  cleanupTestDir,
  runTap,
  buildHarnessCommand,
  waitForSocket,
  sleep,
  ensureTapDir,
} from '../utils.js';

describe('tap CLI integration', () => {
  let testDir: string;
  let tapDir: string;
  let runningProcesses: ChildProcess[] = [];

  // Helper to start tap run in background
  async function startService(
    name: string,
    harnessArgs: Parameters<typeof buildHarnessCommand>[0],
    extraArgs: string[] = []
  ): Promise<ChildProcess> {
    const harnessCmd = buildHarnessCommand(harnessArgs);
    const tapBin = join(import.meta.dirname, '../../bin/tap');

    const proc = spawn('node', [tapBin, 'run', name, ...extraArgs, '--', ...harnessCmd], {
      cwd: testDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    runningProcesses.push(proc);

    // Collect output for debugging
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d) => { stdout += d.toString(); });
    proc.stderr?.on('data', (d) => { stderr += d.toString(); });

    // Wait for socket
    const socketPath = join(tapDir, `${name}.sock`);
    await waitForSocket(socketPath, 5000);
    await sleep(200); // Allow server to fully initialize

    return proc;
  }

  beforeEach(async () => {
    testDir = await createTestDir();
    tapDir = await ensureTapDir(testDir);
    runningProcesses = [];
  });

  afterEach(async () => {
    // Stop all running services
    for (const proc of runningProcesses) {
      if (!proc.killed) {
        proc.kill('SIGTERM');
      }
    }
    await sleep(200); // Allow cleanup
    await cleanupTestDir(testDir);
  });

  describe('tap run', () => {
    it('starts a service and creates socket', async () => {
      const socketPath = join(tapDir, 'test-service.sock');

      await startService('test-service', { forever: true, delay: 100 });

      expect(existsSync(socketPath)).toBe(true);
    });

    it('captures output in ring buffer', async () => {
      await startService('test-service', { forever: true, delay: 50 });
      await sleep(800); // Let some logs accumulate

      const result = await runTap(
        ['observe', 'test-service', '--last', '5', '--format', 'json'],
        { cwd: testDir }
      );

      expect(result.code).toBe(0);
      const response = JSON.parse(result.stdout);
      expect(response.events.length).toBeGreaterThan(0);
      // Verify log content matches harness output format
      expect(response.events[0].text).toMatch(/\[\d{4}-\d{2}-\d{2}T.*\] line \d+/);
    });

    it('passes environment variables to child', async () => {
      const tapBin = join(import.meta.dirname, '../../bin/tap');

      // Use a simple command that echoes the env var
      const proc = spawn('node', [
        tapBin, 'run', 'env-test',
        '--env', 'TEST_VAR=hello_world',
        '--', 'node', '-e', 'console.log("ENV:" + process.env.TEST_VAR); setInterval(() => {}, 1000)',
      ], {
        cwd: testDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      });
      runningProcesses.push(proc);

      const socketPath = join(tapDir, 'env-test.sock');
      await waitForSocket(socketPath, 5000);
      await sleep(300);

      const result = await runTap(
        ['observe', 'env-test', '--last', '5', '--format', 'json'],
        { cwd: testDir }
      );

      const response = JSON.parse(result.stdout);
      const envLine = response.events.find((e: { text: string }) => e.text.includes('ENV:'));
      expect(envLine).toBeDefined();
      expect(envLine.text).toContain('hello_world');
    });
  });

  describe('tap ls', () => {
    it('shows no services when none exist', async () => {
      const result = await runTap(['ls', '--format', 'json'], { cwd: testDir });

      expect(result.code).toBe(0);
      const response = JSON.parse(result.stdout);
      expect(response.services).toEqual([]);
    });

    it('lists running service', async () => {
      await startService('test-service', { forever: true, delay: 100 });

      const result = await runTap(['ls', '--format', 'json'], { cwd: testDir });

      expect(result.code).toBe(0);
      const response = JSON.parse(result.stdout);
      expect(response.services).toHaveLength(1);
      expect(response.services[0].name).toBe('test-service');
      expect(response.services[0].live).toBe(true);
      expect(response.services[0].child_state).toBe('running');
    });

    it('lists multiple services', async () => {
      await startService('service-a', { forever: true, delay: 100 });
      await startService('service-b', { forever: true, delay: 100 });

      const result = await runTap(['ls', '--format', 'json'], { cwd: testDir });

      expect(result.code).toBe(0);
      const response = JSON.parse(result.stdout);
      expect(response.services).toHaveLength(2);
      const names = response.services.map((s: { name: string }) => s.name).sort();
      expect(names).toEqual(['service-a', 'service-b']);
    });

    it('shows stale state for dead socket', async () => {
      // Create a fake socket file to simulate stale state
      const socketPath = join(tapDir, 'stale-service.sock');
      writeFileSync(socketPath, '');

      const result = await runTap(['ls', '--format', 'json'], { cwd: testDir });

      expect(result.code).toBe(0);
      const response = JSON.parse(result.stdout);
      expect(response.services).toHaveLength(1);
      expect(response.services[0].name).toBe('stale-service');
      expect(response.services[0].live).toBe(false);
    });
  });

  describe('tap observe', () => {
    it('returns recent logs with --last', async () => {
      await startService('test-service', { forever: true, delay: 50 });
      await sleep(800); // Let logs accumulate

      const result = await runTap(
        ['observe', 'test-service', '--last', '5', '--format', 'json'],
        { cwd: testDir }
      );

      expect(result.code).toBe(0);
      const response = JSON.parse(result.stdout);
      expect(response.events).toBeDefined();
      expect(response.events.length).toBeGreaterThan(0);
      expect(response.events.length).toBeLessThanOrEqual(5);
    });

    it('filters logs with --grep', async () => {
      await startService('test-service', { forever: true, delay: 30 });
      await sleep(500); // Let enough logs accumulate

      const result = await runTap(
        ['observe', 'test-service', '--last', '50', '--grep', 'line 5', '--format', 'json'],
        { cwd: testDir }
      );

      expect(result.code).toBe(0);
      const response = JSON.parse(result.stdout);
      // All matching events should contain "line 5"
      if (response.events.length > 0) {
        for (const event of response.events) {
          expect(event.text).toContain('line 5');
        }
      }
    });

    it('supports text format with metadata trailer', async () => {
      await startService('test-service', { forever: true, delay: 30 });
      await sleep(300);

      const result = await runTap(
        ['observe', 'test-service', '--last', '3', '--format', 'text'],
        { cwd: testDir }
      );

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('---');
      expect(result.stdout).toContain('cursor=');
      expect(result.stdout).toContain('truncated=');
    });

    it('filters by stream with --stream stderr', async () => {
      await startService('test-service', { forever: true, delay: 30, stream: 'both' });
      await sleep(400);

      const result = await runTap(
        ['observe', 'test-service', '--last', '20', '--stream', 'stderr', '--format', 'json'],
        { cwd: testDir }
      );

      expect(result.code).toBe(0);
      const response = JSON.parse(result.stdout);
      // All events should be from stderr
      for (const event of response.events) {
        expect(event.stream).toBe('stderr');
      }
    });
  });

  describe('tap status', () => {
    it('returns status for running service', async () => {
      await startService('test-service', { forever: true, delay: 100 });

      const result = await runTap(
        ['status', 'test-service', '--format', 'json'],
        { cwd: testDir }
      );

      expect(result.code).toBe(0);
      const status = JSON.parse(result.stdout);
      expect(status.name).toBe('test-service');
      expect(status.child_state).toBe('running');
      expect(status.runner_pid).toBeGreaterThan(0);
      expect(status.child_pid).toBeGreaterThan(0);
      expect(status.uptime_ms).toBeGreaterThanOrEqual(0);
    });

    it('supports text format', async () => {
      await startService('test-service', { forever: true, delay: 100 });

      const result = await runTap(
        ['status', 'test-service', '--format', 'text'],
        { cwd: testDir }
      );

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Name: test-service');
      expect(result.stdout).toContain('State: running');
      expect(result.stdout).toContain('Runner PID:');
    });

    it('fails for non-existent service', async () => {
      const result = await runTap(
        ['status', 'nonexistent', '--format', 'json'],
        { cwd: testDir }
      );

      expect(result.code).not.toBe(0);
      const error = JSON.parse(result.stderr);
      expect(error.error).toBe('no_runner');
    });
  });

  describe('tap stop', () => {
    it('stops a running service', async () => {
      const socketPath = join(tapDir, 'test-service.sock');
      const proc = await startService('test-service', { forever: true, logSignals: true, delay: 100 });

      // Stop the service
      const stopResult = await runTap(
        ['stop', 'test-service', '--format', 'json'],
        { cwd: testDir }
      );

      expect(stopResult.code).toBe(0);

      // Wait for process to exit
      await new Promise<void>((resolve) => {
        proc.on('exit', () => resolve());
        setTimeout(resolve, 2000); // Timeout fallback
      });

      // Socket should be cleaned up
      await sleep(100);
      expect(existsSync(socketPath)).toBe(false);
    });

    it('supports text format', async () => {
      await startService('test-service', { forever: true, delay: 100 });

      const result = await runTap(
        ['stop', 'test-service', '--format', 'text'],
        { cwd: testDir }
      );

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Stopped test-service');
    });
  });

  describe('tap restart', () => {
    it('restarts the child process with new PID', async () => {
      await startService('test-service', { forever: true, delay: 100 });

      // Get initial status
      const statusBefore = await runTap(
        ['status', 'test-service', '--format', 'json'],
        { cwd: testDir }
      );
      const pidBefore = JSON.parse(statusBefore.stdout).child_pid;

      // Restart
      const restartResult = await runTap(
        ['restart', 'test-service', '--format', 'json'],
        { cwd: testDir, timeout: 10000 }
      );

      expect(restartResult.code).toBe(0);
      const restartResponse = JSON.parse(restartResult.stdout);
      expect(restartResponse.ready).toBe(true);

      // Get new status
      const statusAfter = await runTap(
        ['status', 'test-service', '--format', 'json'],
        { cwd: testDir }
      );
      const pidAfter = JSON.parse(statusAfter.stdout).child_pid;

      // PID should have changed
      expect(pidAfter).not.toBe(pidBefore);
    });

    it('waits for --ready pattern on restart', async () => {
      await startService('test-service', {
        forever: true,
        delay: 30,
        readyAfter: 3,
        readyText: 'RESTARTED_READY',
      });

      // Restart with ready pattern
      const result = await runTap(
        ['restart', 'test-service', '--ready', 'RESTARTED_READY', '--format', 'json'],
        { cwd: testDir, timeout: 15000 }
      );

      expect(result.code).toBe(0);
      const response = JSON.parse(result.stdout);
      expect(response.ready).toBe(true);
      expect(response.ready_match).toContain('RESTARTED_READY');
    });

    it('clears logs with --clear-logs', async () => {
      await startService('test-service', { forever: true, delay: 50 });
      await sleep(800); // Let logs accumulate

      // Verify we have logs
      const beforeResult = await runTap(
        ['observe', 'test-service', '--last', '100', '--format', 'json'],
        { cwd: testDir }
      );
      const beforeCount = JSON.parse(beforeResult.stdout).events.length;
      expect(beforeCount).toBeGreaterThan(0);

      // Restart with --clear-logs
      await runTap(
        ['restart', 'test-service', '--clear-logs', '--format', 'json'],
        { cwd: testDir, timeout: 10000 }
      );

      // Logs should be cleared (or have very few new ones)
      const afterResult = await runTap(
        ['observe', 'test-service', '--last', '100', '--format', 'json'],
        { cwd: testDir }
      );
      const afterCount = JSON.parse(afterResult.stdout).events.length;

      // After clear, should have fewer logs than before
      expect(afterCount).toBeLessThan(beforeCount);
    });
  });
}, { timeout: 60000 });
