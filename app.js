import { generateDailySummary, extractAllFromSummary } from './api.js'
import { configureSync, resendSignupEmail, signInWithPassword, signUpWithPassword, signOutOfSync, getCurrentUser, pullSyncState, pushSyncState } from './supabase-sync.js'
import { SUPABASE_CONFIG } from './supabase-config.js'

// ── Storage ───────────────────────────────────────────────
const K = { entries: 'qsj_entries', settings: 'qsj_settings', summaries: 'qsj_summaries', kanban: 'qsj_kanban' }
function readJson(key, fallback) {
  return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback))
}
function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
  queueSync()
}
const db = {
  getEntries:   () => readJson(K.entries, []),
  saveEntries:  v  => writeJson(K.entries, v),
  getSettings:  () => readJson(K.settings, {}),
  saveSettings: v  => writeJson(K.settings, v),
  getSummaries: () => readJson(K.summaries, {}),
  saveSummaries:v  => writeJson(K.summaries, v),
  getKanban:    () => readJson(K.kanban, []),
  saveKanban:   v  => writeJson(K.kanban, v)
}

function clearLocalData() {
  localStorage.removeItem(K.entries)
  localStorage.removeItem(K.summaries)
  localStorage.removeItem(K.kanban)
  localStorage.removeItem(K.settings)
}

// ── Supabase sync ─────────────────────────────────────────
let syncReady = false
let syncTimer = null
let applyingRemoteState = false

function syncableSettings(settings = db.getSettings()) {
  return {
    apiKey: settings.apiKey || '',
    baseUrl: settings.baseUrl || ''
  }
}

function getLocalState() {
  return {
    entries: db.getEntries(),
    summaries: db.getSummaries(),
    kanban: db.getKanban(),
    settings: syncableSettings()
  }
}

function mergeById(localItems, remoteItems) {
  const merged = new Map()
  for (const item of localItems || []) merged.set(item.id, item)
  for (const item of remoteItems || []) merged.set(item.id, { ...merged.get(item.id), ...item })
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

function mergeState(localState, remoteState) {
  if (!remoteState) return localState
  return {
    entries: mergeById(localState.entries, remoteState.entries),
    summaries: mergeSummaries(localState.summaries, remoteState.summaries),
    kanban: mergeById(localState.kanban, remoteState.kanban),
    settings: {
      ...localState.settings,
      ...syncableSettings(remoteState.settings || {})
    }
  }
}

function replaceLocalState(nextState) {
  const localSettings = db.getSettings()

  writeJson(K.entries, nextState.entries || [])
  writeJson(K.summaries, nextState.summaries || {})
  writeJson(K.kanban, nextState.kanban || [])
  writeJson(K.settings, {
    ...localSettings,
    ...syncableSettings(nextState.settings || {}),
    syncEmail: localSettings.syncEmail || ''
  })
}

function applyRemoteState(remoteState) {
  if (!remoteState || !syncReady) return
  applyingRemoteState = true
  replaceLocalState(mergeState(getLocalState(), remoteState))
  applyingRemoteState = false
  renderAll()
}

function queueSync(delay = 900) {
  if (!syncReady || applyingRemoteState) return
  clearTimeout(syncTimer)
  syncTimer = setTimeout(async () => {
    try {
      await pushSyncState(getLocalState())
    } catch (err) {
      setSyncStatus(`同步失败：${err.message}`)
    }
  }, delay)
}

function setSyncStatus(text) {
  const el = document.getElementById('sync-status')
  if (el) el.textContent = text
}

// ── Helpers ───────────────────────────────────────────────
function todayKey() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
}
function pad(n) { return String(n).padStart(2, '0') }
function todayLabel() {
  return new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })
}
function fmtTime(ts) { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }
function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }
function textSimilarity(a, b) {
  const cjk = s => [...s].filter(c => c >= '一' && c <= '鿿')
  const sa = new Set(cjk(a)), sb = new Set(cjk(b))
  if (!sa.size || !sb.size) return 0
  const intersection = [...sa].filter(c => sb.has(c)).length
  return intersection / (new Set([...sa, ...sb]).size)
}
function md2html(text) {
  const bold = s => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  let html = '', inList = false
  for (const line of text.split('\n')) {
    if (/^#{2,3}\s/.test(line)) {
      if (inList) { html += '</ul>'; inList = false }
      html += line.replace(/^#{2,3}\s+(.+)$/, (_, t) => `<h3>${bold(t)}</h3>`)
    } else if (line.startsWith('- ')) {
      if (!inList) { html += '<ul>'; inList = true }
      html += `<li>${bold(line.slice(2))}</li>`
    } else if (line.trim() === '') {
      if (inList) { html += '</ul>'; inList = false }
    } else {
      if (inList) { html += '</ul>'; inList = false }
      if (line.trim()) html += `<p>${bold(line)}</p>`
    }
  }
  if (inList) html += '</ul>'
  return html
}

// ── Toast ─────────────────────────────────────────────────
let toastTimer = null
function toast(msg, ms = 2200) {
  const el = document.getElementById('toast')
  el.textContent = msg
  el.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { el.hidden = true }, ms)
}

