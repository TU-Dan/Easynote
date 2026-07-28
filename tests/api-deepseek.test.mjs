import assert from 'node:assert/strict'
import test from 'node:test'

import { generateDailySummary } from '../api.js'

test('uses the current fast DeepSeek model in non-thinking mode', async t => {
  const originalFetch = globalThis.fetch
  let requestBody
  t.after(() => { globalThis.fetch = originalFetch })

  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body)
    return new Response(
      'data: {"choices":[{"delta":{"content":"总结"}}]}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
    )
  }

  const result = await generateDailySummary(
    [{ timestamp: '2026-07-26T08:00:00+08:00', content: '测试记录' }],
    { apiKey: 'sk-test' },
    '2026-07-26'
  )

  assert.equal(result, '总结')
  assert.equal(requestBody.model, 'deepseek-v4-flash')
  assert.deepEqual(requestBody.thinking, { type: 'disabled' })
})

test('surfaces a plain-text API error instead of hiding it', async t => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async () => new Response('model is no longer available', { status: 400 })

  await assert.rejects(
    generateDailySummary(
      [{ timestamp: '2026-07-26T08:00:00+08:00', content: '测试记录' }],
      { apiKey: 'sk-test' },
      '2026-07-26'
    ),
    /model is no longer available/
  )
})
