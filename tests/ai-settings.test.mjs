import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_AI_BASE_URL, normalizeAiBaseUrl, validateAiSettings } from '../ai-settings.js'

test('normalizes the default endpoint', () => {
  assert.equal(normalizeAiBaseUrl(''), DEFAULT_AI_BASE_URL)
  assert.equal(normalizeAiBaseUrl('https://api.deepseek.com/'), DEFAULT_AI_BASE_URL)
})

test('rejects insecure or credential-bearing endpoints', () => {
  assert.throws(() => normalizeAiBaseUrl('http://example.com'), /必须使用 HTTPS/)
  assert.throws(() => normalizeAiBaseUrl('https://user:pass@example.com'), /不能包含账号/)
  assert.throws(() => normalizeAiBaseUrl('https://example.com?key=value'), /不能包含账号/)
})

test('requires explicit approval before sending a key to a custom endpoint', () => {
  const baseUrl = 'https://proxy.example.com'
  assert.throws(() => validateAiSettings({ apiKey: 'sk-test', baseUrl }), /请确认/)
  assert.equal(
    validateAiSettings({ apiKey: 'sk-test', baseUrl, approvedBaseUrl: baseUrl }).baseUrl,
    baseUrl
  )
})