// ── State ─────────────────────────────────────────────────
let activeTab = 'capture'
let kanbanFilter = 'todo'
let kanbanDateFilter = 'all'
let kanbanStatusFilter = 'open'
let authMode = 'login'
let pendingConfirmationEmail = ''
let summaryLoadingTimer = null
let summaryProgressTimer = null
let summaryProgress = 0
let summaryController = null
let summaryGenerating = false
let summaryStreamingText = ''

// ── Tab switching ─────────────────────────────────────────
function switchTab(tab) {
  activeTab = tab
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'))
  document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'))
  document.getElementById(`tab-${tab}`).classList.add('active')
  document.querySelector(`.nav-btn[data-tab="${tab}"]`).classList.add('active')
  if (tab === 'today')  renderToday()
  if (tab === 'kanban') renderKanban()
}

// ── Render: Capture tab ───────────────────────────────────
function renderRecent() {
  const list = document.getElementById('recent-list')
  const entries = db.getEntries().slice(-5).reverse()
  if (!entries.length) {
    list.innerHTML = '<p style="color:var(--text2);font-size:14px">暂无记录</p>'
    return
  }
  list.innerHTML = entries.map(e => `
    <div class="entry-card">
      <div class="entry-body">
        <div class="entry-text">${escHtml(e.content)}</div>
        <div class="entry-meta">${fmtTime(e.timestamp)}</div>
      </div>
    </div>
  `).join('')
}

function saveEntry() {
  const input = document.getElementById('capture-input')
  const content = input.value.trim()
  if (!content) return
  const entries = db.getEntries()
  entries.push({ id: crypto.randomUUID(), content, timestamp: Date.now(), date: todayKey() })
  db.saveEntries(entries)
  input.value = ''
  input.focus()
  renderRecent()
  toast('已保存 ✓')
}

// ── Render: Today tab ─────────────────────────────────────
function renderToday() {
  renderTodaySummaryArea()
}

function renderTodaySummaryArea() {
  const today = todayKey()
  const entries = db.getEntries().filter(e => e.date === today)
  const saved = db.getSummaries()[today]

  if (summaryGenerating) {
    document.getElementById('today-summary-idle').hidden = true
    document.getElementById('today-summary-loading').hidden = false
    document.getElementById('today-summary-result').hidden = true
    document.getElementById('today-gen-btn').disabled = true
    document.getElementById('today-nav-progress').hidden = false
    setSummaryProgress(summaryProgress)
    renderStreamingSummary(summaryStreamingText)
    document.getElementById('today-entry-count').textContent =
      entries.length ? `今日已记录 ${entries.length} 条` : '今天还没有记录'
    return
  }

  document.getElementById('today-summary-idle').hidden    = !!saved
  document.getElementById('today-summary-loading').hidden = true
  document.getElementById('today-summary-result').hidden  = !saved

  document.getElementById('today-entry-count').textContent =
    entries.length ? `今日已记录 ${entries.length} 条` : '今天还没有记录'

  if (saved) {
    document.getElementById('today-summary-preview').innerHTML = md2html(saved.text)
    document.getElementById('today-summary-text').value = saved.text
    showSummaryPreview()
  }
}


