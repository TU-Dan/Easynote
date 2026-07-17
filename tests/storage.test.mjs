import assert from 'node:assert/strict'
import test from 'node:test'

import { createStorage } from '../storage.js'

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    dump: () => Object.fromEntries(values)
  }
}

test('migrates a legacy API key out of persistent storage', () => {
  const persistent = memoryStorage({ qsj_settings: JSON.stringify({ apiKey: 'sk-secret', baseUrl: 'https://api.deepseek.com' }) })
  const session = memoryStorage()
  const storage = createStorage({ persistent, session })

  assert.equal(storage.getSettings().apiKey, 'sk-secret')
  assert.equal(JSON.parse(persistent.dump().qsj_settings).apiKey, undefined)
  assert.equal(session.dump().qsj_api_key, 'sk-secret')
})

test('keeps new API keys out of persistent storage', () => {
  const persistent = memoryStorage()
  const session = memoryStorage()
  const storage = createStorage({ persistent, session })

  storage.saveSettings({ apiKey: 'sk-session', baseUrl: 'https://api.deepseek.com' })

  assert.equal(JSON.parse(persistent.dump().qsj_settings).apiKey, undefined)
  assert.equal(session.dump().qsj_api_key, 'sk-session')
})

test('recovers from malformed local JSON', () => {
  const persistent = memoryStorage({ qsj_entries: '{broken' })
  const storage = createStorage({ persistent, session: memoryStorage() })

  assert.deepEqual(storage.getEntries(), [])
  assert.equal(persistent.dump().qsj_entries, undefined)
})
