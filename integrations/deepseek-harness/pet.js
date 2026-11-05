/**
 * Pet mode for DeepSeek Harness: the avatar leaves the DSH window and floats on
 * the desktop as a small see-through window. Off by default; DSH's own switch,
 * separate from the Doubao and Codex pets.
 *
 * The pet program is the one the Doubao avatar project ships (its pet/ folder:
 * an Electron window that runs the same avatar page as the Doubao and Codex
 * pets), so all three look and behave alike. This Host half starts it as a
 * child process and talks to it over Node's parent-child message channel: an
 * unnamed pipe only the two processes hold, no network port. It tells the pet
 * only which expert is on stage and whether DSH is thinking, writing or idle,
 * never any chat text. When DSH quits, the pipe closes and the pet goes too.
 *
 * Optional config (cordis.patch.yml): doubaoProject: <folder of the avatar
 * project> (default: the AdaptiveAgentAvatar folder this plugin sits in, two
 * levels up).
 * The setting and the pet's spot on the desktop are kept in .pet.json here.
 */
import { spawn, execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// This plugin ships inside the AdaptiveAgentAvatar folder (integrations/deepseek-harness).
export const DEFAULT_PROJECT = fileURLToPath(new URL('../../', import.meta.url))
const APP = 'dsh'
const LABEL = 'DeepSeek Harness'
const SLOT = 2 // after Doubao (0) and Codex (1): its first spot is left of theirs
const PHASES = ['idle', 'thinking', 'writing']
const OUTFIT = /^[a-z][a-z_]{1,39}$/
const LOOKS = ['people', 'single', 'fish']

export function createPet({ project = DEFAULT_PROJECT, settingsFile, warn = () => {}, spawnImpl = spawn } = {}) {
  const petDir = join(project, 'pet')
  const file = settingsFile ?? fileURLToPath(new URL('./.pet.json', import.meta.url))
  let settings = { on: false, spot: null }
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    settings = { on: saved.on === true, spot: saved.spot ?? null }
  } catch { /* first run: off */ }
  const save = () => { try { writeFileSync(file, JSON.stringify(settings, null, 2)) } catch { /* ignore */ } }

  let child = null
  let wanted = false
  let restarts = 0
  let noGpuSandbox = false
  let last = null // { outfit, phase, look, ring }: what the page's avatar last said
  let notices = [] // settings changed from the pet's menu, for the page to apply (it asks every 3s)

  /** Path to the pet program's Electron, or null when pet mode isn't set up on this PC. */
  function electronPath() {
    try {
      const exe = createRequire(join(petDir, 'package.json'))('electron')
      return typeof exe === 'string' && existsSync(exe) && existsSync(join(petDir, 'main.js')) ? exe : null
    } catch { return null }
  }

  // The pet page is the Doubao project's avatar mod, bundled by its watcher;
  // write it once more so it's there (and current) even if that watcher never ran.
  function refreshPage() {
    return new Promise((resolve) => {
      // The ready-to-run download has its own Node.js (node/node.exe); else the one on PATH.
      const node = existsSync(join(project, 'node', 'node.exe')) ? join(project, 'node', 'node.exe') : 'node'
      execFile(node, [join(project, 'watcher.mjs'), '--pet-bundle'], { cwd: project, windowsHide: true, timeout: 30000 }, (error) => {
        if (error && !existsSync(join(petDir, 'build', 'payload.js'))) warn(`pet page could not be built (${error.message})`)
        resolve()
      })
    })
  }

  async function start() {
    const exe = electronPath()
    if (!exe || child) return
    wanted = true
    await refreshPage()
    if (!wanted || child) return
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE // must not be set, or Electron runs as plain Node
    const args = [petDir]
    if (noGpuSandbox) args.push('--no-gpu-sandbox')
    const proc = spawnImpl(exe, args, { cwd: petDir, env, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true })
    child = proc
    proc.stderr?.on('data', () => {}) // Chromium's own noise
    proc.on('message', (msg) => onMessage(msg))
    proc.on('exit', (code) => {
      if (child === proc) child = null
      if (!wanted) return
      if (code === 75 && !noGpuSandbox) { // its graphics process couldn't start sandboxed
        noGpuSandbox = true
        warn('pet: restarting with the graphics sandbox off (this PC needs it)')
        start()
        return
      }
      if (++restarts > 3) { warn(`pet stopped (exit ${code}) too often; switch it on again to retry`); return }
      setTimeout(() => { if (wanted) start() }, 1000 * restarts)
    })
  }

  function stop() {
    wanted = false
    if (child) { try { child.kill() } catch { /* already gone */ } child = null }
  }

  function onMessage(msg) {
    if (!msg || typeof msg !== 'object') return
    if (msg.type === 'started') {
      restarts = 0
      child?.send({ type: 'open', app: APP, label: LABEL, spot: settings.spot, slot: SLOT })
      if (last) child?.send({ type: 'state', app: APP, ...last })
    }
    if (msg.app !== APP) return
    if (msg.type === 'moved' && Number.isFinite(msg.x) && Number.isFinite(msg.y)) { settings.spot = { x: msg.x, y: msg.y }; save() }
    if (msg.type === 'back') setOn(false)
    // From the pet's menu: settings the page's avatar keeps (it then tells the pet the new state).
    if (msg.type === 'ring') notices.push({ ring: msg.on === true })
    if (msg.type === 'look' && LOOKS.includes(msg.look)) notices.push({ look: msg.look })
    if (notices.length > 10) notices = notices.slice(-10)
    if (msg.type === 'log') warn(`pet: ${String(msg.text).slice(0, 200)}`)
  }

  function setOn(on) {
    if (on && !electronPath()) return false
    if (settings.on !== on) { settings.on = on; save() }
    if (on) { restarts = 0; start() } else stop()
    return true
  }

  return {
    /** What the page needs to know: is pet mode on, can it be on here, and any settings changed
     *  from the pet's menu since it last asked. */
    info() {
      const out = { on: settings.on, available: electronPath() !== null, notices }
      notices = []
      return out
    },
    setOn,
    /** The page's avatar state (as the Doubao avatar sends it to its pet): her topic's outfit
     *  (null: the everyday look), the answer phase, the avatar style and the rainbow switch. */
    state({ outfit = null, phase, look = null, ring = null } = {}) {
      if (outfit !== null && !OUTFIT.test(String(outfit))) return false
      if (!PHASES.includes(phase)) return false
      last = {
        outfit,
        phase,
        look: LOOKS.includes(look) ? look : null,
        ring: typeof ring === 'boolean' ? ring : null,
      }
      child?.send({ type: 'state', app: APP, ...last })
      return true
    },
    /** Bring the pet back at DSH start if it was on last time. */
    resume() { if (settings.on) start() },
    stop,
  }
}
