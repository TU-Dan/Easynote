import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

test('service worker rejects cross-origin requests before caching', async () => {
  const source = await readFile(new URL('sw.js', root), 'utf8')

  assert.match(source, /url\.origin !== self\.location\.origin/)
  assert.match(source, /if \(!isCacheableRequest\(e\.request\)\) return/)
})

test('sync uses explicit tombstones instead of snapshot-difference deletes', async () => {
  const [syncSource, appSource, schemaSource] = await Promise.all([
    readFile(new URL('supabase-sync.js', root), 'utf8'),
    readFile(new URL('app.js', root), 'utf8'),
    readFile(new URL('supabase.sql', root), 'utf8')
  ])

  assert.doesNotMatch(syncSource, /deleteMissingRows|\.delete\(\)/)
  assert.match(syncSource, /TABLES\.deletions/)
  assert.match(appSource, /recordDeletions\('entry'/)
  assert.match(appSource, /recordDeletions\('kanban'/)
  assert.match(schemaSource, /create table if not exists public\.qsj_deletions/)
})
