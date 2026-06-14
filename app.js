import { generateDailySummary, generateDailyLetter, extractAllFromSummary } from './api.js'
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

function normalizeKanbanText(text = '') {
  return text
    .replace(/\*\*/g, '')
    .replace(/[，。！？、；：,.!?;:()[\]（）【】"'“”‘’]/g, '')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase()
}

function kanbanSemanticKey(card) {
  return [
    card.date || '',
    card.type || '',
    card.done ? 'done' : 'open',
    normalizeKanbanText(card.text)
  ].join('|')
}

function dedupeKanbanCards(cards = []) {
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
    kanban: dedupeKanbanCards(mergeById(localState.kanban, remoteState.kanban)),
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
let kanbanDateFilter    = 'today'
let kanbanDateFrom      = null
let kanbanDateTo        = null
let prevKanbanDateFilter = 'today'
let calYear  = new Date().getFullYear()
let calMonth = new Date().getMonth()
let calStart = null   // temporary selection inside the calendar
let calEnd   = null
let kanbanStatusFilter = 'open'
let authMode = 'login'
let pendingConfirmationEmail = ''
let localDevMode = false
let summaryLoadingTimer = null
let summaryProgressTimer = null
let summaryProgress = 0
let summaryController = null
let summaryGenerating = false
let summaryStreamingText = ''
let summaryAutoAttemptKey = ''
let kanbanSearch = ''
const expandedRecentEntries = new Set()

// ── Tab switching ─────────────────────────────────────────
function switchTab(tab) {
  activeTab = tab
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'))
  document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'))
  document.getElementById(`tab-${tab}`).classList.add('active')
  document.querySelector(`.nav-btn[data-tab="${tab}"]`).classList.add('active')
  if (tab === 'today')  { renderToday(); maybeAutoOrganizeToday() }
  if (tab === 'kanban') renderKanban()
  if (tab === 'archive') renderArchive()
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
    <div class="entry-card" data-id="${e.id}">
      <div class="entry-del-bg">
        <button class="entry-del-btn js-entry-del" data-id="${e.id}" type="button">删除</button>
      </div>
      <div class="entry-inner" data-id="${e.id}">
        <time class="entry-time">${fmtTime(e.timestamp)}</time>
        <div class="entry-body">
          <div class="entry-text${expandedRecentEntries.has(e.id) ? ' expanded' : ''}">${escHtml(e.content)}</div>
        </div>
      </div>
    </div>
  `).join('')

  list.querySelectorAll('.entry-inner').forEach(inner => {
    inner.addEventListener('click', () => {
      const id = inner.dataset.id
      if (expandedRecentEntries.has(id)) expandedRecentEntries.delete(id)
      else expandedRecentEntries.add(id)
      renderRecent()
    })
  })
  list.querySelectorAll('.js-entry-del').forEach(btn =>
    btn.addEventListener('click', () => deleteEntry(btn.dataset.id))
  )
  initRecentEntryGestures()
}

function saveEntry() {
  const input = document.getElementById('capture-input')
  const content = input.value.trim()
  if (!content) return
  const entries = db.getEntries()
  entries.push({ id: crypto.randomUUID(), content, timestamp: Date.now(), date: todayKey() })
  db.saveEntries(entries)
  syncKanbanFromRecords()
  input.value = ''
  input.blur()
  renderRecent()
  if (activeTab === 'kanban') renderKanban()
  if (activeTab === 'today') renderToday()
  toast('已保存 ✓')
}

function deleteEntry(id) {
  if (!id) return
  expandedRecentEntries.delete(id)
  db.saveEntries(db.getEntries().filter(e => e.id !== id))
  const entryIds = new Set(db.getEntries().map(e => e.id))
  db.saveKanban(db.getKanban().filter(c => c.source !== 'record' || !c.sourceEntryId || entryIds.has(c.sourceEntryId)))
  renderRecent()
  if (activeTab === 'kanban') renderKanban()
  if (activeTab === 'today') renderToday()
  toast('已删除')
}

let recentGesture = null
let recentSwiped = new Set()

function initRecentEntryGestures() {
  const list = document.getElementById('recent-list')
  list.removeEventListener('touchstart', onRecentTS)
  list.removeEventListener('touchmove', onRecentTM)
  list.removeEventListener('touchend', onRecentTE)
  list.addEventListener('touchstart', onRecentTS, { passive: true })
  list.addEventListener('touchmove', onRecentTM, { passive: false })
  list.addEventListener('touchend', onRecentTE, { passive: true })
}

function onRecentTS(e) {
  const inner = e.target.closest('.entry-inner')
  if (!inner) return
  const id = inner.dataset.id
  recentGesture = {
    id,
    inner,
    startX: e.touches[0].clientX,
    startY: e.touches[0].clientY,
    baseX: recentSwiped.has(id) ? -72 : 0,
    type: 'pending'
  }
}

function onRecentTM(e) {
  if (!recentGesture) return
  const dx = e.touches[0].clientX - recentGesture.startX
  const dy = e.touches[0].clientY - recentGesture.startY
  if (recentGesture.type === 'pending') {
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return
    if (Math.abs(dy) > Math.abs(dx)) { recentGesture = null; return }
    recentGesture.type = 'swipe'
  }
  const x = Math.max(Math.min(recentGesture.baseX + dx, 0), -72)
  recentGesture.inner.style.transition = 'none'
  recentGesture.inner.style.transform = `translateX(${x}px)`
  e.preventDefault()
}

function onRecentTE(e) {
  if (!recentGesture) return
  const dx = e.changedTouches[0].clientX - recentGesture.startX
  const final = recentGesture.baseX + dx
  recentGesture.inner.style.transition = 'transform .2s ease'
  if (final < -36) {
    recentGesture.inner.style.transform = 'translateX(-72px)'
    recentSwiped.add(recentGesture.id)
  } else {
    recentGesture.inner.style.transform = 'translateX(0)'
    recentSwiped.delete(recentGesture.id)
  }
  recentGesture = null
}

// ── Render: Today tab ─────────────────────────────────────
function renderToday() {
  renderTodaySummaryArea()
}

function entryFingerprint(entries) {
  return entries
    .map(e => `${e.id}:${e.timestamp}:${e.content}`)
    .join('|')
}

function todayEntriesAndHash() {
  const today = todayKey()
  const entries = db.getEntries().filter(e => e.date === today)
  return { today, entries, hash: entryFingerprint(entries) }
}

function shouldAutoOrganizeToday() {
  const settings = db.getSettings()
  if (!settings.apiKey || summaryGenerating) return false
  const { today, entries, hash } = todayEntriesAndHash()
  if (!entries.length || !hash) return false
  const saved = db.getSummaries()[today]
  if (saved?.entryHash === hash && (saved?.text || '').trim()) return false
  if (summaryAutoAttemptKey === `${today}:${hash}`) return false
  return true
}

function maybeAutoOrganizeToday() {
  if (!shouldAutoOrganizeToday()) return
  handleGenerateSummary({ auto: true })
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
async function handleGenerateSummary(options = {}) {
  const settings = db.getSettings()
  if (!settings.apiKey) { toast('请先在设置中配置 API Key'); openSettings(); return }
  const { today, entries, hash } = todayEntriesAndHash()
  if (!entries.length) { toast('今天还没有记录'); return }

  document.getElementById('today-summary-idle').hidden    = true
  document.getElementById('today-summary-result').hidden  = true
  document.getElementById('today-summary-loading').hidden = false
  document.getElementById('today-nav-progress').hidden = false
  document.getElementById('today-gen-btn').disabled = true
  document.getElementById('today-summary-loading-text').textContent = '正在归纳今天的内容...'
  summaryGenerating = true
  summaryAutoAttemptKey = `${today}:${hash}`
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
    summaries[today] = { ...(summaries[today] || {}), text, entryHash: hash, ts: Date.now() }
    db.saveSummaries(summaries)
    summaryGenerating = false
    summaryStreamingText = ''
    document.getElementById('today-summary-loading').hidden = true
    document.getElementById('today-summary-result').hidden  = false
    document.getElementById('today-summary-preview').innerHTML = md2html(text)
    document.getElementById('today-summary-text').value = text
    showSummaryPreview()
    addSummaryTextToKanban(text, { silent: true, stay: true })
    toast(options.auto ? '今日已自动整理 ✓' : '今日总结已生成 ✓')
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

// ── Archive (信箱) ─────────────────────────────────────────
let archiveOpenDate = null
let archiveSearch = ''
let archiveRange = 'all'
let archiveFavOnly = false

function datesWithSummaries() {
  const summaries = db.getSummaries()
  return Object.keys(summaries)
    .filter(d => (summaries[d]?.letter || '').trim())
    .sort((a, b) => b.localeCompare(a))
}

function summaryPlainPreview(text, n = 60) {
  const plain = (text || '').replace(/[#>*`_\-]/g, '').replace(/\s+/g, ' ').trim()
  return plain.length > n ? `${plain.slice(0, n)}…` : plain
}

function renderArchive() {
  document.getElementById('archive-detail').hidden = true
  document.getElementById('archive-list-view').hidden = false
  const list = document.getElementById('archive-list')
  const empty = document.getElementById('archive-empty')
  const allDates = datesWithSummaries()
  if (!allDates.length) {
    list.innerHTML = ''
    empty.hidden = false
    return
  }
  empty.hidden = true
  const summaries = db.getSummaries()
  const floor = archiveRange === 'all' ? '' : daysAgoKey(Number(archiveRange) - 1)
  const q = archiveSearch.trim().toLowerCase()
  const dates = allDates.filter(d => {
    if (archiveFavOnly && !summaries[d]?.favorite) return false
    if (floor && d < floor) return false
    if (q) {
      const hay = `${d} ${summaries[d]?.letter || ''} ${summaries[d]?.reflection || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
  if (!dates.length) {
    list.innerHTML = '<p class="archive-noresult">没有匹配的信</p>'
    return
  }
  list.innerHTML = dates.map(d => {
    const s = summaries[d]
    const badge = (s?.reflection || '').trim() ? ' <span class="letter-badge">补充</span>' : ''
    const star = s?.favorite ? '<span class="letter-star">★</span> ' : ''
    return `
      <button class="letter-item js-letter" data-date="${d}">
        <div class="letter-item-date">${star}${d}${badge}</div>
        <div class="letter-item-preview">${escHtml(summaryPlainPreview(s?.letter))}</div>
      </button>`
  }).join('')
}

function openLetter(date) {
  const s = db.getSummaries()[date]
  if (!s) return
  archiveOpenDate = date
  document.getElementById('archive-list-view').hidden = true
  const detail = document.getElementById('archive-detail')
  detail.hidden = false
  detail.style.transform = ''
  detail.style.opacity = ''
  detail.scrollTop = 0
  document.getElementById('archive-letter-date').textContent = formatLetterDate(date)
  document.getElementById('archive-letter-body').innerHTML = md2html(s.letter || '')
  document.getElementById('archive-reflection').value = s.reflection || ''
  setFavButton(!!s.favorite)
}

function setFavButton(fav) {
  const btn = document.getElementById('archive-fav-btn')
  btn.classList.toggle('active', fav)
  btn.setAttribute('aria-pressed', fav ? 'true' : 'false')
  btn.textContent = fav ? '★ 已收藏' : '☆ 收藏'
}

function toggleFavorite() {
  if (!archiveOpenDate) return
  const summaries = db.getSummaries()
  const cur = summaries[archiveOpenDate] || {}
  const fav = !cur.favorite
  summaries[archiveOpenDate] = { ...cur, favorite: fav, ts: Date.now() }
  db.saveSummaries(summaries)
  queueSync(300)
  setFavButton(fav)
  toast(fav ? '已收藏 ✓' : '已取消收藏')
}

function closeLetter() {
  archiveOpenDate = null
  renderArchive()
}

function saveReflection() {
  if (!archiveOpenDate) return
  const val = document.getElementById('archive-reflection').value
  const summaries = db.getSummaries()
  summaries[archiveOpenDate] = { ...(summaries[archiveOpenDate] || {}), reflection: val, ts: Date.now() }
  db.saveSummaries(summaries)
  queueSync(300)
  toast('补充已保存 ✓')
}

function formatLetterDate(dateStr) {
  const [y, m, d] = (dateStr || '').split('-').map(Number)
  if (!y) return dateStr
  const wk = new Date(y, (m || 1) - 1, d || 1).toLocaleDateString('zh-CN', { weekday: 'long' })
  return `${y}年${m}月${d}日 · ${wk}`
}

// Share the letter text + date (never the private reflection)
async function shareLetter() {
  if (!archiveOpenDate) return
  const s = db.getSummaries()[archiveOpenDate]
  if (!s || !(s.letter || '').trim()) { toast('这封信还没有内容'); return }
  const body = s.letter.replace(/\*\*/g, '').trim()
  const text = `${formatLetterDate(archiveOpenDate)}\n\n${body}\n\n—— 来自 EasyNote`
  try {
    if (navigator.share) {
      await navigator.share({ title: `EasyNote · ${archiveOpenDate}`, text })
    } else {
      await navigator.clipboard.writeText(text)
      toast('已复制到剪贴板 ✓')
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return
    try { await navigator.clipboard.writeText(text); toast('已复制到剪贴板 ✓') }
    catch { toast('分享失败') }
  }
}

// Right-swipe on the letter detail to go back (mirrors the recent-entry gesture)
let letterSwipe = null
function initLetterSwipe() {
  const el = document.getElementById('archive-detail')
  el.addEventListener('touchstart', onLetterTS, { passive: true })
  el.addEventListener('touchmove', onLetterTM, { passive: false })
  el.addEventListener('touchend', onLetterTE, { passive: true })
}
function onLetterTS(e) {
  if (e.target.closest('textarea, input, button')) { letterSwipe = null; return }
  letterSwipe = {
    el: document.getElementById('archive-detail'),
    startX: e.touches[0].clientX,
    startY: e.touches[0].clientY,
    type: 'pending'
  }
}
function onLetterTM(e) {
  if (!letterSwipe) return
  const dx = e.touches[0].clientX - letterSwipe.startX
  const dy = e.touches[0].clientY - letterSwipe.startY
  if (letterSwipe.type === 'pending') {
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return
    if (dx <= 0 || Math.abs(dy) > Math.abs(dx)) { letterSwipe = null; return }
    letterSwipe.type = 'swipe'
  }
  const x = Math.max(0, dx)
  letterSwipe.el.style.transition = 'none'
  letterSwipe.el.style.transform = `translateX(${x}px)`
  letterSwipe.el.style.opacity = String(Math.max(0.4, 1 - x / 600))
  e.preventDefault()
}
function onLetterTE(e) {
  if (!letterSwipe || letterSwipe.type !== 'swipe') { letterSwipe = null; return }
  const dx = e.changedTouches[0].clientX - letterSwipe.startX
  const el = letterSwipe.el
  el.style.transition = 'transform .2s ease, opacity .2s ease'
  if (dx > 80) {
    el.style.transform = 'translateX(100%)'
    el.style.opacity = '0'
    setTimeout(() => { el.style.transform = ''; el.style.opacity = ''; closeLetter() }, 180)
  } else {
    el.style.transform = 'translateX(0)'
    el.style.opacity = '1'
  }
  letterSwipe = null
}

// Auto-write a letter for past days that have records but no letter yet
async function backfillLetters() {
  const settings = db.getSettings()
  if (!settings.apiKey) return
  const today = todayKey()
  const floor = daysAgoKey(14)
  const byDate = {}
  for (const e of db.getEntries()) {
    if (e.date >= today || e.date < floor) continue
    ;(byDate[e.date] ||= []).push(e)
  }
  const summaries = db.getSummaries()
  const targets = Object.keys(byDate)
    .filter(d => !(summaries[d]?.letter || '').trim())
    .sort()
  for (const date of targets) {
    try {
      const letter = await generateDailyLetter(byDate[date], { ...settings }, date)
      if (!letter || !letter.trim()) continue
      const cur = db.getSummaries()
      cur[date] = { ...(cur[date] || {}), letter, ts: Date.now() }
      db.saveSummaries(cur)
      queueSync(500)
      if (activeTab === 'archive' && !archiveOpenDate) renderArchive()
    } catch { /* skip failures silently, retry on next open */ }
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
function addSummaryTextToKanban(text, options = {}) {
  const today = todayKey()
  const items = text ? extractAllFromSummary(text) : []
  if (!items.length) {
    if (!options.silent) toast('没有识别到可加入的事项')
    return { added: 0, updated: 0 }
  }

  // Persist any edits the user made
  const summaries = db.getSummaries()
  if (summaries[today]) { summaries[today].text = text; summaries[today].ts = Date.now(); db.saveSummaries(summaries) }

  const allCards = dedupeKanbanCards(db.getKanban())
  const reusableSummaryCards = allCards.filter(c =>
    c.date === today && (c.source === 'summary' || !c.source)
  )
  const existing = allCards.filter(c =>
    !(c.date === today && (c.source === 'summary' || !c.source))
  )

  let added = 0, updated = 0
  const newItems = []
  const reusedIds = new Set()
  const batchKeys = new Set()
  for (const item of items) {
    const candidate = { text: item.text, type: item.type, done: item.done ?? false, date: today }
    const key = kanbanSemanticKey(candidate)
    if (batchKeys.has(key)) continue
    batchKeys.add(key)

    // Skip if this item already exists anywhere on the board (any date/type/status),
    // so old or completed items don't resurface in today's organize.
    const candNorm = normalizeKanbanText(candidate.text)
    if (existing.some(c =>
      normalizeKanbanText(c.text) === candNorm ||
      (c.type === candidate.type && textSimilarity(c.text, candidate.text) >= 0.65)
    )) continue

    const reusable = reusableSummaryCards.find(c =>
      !reusedIds.has(c.id) &&
      (normalizeKanbanText(c.text) === candNorm ||
       (c.type === candidate.type && textSimilarity(c.text, candidate.text) >= 0.65))
    )
    if (reusable) reusedIds.add(reusable.id)
    if (reusable) {
      const textChanged = reusable.text !== candidate.text
      if (textChanged) updated++
    } else {
      added++
    }

    newItems.push({
      ...(reusable || {}),
      id: reusable?.id || crypto.randomUUID(),
      text: candidate.text,
      type: candidate.type,
      // keep a manually-completed card completed across re-organize (completion wins)
      done: reusable ? (reusable.done || candidate.done) : candidate.done,
      date: today,
      source: 'summary'
    })
  }
  db.saveKanban(dedupeKanbanCards([...existing, ...newItems]))

  if (!options.silent) {
    if (added === 0 && updated === 0) toast('看板已是最新')
    else toast(added ? '已加入看板 ✓' : '看板已更新 ✓')
  }
  if (!options.stay && (added || updated)) switchTab('kanban')
  if (activeTab === 'kanban') renderKanban()
  return { added, updated }
}

function handleAddToKanban() {
  const text = document.getElementById('today-summary-text').value.trim()
  addSummaryTextToKanban(text)
}


// ── Kanban ────────────────────────────────────────────────
const TYPE_ICONS = { todo: null, reminder: '⏰', quote: '💬', thought: '💭' }
const FILTER_LABELS = { todo: 'Todo', reminder: '提醒', quote: '好句', thought: '感触', all: '全部' }

function daysAgoKey(n) {
  const d = new Date(); d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
}
function isArchived(card) {
  return card.done && card.date < daysAgoKey(7)
}

// Parse ☐/☑ checkbox lines from raw records into todo candidates
function extractCheckboxItems(entries) {
  const items = []
  for (const e of entries) {
    const lines = (e.content || '')
      .replace(/☐/g, '\n☐')
      .replace(/☑/g, '\n☑')
      .split('\n')
    for (const raw of lines) {
      const m = /^([☐☑])\s*(.+)$/.exec(raw.trim())
      if (!m) continue
      const text = m[2].trim()
      if (!text) continue
      items.push({ text, type: 'todo', done: m[1] === '☑', date: e.date, sourceEntryId: e.id })
    }
  }
  return items
}

// Materialize ☐/☑ records into kanban cards so the board works without a summary
function syncKanbanFromRecords() {
  const items = extractCheckboxItems(db.getEntries())
  const entryIds = new Set(db.getEntries().map(e => e.id))
  const cards = dedupeKanbanCards(db.getKanban()).filter(c =>
    c.source !== 'record' || !c.sourceEntryId || entryIds.has(c.sourceEntryId)
  )
  const seen = new Set(cards.map(c => `${c.date}|${c.type}|${normalizeKanbanText(c.text)}`))
  const additions = []
  for (const it of items) {
    const key = `${it.date}|${it.type}|${normalizeKanbanText(it.text)}`
    if (seen.has(key)) continue
    seen.add(key)
    additions.push({
      id: crypto.randomUUID(),
      text: it.text,
      type: it.type,
      done: it.done,
      date: it.date,
      source: 'record',
      sourceEntryId: it.sourceEntryId
    })
  }
  const next = dedupeKanbanCards([...cards, ...additions])
  if (!additions.length && next.length === db.getKanban().length) return
  db.saveKanban(next)
  queueSync(300)
}

function renderKanban() {
  syncKanbanFromRecords()
  const allCards = db.getKanban()
  let cards = kanbanFilter === 'all' ? allCards : allCards.filter(c => c.type === kanbanFilter)
  if (kanbanDateFilter === 'today') {
    cards = cards.filter(c => c.date === todayKey() && !isArchived(c))
  } else if (kanbanDateFilter === 'week') {
    const ws = daysAgoKey(6)
    cards = cards.filter(c => c.date >= ws && !isArchived(c))
  } else if (kanbanDateFilter === 'other') {
    if (kanbanDateFrom) {
      const to = kanbanDateTo || kanbanDateFrom
      cards = cards.filter(c => c.date >= kanbanDateFrom && c.date <= to)
    } else {
      cards = []
    }
  }
  const q = kanbanSearch.trim().toLowerCase()
  if (q) {
    cards = cards.filter(c => `${c.text} ${c.date} ${FILTER_LABELS[c.type] || c.type}`.toLowerCase().includes(q))
  }
  cards = kanbanStatusFilter === 'done' ? cards.filter(c => c.done) : cards.filter(c => !c.done)
  const list     = document.getElementById('kanban-list')
  const empty    = document.getElementById('kanban-empty')
  const clearBtn = document.getElementById('kanban-clear-done-btn')

  clearBtn.hidden = kanbanStatusFilter !== 'done' || !allCards.some(c => c.done)

  // Stats: count open/done across current type+date filter (ignore status filter)
  const statsBase = kanbanFilter === 'all' ? allCards : allCards.filter(c => c.type === kanbanFilter)
  const statsDated = kanbanDateFilter === 'today'
    ? statsBase.filter(c => c.date === todayKey() && !isArchived(c))
    : kanbanDateFilter === 'week'
    ? (() => { const ws = daysAgoKey(6); return statsBase.filter(c => c.date >= ws && !isArchived(c)) })()
    : kanbanDateFilter === 'other' && kanbanDateFrom
    ? (() => { const to = kanbanDateTo || kanbanDateFrom; return statsBase.filter(c => c.date >= kanbanDateFrom && c.date <= to) })()
    : statsBase.filter(c => !isArchived(c))
  const statsSearched = q
    ? statsDated.filter(c => `${c.text} ${c.date} ${FILTER_LABELS[c.type] || c.type}`.toLowerCase().includes(q))
    : statsDated
  const openCount = statsSearched.filter(c => !c.done).length
  const doneCount = statsSearched.filter(c => c.done).length
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

  list.innerHTML = cards.map((card, idx) => {
    const icon = TYPE_ICONS[card.type]
    const isTodo = card.type === 'todo'
    const priority = kanbanStatusFilter === 'open' && idx < 3 ? idx + 1 : 0
    return `
      <div class="k-card" data-id="${card.id}" data-type="${card.type}"${priority ? ` data-priority="${priority}"` : ''}>
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

function syncVisibleKanbanPriorityAccents() {
  const list = document.getElementById('kanban-list')
  if (!list) return

  let orderedCards = [...list.children].flatMap(child => {
    if (child.classList?.contains('k-placeholder') && drag?.card) return [drag.card]
    if (child.classList?.contains('k-card') && !child.classList.contains('k-dragging')) return [child]
    return []
  })

  if (!orderedCards.length) orderedCards = [...list.querySelectorAll('.k-card')]

  orderedCards.forEach((card, idx) => {
    if (kanbanStatusFilter === 'open' && idx < 3) {
      card.dataset.priority = String(idx + 1)
    } else {
      card.removeAttribute('data-priority')
    }
  })
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
  syncVisibleKanbanPriorityAccents()
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
  syncVisibleKanbanPriorityAccents()

  drag = null
  gesture = null
}

// ── Calendar ──────────────────────────────────────────────
function updateOtherBtnLabel() {
  const btn = document.querySelector('#kanban-date-filters [data-date="other"]')
  if (!btn) return
  if (kanbanDateFrom && kanbanDateTo && kanbanDateFrom !== kanbanDateTo) {
    const fmt = s => s.slice(5).replace('-', '/')
    btn.textContent = `${fmt(kanbanDateFrom)}–${fmt(kanbanDateTo)}`
  } else if (kanbanDateFrom) {
    btn.textContent = kanbanDateFrom.slice(5).replace('-', '/')
  } else {
    btn.textContent = '其他'
  }
}

function openCalendar() {
  calYear  = new Date().getFullYear()
  calMonth = new Date().getMonth()
  // Initialise temp selection from committed range
  calStart = kanbanDateFrom || null
  calEnd   = kanbanDateTo   || null
  renderCalendar()
  document.getElementById('cal-overlay').hidden = false
}

function closeCalendar() {
  document.getElementById('cal-overlay').hidden = true
}

function cancelCalendar() {
  closeCalendar()
  // Restore previous filter if no range was ever committed for 'other'
  if (!kanbanDateFrom) {
    kanbanDateFilter = prevKanbanDateFilter
    document.querySelectorAll('#kanban-date-filters .date-segment-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.date === kanbanDateFilter)
    )
    updateOtherBtnLabel()
    renderKanban()
  }
}

function confirmCalendar() {
  if (calStart) {
    const s = calStart <= (calEnd || calStart) ? calStart : calEnd
    const e = calStart <= (calEnd || calStart) ? (calEnd || calStart) : calStart
    kanbanDateFrom = s
    kanbanDateTo   = e
  } else {
    kanbanDateFrom = null
    kanbanDateTo   = null
  }
  closeCalendar()
  updateOtherBtnLabel()
  renderKanban()
}

function renderCalendar() {
  const title = document.getElementById('cal-title')
  const grid  = document.getElementById('cal-grid')
  const today = todayKey()

  title.textContent = `${calYear}年${calMonth + 1}月`

  const firstDow    = new Date(calYear, calMonth, 1).getDay()
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate()

  // Normalise start/end for range rendering
  const rangeS = calStart && calEnd ? (calStart <= calEnd ? calStart : calEnd) : calStart
  const rangeE = calStart && calEnd ? (calStart <= calEnd ? calEnd : calStart) : calStart

  let html = ''
  for (let i = 0; i < firstDow; i++) html += '<button class="cal-day empty"></button>'

  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${calYear}-${pad(calMonth + 1)}-${pad(d)}`
    let cls = 'cal-day'
    if (ds === today) cls += ' today'
    if (rangeS && rangeE && rangeS !== rangeE) {
      if (ds === rangeS)                  cls += ' range-start in-range'
      else if (ds === rangeE)             cls += ' range-end in-range'
      else if (ds > rangeS && ds < rangeE) cls += ' in-range'
    } else if (rangeS && ds === rangeS)  cls += ' selected'
    html += `<button class="${cls}" data-date="${ds}">${d}</button>`
  }

  grid.innerHTML = html
  grid.querySelectorAll('.cal-day:not(.empty)').forEach(btn =>
    btn.addEventListener('click', () => {
      const d = btn.dataset.date
      if (!calStart || (calStart && calEnd)) {
        calStart = d; calEnd = null
      } else if (d === calStart) {
        calStart = null; calEnd = null
      } else {
        calEnd = d
      }
      renderCalendar()  // preview only — apply on 完成
    })
  )
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

    if (localDevMode) return
    if (!user) {
      showAuthScreen()
      return
    }
    await enterApp()
  } catch (err) {
    if (localDevMode) return
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
  backfillLetters()
  setTimeout(() => document.getElementById('capture-input').focus(), 150)
}

function showAuthScreen(message = '') {
  document.getElementById('app-shell').hidden = true
  document.getElementById('auth-screen').hidden = false
  setAuthStatus(message)
}

function isLocalDevHost() {
  return ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)
}

function enterLocalDevApp() {
  localDevMode = true
  syncReady = false
  applyingRemoteState = false
  document.getElementById('auth-screen').hidden = true
  document.getElementById('app-shell').hidden = false
  setSyncStatus('本地测试模式：未连接同步')
  renderAll()
  setTimeout(() => document.getElementById('capture-input').focus(), 150)
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
  localDevMode = false
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
    localDevMode = false
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
  if (activeTab === 'archive' && !archiveOpenDate) renderArchive()
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
  const localDevBtn = document.getElementById('local-dev-btn')
  if (isLocalDevHost()) {
    localDevBtn.hidden = false
    localDevBtn.addEventListener('click', enterLocalDevApp)
  }
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
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      saveEntry()
    }
  })

  // Tabs
  document.querySelectorAll('.nav-btn').forEach(btn =>
    btn.addEventListener('click', () => switchTab(btn.dataset.tab))
  )

  // Archive (信箱)
  document.getElementById('archive-back-btn').addEventListener('click', closeLetter)
  document.getElementById('archive-reflection-save').addEventListener('click', saveReflection)
  document.getElementById('archive-list').addEventListener('click', e => {
    const btn = e.target.closest('.js-letter')
    if (btn) openLetter(btn.dataset.date)
  })
  document.getElementById('archive-search').addEventListener('input', e => {
    archiveSearch = e.target.value
    renderArchive()
  })
  document.getElementById('archive-date-filters').addEventListener('click', e => {
    const btn = e.target.closest('.date-segment-btn')
    if (!btn) return
    archiveRange = btn.dataset.range
    document.querySelectorAll('#archive-date-filters .date-segment-btn')
      .forEach(b => b.classList.toggle('active', b === btn))
    renderArchive()
  })
  document.getElementById('archive-fav-btn').addEventListener('click', toggleFavorite)
  document.getElementById('archive-share-btn').addEventListener('click', shareLetter)
  initLetterSwipe()
  document.getElementById('archive-fav-filter').addEventListener('click', e => {
    archiveFavOnly = !archiveFavOnly
    const btn = e.currentTarget
    btn.classList.toggle('active', archiveFavOnly)
    btn.setAttribute('aria-pressed', archiveFavOnly ? 'true' : 'false')
    btn.textContent = archiveFavOnly ? '★ 收藏' : '☆ 收藏'
    renderArchive()
  })

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
      addSummaryTextToKanban(text, { silent: true, stay: true })
      toast('整理已更新 ✓')
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
    if (kanbanDateFilter === 'other') {
      prevKanbanDateFilter = document.querySelector('#kanban-date-filters .date-segment-btn.active:not([data-date="other"])')?.dataset.date || 'today'
      openCalendar(); return
    }
    updateOtherBtnLabel()
    renderKanban()
  })

  document.getElementById('cal-prev').addEventListener('click', () => {
    calMonth--; if (calMonth < 0) { calMonth = 11; calYear-- }
    renderCalendar()
  })
  document.getElementById('cal-next').addEventListener('click', () => {
    calMonth++; if (calMonth > 11) { calMonth = 0; calYear++ }
    renderCalendar()
  })
  document.getElementById('cal-close').addEventListener('click', cancelCalendar)
  document.getElementById('cal-confirm').addEventListener('click', confirmCalendar)
  document.getElementById('cal-backdrop').addEventListener('click', cancelCalendar)

  // Kanban status filter
  document.getElementById('kanban-status-filters').addEventListener('click', e => {
    const btn = e.target.closest('.status-filter-btn')
    if (!btn) return
    kanbanStatusFilter = btn.dataset.status
    document.querySelectorAll('#kanban-status-filters .status-filter-btn').forEach(b => b.classList.toggle('active', b === btn))
    renderKanban()
  })

  document.getElementById('kanban-search').addEventListener('input', e => {
    kanbanSearch = e.target.value
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
