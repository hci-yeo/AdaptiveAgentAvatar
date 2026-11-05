/**
 * The local topic model for DeepSeek Harness: the same model, topic list and rule
 * as the Doubao / Codex / Yuanbao avatar, taken from the avatar project itself
 * (its classifier.mjs, topics.mjs and models/), so a fix there reaches DSH too.
 * Nothing is sent anywhere; nothing is fetched while DSH runs.
 *
 * The model runs in a helper process of its own (model-worker.js), not in DSH's
 * plugin process. DSH ships an older onnxruntime.dll (1.17, for its voice
 * feature) and Windows loads only one DLL of that name per process: when DSH's
 * loaded first, ours got the old one and crashed all of DSH ("initOrt"). The
 * helper is DSH's child, runs on DSH's own runtime, and quits when DSH (or this
 * plugin) does; a crash there can't take DSH down.
 */
import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const WORKER = fileURLToPath(new URL('./model-worker.js', import.meta.url))
/** Give up on one question after this long (the helper answers in tens of ms). */
const ANSWER_TIMEOUT_MS = 15000
/** Start the helper again after a crash at most this many times. */
const MAX_RESTARTS = 3

/**
 * Start the model in its helper process and resolve once it's ready.
 * @param {{ project: string, execPath?: string }} options - the avatar project's folder, and
 *   the runtime to run the helper on (default: DSH's own).
 * @returns {Promise<{
 *   pick(questions: string[], current: string | null): Promise<{ outfit: string | null, score?: number }>,
 *   close(): void,
 *   model: string,
 * }>}
 */
export async function createLocalClassifier({ project, execPath = process.execPath }) {
  let child = null
  let ready = null
  let closed = false
  let restarts = 0
  let lastRestart = 0
  let nextId = 0
  let model = ''
  const pending = new Map()

  // Hold the event loop open only while a question is waiting, so tests and a
  // shutting-down host can exit without waiting for the helper.
  const holdLoop = () => { if (pending.size) child?.channel?.ref?.(); else child?.channel?.unref?.() }

  function start() {
    ready = new Promise((resolve, reject) => {
      // ELECTRON_RUN_AS_NODE: DSH runs plugins on Electron's binary; this makes it plain Node (no window).
      const proc = fork(WORKER, [project], {
        execPath,
        execArgv: [],   // not DSH's own startup options (it runs plugins with --expose-internals)
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        windowsHide: true,
      })
      child = proc
      proc.unref()
      let stderr = ''
      proc.stderr?.on('data', (chunk) => { stderr = (stderr + chunk).slice(-2000) })
      proc.on('message', (message) => {
        if (message?.type === 'ready') { model = message.model; holdLoop(); resolve() }
        else if (message?.type === 'failed') reject(new Error(message.error))
        else if (message?.type === 'result') {
          const waiting = pending.get(message.id)
          if (!waiting) return
          pending.delete(message.id)
          clearTimeout(waiting.timer)
          holdLoop()
          if (message.error) waiting.reject(new Error(message.error))
          else waiting.resolve(message.result)
        }
      })
      // It couldn't be started at all: forget it, so the next question tries again (without this, every
      // later question waited on the same failed start and the model stayed off until DSH restarted).
      proc.on('error', (error) => {
        if (child === proc) { child = null; ready = null }
        reject(error)
      })
      proc.on('exit', (code, signal) => {
        if (child === proc) { child = null; ready = null }
        const last = stderr.trim().split(/\r?\n/).filter(Boolean).at(-1)
        const error = new Error(`topic model helper stopped (${signal ?? `exit ${code}`})${last ? `: ${last}` : ''}`)
        reject(error) // ignored if it was already ready
        for (const waiting of pending.values()) { clearTimeout(waiting.timer); waiting.reject(error) }
        pending.clear()
      })
    })
    return ready
  }

  await start()

  return {
    get model() { return model },
    async pick(questions, current) {
      if (closed) throw new Error('topic model helper is closed')
      if (!ready) {
        // Three restarts in a row at most; after ten quiet minutes the count starts again (it used to
        // count for the whole session, so three crashes over a long day turned the model off for good).
        if (Date.now() - lastRestart > 10 * 60 * 1000) restarts = 0
        if (restarts >= MAX_RESTARTS) throw new Error('topic model helper stopped too often')
        restarts += 1
        lastRestart = Date.now()
        start()
      }
      await ready
      const proc = child
      if (!proc) throw new Error('topic model helper is not running')
      const id = ++nextId
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          holdLoop()
          reject(new Error('topic model helper did not answer in time'))
        }, ANSWER_TIMEOUT_MS)
        pending.set(id, { resolve, reject, timer })
        holdLoop()
        proc.send({ type: 'pick', id, questions: questions.map(String), current })
      })
    },
    close() {
      closed = true
      const proc = child
      child = null
      ready = null
      if (proc && proc.exitCode === null) proc.kill()
    },
  }
}
