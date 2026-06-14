async function callDeepSeek(messages, settings, options = {}) {
  const base = (settings.baseUrl || 'https://api.deepseek.com').replace(/\/$/, '')
  const controller = options.controller || new AbortController()
  let timedOut = false

  // Overall timeout: 40s — enough for any reasonable response
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, 40000)

  let res
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify({
        model: settings.model || 'deepseek-chat',
        messages,
        temperature: 0.2,
        max_tokens: 1800,
        stream: true
      })
    })
  } catch (err) {
    clearTimeout(timeout)
    if (err.name === 'AbortError') {
      throw Object.assign(new Error(timedOut ? '连接超时，请检查网络后重试' : '已取消'), { name: 'AbortError' })
    }
    throw new Error(`无法连接 AI 接口（${err.message}）`)
  }

  if (!res.ok) {
    clearTimeout(timeout)
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error?.message || `API 错误 ${res.status}`)
  }

  let content
  try {
    content = await readDeepSeekStream(res, options.onChunk, controller, () => { timedOut = true })
  } catch (err) {
    if (err.name === 'AbortError') {
      throw Object.assign(new Error(timedOut ? '响应超时，请重试' : '已取消'), { name: 'AbortError' })
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }

  if (!content) throw new Error('AI 返回内容为空，请重试')
  return content
}

async function readDeepSeekStream(res, onChunk, controller, onTimeout) {
  if (!res.body) {
    const data = await res.json()
    return data.choices?.[0]?.message?.content || ''
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let firstChunk = false

  // First-byte timeout: if nothing arrives within 12s, the API is likely stuck
  const firstByteTimer = setTimeout(() => {
    if (!firstChunk) { onTimeout?.(); controller.abort() }
  }, 12000)

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break

      firstChunk = true
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        try {
          const data = JSON.parse(payload)
          const delta = data.choices?.[0]?.delta?.content || ''
          if (!delta) continue
          content += delta
          onChunk?.(delta, content)
        } catch { /* skip malformed chunk */ }
      }
    }
  } finally {
    clearTimeout(firstByteTimer)
  }

  return content
}