// ── Today: generate summary ───────────────────────────────
async function handleGenerateSummary() {
  const settings = db.getSettings()
  if (!settings.apiKey) { toast('请先在设置中配置 API Key'); openSettings(); return }
  const today   = todayKey()
  const entries = db.getEntries().filter(e => e.date === today)
  if (!entries.length) { toast('今天还没有记录'); return }

  document.getElementById('today-summary-idle').hidden    = true
  document.getElementById('today-summary-result').hidden  = true
  document.getElementById('today-summary-loading').hidden = false
  document.getElementById('today-nav-progress').hidden = false
  document.getElementById('today-gen-btn').disabled = true
  document.getElementById('today-summary-loading-text').textContent = '正在归纳今天的内容...'
  summaryGenerating = true
  summaryStreamingText = ''
  renderStreamingSummary('')
  setSummaryProgress(4)
  startSummaryProgress()
  summaryController = new AbortController()
  clearTimeout(summaryLoadingTimer)
  summaryLoadingTimer = setTimeout(() => {
    document.getElementById('today-summary-loading-text').textContent = 'AI 还在处理，内容较多时会慢一些...'
  }, 18000)

  try {
    const text = await generateDailySummary(entries, {
      ...settings,
      controller: summaryController,
      onChunk: (_chunk, content) => {
        if (!summaryGenerating) return
        summaryStreamingText = content
        renderStreamingSummary(summaryStreamingText)
        if (summaryProgress < 35) setSummaryProgress(35)
        const generatedLength = content.trim().length
        if (generatedLength > 40) {
          document.getElementById('today-summary-loading-text').textContent =
            `正在生成总结，已收到 ${generatedLength} 字...`
          setSummaryProgress(Math.min(96, 35 + Math.floor(generatedLength / 18)))
        } else {
          document.getElementById('today-summary-loading-text').textContent = 'AI 已开始生成...'
        }
      }
    }, today, db.getKanban())
    setSummaryProgress(100)
    const summaries = db.getSummaries()
    summaries[today] = { text, ts: Date.now() }
    db.saveSummaries(summaries)
    toast('今日总结已生成 ✓')
    summaryGenerating = false
    summaryStreamingText = ''
    document.getElementById('today-summary-loading').hidden = true
    document.getElementById('today-summary-result').hidden  = false
    document.getElementById('today-summary-preview').innerHTML = md2html(text)
    document.getElementById('today-summary-text').value = text
    showSummaryPreview()
  } catch (err) {
    summaryGenerating = false
    summaryStreamingText = ''
    toast(err.name === 'AbortError' ? err.message : `生成失败: ${err.message}`, 4000)
  } finally {
    clearTimeout(summaryLoadingTimer)
    stopSummaryProgress()
    summaryController = null
    document.getElementById('today-summary-loading').hidden = true
    document.getElementById('today-nav-progress').hidden = true
    document.getElementById('today-gen-btn').disabled = false
    renderStreamingSummary('')
    const hasSummary = !!db.getSummaries()[today]
    document.getElementById('today-summary-idle').hidden = hasSummary
    document.getElementById('today-summary-result').hidden = !hasSummary
  }
}

function renderStreamingSummary(text) {
  const preview = document.getElementById('today-summary-stream')
  if (!preview) return
  preview.hidden = !text.trim()
  preview.innerHTML = text.trim() ? md2html(text) : ''
}

function setSummaryProgress(value) {
  summaryProgress = Math.max(0, Math.min(100, Math.round(value)))
  document.getElementById('today-summary-progress-text').textContent = `${summaryProgress}%`
  document.getElementById('today-summary-progress-bar').style.width = `${summaryProgress}%`
  document.getElementById('today-nav-progress').textContent = `${summaryProgress}%`
}

function startSummaryProgress() {
  clearInterval(summaryProgressTimer)
  summaryProgressTimer = setInterval(() => {
    const remaining = 92 - summaryProgress
    if (remaining <= 0) return
    const step = summaryProgress < 35 ? 4 : summaryProgress < 70 ? 2 : 1
    setSummaryProgress(summaryProgress + Math.min(step, remaining))
  }, 1400)
}

function stopSummaryProgress() {
  clearInterval(summaryProgressTimer)
  summaryProgressTimer = null
}

function cancelSummaryGeneration() {
  if (summaryController) summaryController.abort()
}

