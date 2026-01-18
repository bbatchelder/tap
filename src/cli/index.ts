import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCommand } from './run.js';
import { observeCommand } from './observe.js';
import { restartCommand } from './restart.js';
import { stopCommand } from './stop.js';
import { statusCommand } from './status.js';
import { lsCommand } from './ls.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, '..', '..');

// Handle --skill before parsing
if (process.argv.includes('--skill')) {
  const skillPath = join(packageRoot, 'skill.md');
  console.log(readFileSync(skillPath, 'utf-8'));
  process.exit(0);
}

const program = new Command();

program
  .name('tap')
  .description('Process supervisor with queryable logs. LLMs: try "tap --skill" for usage guide.')
  .version('0.1.0');

// Register commands
runCommand(program);
observeCommand(program);
restartCommand(program);
stopCommand(program);
statusCommand(program);
lsCommand(program);

program.parse();
