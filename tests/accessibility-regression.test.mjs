import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

test('dialogs expose names and modal semantics', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8')

  assert.match(html, /id="settings-modal"[^>]+role="dialog"[^>]+aria-modal="true"[^>]+aria-labelledby="settings-title"/)
  assert.match(html, /id="cal-overlay"[^>]+role="dialog"[^>]+aria-modal="true"[^>]+aria-labelledby="cal-title"/)
  assert.match(html, /id="toast"[^>]+role="status"[^>]+aria-live="polite"/)
})

test('dialog keyboard behavior supports Escape and focus wrapping', async () => {
  const source = await readFile(new URL('app.js', root), 'utf8')

  assert.match(source, /e\.key === 'Escape'/)
  assert.match(source, /e\.key !== 'Tab'/)
  assert.match(source, /settingsReturnFocus\?\.focus\(\)/)
  assert.match(source, /calendarReturnFocus\?\.focus\(\)/)
})
