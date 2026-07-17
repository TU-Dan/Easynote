import { dedupeKanbanCards } from './kanban-model.js'

function mergeById(localItems = [], remoteItems = []) {
  const merged = new Map()
  for (const item of localItems) merged.set(item.id, item)
  for (const item of remoteItems) merged.set(item.id, { ...merged.get(item.id), ...item })
  return [...merged.values()].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
}

function mergeSummaries(localSummaries = {}, remoteSummaries = {}) {
  const merged = { ...localSummaries }
  for (const [date, remote] of Object.entries(remoteSummaries)) {
    const local = merged[date]
    if (!local || (remote?.ts || 0) >= (local?.ts || 0)) merged[date] = remote
  }
  return merged
}

export function deletionKey(deletion) {
  return `${deletion.entity}:${deletion.key}`
}

export function mergeDeletions(localDeletions = [], remoteDeletions = []) {
  const merged = new Map()
  for (const deletion of [...localDeletions, ...remoteDeletions]) {
    const key = deletionKey(deletion)
    const existing = merged.get(key)
    if (!existing || deletion.deletedAt > existing.deletedAt) merged.set(key, deletion)
  }
  return [...merged.values()]
}

export function mergeSyncState(localState, remoteState) {
  if (!remoteState) return localState
  const deletions = mergeDeletions(localState.deletions, remoteState.deletions)
  const deleted = new Set(deletions.map(deletionKey))
  const summaries = mergeSummaries(localState.summaries, remoteState.summaries)

  return {
    entries: mergeById(localState.entries, remoteState.entries)
      .filter(item => !deleted.has(`entry:${item.id}`)),
    summaries: Object.fromEntries(
      Object.entries(summaries).filter(([date]) => !deleted.has(`summary:${date}`))
    ),
    kanban: dedupeKanbanCards(mergeById(localState.kanban, remoteState.kanban))
      .filter(card => !deleted.has(`kanban:${card.id}`)),
    settings: { ...localState.settings, ...(remoteState.settings || {}) },
    deletions
  }
}