// ── Today: add to kanban ──────────────────────────────────
function handleAddToKanban() {
  const today = todayKey()
  const text = document.getElementById('today-summary-text').value.trim()
  const items = text ? extractAllFromSummary(text) : []
  if (!items.length) { toast('没有识别到可加入的事项'); return }

  // Persist any edits the user made
  const summaries = db.getSummaries()
  if (summaries[today]) { summaries[today].text = text; db.saveSummaries(summaries) }

  // Keep only manually-added items (not today's summary items)
  const existing = db.getKanban().filter(c =>
    !(c.date === today && (c.source === 'summary' || !c.source))
  )

  // Dedup only against pre-existing items — items in the current batch
  // must NOT dedup each other (todo + done version of same task both belong)
  let added = 0, doneAdded = 0
  const newItems = []
  for (const item of items) {
    if (!existing.some(c => textSimilarity(c.text, item.text) >= 0.65)) {
      newItems.push({ id: crypto.randomUUID(), text: item.text, type: item.type, done: item.done ?? false, date: today, source: 'summary' })
      added++
      if (item.done) doneAdded++
    }
  }
  db.saveKanban([...existing, ...newItems])

  if (added === 0) { toast('看板已是最新'); return }
  toast('已加入看板 ✓')
  switchTab('kanban')
}


// ── Kanban ────────────────────────────────────────────────
const TYPE_ICONS = { todo: null, reminder: '⏰', quote: '💬', thought: '💭' }
const FILTER_LABELS = { todo: 'Todo', reminder: '提醒', quote: '好句', thought: '感触', all: '全部' }

function weekStartKey() {
  const d = new Date()
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const mon = new Date(d); mon.setDate(d.getDate() + diff)
  return `${mon.getFullYear()}-${pad(mon.getMonth()+1)}-${pad(mon.getDate())}`
}

function renderKanban() {
  const allCards = db.getKanban()
  let cards = kanbanFilter === 'all' ? allCards : allCards.filter(c => c.type === kanbanFilter)
  if (kanbanDateFilter === 'today') cards = cards.filter(c => c.date === todayKey())
  else if (kanbanDateFilter === 'week') { const ws = weekStartKey(); cards = cards.filter(c => c.date >= ws) }
  cards = kanbanStatusFilter === 'done' ? cards.filter(c => c.done) : cards.filter(c => !c.done)
  const list     = document.getElementById('kanban-list')
  const empty    = document.getElementById('kanban-empty')
  const clearBtn = document.getElementById('kanban-clear-done-btn')

  clearBtn.hidden = kanbanStatusFilter !== 'done' || !allCards.some(c => c.done)

  // Stats: count open/done across current type+date filter (ignore status filter)
  const statsBase = kanbanFilter === 'all' ? allCards : allCards.filter(c => c.type === kanbanFilter)
  const statsDated = kanbanDateFilter === 'today' ? statsBase.filter(c => c.date === todayKey())
    : kanbanDateFilter === 'week' ? (() => { const ws = weekStartKey(); return statsBase.filter(c => c.date >= ws) })()
    : statsBase
  const openCount = statsDated.filter(c => !c.done).length
  const doneCount = statsDated.filter(c => c.done).length
  // Put counts on the status filter tabs
  const openBtn = document.querySelector('#kanban-status-filters [data-status="open"]')
  const doneBtn = document.querySelector('#kanban-status-filters [data-status="done"]')
  if (openBtn) openBtn.innerHTML = `未完成${openCount ? ` <span class="tab-count">${openCount}</span>` : ''}`
  if (doneBtn) doneBtn.innerHTML = `已完成${doneCount ? ` <span class="tab-count">${doneCount}</span>` : ''}`

  if (!cards.length) {
    list.innerHTML = ''
    empty.hidden = false
    return
  }
  empty.hidden = true

  list.innerHTML = cards.map(card => {
    const icon = TYPE_ICONS[card.type]
    const isTodo = card.type === 'todo'
    return `
      <div class="k-card" data-id="${card.id}" data-type="${card.type}">
        <div class="k-del-bg">
          <button class="k-del-btn js-k-del" data-id="${card.id}">删除</button>
        </div>
        <div class="k-inner" data-id="${card.id}">
          ${isTodo
            ? `<button class="k-check${card.done ? ' checked' : ''} js-k-check" data-id="${card.id}"></button>`
            : `<span class="k-type-icon">${icon}</span>`
          }
          <div class="k-body">
            <div class="k-text${card.done ? ' done' : ''}">${escHtml(card.text)}</div>
            <div class="k-date">${card.date}</div>
          </div>
          <div class="k-drag js-drag" data-id="${card.id}">
            <svg width="14" height="20" viewBox="0 0 14 20" fill="currentColor">
              <circle cx="4" cy="4" r="1.5"/><circle cx="10" cy="4" r="1.5"/>
              <circle cx="4" cy="10" r="1.5"/><circle cx="10" cy="10" r="1.5"/>
              <circle cx="4" cy="16" r="1.5"/><circle cx="10" cy="16" r="1.5"/>
            </svg>
          </div>
        </div>
      </div>
    `
  }).join('')

  // Checkbox toggle
  list.querySelectorAll('.js-k-check').forEach(btn =>
    btn.addEventListener('click', e => {
      e.stopPropagation()
      const cards = db.getKanban()
      const card = cards.find(c => c.id === btn.dataset.id)
      if (card) { card.done = !card.done; db.saveKanban(cards); renderKanban() }
    })
  )

  // Delete button (revealed by swipe)
  list.querySelectorAll('.js-k-del').forEach(btn =>
    btn.addEventListener('click', () => {
      db.saveKanban(db.getKanban().filter(c => c.id !== btn.dataset.id))
      renderKanban()
    })
  )

  initKanbanGestures()
}

