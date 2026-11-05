/**
 * Host half of the AI avatar bundle: works out the topic of a conversation so the
 * Client can dress the avatar for it.
 *
 * The browser posts each new question, with the ones before it and the expert
 * showing now, to one private route: { method: 'local', questions, current }. The
 * on-device model answers in tens of ms, on this PC: nothing is sent anywhere. It
 * uses the avatar project's own topic list and rule (local-model.js), so DSH picks
 * the same expert as Doubao, Codex and Yuanbao. It answers { outfit } with an
 * outfit id from the project's topics.mjs, or null for no topic (her everyday look).
 * The Client owns the drawing.
 *
 * Optional config in cordis.patch.yml (all keys optional):
 *   local: false             turn the local model off (the avatar then uses keywords)
 *   doubaoProject: <folder>  where the avatar project (its model, topics and pet program) is
 *
 * Pet mode (pet.js): the page posts to a second route, PET_ROUTE:
 *   { type: 'info' }                            -> { on, available, notices }
 *   { type: 'mode', on }                        switch the desktop pet on or off
 *   { type: 'state', outfit, phase, look, ring } her topic, idle / thinking / writing, style
 *
 * The page runs the shared avatar from the avatar project (see src/client.src.js); the
 * clips it walks with are served by media.js.
 */
import { createLocalClassifier } from './local-model.js'
import { MEDIA_PREFIXES, mediaHandler } from './media.js'
import { createPet, DEFAULT_PROJECT } from './pet.js'

export const name = 'ai-avatar'
export const inject = ['connection', 'webServer']

/** Exact route the browser posts topic questions to. */
export const ROUTE = '/api/local.ai-avatar.topic'
/** Exact route for pet mode (see pet.js). */
export const PET_ROUTE = '/api/local.ai-avatar.pet'
/** Longest question text classified; longer text is cut (the model reads the first 500 characters). */
const MAX_TEXT = 2000
/** Questions of the conversation passed on (the rule reads the newest few). */
const MAX_QUESTIONS = 6

const DEFAULTS = { local: true }

/** JSON response helper. */
function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

export function apply(ctx, rawConfig) {
  const config = { ...DEFAULTS, ...(rawConfig && typeof rawConfig === 'object' ? rawConfig : {}) }
  const warn = (message) => { try { ctx.logger?.warn?.(`ai-avatar: ${message}`) } catch { /* ignore */ } }
  const project = typeof config.doubaoProject === 'string' ? config.doubaoProject : DEFAULT_PROJECT

  // Start loading the local model now, so the first question is quick.
  let local = null
  let loaded = null   // the classifier once it has loaded (until then the route says "not ready")
  let failedAt = 0    // when loading last failed (it's tried again a minute later, on the next question)
  let unloaded = false
  const load = () => {
    failedAt = 0
    local = (config.createLocalClassifier ?? createLocalClassifier)({ project }).then((classifier) => {
      if (unloaded) { classifier?.close(); return null }
      return (loaded = classifier)
    }, (error) => {
      failedAt = Date.now()
      warn(`local model unavailable (${error instanceof Error ? error.message : String(error)})`)
      return null
    })
  }
  if (config.local !== false) {
    load()
    // The model runs in a helper process (local-model.js): stop it when the plugin unloads.
    ctx.effect(() => () => { unloaded = true; local?.then((classifier) => classifier?.close()).catch(() => {}) }, 'ai-avatar: local model helper')
  }

  async function handle(request) {
    let payload
    try { payload = await request.json() } catch { return json(400, { ok: false, error: 'the body must be JSON' }) }
    // The conversation's questions, oldest first ({ text } alone is one question).
    const list = Array.isArray(payload?.questions) ? payload.questions : [payload?.text]
    const questions = list.filter((q) => typeof q === 'string').map((q) => q.slice(0, MAX_TEXT).trim()).filter(Boolean).slice(-MAX_QUESTIONS)
    const current = typeof payload?.current === 'string' ? payload.current : null
    const method = payload?.method
    if (questions.length === 0) return json(400, { ok: false, error: 'questions are required' })
    if (method !== 'local') return json(400, { ok: false, error: 'method must be "local"' })
    const started = Date.now()
    try {
      // As in every app: while the model is still loading (or off, or failed), say so at once, and
      // the avatar uses its keywords for this question instead of waiting.
      const classifier = loaded
      if (!classifier && failedAt && Date.now() - failedAt > 60000) load()   // failed a while ago: try again
      if (!classifier) return json(200, { ok: false, method, error: local ? 'local model not ready' : 'local model is off' })
      const result = await classifier.pick(questions, current)
      return json(200, { ok: true, method, outfit: result.outfit ?? null, score: result.score ?? null, ms: Date.now() - started })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      warn(`topic check failed: ${message}`)
      return json(200, { ok: false, method, error: message, ms: Date.now() - started })
    }
  }

  ctx.effect(() => {
    const dispose = ctx.connection.fetch.register({
      path: ROUTE,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: (request) => handle(request),
    })
    return () => { Promise.resolve(dispose()).catch(() => {}) }
  }, 'ai-avatar: topic route')

  // Pet mode: the avatar floating on the desktop (off by default).
  const pet = (config.createPet ?? createPet)({ project, warn })
  async function handlePet(request) {
    let payload
    try { payload = await request.json() } catch { return json(400, { ok: false, error: 'the body must be JSON' }) }
    if (payload?.type === 'info') return json(200, { ok: true, ...pet.info() })
    if (payload?.type === 'mode') {
      const done = pet.setOn(payload.on === true)
      return json(200, { ok: done, ...pet.info(), ...(done ? {} : { error: 'pet mode is not set up on this PC' }) })
    }
    if (payload?.type === 'state') return json(200, { ok: pet.state(payload) })
    return json(400, { ok: false, error: 'type must be "info", "mode" or "state"' })
  }
  ctx.effect(() => {
    const dispose = ctx.connection.fetch.register({
      path: PET_ROUTE,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: (request) => handlePet(request),
    })
    pet.resume() // it was on last time
    return () => { pet.stop(); Promise.resolve(dispose()).catch(() => {}) }
  }, 'ai-avatar: pet mode')

  // The experts' walk-in / walk-out clips, under each published prefix.
  for (const base of MEDIA_PREFIXES) {
    ctx.effect(
      () => ctx.webServer.register({ kind: 'prefix', path: base, handler: mediaHandler(base) }),
      `ai-avatar: media route (${base})`,
    )
  }
}
