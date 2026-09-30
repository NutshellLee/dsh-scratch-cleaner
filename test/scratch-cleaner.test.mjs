/**
 * Behavior tests for dsh-scratch-cleaner.
 *
 * Each case builds an isolated working directory, so the suite never touches
 * real session data or a real workspace.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Local test seam: when the package has not been installed into a profile yet,
 * point the declared schemastery dependency at the copy shipped inside the
 * running DSH installation.
 */
function ensureSchemaDependency() {
  const scope = join(import.meta.dirname, '..', 'node_modules', '@deepseek-ai')
  const link = join(scope, 'schemastery')
  if (existsSync(link)) return
  const candidates = [
    process.env.DSH_SCHEMASTERY,
    join(process.env.DSH_HOME ?? '', 'profiles', 'web', 'node_modules', '@deepseek-ai', 'schemastery'),
    'D:\\nodejs\\node_modules\\@deepseek-ai\\dsh\\node_modules\\@deepseek-ai\\schemastery',
    join(import.meta.dirname, '..', '..', 'deepseek-harness', 'node_modules', '@deepseek-ai', 'schemastery'),
  ]
  const source = candidates.find((candidate) => typeof candidate === 'string' && candidate !== '' && existsSync(candidate))
  if (source === undefined) throw new Error('test setup: no @deepseek-ai/schemastery copy found to link')
  mkdirSync(scope, { recursive: true })
  symlinkSync(source, link, 'junction')
}

ensureSchemaDependency()

const { Config, clearScratch } = await import('../lib/index.js')

/** Validate one raw config record through the exported schema, as the Loader does. */
function configOf(raw) {
  return Config(raw)
}

/** A fake live session carrying only the header fields the plugin reads. */
function sessionAt(cwd, id = 'session-test') {
  return { header: { id, cwd } }
}

/** Immediate entry names under a directory, or `[]` when it does not exist. */
function namesIn(directory) {
  try {
    return readdirSync(directory).sort()
  } catch {
    return []
  }
}

/** A working directory with a populated scratch directory. */
function workspaceWithScratch() {
  const cwd = mkdtempSync(join(tmpdir(), 'scratch-cleaner-cwd-'))
  const scratch = join(cwd, '.dsh-scratch')
  mkdirSync(scratch, { recursive: true })
  return { cwd, scratch }
}

function test(name, run) {
  try {
    run()
    console.log(`ok   ${name}`)
  } catch (error) {
    console.log(`FAIL ${name}`)
    console.log(error)
    process.exitCode = 1
  }
}

const config = configOf({})

test('defaults fill every unset field', () => {
  assert.equal(config.scratchDir, '.dsh-scratch')
  assert.equal(config.logReclaimed, true)
})

test('a configured scratchDir overrides the default', () => {
  assert.equal(configOf({ scratchDir: '.probe-scratch' }).scratchDir, '.probe-scratch')
})

test('a turn end deletes every scratch entry, including nested trees', async () => {
  const { cwd, scratch } = workspaceWithScratch()
  mkdirSync(join(scratch, 'nested', 'deeper'), { recursive: true })
  writeFileSync(join(scratch, 'probe.mjs'), 'console.log(1)\n')
  writeFileSync(join(scratch, 'nested', 'deeper', 'inner.txt'), 'inner\n')

  const { removed, scratch: reported } = await clearScratch(sessionAt(cwd, 'session-a'), config)
  assert.deepEqual(removed.sort(), ['nested', 'probe.mjs'])
  assert.deepEqual(namesIn(scratch), [])
  assert.equal(existsSync(scratch), true)
  assert.equal(reported, scratch)
})

test('a turn end with an empty scratch directory deletes nothing', async () => {
  const { cwd } = workspaceWithScratch()
  const { removed } = await clearScratch(sessionAt(cwd, 'session-empty'), config)
  assert.deepEqual(removed, [])
})

test('a missing scratch directory is not created and reports nothing', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'scratch-cleaner-cwd-'))
  const { removed, scratch } = await clearScratch(sessionAt(cwd, 'session-missing'), config)
  assert.deepEqual(removed, [])
  assert.equal(existsSync(join(cwd, '.dsh-scratch')), false)
  assert.equal(scratch, join(cwd, '.dsh-scratch'))
})

test('a session without a cwd is skipped, not guessed at', async () => {
  const { removed, scratch } = await clearScratch({ header: { id: 'session-nocwd' } }, config)
  assert.deepEqual(removed, [])
  assert.equal(scratch, undefined)
})

test('a custom scratchDir is the only directory read', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'scratch-cleaner-cwd-'))
  const custom = configOf({ scratchDir: '.probe-scratch' })
  mkdirSync(join(cwd, '.probe-scratch'), { recursive: true })
  mkdirSync(join(cwd, '.dsh-scratch'), { recursive: true })
  writeFileSync(join(cwd, '.probe-scratch', 'gone.mjs'), 'x\n')
  writeFileSync(join(cwd, '.dsh-scratch', 'kept.mjs'), 'x\n')

  const { removed } = await clearScratch(sessionAt(cwd, 'session-custom'), custom)
  assert.deepEqual(removed, ['gone.mjs'])
  assert.deepEqual(namesIn(join(cwd, '.dsh-scratch')), ['kept.mjs'])
})

test('loose scripts beside the scratch directory are left alone', async () => {
  const { cwd, scratch } = workspaceWithScratch()
  writeFileSync(join(scratch, 'inside.mjs'), 'x\n')
  writeFileSync(join(cwd, 'loose.mjs'), 'x\n')

  await clearScratch(sessionAt(cwd, 'session-loose'), config)
  assert.equal(existsSync(join(cwd, 'loose.mjs')), true)
  assert.equal(readFileSync(join(cwd, 'loose.mjs'), 'utf8'), 'x\n')
})

test('a file left in place by a failed removal does not stop the rest', async () => {
  const { cwd, scratch } = workspaceWithScratch()
  writeFileSync(join(scratch, 'first.mjs'), 'x\n')
  writeFileSync(join(scratch, 'second.mjs'), 'x\n')
  const locked = join(scratch, 'locked.mjs')
  writeFileSync(locked, 'x\n')

  // Hold an exclusive handle on Windows: recursive rm of that entry fails
  // while every sibling still has to go.
  const { openSync, closeSync } = await import('node:fs')
  const fd = openSync(locked, 'r')
  try {
    const { removed } = await clearScratch(sessionAt(cwd, 'session-locked'), config)
    assert.equal(removed.includes('first.mjs'), true)
    assert.equal(removed.includes('second.mjs'), true)
  } finally {
    closeSync(fd)
  }
})

console.log(process.exitCode === 1 ? '\nsome cases failed' : '\nall cases passed')
