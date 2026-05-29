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
        max_tokens: 900,
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

export function buildDailySummaryPrompt(entries, date) {
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
请控制总长度，优先保留关键事项，不要逐字复述所有记录。

### 📋 Todo 回顾
- 只列出仍需推进的关键事项，最多 8 条。
- 如果来自 "☐" 项，保留原意并适度压缩。
- 如果来自 "☑" 项，不要放在这里。

### ✅ 已完成
- 只列出 "☑" 或语义上已经完成的关键事项，最多 6 条。
- 用简洁语言说明完成了什么。

### 💭 感触洞见
- 提炼用户今天的判断、反思、方向感、问题意识，最多 3 条。

### 💬 精选好句
- 只放适合原文保留的句子。

### ⏰ 重要提醒
- 放时间敏感、需要后续注意或不能遗漏的内容，最多 4 条。

### ✨ 今日寄语
- 一句话，温和、有力量，不要鸡汤。

整体要求：
- 用中文。
- 保持克制、清晰、具体。
- 不要编造记录里没有的信息。
- 不要把所有内容都塞进 Todo；先判断性质再归类。`
}

export async function generateDailySummary(entries, settings, date) {
  const prompt = buildDailySummaryPrompt(entries, date)
  return callDeepSeek(
    [{ role: 'user', content: prompt }],
    settings,
    { controller: settings.controller, onChunk: settings.onChunk }
  )
}

// Parse all typed items from AI summary text
export function extractAllFromSummary(text) {
  const sections = [
    { emoji: '📋', type: 'todo' },
    { emoji: '⏰', type: 'reminder' },
    { emoji: '💬', type: 'quote' },
    { emoji: '💭', type: 'thought' }
  ]

  const items = []
  for (const { emoji, type } of sections) {
    const re = new RegExp(`###[^\\n]*${emoji}[^\\n]*\\n([\\s\\S]*?)(?=###|$)`)
    const match = text.match(re)
    if (!match) continue
    match[1]
      .split('\n')
      .filter(l => l.trim().startsWith('-'))
      .map(l => l.replace(/^-\s*/, '').replace(/\*\*/g, '').trim())
      .filter(Boolean)
      .forEach(t => items.push({ type, text: t }))
  }
  return items
}
