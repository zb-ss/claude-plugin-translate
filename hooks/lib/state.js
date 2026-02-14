/**
 * Shared state library for translate workflow hooks.
 * Reads workflow-state.json from the translate workflow directory.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const TRANSLATE_DIR = path.join(os.homedir(), '.claude', 'workflows', 'translate');

/**
 * Validate that a file path is within the translate workflow directory.
 */
function validatePath(filePath) {
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(TRANSLATE_DIR)) {
    throw new Error(`Path ${filePath} is outside translate workflow directory`);
  }
  return resolved;
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

module.exports = {
  TRANSLATE_DIR,
  getActiveTranslateWorkflow,
  allViewsDone,
  workflowFullyComplete,
  getPendingViews,
  getViewCounts,
};
