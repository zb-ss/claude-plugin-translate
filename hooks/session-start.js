#!/usr/bin/env node
/**
 * Session Start — Translate workflow auto-resume hook (SessionStart event)
 *
 * Scans for active translate workflows and injects context into the session
 * via additionalContext. Writes a session marker for session-scoped tracking.
 *
 * Always exits 0 — never blocks session startup.
 */

const fs = require('fs');

try {
  const { getActiveTranslateWorkflow, writeSessionMarker, getViewCounts } = require('./lib/state');
  const { log } = require('./lib/logger');

  // Read stdin (hook input JSON)
  let input = {};
  try {
    const stdin = fs.readFileSync(0, 'utf8').trim();
    if (stdin) input = JSON.parse(stdin);
  } catch {}

  // Write session marker so hooks can discover the session_id
  const sessionId = input.session_id;
  if (sessionId) {
    writeSessionMarker(sessionId);
  }

  // Scan for active translate workflows
  const active = getActiveTranslateWorkflow();

  if (!active) {
    process.exit(0);
  }

  const { state } = active;
  const counts = getViewCounts(state);

  const contextParts = [
    '## Active Translation Workflow',
    '',
    `There is an active translation workflow. Use \`/translate:auto --resume\` to continue.`,
    '',
    `- **${state.id}** — ${state.componentName} to ${state.targetLanguage}`,
    `  - Status: ${state.status}`,
    `  - Progress: ${counts.done}/${counts.total} views done (${counts.pending} pending, ${counts.error} errors)`,
  ];

  if (sessionId) {
    contextParts.push(`  - Session ID: ${sessionId}`);
  }

  log('session-start', `Found active workflow ${state.id}: ${counts.done}/${counts.total} done`);

  const output = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: contextParts.join('\n'),
    },
  });

  process.stdout.write(output);
  process.exit(0);

} catch (err) {
  // Never block session startup
  try {
    const { log } = require('./lib/logger');
    log('session-start', `Error (allowing start): ${err.message}`);
  } catch {}
  process.exit(0);
}
