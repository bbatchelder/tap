import * as pty from 'node-pty';
import { spawn, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { ChildState } from '../protocol/types.js';

export interface ChildConfig {
  command: string[];
  cwd: string;
  env: Record<string, string>;
  usePty: boolean;
}

export interface ChildStateInfo {
  pid: number | null;
  state: ChildState;
  exitCode: number | null;
  exitSignal: string | null;
}

export interface ChildEvents {
  line: { text: string; stream: 'combined' | 'stdout' | 'stderr' };
  exit: { exitCode: number | null; signal: string | null };
  data: { data: string; stream: 'combined' | 'stdout' | 'stderr' };
}

/**
 * Manages a child process with optional PTY support.
 * Emits 'line' events for complete log lines and 'exit' events when the child exits.
 */
export class ChildManager extends EventEmitter {
  private ptyProcess: pty.IPty | null = null;
  private childProcess: ChildProcess | null = null;
  private config: ChildConfig;
  private state: ChildStateInfo;
  private lineBuffer: Record<string, string> = {
    combined: '',
    stdout: '',
    stderr: '',
  };

  constructor(config: ChildConfig) {
    super();
    this.config = config;
    this.state = {
      pid: null,
      state: 'stopped',
      exitCode: null,
      exitSignal: null,
    };
  }

  /**
   * Start the child process.
   */
  start(): void {
    this.state.state = 'starting';
    this.state.exitCode = null;
    this.state.exitSignal = null;

    // Reset line buffers
    this.lineBuffer = { combined: '', stdout: '', stderr: '' };

    if (this.config.usePty) {
      this.startPty();
    } else {
      this.startPipe();
    }
  }

  private startPty(): void {
    // Use shell to handle command resolution and proper environment
    const shell = process.env.SHELL || '/bin/bash';
    const shellCommand = this.config.command.map(arg => {
      // Escape single quotes in arguments
      return `'${arg.replace(/'/g, "'\\''")}'`;
    }).join(' ');

    try {
      this.ptyProcess = pty.spawn(shell, ['-c', shellCommand], {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd: this.config.cwd,
        env: { ...process.env, ...this.config.env },
      });
    } catch (err) {
      this.state.state = 'exited';
      this.state.exitCode = 1;
      throw new Error(`Failed to spawn PTY: ${err instanceof Error ? err.message : err}`);
    }

    this.state.pid = this.ptyProcess.pid;
    this.state.state = 'running';

    this.ptyProcess.onData((data) => {
      this.emit('data', { data, stream: 'combined' });
      this.processOutput(data, 'combined');
    });

    this.ptyProcess.onExit(({ exitCode, signal }) => {
      this.state.state = 'exited';
      this.state.exitCode = exitCode;
      this.state.exitSignal = signal !== undefined ? String(signal) : null;
      this.flushLineBuffer('combined');
      this.emit('exit', { exitCode, signal: this.state.exitSignal });
    });
  }

  private startPipe(): void {
    const [cmd, ...args] = this.config.command;

    this.childProcess = spawn(cmd, args, {
      cwd: this.config.cwd,
      env: { ...process.env, ...this.config.env },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.state.pid = this.childProcess.pid ?? null;
    this.state.state = 'running';

    this.childProcess.stdout?.on('data', (chunk: Buffer) => {
      const data = chunk.toString();
      this.emit('data', { data, stream: 'stdout' });
      this.processOutput(data, 'stdout');
    });

    this.childProcess.stderr?.on('data', (chunk: Buffer) => {
      const data = chunk.toString();
      this.emit('data', { data, stream: 'stderr' });
      this.processOutput(data, 'stderr');
    });

    this.childProcess.on('exit', (code, signal) => {
      this.state.state = 'exited';
      this.state.exitCode = code;
      this.state.exitSignal = signal;
      this.flushLineBuffer('stdout');
      this.flushLineBuffer('stderr');
      this.emit('exit', { exitCode: code, signal });
    });

    this.childProcess.on('error', (err) => {
      this.state.state = 'exited';
      this.state.exitCode = 1;
      this.state.exitSignal = null;
      this.emit('exit', { exitCode: 1, signal: null });
    });
  }

  private processOutput(data: string, stream: 'combined' | 'stdout' | 'stderr'): void {
    this.lineBuffer[stream] += data;
    const lines = this.lineBuffer[stream].split('\n');
    this.lineBuffer[stream] = lines.pop() ?? '';

    for (const line of lines) {
      // Remove carriage returns from PTY output
      const cleanLine = line.replace(/\r$/, '');
      this.emit('line', { text: cleanLine, stream });
    }
  }

  private flushLineBuffer(stream: 'combined' | 'stdout' | 'stderr'): void {
    if (this.lineBuffer[stream]) {
      const cleanLine = this.lineBuffer[stream].replace(/\r$/, '');
      this.emit('line', { text: cleanLine, stream });
      this.lineBuffer[stream] = '';
    }
  }

  /**
   * Stop the child process.
   */
  async stop(graceMs: number = 2000): Promise<void> {
    const pid = this.state.pid;
    if (!pid || this.state.state !== 'running') {
      return;
    }

    // Send SIGTERM to process group (negative pid)
    try {
      process.kill(-pid, 'SIGTERM');
    } catch (err: unknown) {
      // ESRCH means process already dead
      if ((err as NodeJS.ErrnoException).code === 'ESRCH') {
        this.cleanup();
        return;
      }
      // Try killing just the process if process group fails
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        this.cleanup();
        return;
      }
    }

    // Wait for graceful exit or timeout
    const exitPromise = new Promise<void>((resolve) => {
      const onExit = () => {
        this.removeListener('exit', onExit);
        resolve();
      };
      this.once('exit', onExit);
    });

    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(resolve, graceMs);
    });

    await Promise.race([exitPromise, timeoutPromise]);

    // If still running, send SIGKILL
    if (this.state.state === 'running') {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // Process already dead
        }
      }

      // Wait a bit more for SIGKILL to take effect
      await new Promise((r) => setTimeout(r, 100));
    }

    this.cleanup();
  }

  private cleanup(): void {
    this.ptyProcess = null;
    this.childProcess = null;
    this.state.state = 'stopped';
  }

  /**
   * Get the current state of the child process.
   */
  getState(): ChildStateInfo {
    return { ...this.state };
  }

  /**
   * Get the current configuration.
   */
  getConfig(): ChildConfig {
    return { ...this.config };
  }
}
