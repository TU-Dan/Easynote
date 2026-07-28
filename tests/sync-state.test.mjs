import assert from 'node:assert/strict'
import test from 'node:test'

import { mergeSyncState } from '../sync-state.js'

test('remote tombstones suppress stale local entries and cards', () => {
  const local = {
    entries: [{ id: 'entry-old', timestamp: 1, content: '旧记录' }],
    summaries: {},
    kanban: [{ id: 'card-old', timestamp: 1, text: '旧卡片', type: 'todo', date: '2026-07-17' }],
    settings: { approvedBaseUrl: 'https://proxy.example.com' },
    deletions: []
  }
  const remote = {
    entries: [], summaries: {}, kanban: [], settings: {},
    deletions: [
      { entity: 'entry', key: 'entry-old', deletedAt: 2 },
      { entity: 'kanban', key: 'card-old', deletedAt: 2 }
    ]
  }

  const merged = mergeSyncState(local, remote)
  assert.deepEqual(merged.entries, [])
  assert.deepEqual(merged.kanban, [])
  assert.equal(merged.settings.approvedBaseUrl, 'https://proxy.example.com')
})

test('newer remote summaries win while newer local summaries survive', () => {
  const merged = mergeSyncState(
    { entries: [], kanban: [], deletions: [], settings: {}, summaries: {
      '2026-07-16': { text: 'local newer', ts: 20 },
      '2026-07-17': { text: 'local older', ts: 10 }
    } },
    { entries: [], kanban: [], deletions: [], settings: {}, summaries: {
      '2026-07-16': { text: 'remote older', ts: 10 },
      '2026-07-17': { text: 'remote newer', ts: 20 }
    } }
  )

  assert.equal(merged.summaries['2026-07-16'].text, 'local newer')
  assert.equal(merged.summaries['2026-07-17'].text, 'remote newer')
})
