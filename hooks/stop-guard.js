#!/usr/bin/env node
/**
 * Stop Guard for Translation Workflow
 *
 * Prevents Claude from stopping when views remain unprocessed.
 * 3-layer infinite loop prevention:
 *   1. Circuit breaker (stop_hook_active)
 *   2. Session counter (max 5 consecutive blocks)
 *   3. Staleness detection (updated_at unchanged 3x)
 *
 * Exit 0 = allow stop. JSON { decision: "block", reason } = block stop.
 * On ANY error, exits 0 (never break a session).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

try {
  const { getWorkflowForSession, workflowFullyComplete, getPendingViews, getViewCounts } = require('./lib/state');
  const { log } = require('./lib/logger');

  // Read stdin
  let input = {};
  try {
    const stdin = fs.readFileSync(0, 'utf8').trim();
    if (stdin) input = JSON.parse(stdin);
  } catch {}

  // Layer 1: Circuit breaker
  if (input.stop_hook_active === true) {
    log('stop-guard', 'Circuit breaker active, allowing stop');
    process.exit(0);
  }

  // Check for active workflow (session-scoped with fallback)
  const sessionId = input.session_id || 'unknown';
  const active = getWorkflowForSession(sessionId);
  if (!active) {
    process.exit(0);
  }

  const { state } = active;

  // Allow stop if workflow fully complete (all views done AND completion guard passed)
  if (workflowFullyComplete(state)) {
    log('stop-guard', `Workflow fully complete for ${state.id}, allowing stop`);
    process.exit(0);
  }

  // Layer 2: Session counter (max 5)
  const counterFile = path.join(os.tmpdir(), `translate-stop-${sessionId}.count`);
  const staleFile = path.join(os.tmpdir(), `translate-stop-${sessionId}.stale`);

  let counter = 0;
  try {
    if (fs.existsSync(counterFile)) {
      counter = parseInt(fs.readFileSync(counterFile, 'utf8').trim(), 10) || 0;
    }
  } catch {}

  if (counter >= 5) {
    log('stop-guard', `Safety valve: ${counter} consecutive blocks, allowing stop`);
    try { fs.unlinkSync(counterFile); } catch {}
    process.exit(0);
  }

  // Layer 3: Staleness detection
  const currentUpdatedAt = state.updated || '';
  let staleCount = 0;
  try {
    if (fs.existsSync(staleFile)) {
      const staleData = JSON.parse(fs.readFileSync(staleFile, 'utf8'));
      if (staleData.updated_at === currentUpdatedAt) {
        staleCount = (staleData.count || 0) + 1;
      }
    }
  } catch {}

  if (staleCount >= 3) {
    log('stop-guard', `Staleness detected, allowing stop`);
    try { fs.unlinkSync(staleFile); } catch {}
    try { fs.unlinkSync(counterFile); } catch {}
    process.exit(0);
  }

  // Update counters
  try {
    fs.writeFileSync(counterFile, String(counter + 1), 'utf8');
    fs.writeFileSync(staleFile, JSON.stringify({
      updated_at: currentUpdatedAt,
      count: staleCount,
    }), 'utf8');
  } catch {}

  // Block the stop
  const counts = getViewCounts(state);
  const pending = getPendingViews(state);
  const pendingPaths = pending.slice(0, 3).map(v => v.relativePath || v.path).join(', ');
  const more = pending.length > 3 ? ` (+${pending.length - 3} more)` : '';

  const reason = [
    `Cannot stop. Active translation "${state.id}" has ${counts.total - counts.done}/${counts.total} views incomplete.`,
    `Pending: ${pendingPaths}${more}.`,
    `Continue processing views or use --force to override.`,
    `(Block ${counter + 1}/5 - safety valve at 5)`,
  ].join(' ');

  log('stop-guard', `Blocking: ${counts.done}/${counts.total} done (${counter + 1}/5)`);

  const output = JSON.stringify({ decision: 'block', reason });
  process.stdout.write(output);
  process.exit(0);

} catch (err) {
  try {
    const { log } = require('./lib/logger');
    log('stop-guard', `Error (allowing stop): ${err.message}`);
  } catch {}
  process.exit(0);
}
