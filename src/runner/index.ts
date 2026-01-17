import { RingBuffer } from './ring-buffer.js';
import { ChildManager, ChildConfig } from './child.js';
import { RunnerServer } from './server.js';
import { setupSignalHandlers } from './signals.js';
import { ensureTapDir, getSocketPath } from '../utils/paths.js';

export interface RunnerConfig {
  name: string;
  tapDir: string;
  command: string[];
  cwd: string;
  env: Record<string, string>;
  usePty: boolean;
  forward: boolean;
  bufferLines: number;
  bufferBytes: number;
  printConnection: boolean;
  readyPattern?: string;
  readyRegex?: string;
}

/**
 * Start the runner with the given configuration.
 */
export async function startRunner(config: RunnerConfig): Promise<void> {
  // Ensure tap directory exists
  await ensureTapDir(config.tapDir);

  const socketPath = getSocketPath(config.tapDir, config.name);

  // Create ring buffer
  const ringBuffer = new RingBuffer(config.bufferLines, config.bufferBytes);

  // Create child config
  const childConfig: ChildConfig = {
    command: config.command,
    cwd: config.cwd,
    env: config.env,
    usePty: config.usePty,
  };

  // Create child manager
  const childManager = new ChildManager(childConfig);

  // Create server
  const server = new RunnerServer({
    socketPath,
    name: config.name,
    ringBuffer,
    childManager,
    usePty: config.usePty,
    forward: config.forward,
  });

  // Set up signal handlers
  setupSignalHandlers(childManager, server);

  // Wire up child output to ring buffer and optional forwarding
  childManager.on('line', ({ text, stream }) => {
    ringBuffer.append(text, stream);
  });

  if (config.forward) {
    childManager.on('data', ({ data }) => {
      process.stdout.write(data);
    });
  }

  // Track readiness
  let readyMatched = false;
  const readyPattern = config.readyPattern ?? config.readyRegex;
  const isRegex = !!config.readyRegex;

  if (readyPattern) {
    childManager.on('line', ({ text }) => {
      if (readyMatched) return;

      let matches = false;
      if (isRegex) {
        matches = new RegExp(readyPattern, 'i').test(text);
      } else {
        matches = text.toLowerCase().includes(readyPattern.toLowerCase());
      }

      if (matches) {
        readyMatched = true;
        console.error(`READY: Pattern matched in output`);
      }
    });
  }

  // Handle child exit
  childManager.on('exit', ({ exitCode, signal }) => {
    const reason = signal ? `signal ${signal}` : `code ${exitCode}`;
    console.error(`Child process exited (${reason})`);
    ringBuffer.insertMarker(`--- child exited (${reason}) ---`);
  });

  // Start the server first
  try {
    await server.start();
  } catch (err) {
    console.error(`Failed to start server: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  // Print connection info if requested
  if (config.printConnection) {
    console.error(`tap: socket=${socketPath} pid=${process.pid}`);
  }

  // Start the child process
  childManager.start();

  const childState = childManager.getState();
  console.error(`Started child process (pid=${childState.pid})`);
}

export { RingBuffer } from './ring-buffer.js';
export { ChildManager } from './child.js';
export { RunnerServer } from './server.js';
