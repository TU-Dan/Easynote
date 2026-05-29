import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const INSTANCE_ID = crypto.randomUUID()
const TABLES = {
  entries: 'qsj_entries',
  summaries: 'qsj_summaries',
  kanban: 'qsj_kanban_cards',
  settings: 'qsj_user_settings'
}

let client = null
let currentUser = null
let channel = null
let pullTimer = null
let handlers = {
  status: () => {},
  remoteState: () => {}
}

function setStatus(text) {
  handlers.status(text)
}

function requireClient() {
  if (!client) throw new Error('请先配置 Supabase')
  return client
}

async function loadSession() {
  const supabase = requireClient()
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  currentUser = data.session?.user || null
  return currentUser
}

function sortByTimestamp(items) {
  return [...(items || [])].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
}

function toEntry(row) {
  return {
    id: row.id,
    content: row.content,
    timestamp: row.timestamp_ms,
    date: row.entry_date
  }
}

function toSummaryMap(rows) {
  return Object.fromEntries((rows || []).map(row => [
    row.summary_date,
    {
      text: row.text,
      ts: row.updated_ms || new Date(row.updated_at).getTime()
    }
  ]))
}

function toKanbanCard(row) {
  return {
    id: row.id,
    text: row.text,
    type: row.card_type,
    done: row.done,
    date: row.card_date,
    timestamp: row.sort_order || 0
  }
}

function fromEntry(item) {
  return {
    id: item.id,
    user_id: currentUser.id,
    content: item.content,
    timestamp_ms: item.timestamp,
    entry_date: item.date,
    client_id: INSTANCE_ID,
    updated_at: new Date().toISOString()
  }
}

function fromSummary(date, summary) {
  return {
    user_id: currentUser.id,
    summary_date: date,
    text: summary.text || '',
    updated_ms: summary.ts || Date.now(),
    client_id: INSTANCE_ID,
    updated_at: new Date().toISOString()
  }
}

function fromKanbanCard(card, index) {
  return {
    id: card.id,
    user_id: currentUser.id,
    text: card.text,
    card_type: card.type,
    done: !!card.done,
    card_date: card.date,
    sort_order: index,
    client_id: INSTANCE_ID,
    updated_at: new Date().toISOString()
  }
}

function fromSettings(settings = {}) {
  return {
    user_id: currentUser.id,
    api_key: settings.apiKey || '',
    base_url: settings.baseUrl || '',
    client_id: INSTANCE_ID,
    updated_at: new Date().toISOString()
  }
}

export async function configureSync({ url, anonKey, onStatus, onRemoteState }) {
  handlers = {
    status: onStatus || (() => {}),
    remoteState: onRemoteState || (() => {})
  }

  if (!url || !anonKey) {
    setStatus('未配置同步')
    return null
  }

  client = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true
    }
  })

  const user = await loadSession()
  if (!user) {
    setStatus('未登录同步')
    return null
  }

  setStatus(`同步账号：${user.email}`)
  await subscribeRemoteChanges()
  return user
}

export async function signUpWithPassword(email, password) {
  const supabase = requireClient()
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: location.href }
  })
  if (error) throw error
  currentUser = data.session?.user || data.user || null
  return { user: currentUser, needsConfirmation: !data.session }
}

export async function resendSignupEmail(email) {
  const supabase = requireClient()
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: location.href }
  })
  if (error) throw error
}

export async function signInWithPassword(email, password) {
  const supabase = requireClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  currentUser = data.user
  await subscribeRemoteChanges()
  return currentUser
}

export async function signOutOfSync() {
  const supabase = requireClient()
  if (channel) {
    supabase.removeChannel(channel)
    channel = null
  }
  const { error } = await supabase.auth.signOut()
  if (error) throw error
  currentUser = null
  setStatus('未登录同步')
}

export function getCurrentUser() {
  return currentUser
}

export async function pullSyncState() {
  if (!currentUser) return null
  const supabase = requireClient()

  const [entriesRes, summariesRes, kanbanRes, settingsRes] = await Promise.all([
    supabase.from(TABLES.entries).select('id, content, timestamp_ms, entry_date').order('timestamp_ms'),
    supabase.from(TABLES.summaries).select('summary_date, text, updated_ms, updated_at'),
    supabase.from(TABLES.kanban).select('id, text, card_type, done, card_date, sort_order').order('sort_order'),
    supabase.from(TABLES.settings).select('api_key, base_url').maybeSingle()
  ])

  for (const res of [entriesRes, summariesRes, kanbanRes, settingsRes]) {
    if (res.error) throw res.error
  }

  return {
    entries: sortByTimestamp(entriesRes.data.map(toEntry)),
    summaries: toSummaryMap(summariesRes.data),
    kanban: kanbanRes.data.map(toKanbanCard),
    settings: {
      apiKey: settingsRes.data?.api_key || '',
      baseUrl: settingsRes.data?.base_url || ''
    }
  }
}

export async function pushSyncState(state) {
  if (!currentUser) return
  const supabase = requireClient()
  setStatus('正在同步...')

  const entries = state.entries || []
  const summaries = Object.entries(state.summaries || {})
  const kanban = state.kanban || []

  const nextEntryIds = entries.map(item => item.id)
  const nextSummaryDates = summaries.map(([date]) => date)
  const nextKanbanIds = kanban.map(card => card.id)

  const upserts = []
  if (entries.length) upserts.push(supabase.from(TABLES.entries).upsert(entries.map(fromEntry)))
  if (summaries.length) {
    upserts.push(
      supabase
        .from(TABLES.summaries)
        .upsert(summaries.map(([date, summary]) => fromSummary(date, summary)), { onConflict: 'user_id,summary_date' })
    )
  }
  if (kanban.length) upserts.push(supabase.from(TABLES.kanban).upsert(kanban.map(fromKanbanCard)))
  upserts.push(supabase.from(TABLES.settings).upsert(fromSettings(state.settings || {})))

  const upsertResults = await Promise.all(upserts)
  for (const res of upsertResults) {
    if (res.error) throw res.error
  }

  await deleteMissingRows(TABLES.entries, 'id', nextEntryIds)
  await deleteMissingRows(TABLES.summaries, 'summary_date', nextSummaryDates)
  await deleteMissingRows(TABLES.kanban, 'id', nextKanbanIds)

  setStatus(`已同步：${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`)
}

async function deleteMissingRows(table, column, keepValues) {
  const supabase = requireClient()
  let query = supabase.from(table).delete().eq('user_id', currentUser.id)
  query = keepValues.length ? query.not(column, 'in', `(${keepValues.map(v => `"${v}"`).join(',')})`) : query.not(column, 'is', null)
  const { error } = await query
  if (error) throw error
}

async function subscribeRemoteChanges() {
  const supabase = requireClient()
  if (!currentUser) return
  if (channel) supabase.removeChannel(channel)

  channel = supabase.channel(`qsj-data-${currentUser.id}`)
  for (const table of Object.values(TABLES)) {
    channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table,
        filter: `user_id=eq.${currentUser.id}`
      },
      payload => {
        if (payload.new?.client_id === INSTANCE_ID) return
        clearTimeout(pullTimer)
        pullTimer = setTimeout(async () => {
          try {
            handlers.remoteState(await pullSyncState())
          } catch (err) {
            setStatus(`同步失败：${err.message}`)
          }
        }, 300)
      }
    )
  }

  channel.subscribe()
}