// ── Kanban: swipe-to-delete + touch drag ──────────────────
let gesture = null      // { type: 'swipe'|'drag', ... }
let swiped = new Set()  // card IDs currently swiped open

function initKanbanGestures() {
  const list = document.getElementById('kanban-list')
  list.removeEventListener('touchstart', onTS)
  list.removeEventListener('touchmove',  onTM)
  list.removeEventListener('touchend',   onTE)
  list.addEventListener('touchstart', onTS, { passive: true })
  list.addEventListener('touchmove',  onTM, { passive: false })
  list.addEventListener('touchend',   onTE, { passive: true })
}

function onTS(e) {
  // Close open swipes on tap elsewhere
  if (!e.target.closest('.k-inner') && !e.target.closest('.k-del-bg')) {
    closeAllSwipes()
  }

  const handle = e.target.closest('.js-drag')
  if (handle) {
    startDrag(e, handle.closest('.k-card'))
    return
  }

  const inner = e.target.closest('.k-inner')
  if (!inner) return
  const id = inner.dataset.id
  gesture = { type: 'pending', id, inner, startX: e.touches[0].clientX, startY: e.touches[0].clientY, baseX: swiped.has(id) ? -80 : 0 }
}

function onTM(e) {
  if (!gesture) return

  if (gesture.type === 'drag') {
    moveDrag(e)
    e.preventDefault()
    return
  }

  const dx = e.touches[0].clientX - gesture.startX
  const dy = e.touches[0].clientY - gesture.startY

  if (gesture.type === 'pending') {
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return
    if (Math.abs(dy) > Math.abs(dx)) { gesture = null; return }
    gesture.type = 'swipe'
  }

  if (gesture.type === 'swipe') {
    const x = Math.max(Math.min(gesture.baseX + dx, 0), -80)
    gesture.inner.style.transition = 'none'
    gesture.inner.style.transform = `translateX(${x}px)`
    e.preventDefault()
  }
}

function onTE(e) {
  if (!gesture) return

  if (gesture.type === 'drag') {
    endDrag()
    return
  }

  if (gesture.type === 'swipe') {
    const dx = e.changedTouches[0].clientX - gesture.startX
    const final = gesture.baseX + dx
    gesture.inner.style.transition = 'transform .2s ease'

    if (final < -40) {
      gesture.inner.style.transform = 'translateX(-80px)'
      swiped.add(gesture.id)
    } else {
      gesture.inner.style.transform = 'translateX(0)'
      swiped.delete(gesture.id)
    }
  }

  gesture = null
}

function closeAllSwipes() {
  swiped.forEach(id => {
    const inner = document.querySelector(`.k-inner[data-id="${id}"]`)
    if (inner) { inner.style.transition = 'transform .2s ease'; inner.style.transform = 'translateX(0)' }
  })
  swiped.clear()
}

