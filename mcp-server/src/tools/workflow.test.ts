/**
 * Tests for workflow.ts - Workflow state transitions and gate enforcement
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, unlinkSync, existsSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import {
  executeWorkflowNext,
  executeWorkflowGateUpdate,
  type WorkflowNextArgs,
  type WorkflowGateUpdateArgs
} from './workflow'

// Helper to get workflow directory
function getTestWorkflowDir() {
  return join(homedir(), '.claude/workflows/translate')
}

// Helper to create test workflow state
function createTestWorkflow(id: string, views: any[], status: string = 'processing', gates?: any) {
  const workflowDir = getTestWorkflowDir()
  const workflowPath = join(workflowDir, id)
  const statePath = join(workflowPath, 'workflow-state.json')

  mkdirSync(workflowPath, { recursive: true })

  const state = {
    id,
    componentPath: '/test/component',
    componentName: 'testcomponent',
    targetLanguage: 'fr-CA',
    sourceLanguage: 'en-GB',
    sourceIniPath: '/test/en-GB.ini',
    targetIniPath: '/test/fr-CA.ini',
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    status,
    currentViewIndex: 0,
    views,
    totalStringsConverted: 0,
    totalErrors: 0,
    ...(gates && { gates })
  }

  writeFileSync(statePath, JSON.stringify(state, null, 2))
  return { workflowPath, statePath }
}

function cleanupTestWorkflow(id: string) {
  const workflowPath = join(getTestWorkflowDir(), id)
  if (existsSync(workflowPath)) {
    rmSync(workflowPath, { recursive: true, force: true })
  }
}

describe('executeWorkflowNext', () => {
  const testWorkflowId = 'test-workflow-next-' + Date.now()

  afterEach(() => {
    cleanupTestWorkflow(testWorkflowId)
  })

  it('should return next pending view when available', async () => {
    createTestWorkflow(testWorkflowId, [
      { path: '/a.php', relativePath: 'a.php', status: 'done', lines: 100, needsChunking: false, attempts: 0, errors: [], stringsFound: 10, stringsConverted: 10 },
      { path: '/b.php', relativePath: 'b.php', status: 'pending', lines: 150, needsChunking: false, attempts: 0, errors: [], stringsFound: 0, stringsConverted: 0 },
      { path: '/c.php', relativePath: 'c.php', status: 'pending', lines: 200, needsChunking: false, attempts: 0, errors: [], stringsFound: 0, stringsConverted: 0 },
    ])

    const args: WorkflowNextArgs = { workflowId: testWorkflowId }
    const result = await executeWorkflowNext(args)
    const data = JSON.parse(result)

    expect(data.success).toBe(true)
    expect(data.view).toBeDefined()
    expect(data.view.relativePath).toBe('b.php')
    expect(data.view.path).toBe('/b.php')
    expect(data.view.lines).toBe(150)
    expect(data.view.attempt).toBe(1) // attempts incremented to 1 when view marked as processing
  })

  it('should set status to "verification" when all views done', async () => {
    createTestWorkflow(testWorkflowId, [
      { path: '/a.php', relativePath: 'a.php', status: 'done', lines: 100, needsChunking: false, attempts: 0, errors: [], stringsFound: 10, stringsConverted: 10 },
      { path: '/b.php', relativePath: 'b.php', status: 'done', lines: 150, needsChunking: false, attempts: 0, errors: [], stringsFound: 15, stringsConverted: 15 },
    ])

    const args: WorkflowNextArgs = { workflowId: testWorkflowId }
    const result = await executeWorkflowNext(args)
    const data = JSON.parse(result)

    expect(data.success).toBe(true)
    expect(data.complete).toBe(true)
    expect(data.message).toContain('All views processed')

    // Verify status was changed to "verification"
    const statePath = join(getTestWorkflowDir(), testWorkflowId, 'workflow-state.json')
    const stateContent = require('fs').readFileSync(statePath, 'utf8')
    const state = JSON.parse(stateContent)
    expect(state.status).toBe('verification')
  })

  it('should NOT set status to "complete" when all views done (only verification)', async () => {
    createTestWorkflow(testWorkflowId, [
      { path: '/a.php', relativePath: 'a.php', status: 'done', lines: 100, needsChunking: false, attempts: 0, errors: [], stringsFound: 10, stringsConverted: 10 },
    ])

    const args: WorkflowNextArgs = { workflowId: testWorkflowId }
    const result = await executeWorkflowNext(args)
    const data = JSON.parse(result)

    expect(data.success).toBe(true)

    // Verify status is "verification", NOT "complete"
    const statePath = join(getTestWorkflowDir(), testWorkflowId, 'workflow-state.json')
    const stateContent = require('fs').readFileSync(statePath, 'utf8')
    const state = JSON.parse(stateContent)
    expect(state.status).toBe('verification')
    expect(state.status).not.toBe('complete')
  })

  it('should return error view when no pending views but error views exist', async () => {
    createTestWorkflow(testWorkflowId, [
      { path: '/a.php', relativePath: 'a.php', status: 'done', lines: 100, needsChunking: false, attempts: 0, errors: [], stringsFound: 10, stringsConverted: 10 },
      { path: '/b.php', relativePath: 'b.php', status: 'error', lines: 150, needsChunking: false, attempts: 1, errors: ['Syntax error'], stringsFound: 0, stringsConverted: 0 },
    ])

    const args: WorkflowNextArgs = { workflowId: testWorkflowId }
    const result = await executeWorkflowNext(args)
    const data = JSON.parse(result)

    expect(data.success).toBe(true)
    expect(data.view).toBeDefined()
    expect(data.view.relativePath).toBe('b.php')
    expect(data.view.path).toBe('/b.php')
    expect(data.view.previousErrors).toEqual(['Syntax error'])
    expect(data.view.attempt).toBe(2) // attempts incremented from 1 to 2
  })

  it('should return error when workflow not found', async () => {
    const args: WorkflowNextArgs = { workflowId: 'nonexistent-workflow' }
    const result = await executeWorkflowNext(args)
    const data = JSON.parse(result)

    expect(data.success).toBe(false)
    expect(data.error).toContain('not found')
  })
})

describe('executeWorkflowGateUpdate', () => {
  const testWorkflowId = 'test-workflow-gate-' + Date.now()

  afterEach(() => {
    cleanupTestWorkflow(testWorkflowId)
  })

  it('should initialize gates if missing', async () => {
    createTestWorkflow(testWorkflowId, [
      { path: '/a.php', relativePath: 'a.php', status: 'done', lines: 100, needsChunking: false, attempts: 0, errors: [], stringsFound: 10, stringsConverted: 10 },
    ])

    const args: WorkflowGateUpdateArgs = {
      workflowId: testWorkflowId,
      gateName: 'hardcode_sweep',
      status: 'passed'
    }

    const result = await executeWorkflowGateUpdate(args)
    const data = JSON.parse(result)

    expect(data.success).toBe(true)
    expect(data.gate).toBe('hardcode_sweep')
    expect(data.status).toBe('passed')

    // Verify gates were initialized
    const statePath = join(getTestWorkflowDir(), testWorkflowId, 'workflow-state.json')
    const stateContent = require('fs').readFileSync(statePath, 'utf8')
    const state = JSON.parse(stateContent)
    expect(state.gates).toBeDefined()
    expect(state.gates.hardcode_sweep).toBeDefined()
    expect(state.gates.completion_guard).toBeDefined()
  })

  it('should update gate status and increment iteration', async () => {
    createTestWorkflow(testWorkflowId, [
      { path: '/a.php', relativePath: 'a.php', status: 'done', lines: 100, needsChunking: false, attempts: 0, errors: [], stringsFound: 10, stringsConverted: 10 },
    ], 'verification', {
      hardcode_sweep: { status: 'pending', iteration: 0 },
      completion_guard: { status: 'pending', iteration: 0 }
    })

    const args: WorkflowGateUpdateArgs = {
      workflowId: testWorkflowId,
      gateName: 'hardcode_sweep',
      status: 'passed'
    }

    const result = await executeWorkflowGateUpdate(args)
    const data = JSON.parse(result)

    expect(data.success).toBe(true)
    expect(data.iteration).toBe(1)

    // Verify state was updated
    const statePath = join(getTestWorkflowDir(), testWorkflowId, 'workflow-state.json')
    const stateContent = require('fs').readFileSync(statePath, 'utf8')
    const state = JSON.parse(stateContent)
    expect(state.gates.hardcode_sweep.status).toBe('passed')
    expect(state.gates.hardcode_sweep.iteration).toBe(1)
  })

  it('should set workflow status to "complete" when completion_guard passes', async () => {
    createTestWorkflow(testWorkflowId, [
      { path: '/a.php', relativePath: 'a.php', status: 'done', lines: 100, needsChunking: false, attempts: 0, errors: [], stringsFound: 10, stringsConverted: 10 },
      { path: '/b.php', relativePath: 'b.php', status: 'done', lines: 150, needsChunking: false, attempts: 0, errors: [], stringsFound: 15, stringsConverted: 15 },
    ], 'verification', {
      hardcode_sweep: { status: 'passed', iteration: 1 },
      completion_guard: { status: 'pending', iteration: 0 }
    })

    const args: WorkflowGateUpdateArgs = {
      workflowId: testWorkflowId,
      gateName: 'completion_guard',
      status: 'passed'
    }

    const result = await executeWorkflowGateUpdate(args)
    const data = JSON.parse(result)

    expect(data.success).toBe(true)

    // Verify workflow status was set to "complete"
    const statePath = join(getTestWorkflowDir(), testWorkflowId, 'workflow-state.json')
    const stateContent = require('fs').readFileSync(statePath, 'utf8')
    const state = JSON.parse(stateContent)
    expect(state.status).toBe('complete')
    expect(state.gates.completion_guard.status).toBe('passed')
  })

  it('should NOT set workflow to complete when completion_guard fails', async () => {
    createTestWorkflow(testWorkflowId, [
      { path: '/a.php', relativePath: 'a.php', status: 'done', lines: 100, needsChunking: false, attempts: 0, errors: [], stringsFound: 10, stringsConverted: 10 },
    ], 'verification', {
      hardcode_sweep: { status: 'passed', iteration: 1 },
      completion_guard: { status: 'pending', iteration: 0 }
    })

    const args: WorkflowGateUpdateArgs = {
      workflowId: testWorkflowId,
      gateName: 'completion_guard',
      status: 'failed'
    }

    const result = await executeWorkflowGateUpdate(args)
    const data = JSON.parse(result)

    expect(data.success).toBe(true)

    // Verify workflow status was NOT set to "complete"
    const statePath = join(getTestWorkflowDir(), testWorkflowId, 'workflow-state.json')
    const stateContent = require('fs').readFileSync(statePath, 'utf8')
    const state = JSON.parse(stateContent)
    expect(state.status).not.toBe('complete')
    expect(state.gates.completion_guard.status).toBe('failed')
  })

  it('should NOT set workflow to complete when hardcode_sweep passes (only completion_guard triggers completion)', async () => {
    createTestWorkflow(testWorkflowId, [
      { path: '/a.php', relativePath: 'a.php', status: 'done', lines: 100, needsChunking: false, attempts: 0, errors: [], stringsFound: 10, stringsConverted: 10 },
    ], 'verification', {
      hardcode_sweep: { status: 'pending', iteration: 0 },
      completion_guard: { status: 'pending', iteration: 0 }
    })

    const args: WorkflowGateUpdateArgs = {
      workflowId: testWorkflowId,
      gateName: 'hardcode_sweep',
      status: 'passed'
    }

    const result = await executeWorkflowGateUpdate(args)
    const data = JSON.parse(result)

    expect(data.success).toBe(true)

    // Verify workflow status was NOT changed to complete
    const statePath = join(getTestWorkflowDir(), testWorkflowId, 'workflow-state.json')
    const stateContent = require('fs').readFileSync(statePath, 'utf8')
    const state = JSON.parse(stateContent)
    expect(state.status).toBe('verification')
    expect(state.status).not.toBe('complete')
  })

  it('should handle gate defaults with correct initial values', async () => {
    createTestWorkflow(testWorkflowId, [
      { path: '/a.php', relativePath: 'a.php', status: 'done', lines: 100, needsChunking: false, attempts: 0, errors: [], stringsFound: 10, stringsConverted: 10 },
    ])

    const args: WorkflowGateUpdateArgs = {
      workflowId: testWorkflowId,
      gateName: 'completion_guard',
      status: 'pending'
    }

    const result = await executeWorkflowGateUpdate(args)
    const data = JSON.parse(result)

    expect(data.success).toBe(true)

    // Verify default initialization
    const statePath = join(getTestWorkflowDir(), testWorkflowId, 'workflow-state.json')
    const stateContent = require('fs').readFileSync(statePath, 'utf8')
    const state = JSON.parse(stateContent)

    expect(state.gates.hardcode_sweep.status).toBe('pending')
    expect(state.gates.hardcode_sweep.iteration).toBe(0)
    expect(state.gates.completion_guard.status).toBe('pending')
    expect(state.gates.completion_guard.iteration).toBe(1) // Incremented because we updated it
  })

  it('should return error when workflow not found', async () => {
    const args: WorkflowGateUpdateArgs = {
      workflowId: 'nonexistent-workflow',
      gateName: 'hardcode_sweep',
      status: 'passed'
    }

    const result = await executeWorkflowGateUpdate(args)
    const data = JSON.parse(result)

    expect(data.success).toBe(false)
    expect(data.error).toContain('not found')
  })
})

describe('Workflow State Transitions', () => {
  const testWorkflowId = 'test-workflow-transitions-' + Date.now()

  afterEach(() => {
    cleanupTestWorkflow(testWorkflowId)
  })

  it('should follow correct state flow: processing -> verification -> complete', async () => {
    // Start in processing
    createTestWorkflow(testWorkflowId, [
      { path: '/a.php', relativePath: 'a.php', status: 'pending', lines: 100, needsChunking: false, attempts: 0, errors: [], stringsFound: 0, stringsConverted: 0 },
    ], 'processing')

    let statePath = join(getTestWorkflowDir(), testWorkflowId, 'workflow-state.json')
    let state = JSON.parse(require('fs').readFileSync(statePath, 'utf8'))
    expect(state.status).toBe('processing')

    // Mark view as done - should transition to verification
    state.views[0].status = 'done'
    writeFileSync(statePath, JSON.stringify(state, null, 2))

    const nextResult = await executeWorkflowNext({ workflowId: testWorkflowId })
    const nextData = JSON.parse(nextResult)
    expect(nextData.complete).toBe(true)

    state = JSON.parse(require('fs').readFileSync(statePath, 'utf8'))
    expect(state.status).toBe('verification')

    // Pass completion_guard - should transition to complete
    const gateResult = await executeWorkflowGateUpdate({
      workflowId: testWorkflowId,
      gateName: 'completion_guard',
      status: 'passed'
    })
    const gateData = JSON.parse(gateResult)
    expect(gateData.success).toBe(true)

    state = JSON.parse(require('fs').readFileSync(statePath, 'utf8'))
    expect(state.status).toBe('complete')
  })
})
