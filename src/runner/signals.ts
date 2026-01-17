import { ChildManager } from './child.js';
import { RunnerServer } from './server.js';

/**
 * Set up signal handlers for graceful shutdown.
 */
export function setupSignalHandlers(
  childManager: ChildManager,
  server: RunnerServer
): void {
  let isShuttingDown = false;

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.error(`\nReceived ${signal}, shutting down...`);

    try {
      await childManager.stop(2000);
    } catch (err) {
      console.error('Error stopping child:', err);
    }

    server.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Handle uncaught errors gracefully
  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    shutdown('uncaughtException').catch(() => process.exit(1));
  });

  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
    // Don't exit on unhandled rejection, just log it
  });
}