export function buildDailySummaryPrompt(entries, date, kanban = []) {
  const compactEntries = entries.map(e => ({
    time: new Date(e.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
    content: e.content
      .replace(/\s+/g, ' ')
      .replace(/☐/g, '\n☐')
      .replace(/☑/g, '\n☑')
      .trim()
  }))
  const text = compactEntries.map((e, i) => `${i + 1}. [${e.time}]\n${e.content}`).join('\n\n')

  return `你是用户的私人助理，帮助把零散记录整理成清晰、可执行的一日总结。
只依据下面今天的记录来判断，不要凭空补充历史事项。
用户今天（${date}）的记录（未分类，请自行判断类型）：

${text}

请先理解记录中的符号：
- "☐" 表示尚未完成、待推进、可进入 Todo。
- "☑" 表示已经完成，用于回顾，不要再当成待办。
- 没有符号的内容，请根据语义判断是任务、提醒、想法、引用还是项目线索。

用户可以用任何格式记录内容，请尊重原始表达，不要要求用户改变记录格式。

请使用下面的 Markdown 结构输出。只输出总结正文，不要解释规则。
如果某个板块没有内容，就跳过该板块。
为了让“加入看板”能识别事项，请在 Todo、已完成、重要提醒这几个板块中使用 "- " 输出条目；其他板块可以按最自然的方式表达。
请覆盖今天的所有记录，每一条都要有所呈现，不要遗漏任何一条。可以合并高度相似的内容，但不能跳过。
同一个事项只能出现一次。不要在 Todo 和已完成中重复同一件事。
每条看板候选事项必须是一个独立动作或明确结果，不要把多个无关事项塞进一条。
条目文字不要带 "☐"、"☑"、编号、状态标签或多余解释。

### 📋 Todo 回顾
- **默认分类**：任何需要去做、打算去做、计划中的事项，都放这里。
- 没有符号、没有截止时间、语义模糊的可执行条目，统一归 Todo，不要归提醒。
- ☑ 项不放这里。最多 8 条。
- 每条用 "- " 开头，写成可直接放进看板的短句。

### ✅ 已完成
- 只列出明确带有 "☑" 符号、或句子中有"已完成""做完了""搞定了"等明确完成语义的事项。
- 没有 ☑ 符号、且语义模糊或未来导向（如"头发补色""制定计划"）的条目，一律不放这里，归 Todo 或提醒。
- 宁可少归已完成，不要误判。最多 6 条。
- 每条用 "- " 开头，写成已经完成的结果，不要再像待办一样表达。

### 💭 感触洞见
- 仅当记录中确实有深度判断、反思或方向感时才输出，最多 3 条。
- 如果今天的记录以任务为主、没有值得提炼的洞见，直接跳过这个板块。

### 💬 精选好句
- 只放记录中适合原文保留的句子，没有就跳过。

### ⏰ 重要提醒
- 只放有明确截止时间、或用了"提醒""记得""别忘""deadline"等字眼的内容。
- 普通的计划和待办（如"头发补色""制定计划"）不放这里，放 Todo。最多 4 条。
- 每条用 "- " 开头。

### ✨ 今日寄语
- 仅当今天的记录有足够的情感厚度或值得回味的内容时才写，一句话，温和有力量。
- 如果今天只是普通的任务流水，跳过这个板块，不要强行制造鸡汤。

整体要求：
- 用中文。
- 保持克制、清晰、具体。
- 不要编造记录里没有的信息。
- 不要把所有内容都塞进 Todo；先判断性质再归类。`
}

export async function generateDailySummary(entries, settings, date, kanban = []) {
  const prompt = buildDailySummaryPrompt(entries, date, kanban)
  return callDeepSeek(
    [{ role: 'user', content: prompt }],
    settings,
    { controller: settings.controller, onChunk: settings.onChunk }
  )
}

// A warm, reflective letter for the archive (信箱) — not a task list
export function buildLetterPrompt(entries, date) {
  const compact = entries.map(e => ({
    time: new Date(e.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
    content: e.content.replace(/\s+/g, ' ').trim()
  }))
  const text = compact.map((e, i) => `${i + 1}. [${e.time}] ${e.content}`).join('\n')

  return `你是一位懂得倾听的朋友，正在给对方写一封信，回顾他这一天（${date}）。
下面是他今天零散记下的内容：

${text}

请基于这些记录，写一封温暖、真诚的信。要求：
- 用第二人称"你"，像一个懂他的朋友在回信。
- 篇幅简短克制：2-3 个短自然段，整体控制在 150-280 字。点到情绪和一点真诚的看见即可，不要铺陈、不要凑字数。
- 从这些零散记录里读出今天的情绪基调、在意的事、隐约的纠结或微小的欢喜，挑最值得说的写，不必面面俱到。
- 不要罗列任务清单，不要用"待办/已完成/提醒"这类分类标题。
- 不要编造记录里没有的事，但可以温柔地延伸、共情与体察。
- 结尾用一两句话给他一点轻轻的鼓励或祝福，不煽情、不说教。
- 用中文，语气克制而有温度。可以用"亲爱的"之类的称呼开头，但不要写日期抬头和落款署名。

只输出信的正文。`
}

export async function generateDailyLetter(entries, settings, date) {
  const prompt = buildLetterPrompt(entries, date)
  return callDeepSeek(
    [{ role: 'user', content: prompt }],
    settings,
    { controller: settings.controller, onChunk: settings.onChunk }
  )
}

// Strip any leading bullets / checkboxes / numbering, in any order or repetition
function stripItemPrefix(line) {
  let s = line, prev
  do {
    prev = s
    s = s
      .replace(/^[-*]\s*/, '')
      .replace(/^\[[ xX✓✔]\]\s*/, '')
      .replace(/^[☐☑]\s*/, '')
      .replace(/^\d+[.)、]\s*/, '')
      .trim()
  } while (s !== prev)
  return s.replace(/\*\*/g, '').trim()
}

// Parse all typed items from AI summary text
export function extractAllFromSummary(text) {
  const sections = [
    { emoji: '📋', type: 'todo',     done: false },
    { emoji: '✅', type: 'todo',     done: true  },
    { emoji: '⏰', type: 'reminder', done: false },
    { emoji: '💬', type: 'quote',    done: false },
    { emoji: '💭', type: 'thought',  done: false }
  ]

  const byText = new Map()
  for (const { emoji, type, done } of sections) {
    const re = new RegExp(`###[^\\n]*${emoji}[^\\n]*\\n([\\s\\S]*?)(?=###|$)`)
    const match = text.match(re)
    if (!match) continue
    match[1]
      .split('\n')
      .filter(l => l.trim().startsWith('-'))
      .map(stripItemPrefix)
      .filter(Boolean)
      .forEach(t => {
        const key = t.replace(/\s+/g, '').toLowerCase()
        const existing = byText.get(key)
        if (!existing) byText.set(key, { type, text: t, done: !!done })
        else if (done && !existing.done) existing.done = true   // 完成优先：任何板块标了完成即视为完成
      })
  }
  return [...byText.values()]
}