// ── Kanban: touch drag-to-reorder ────────────────────────
let drag = null

function startDrag(e, card) {
  const list = document.getElementById('kanban-list')
  const rect = card.getBoundingClientRect()

  const ph = document.createElement('div')
  ph.className = 'k-placeholder'
  ph.style.height = rect.height + 'px'
  card.after(ph)

  card.style.width  = rect.width  + 'px'
  card.style.left   = rect.left   + 'px'
  card.style.top    = rect.top    + 'px'
  card.classList.add('k-dragging')

  drag = { card, startY: e.touches[0].clientY, origTop: rect.top, ph, list }
  gesture = { type: 'drag' }
}

function moveDrag(e) {
  if (!drag) return
  const dy = e.touches[0].clientY - drag.startY
  drag.card.style.top = (drag.origTop + dy) + 'px'

  const midY = drag.card.getBoundingClientRect().top + drag.card.getBoundingClientRect().height / 2
  const siblings = [...drag.list.querySelectorAll('.k-card:not(.k-dragging)')]
  let placed = false
  for (const s of siblings) {
    const r = s.getBoundingClientRect()
    if (midY < r.top + r.height / 2) {
      drag.list.insertBefore(drag.ph, s)
      placed = true
      break
    }
  }
  if (!placed) drag.list.appendChild(drag.ph)
}

function endDrag() {
  if (!drag) return
  drag.card.classList.remove('k-dragging')
  drag.card.style.width = drag.card.style.left = drag.card.style.top = ''
  drag.list.insertBefore(drag.card, drag.ph)
  drag.ph.remove()

  // Persist new order
  const newOrder = [...drag.list.querySelectorAll('.k-card')].map(c => c.dataset.id)
  const all = db.getKanban()
  const sorted = newOrder.map(id => all.find(c => c.id === id)).filter(Boolean)
  const rest   = all.filter(c => !sorted.find(s => s.id === c.id))
  db.saveKanban([...sorted, ...rest])

  drag = null
  gesture = null
}

// ── Summary edit toggle ───────────────────────────────────
function showSummaryPreview() {
  document.getElementById('today-summary-preview').hidden = false
  document.getElementById('today-summary-text').hidden    = true
  document.getElementById('today-edit-btn').textContent  = '编辑'
}

function showSummaryEdit() {
  document.getElementById('today-summary-preview').hidden = true
  const ta = document.getElementById('today-summary-text')
  ta.hidden = false
  ta.style.height = 'auto'
  ta.style.height = ta.scrollHeight + 'px'
  document.getElementById('today-edit-btn').textContent = '完成'
  ta.focus()
}

// ── Settings ──────────────────────────────────────────────
function openSettings() {
  const s = db.getSettings()
  const user = getCurrentUser()
  document.getElementById('setting-api-key').value  = s.apiKey  || ''
  document.getElementById('setting-base-url').value = s.baseUrl || ''
  document.getElementById('account-email').textContent = user?.email ? `当前账号：${user.email}` : '未登录'
  document.getElementById('settings-modal').hidden       = false
}
function closeSettings() { document.getElementById('settings-modal').hidden = true }
async function saveSettingsForm() {
  const prev = db.getSettings()
  db.saveSettings({
    ...prev,
    apiKey:  document.getElementById('setting-api-key').value.trim(),
    baseUrl: document.getElementById('setting-base-url').value.trim()
  })
  queueSync(100)
  closeSettings()
  toast('设置已保存')
}

async function initAuth() {
  syncReady = false

  try {
    const user = await configureSync({
      url: SUPABASE_CONFIG.url,
      anonKey: SUPABASE_CONFIG.anonKey,
      onStatus: setSyncStatus,
      onRemoteState: applyRemoteState
    })

    if (!user) {
      showAuthScreen()
      return
    }
    await enterApp()
  } catch (err) {
    showAuthScreen(`登录服务不可用：${err.message}`)
  }
}

