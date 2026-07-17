export function normalizeKanbanText(text = '') {
  return text
    .replace(/\*\*/g, '')
    .replace(/[，。！？、；：,.!?;:()[\]（）【】"'“”‘’]/g, '')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase()
}

export function kanbanSemanticKey(card) {
  return [
    card.date || '',
    card.type || '',
    card.done ? 'done' : 'open',
    normalizeKanbanText(card.text)
  ].join('|')
}

export function dedupeKanbanCards(cards = []) {
  const byKey = new Map()
  for (const card of cards) {
    const key = kanbanSemanticKey(card)
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, card)
      continue
    }

    const existingScore = (existing.source === 'summary' ? 2 : 1) + (existing.id ? 1 : 0)
    const cardScore = (card.source === 'summary' ? 2 : 1) + (card.id ? 1 : 0)
    if (cardScore > existingScore) byKey.set(key, { ...existing, ...card })
  }
  return [...byKey.values()]
}

export function textSimilarity(a, b) {
  const cjk = text => [...text].filter(char => char >= '一' && char <= '鿿')
  const left = new Set(cjk(a))
  const right = new Set(cjk(b))
  if (!left.size || !right.size) return 0
  const intersection = [...left].filter(char => right.has(char)).length
  return intersection / new Set([...left, ...right]).size
}
