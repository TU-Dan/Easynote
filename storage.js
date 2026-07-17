const KEYS = {
  entries: 'qsj_entries',
  settings: 'qsj_settings',
  summaries: 'qsj_summaries',
  kanban: 'qsj_kanban',
  deletions: 'qsj_deletions',
  apiKey: 'qsj_api_key',
  schemaVersion: 'qsj_schema_version'
}

const SCHEMA_VERSION = 1

function cloneFallback(value) {
  return JSON.parse(JSON.stringify(value))
}

function safeRead(storage, key, fallback, onRecover) {
  const raw = storage.getItem(key)
  if (raw === null) return cloneFallback(fallback)

  try {
    return JSON.parse(raw)
  } catch {
    const backupKey = `${key}_corrupt_${Date.now()}`
    try { storage.setItem(backupKey, raw) } catch { /* storage may be full */ }
    storage.removeItem(key)
    onRecover({ key, backupKey })
    return cloneFallback(fallback)
  }
}

export function createStorage({ persistent, session, onChange = () => {} }) {
  const recoveries = []
  const onRecover = recovery => recoveries.push(recovery)
  try { persistent.setItem(KEYS.schemaVersion, String(SCHEMA_VERSION)) } catch { /* storage may be unavailable */ }

  function write(key, value) {
    persistent.setItem(key, JSON.stringify(value))
    onChange()
  }

  function getSettings() {
    const stored = safeRead(persistent, KEYS.settings, {}, onRecover)
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
    getEntries: () => safeRead(persistent, KEYS.entries, [], onRecover),
    saveEntries: value => write(KEYS.entries, value),
    getSettings,
    saveSettings,
    getSummaries: () => safeRead(persistent, KEYS.summaries, {}, onRecover),
    saveSummaries: value => write(KEYS.summaries, value),
    getKanban: () => safeRead(persistent, KEYS.kanban, [], onRecover),
    saveKanban: value => write(KEYS.kanban, value),
    getDeletions: () => safeRead(persistent, KEYS.deletions, [], onRecover),
    saveDeletions: value => write(KEYS.deletions, value),
    consumeRecoveries() {
      return recoveries.splice(0)
    },
    clearAll() {
      Object.entries(KEYS)
        .filter(([name]) => name !== 'schemaVersion')
        .forEach(([, key]) => persistent.removeItem(key))
      session.removeItem(KEYS.apiKey)
    }
  }
}
