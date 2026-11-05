/**
 * The topic model's helper process (see createLocalClassifier in local-model.js).
 * DSH's plugin starts it as a child with the avatar project's folder. It loads that
 * project's classifier.mjs, topics.mjs and model, answers
 * { type: 'pick', id, questions, current } with { type: 'result', id, result | error }
 * using the same rule as the Doubao / Codex watcher (pickTopicWith), and quits as soon
 * as its parent goes away.
 */
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Tried in order, as the watcher does (watcher.mjs TOPIC_MODELS); only models that ship in models/. */
const MODELS = ['gemma-300m', 'e5-small-zh-en']

const message = (error) => (error instanceof Error ? error.message : String(error))

// The parent closed the channel: DSH quit, crashed, or unloaded the plugin.
process.on('disconnect', () => process.exit(0))

async function load(project) {
  if (!project) throw new Error('no avatar project folder given')
  const from = (file) => import(pathToFileURL(join(project, file)).href)
  const { createClassifier, pickTopicWith } = await from('classifier.mjs')
  const { TOPICS, NO_TOPIC_EXAMPLES, EVERYDAY_EXAMPLES = [] } = await from('topics.mjs')
  const errors = []
  for (const model of MODELS) {
    try {
      const classifier = await createClassifier({ model, topics: TOPICS, noTopicExamples: NO_TOPIC_EXAMPLES, everydayExamples: EVERYDAY_EXAMPLES, log: () => {} })
      return { model, pick: (questions, current) => pickTopicWith(classifier, questions, current) }
    } catch (error) { errors.push(`${model}: ${message(error)}`) }
  }
  throw new Error(`no model could be loaded (${errors.join('; ')})`)
}

const ready = load(process.argv[2])
ready.then(
  ({ model }) => process.send?.({ type: 'ready', model }),
  (error) => {
    process.send?.({ type: 'failed', error: message(error) })
    process.exit(1)
  },
)

process.on('message', async (request) => {
  if (request?.type !== 'pick') return
  try {
    const { pick } = await ready
    const current = typeof request.current === 'string' ? request.current : null
    const result = await pick(Array.isArray(request.questions) ? request.questions : [], current)
    process.send?.({ type: 'result', id: request.id, result })
  } catch (error) {
    process.send?.({ type: 'result', id: request.id, error: message(error) })
  }
})
