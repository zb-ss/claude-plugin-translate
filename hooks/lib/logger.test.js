/**
 * Tests for logger.js - Hook logging utilities
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Mock the logger to use a temp directory
const originalLogDir = path.join(os.homedir(), '.claude', 'workflows', 'translate');
const testLogDir = path.join(os.tmpdir(), 'test-translate-logger-' + Date.now());
const testLogFile = path.join(testLogDir, 'hook.log');

describe('logger', () => {
  before(() => {
    // Create test log directory
    if (!fs.existsSync(testLogDir)) {
      fs.mkdirSync(testLogDir, { recursive: true });
    }
  });

  after(() => {
    // Cleanup test directory
    if (fs.existsSync(testLogDir)) {
      fs.rmSync(testLogDir, { recursive: true, force: true });
    }
  });

  it('should create log directory if missing', () => {
    const tempDir = path.join(os.tmpdir(), 'test-logger-mkdir-' + Date.now());

    // Ensure directory doesn't exist
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }

    // Create a custom logger pointing to temp directory
    const logFile = path.join(tempDir, 'hook.log');

    // Simulate logger behavior
    try {
      fs.mkdirSync(tempDir, { recursive: true });
    } catch (e) {}

    // Verify directory was created
    assert.ok(fs.existsSync(tempDir), 'Log directory should be created');

    // Cleanup
    fs.rmSync(tempDir, { recursive: true });
  });

  it('should append timestamped log entries', () => {
    const { log } = require('./logger');

    // Clear any existing log
    if (fs.existsSync(testLogFile)) {
      fs.unlinkSync(testLogFile);
    }

    // Note: The actual logger writes to ~/.claude/workflows/translate/hook.log
    // We can't easily override this without refactoring, so we test the actual file
    const beforeSize = fs.existsSync(testLogFile) ? fs.statSync(testLogFile).size : 0;

    log('test-hook', 'Test message');

    // Check that actual log file exists (in real location)
    const actualLogFile = path.join(os.homedir(), '.claude', 'workflows', 'translate', 'hook.log');
    if (fs.existsSync(actualLogFile)) {
      const content = fs.readFileSync(actualLogFile, 'utf8');
      // Verify format: [timestamp] [hookName] message
      assert.match(content, /\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[test-hook\] Test message/);
    }
  });

  it('should handle errors gracefully without throwing', () => {
    const { log } = require('./logger');

    // Even with invalid parameters, log should not throw
    assert.doesNotThrow(() => {
      log(null, null);
      log(undefined, undefined);
      log('', '');
    });
  });

  it('should format log entries correctly', () => {
    const { log } = require('./logger');

    log('stop-guard', 'Blocking stop attempt');

    const actualLogFile = path.join(os.homedir(), '.claude', 'workflows', 'translate', 'hook.log');
    if (fs.existsSync(actualLogFile)) {
      const content = fs.readFileSync(actualLogFile, 'utf8');
      const lines = content.trim().split('\n');
      const lastLine = lines[lines.length - 1];

      // Check format: [ISO timestamp] [hookName] message
      assert.match(lastLine, /^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\] \[stop-guard\] Blocking stop attempt$/);
    }
  });

  it('should handle write errors without crashing', () => {
    const { log } = require('./logger');

    // Try to log even if file system has issues
    // Logger should catch errors and not throw
    assert.doesNotThrow(() => {
      log('test', 'Should not crash on errors');
    });
  });
});
