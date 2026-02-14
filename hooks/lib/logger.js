/**
 * Simple logger for translate hooks.
 * Writes to ~/.claude/workflows/translate/hook.log for debugging.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const LOG_DIR = path.join(os.homedir(), '.claude', 'workflows', 'translate');
const LOG_FILE = path.join(LOG_DIR, 'hook.log');

// Ensure directory exists
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (e) {}

function log(hookName, message) {
  try {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] [${hookName}] ${message}\n`;
    fs.appendFileSync(LOG_FILE, entry, 'utf8');
  } catch {
    // Never fail on logging
  }
}

module.exports = { log, LOG_FILE };
