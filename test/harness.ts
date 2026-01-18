#!/usr/bin/env npx tsx
/**
 * Test harness script for integration testing.
 * Produces predictable, controllable output for testing tap CLI.
 *
 * Usage:
 *   npx tsx test/harness.ts --lines 10 --delay 100
 *   npx tsx test/harness.ts --lines 5 --stream stderr
 *   npx tsx test/harness.ts --ready-after 3 --ready-text "Server ready"
 *   npx tsx test/harness.ts --forever --log-signals
 *   npx tsx test/harness.ts --exit-code 1 --exit-after 5
 */

import { parseArgs } from 'node:util';

interface HarnessOptions {
  lines: number;
  delay: number;
  stream: 'stdout' | 'stderr' | 'both';
  readyAfter: number | null;
  readyText: string;
  forever: boolean;
  logSignals: boolean;
  exitCode: number;
  exitAfter: number | null;
}

function parseOptions(): HarnessOptions {
  const { values } = parseArgs({
    options: {
      lines: { type: 'string', short: 'l', default: '10' },
      delay: { type: 'string', short: 'd', default: '10' },
      stream: { type: 'string', short: 's', default: 'stdout' },
      'ready-after': { type: 'string' },
      'ready-text': { type: 'string', default: 'READY' },
      forever: { type: 'boolean', short: 'f', default: false },
      'log-signals': { type: 'boolean', default: false },
      'exit-code': { type: 'string', default: '0' },
      'exit-after': { type: 'string' },
    },
    strict: true,
  });

  const stream = values.stream as string;
  if (stream !== 'stdout' && stream !== 'stderr' && stream !== 'both') {
    throw new Error(`Invalid stream: ${stream}. Must be stdout, stderr, or both`);
  }

  return {
    lines: parseInt(values.lines as string, 10),
    delay: parseInt(values.delay as string, 10),
    stream,
    readyAfter: values['ready-after'] ? parseInt(values['ready-after'] as string, 10) : null,
    readyText: values['ready-text'] as string,
    forever: values.forever as boolean,
    logSignals: values['log-signals'] as boolean,
    exitCode: parseInt(values['exit-code'] as string, 10),
    exitAfter: values['exit-after'] ? parseInt(values['exit-after'] as string, 10) : null,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function writeLine(text: string, stream: 'stdout' | 'stderr' | 'both'): void {
  if (stream === 'stdout' || stream === 'both') {
    process.stdout.write(text + '\n');
  }
  if (stream === 'stderr' || stream === 'both') {
    process.stderr.write(text + '\n');
  }
}

function setupSignalHandlers(logSignals: boolean): void {
  const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGHUP'];

  for (const signal of signals) {
    process.on(signal, () => {
      if (logSignals) {
        process.stdout.write(`SIGNAL:${signal}\n`);
      }
      process.exit(0);
    });
  }
}

async function main(): Promise<void> {
  const opts = parseOptions();

  if (opts.logSignals) {
    setupSignalHandlers(true);
  } else {
    // Default signal handling - exit cleanly
    setupSignalHandlers(false);
  }

  let lineCount = 0;

  const emitLine = (): void => {
    lineCount++;
    const timestamp = new Date().toISOString();
    writeLine(`[${timestamp}] line ${lineCount}`, opts.stream);

    // Emit ready text after specified number of lines
    if (opts.readyAfter !== null && lineCount === opts.readyAfter) {
      writeLine(opts.readyText, opts.stream);
    }

    // Exit after specified number of lines
    if (opts.exitAfter !== null && lineCount >= opts.exitAfter) {
      process.exit(opts.exitCode);
    }
  };

  if (opts.forever) {
    // Run until signaled
    while (true) {
      emitLine();
      await sleep(opts.delay);
    }
  } else {
    // Emit specified number of lines
    for (let i = 0; i < opts.lines; i++) {
      emitLine();
      if (i < opts.lines - 1) {
        await sleep(opts.delay);
      }
    }
    process.exit(opts.exitCode);
  }
}

main().catch(err => {
  console.error('Harness error:', err);
  process.exit(1);
});
