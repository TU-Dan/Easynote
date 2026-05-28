import { generateDailySummary, extractAllFromSummary } from './api.js'

// ── Storage ───────────────────────────────────────────────
const K = { entries: 'qsj_entries', settings: 'qsj_settings', summaries: 'qsj_summaries', kanban: 'qsj_kanban' }
const db = {
  getEntries:   () => JSON.parse(localStorage.getItem(K.entries)   || '[]'),
  saveEntries:  v  => localStorage.setItem(K.entries,   JSON.stringify(v)),
  getSettings:  () => JSON.parse(localStorage.getItem(K.settings)  || '{}'),
  saveSettings: v  => localStorage.setItem(K.settings,  JSON.stringify(v)),
  getSummaries: () => JSON.parse(localStorage.getItem(K.summaries) || '{}'),
  saveSummaries:v  => localStorage.setItem(K.summaries, JSON.stringify(v)),
  getKanban:    () => JSON.parse(localStorage.getItem(K.kanban)    || '[]'),
  saveKanban:   v  => localStorage.setItem(K.kanban,    JSON.stringify(v))
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
  document.getElementById('today-date').textContent = todayLabel()
  renderTodaySummaryArea()
  renderTodayEntries()
}

function renderTodaySummaryArea() {
  const today = todayKey()
  const entries = db.getEntries().filter(e => e.date === today)
  const saved = db.getSummaries()[today]

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

function renderTodayEntries() {
  const container = document.getElementById('today-entries')
  const empty     = document.getElementById('today-empty')
  const today     = todayKey()
  const entries   = db.getEntries().filter(e => e.date === today).reverse()

  if (!entries.length) {
    container.innerHTML = ''
    empty.hidden = false
    return
  }
  empty.hidden = true

  container.innerHTML = entries.map(e => `
    <div class="tl-entry">
      <div class="tl-time">${fmtTime(e.timestamp)}</div>
      <div class="tl-card">
        <div class="tl-text">${escHtml(e.content)}</div>
        <button class="tl-del js-del" data-id="${e.id}">✕</button>
      </div>
    </div>
  `).join('')

  container.querySelectorAll('.js-del').forEach(btn =>
    btn.addEventListener('click', () => {
      db.saveEntries(db.getEntries().filter(e => e.id !== btn.dataset.id))
      renderTodayEntries()
      renderRecent()
      renderTodaySummaryArea()
    })
  )
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

  try {
    const text = await generateDailySummary(entries, settings, today)
    const summaries = db.getSummaries()
    summaries[today] = { text, ts: Date.now() }
    db.saveSummaries(summaries)
    document.getElementById('today-summary-loading').hidden = true
    document.getElementById('today-summary-result').hidden  = false
    document.getElementById('today-summary-preview').innerHTML = md2html(text)
    document.getElementById('today-summary-text').value = text
    showSummaryPreview()
  } catch (err) {
    document.getElementById('today-summary-loading').hidden = true
    document.getElementById('today-summary-idle').hidden    = false
    toast(`生成失败: ${err.message}`, 4000)
  }
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

  const kanban = db.getKanban()
  let added = 0
  for (const item of items) {
    if (!kanban.some(c => textSimilarity(c.text, item.text) >= 0.65)) {
      kanban.push({ id: crypto.randomUUID(), text: item.text, type: item.type, done: false, date: today })
      added++
    }
  }
  db.saveKanban(kanban)

  if (added === 0) { toast('这些事项已在看板中'); return }
  toast(`已加入 ${added} 项到看板 ✓`)
  switchTab('kanban')
}


// ── Kanban ────────────────────────────────────────────────
const TYPE_ICONS = { todo: null, reminder: '⏰', quote: '💬', thought: '💭' }

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
  const list     = document.getElementById('kanban-list')
  const empty    = document.getElementById('kanban-empty')
  const clearBtn = document.getElementById('kanban-clear-done-btn')

  clearBtn.hidden = !allCards.some(c => c.done)

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
  document.getElementById('setting-api-key').value  = s.apiKey  || ''
  document.getElementById('setting-base-url').value = s.baseUrl || ''
  document.getElementById('settings-modal').hidden       = false
}
function closeSettings() { document.getElementById('settings-modal').hidden = true }
function saveSettingsForm() {
  db.saveSettings({
    apiKey:  document.getElementById('setting-api-key').value.trim(),
    baseUrl: document.getElementById('setting-base-url').value.trim()
  })
  closeSettings()
  toast('设置已保存')
}


// ── Init ──────────────────────────────────────────────────
function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('sw.js', { updateViaCache: 'none' })
      .then(reg => reg.update())
      .catch(() => {})
  }

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
  document.getElementById('kanban-filters').addEventListener('click', e => {
    const btn = e.target.closest('.k-filter-btn')
    if (!btn) return
    kanbanFilter = btn.dataset.filter
    document.querySelectorAll('#kanban-filters .k-filter-btn').forEach(b => b.classList.toggle('active', b === btn))
    renderKanban()
  })

  // Kanban date filter
  document.getElementById('kanban-date-filters').addEventListener('click', e => {
    const btn = e.target.closest('.k-filter-btn')
    if (!btn) return
    kanbanDateFilter = btn.dataset.date
    document.querySelectorAll('#kanban-date-filters .k-filter-btn').forEach(b => b.classList.toggle('active', b === btn))
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

  document.getElementById('today-summary-text').addEventListener('input', e => {
    e.target.style.height = 'auto'
    e.target.style.height = e.target.scrollHeight + 'px'
  })

  renderRecent()
  setTimeout(() => document.getElementById('capture-input').focus(), 150)
}

document.addEventListener('DOMContentLoaded', init)
