const KEYS = {
  entries: 'qsj_entries',
  settings: 'qsj_settings',
  summaries: 'qsj_summaries',
  kanban: 'qsj_kanban',
  deletions: 'qsj_deletions',
  apiKey: 'qsj_api_key'
}

function cloneFallback(value) {
  return JSON.parse(JSON.stringify(value))
}

function safeRead(storage, key, fallback) {
  const raw = storage.getItem(key)
  if (raw === null) return cloneFallback(fallback)

  try {
    return JSON.parse(raw)
  } catch {
    storage.removeItem(key)
    return cloneFallback(fallback)
  }
}

export function createStorage({ persistent, session, onChange = () => {} }) {
  function write(key, value) {
    persistent.setItem(key, JSON.stringify(value))
    onChange()
  }

  function getSettings() {
    const stored = safeRead(persistent, KEYS.settings, {})
    let apiKey = session.getItem(KEYS.apiKey) || ''

    // One-time migration: remove legacy API keys from persistent browser storage.
    if (!apiKey && stored.apiKey) {
      apiKey = stored.apiKey
      session.setItem(KEYS.apiKey, apiKey)
    }
    if ('apiKey' in stored) {
      delete stored.apiKey
      persistent.setItem(KEYS.settings, JSON.stringify(stored))
    }

    return { ...stored, apiKey }
  }

  function saveSettings(settings = {}) {
    const { apiKey = '', ...publicSettings } = settings
    if (apiKey) session.setItem(KEYS.apiKey, apiKey)
    else session.removeItem(KEYS.apiKey)
    write(KEYS.settings, publicSettings)
  }

  return {
    getEntries: () => safeRead(persistent, KEYS.entries, []),
    saveEntries: value => write(KEYS.entries, value),
    getSettings,
    saveSettings,
    getSummaries: () => safeRead(persistent, KEYS.summaries, {}),
    saveSummaries: value => write(KEYS.summaries, value),
    getKanban: () => safeRead(persistent, KEYS.kanban, []),
    saveKanban: value => write(KEYS.kanban, value),
    getDeletions: () => safeRead(persistent, KEYS.deletions, []),
    saveDeletions: value => write(KEYS.deletions, value),
    clearAll() {
      Object.values(KEYS).forEach(key => persistent.removeItem(key))
      session.removeItem(KEYS.apiKey)
    }
  }
}
