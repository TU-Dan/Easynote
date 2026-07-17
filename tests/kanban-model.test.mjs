import assert from 'node:assert/strict'
import test from 'node:test'

import { dedupeKanbanCards, normalizeKanbanText, textSimilarity } from '../kanban-model.js'

test('normalizes punctuation and formatting for matching', () => {
  assert.equal(normalizeKanbanText('**提交，报告！**'), '提交报告')
})

test('prefers summary cards when semantic duplicates exist', () => {
  const cards = dedupeKanbanCards([
    { id: 'record', text: '提交报告', type: 'todo', date: '2026-07-17', done: false, source: 'record' },
    { id: 'summary', text: '提交报告！', type: 'todo', date: '2026-07-17', done: false, source: 'summary' }
  ])

  assert.equal(cards.length, 1)
  assert.equal(cards[0].id, 'summary')
})

test('measures Chinese character overlap', () => {
  assert.ok(textSimilarity('整理项目计划', '整理项目周计划') >= 0.65)
  assert.equal(textSimilarity('abc', 'abc'), 0)
})
