/**
 * Shared state library for translate workflow hooks.
 * Reads workflow-state.json from the translate workflow directory.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const TRANSLATE_DIR = path.join(os.homedir(), '.claude', 'workflows', 'translate');

/**
 * Validate a file path to prevent traversal attacks.
 * Only allows paths under ~/.claude/workflows/translate/ or os.tmpdir().
 */
function validatePath(filePath) {
  if (!filePath || typeof filePath !== 'string') return null;

  const dangerousPatterns = [
    /\.\.[\/\\]/,
    /[<>|"'`$(){}]/,
    /\0/,
    /^[\/\\]{2}/,
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(filePath)) return null;
  }

  try {
    const resolved = path.resolve(filePath);
    const allowedRoots = [
      path.resolve(TRANSLATE_DIR),
      path.resolve(os.tmpdir()),
    ];

    const isAllowed = allowedRoots.some(root => {
      const normalizedRoot = root.endsWith(path.sep) ? root : root + path.sep;
      return resolved === root || resolved.startsWith(normalizedRoot);
    });

    return isAllowed ? resolved : null;
  } catch {
    return null;
  }
}

/**
 * Find the most recently updated active translate workflow.
 * Returns { path, state } or null.
 */
function getActiveTranslateWorkflow() {
  try {
    if (!fs.existsSync(TRANSLATE_DIR)) return null;

    const dirs = fs.readdirSync(TRANSLATE_DIR).filter(d => {
      const statePath = path.join(TRANSLATE_DIR, d, 'workflow-state.json');
      return fs.existsSync(statePath);
    });

    if (dirs.length === 0) return null;

    let latest = null;
    let latestTime = 0;

    for (const dir of dirs) {
      const statePath = validatePath(path.join(TRANSLATE_DIR, dir, 'workflow-state.json'));
      if (!statePath) continue;
      try {
        const content = fs.readFileSync(statePath, 'utf8');
        const state = JSON.parse(content);

        if (state.status === 'complete') continue;

        const updated = new Date(state.updated || 0).getTime();
        if (updated > latestTime) {
          latestTime = updated;
          latest = { path: statePath, state };
        }
      } catch {
        // Skip corrupt state files
      }
    }

    return latest;
  } catch {
    return null;
  }
}

/**
 * Check if all views are done (workflow can complete).
 */
function allViewsDone(state) {
  if (!state || !state.views || state.views.length === 0) return false;
  return state.views.every(v => v.status === 'done');
}

/**
 * Check if workflow is fully complete (all views done AND completion guard passed).
 */
function workflowFullyComplete(state) {
  return allViewsDone(state) &&
    state.gates?.completion_guard?.status === 'passed';
}

/**
 * Get views that have not passed verification.
 */
function getPendingViews(state) {
  if (!state || !state.views) return [];
  return state.views.filter(v => v.status !== 'done');
}

/**
 * Get count of views in each status.
 */
function getViewCounts(state) {
  if (!state || !state.views) return { total: 0, done: 0, pending: 0, error: 0, processing: 0 };
  return {
    total: state.views.length,
    done: state.views.filter(v => v.status === 'done').length,
    pending: state.views.filter(v => v.status === 'pending').length,
    error: state.views.filter(v => v.status === 'error').length,
    processing: state.views.filter(v => v.status === 'processing' || v.status === 'review').length,
  };
}

/**
 * Write a session marker file so hooks can discover the session_id.
 * Writes /tmp/translate-session-marker-{sessionId}.json.
 */
function writeSessionMarker(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') return false;
  const markerPath = path.join(os.tmpdir(), `translate-session-marker-${sessionId}.json`);
  try {
    const content = JSON.stringify({ session_id: sessionId, timestamp: new Date().toISOString() }) + '\n';
    fs.writeFileSync(markerPath, content, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Bind a session to a specific translate workflow.
 * Writes /tmp/translate-binding-{sessionId}.json.
 */
function bindSessionToWorkflow(sessionId, workflowPath, workflowId) {
  if (!sessionId || !workflowPath) return false;
  const bindingPath = path.join(os.tmpdir(), `translate-binding-${sessionId}.json`);
  try {
    const content = JSON.stringify({
      session_id: sessionId,
      workflow_path: workflowPath,
      workflow_id: workflowId || null,
      bound_at: new Date().toISOString(),
    }) + '\n';
    fs.writeFileSync(bindingPath, content, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the translate workflow bound to a session.
 * Reads the binding file, loads the state, and returns { path, state }.
 * Falls back to getActiveTranslateWorkflow() ONLY if no binding file exists.
 * If a binding exists but the workflow is complete, returns null — never
 * cross-pollinate by finding another session's workflow.
 */
function getWorkflowForSession(sessionId) {
  if (sessionId && typeof sessionId === 'string') {
    const bindingPath = path.join(os.tmpdir(), `translate-binding-${sessionId}.json`);
    try {
      if (fs.existsSync(bindingPath)) {
        const binding = JSON.parse(fs.readFileSync(bindingPath, 'utf8'));
        if (binding.workflow_path) {
          const validated = validatePath(binding.workflow_path);
          if (validated) {
            const content = fs.readFileSync(validated, 'utf8');
            const state = JSON.parse(content);
            if (state && state.status !== 'complete') {
              return { path: validated, state };
            }
          }
        }
        // Binding exists but workflow is complete — this session is done.
        // Do NOT fall through to global discovery (would find another session's workflow).
        return null;
      }
    } catch {
      // Fall through to getActiveTranslateWorkflow()
    }
  }
  // No binding file — this session has never called workflow_translate_init,
  // so it is NOT a translate session. Return null to avoid blocking unrelated
  // sessions with another session's workflow.
  // Only fall back to global discovery for sessions without a sessionId at all
  // (backward compat for very old callers).
  if (sessionId) {
    return null;
  }
  return getActiveTranslateWorkflow();
}

/**
 * Clean up all translate-related temp files for a session.
 * Returns the number of files removed.
 */
function cleanupSessionTempFiles(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') return 0;

  const tmpDir = os.tmpdir();
  const exactFiles = [
    `translate-session-marker-${sessionId}.json`,
    `translate-binding-${sessionId}.json`,
    `translate-stop-${sessionId}.count`,
    `translate-stop-${sessionId}.stale`,
  ];

  let cleaned = 0;

  for (const name of exactFiles) {
    const filePath = path.join(tmpDir, name);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        cleaned++;
      }
    } catch {
      // Best-effort cleanup
    }
  }

  return cleaned;
}

module.exports = {
  TRANSLATE_DIR,
  validatePath,
  getActiveTranslateWorkflow,
  writeSessionMarker,
  bindSessionToWorkflow,
  getWorkflowForSession,
  cleanupSessionTempFiles,
  allViewsDone,
  workflowFullyComplete,
  getPendingViews,
  getViewCounts,
};