async function enterApp() {
  const localState = getLocalState()
  const remoteState = await pullSyncState()
  const nextState = mergeState(localState, remoteState)

  syncReady = true
  applyingRemoteState = true
  replaceLocalState(nextState)
  applyingRemoteState = false
  document.getElementById('auth-screen').hidden = true
  document.getElementById('app-shell').hidden = false
  setSyncStatus(`已登录：${getCurrentUser()?.email || ''}`)
  renderAll()
  queueSync(100)
  setTimeout(() => document.getElementById('capture-input').focus(), 150)
}

function showAuthScreen(message = '') {
  document.getElementById('app-shell').hidden = true
  document.getElementById('auth-screen').hidden = false
  setAuthStatus(message)
}

function setAuthMode(mode) {
  authMode = mode
  document.getElementById('auth-login-tab').classList.toggle('active', mode === 'login')
  document.getElementById('auth-register-tab').classList.toggle('active', mode === 'register')
  document.getElementById('auth-submit-btn').textContent = mode === 'login' ? '登录' : '注册账号'
  document.getElementById('auth-password').autocomplete = mode === 'login' ? 'current-password' : 'new-password'
  document.getElementById('auth-resend-btn').hidden = true
  pendingConfirmationEmail = ''
  setAuthStatus('')
}

function setAuthStatus(text) {
  document.getElementById('auth-status').textContent = text
}

async function handleAuthSubmit() {
  if (!SUPABASE_CONFIG.url || !SUPABASE_CONFIG.anonKey) {
    setAuthStatus('应用还没有配置 Supabase')
    return
  }

  const email = document.getElementById('auth-email').value.trim()
  const password = document.getElementById('auth-password').value
  if (!email) { setAuthStatus('请输入邮箱'); return }
  if (password.length < 6) { setAuthStatus('密码至少 6 位'); return }

  try {
    setAuthStatus(authMode === 'login' ? '正在登录...' : '正在注册...')
    await configureSync({
      url: SUPABASE_CONFIG.url,
      anonKey: SUPABASE_CONFIG.anonKey,
      onStatus: setSyncStatus,
      onRemoteState: applyRemoteState
    })

    if (authMode === 'register') {
      const result = await signUpWithPassword(email, password)
      if (result.needsConfirmation) {
        pendingConfirmationEmail = email
        document.getElementById('auth-resend-btn').hidden = false
        setAuthStatus('注册请求已提交，请检查验证邮件；没有收到可重发')
        return
      }
    } else {
      await signInWithPassword(email, password)
    }

    await enterApp()
  } catch (err) {
    setAuthStatus(err.message)
  }
}

async function handleResendSignupEmail() {
  const email = pendingConfirmationEmail || document.getElementById('auth-email').value.trim()
  if (!email) { setAuthStatus('请输入邮箱'); return }

  try {
    setAuthStatus('正在重发验证邮件...')
    await configureSync({
      url: SUPABASE_CONFIG.url,
      anonKey: SUPABASE_CONFIG.anonKey,
      onStatus: setSyncStatus,
      onRemoteState: applyRemoteState
    })
    await resendSignupEmail(email)
    pendingConfirmationEmail = email
    setAuthStatus('验证邮件已重发，请检查收件箱和垃圾邮件')
  } catch (err) {
    setAuthStatus(err.message)
  }
}

async function handleSignOut() {
  try {
    syncReady = false
    await signOutOfSync()
    clearLocalData()
    renderAll()
    closeSettings()
    showAuthScreen('已退出账号')
  } catch (err) {
    toast(`退出失败：${err.message}`, 4000)
  }
}

function renderAll() {
  renderRecent()
  if (activeTab === 'today') renderToday()
  if (activeTab === 'kanban') renderKanban()
}


