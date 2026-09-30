/**
 * dsh-scratch-cleaner — a Harness host plugin that gives the agent one
 * designated place for throwaway scripts and deletes that place's contents
 * whenever a turn ends.
 *
 * The plugin only ever touches the configured scratch directory inside a
 * session's working directory. A turn end removes the directory's immediate
 * children and then logs what it removed; nothing outside that directory is
 * read or deleted, so a script the agent leaves loose in the workspace is never
 * touched.
 *
 * @module dsh-scratch-cleaner
 */
import { readdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import z from '@deepseek-ai/schemastery'

/** Stable Cordis plugin name. */
export const name = 'scratch-cleaner'

/**
 * The prompt service is read through `ctx.get` at use time rather than declared
 * as a hard injection, so a deployment that omits it still composes this plugin.
 */
export const inject = []

/** Validated plugin configuration. */
export const Config = z.object({
  /** Per-session directory name holding throwaway scripts, inside the working directory. */
  scratchDir: z.string().default('.dsh-scratch'),
  /** Emit one info line naming the entries removed for each turn. */
  logReclaimed: z.boolean().default(true),
})

/** Emit a warning without letting a broken log sink disturb cleanup. */
function warn(ctx, error) {
  try {
    ctx.logger?.warn('scratch-cleaner: %s', error instanceof Error ? error.message : String(error))
  } catch {
    /* noexcept: a logging sink must never turn a contained failure into a crash */
  }
}

/**
 * The absolute scratch directory for one session, or `undefined` when the
 * session's working directory cannot be read.
 */
function scratchPathOf(session, config) {
  const cwd = session?.header?.cwd
  if (typeof cwd !== 'string' || cwd === '') return undefined
  return join(resolve(cwd), config.scratchDir)
}

/** Immediate entry names under `source`, or `[]` when it does not exist. */
async function listNames(source) {
  try {
    return await readdir(source)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

/**
 * Delete everything inside one session's scratch directory.
 *
 * The directory itself is left in place so a running harness never races a
 * removed path. A session whose header carries no working directory is skipped
 * rather than guessed at. One entry that cannot be removed does not stop the
 * others.
 *
 * @param session - the live session whose turn ended.
 * @param config - validated plugin configuration.
 * @returns the scratch directory and the entry names deleted.
 */
export async function clearScratch(session, config) {
  const scratch = scratchPathOf(session, config)
  if (scratch === undefined) return { removed: [], scratch: undefined }
  const names = await listNames(scratch)
  if (names.length === 0) return { removed: [], scratch }
  const removed = []
  for (const entry of names) {
    try {
      await rm(join(scratch, entry), { recursive: true, force: true })
      removed.push(entry)
    } catch {
      /* noexcept: a locked entry stays put and is retried at the next turn end */
    }
  }
  return { removed, scratch }
}

/**
 * Mount the plugin: register the scratch instruction and clear the scratch
 * directory on every turn end.
 *
 * @param ctx - owning Cordis plugin context.
 * @param config - validated plugin configuration.
 */
export function apply(ctx, config) {
  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.systemPrompt.section({
      name: 'scratch-cleaner',
      order: promptCtx.systemPrompt.getSectionOrder('WEB_SURFACE'),
      text: [
        `Throwaway scripts — probes, one-off test harnesses, temporary evaluation drivers — belong in the \`${config.scratchDir}/\` directory at the root of the working directory, not loose in the workspace.`,
        `Every file in \`${config.scratchDir}/\` is deleted when the turn ends, so keep working scripts there and nothing else: anything meant to outlive the turn belongs somewhere else.`,
      ].join(' '),
    })
  })

  ctx.on('session/event', (session, event) => {
    if (event?.type !== 'turn/end') return
    void clearScratch(session, config)
      .then(({ removed }) => {
        if (!config.logReclaimed || removed.length === 0) return
        try {
          ctx.logger?.info(
            'scratch-cleaner: turn %s deleted %s from %s/%s: %s',
            String(event?.data?.turn),
            `${String(removed.length)} entr${removed.length === 1 ? 'y' : 'ies'}`,
            session?.header?.cwd,
            config.scratchDir,
            removed.join(', '),
          )
        } catch {
          /* noexcept: logging must not affect cleanup */
        }
      })
      .catch((error) => { warn(ctx, error) })
  })
}