// ── Init ──────────────────────────────────────────────────
function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('sw.js', { updateViaCache: 'none' })
      .then(reg => reg.update())
      .catch(() => {})
  }

  // Auth
  document.getElementById('auth-login-tab').addEventListener('click', () => setAuthMode('login'))
  document.getElementById('auth-register-tab').addEventListener('click', () => setAuthMode('register'))
  document.getElementById('auth-submit-btn').addEventListener('click', handleAuthSubmit)
  document.getElementById('auth-resend-btn').addEventListener('click', handleResendSignupEmail)
  document.getElementById('auth-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleAuthSubmit()
  })
  document.getElementById('auth-email').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('auth-password').focus()
  })

  // Capture
  document.getElementById('save-btn').addEventListener('click', saveEntry)
  document.getElementById('capture-input').addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') saveEntry()
  })

  // Tabs
  document.querySelectorAll('.nav-btn').forEach(btn =>
    btn.addEventListener('click', () => switchTab(btn.dataset.tab))
  )

  // Today: summary
  document.getElementById('today-gen-btn').addEventListener('click', handleGenerateSummary)
  document.getElementById('today-summary-cancel-btn').addEventListener('click', cancelSummaryGeneration)
  document.getElementById('today-regen-btn').addEventListener('click', () => {
    const today = todayKey()
    const s = db.getSummaries()
    delete s[today]
    db.saveSummaries(s)
    handleGenerateSummary()
  })
  document.getElementById('today-add-kanban-btn').addEventListener('click', handleAddToKanban)
  document.getElementById('today-edit-btn').addEventListener('click', () => {
    const isEditing = !document.getElementById('today-summary-text').hidden
    if (isEditing) {
      const text = document.getElementById('today-summary-text').value.trim()
      const today = todayKey()
      const s = db.getSummaries()
      if (s[today]) { s[today].text = text; db.saveSummaries(s) }
      document.getElementById('today-summary-preview').innerHTML = md2html(text)
      showSummaryPreview()
    } else {
      showSummaryEdit()
    }
  })

  // Kanban type filter
  document.getElementById('kanban-filter-trigger').addEventListener('click', () => {
    const menu = document.getElementById('kanban-filters')
    const nextHidden = !menu.hidden
    menu.hidden = nextHidden
    document.getElementById('kanban-filter-trigger').setAttribute('aria-expanded', String(!nextHidden))
  })
  document.getElementById('kanban-filters').addEventListener('click', e => {
    const btn = e.target.closest('.tag-filter-option')
    if (!btn) return
    kanbanFilter = btn.dataset.filter
    document.getElementById('kanban-filter-label').textContent = FILTER_LABELS[kanbanFilter] || kanbanFilter
    document.querySelectorAll('#kanban-filters .tag-filter-option').forEach(b => b.classList.toggle('active', b === btn))
    document.getElementById('kanban-filters').hidden = true
    document.getElementById('kanban-filter-trigger').setAttribute('aria-expanded', 'false')
    renderKanban()
  })
  document.addEventListener('click', e => {
    if (!e.target.closest('.tag-filter')) {
      document.getElementById('kanban-filters').hidden = true
      document.getElementById('kanban-filter-trigger').setAttribute('aria-expanded', 'false')
    }
  })

  // Kanban date filter
  document.getElementById('kanban-date-filters').addEventListener('click', e => {
    const btn = e.target.closest('.date-segment-btn')
    if (!btn) return
    kanbanDateFilter = btn.dataset.date
    document.querySelectorAll('#kanban-date-filters .date-segment-btn').forEach(b => b.classList.toggle('active', b === btn))
    renderKanban()
  })

  // Kanban status filter
  document.getElementById('kanban-status-filters').addEventListener('click', e => {
    const btn = e.target.closest('.status-filter-btn')
    if (!btn) return
    kanbanStatusFilter = btn.dataset.status
    document.querySelectorAll('#kanban-status-filters .status-filter-btn').forEach(b => b.classList.toggle('active', b === btn))
    renderKanban()
  })

  // Kanban clear done
  document.getElementById('kanban-clear-done-btn').addEventListener('click', () => {
    db.saveKanban(db.getKanban().filter(c => !c.done))
    renderKanban()
  })

  // Settings
  document.getElementById('settings-btn').addEventListener('click', openSettings)
  document.getElementById('close-settings-btn').addEventListener('click', closeSettings)
  document.getElementById('modal-backdrop').addEventListener('click', closeSettings)
  document.getElementById('save-settings-btn').addEventListener('click', saveSettingsForm)
  document.getElementById('sign-out-btn').addEventListener('click', handleSignOut)

  document.getElementById('today-summary-text').addEventListener('input', e => {
    e.target.style.height = 'auto'
    e.target.style.height = e.target.scrollHeight + 'px'
  })

  document.getElementById('capture-today-label').textContent = todayLabel()
  setAuthMode('login')
  initAuth()
}

document.addEventListener('DOMContentLoaded', init)
