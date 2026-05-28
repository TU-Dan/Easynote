async function callDeepSeek(messages, settings) {
  const base = (settings.baseUrl || 'https://api.deepseek.com').replace(/\/$/, '')
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({ model: 'deepseek-chat', messages, temperature: 0.7, max_tokens: 2000 })
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error?.message || `API 错误 ${res.status}`)
  }
  return (await res.json()).choices[0].message.content
}

export async function generateDailySummary(entries, settings, date) {
  const text = entries.map((e, i) => `${i + 1}. ${e.content}`).join('\n')
  const prompt = `你是用户的私人助理，帮助梳理每日记录。

用户今天（${date}）的记录（未分类，请自行判断类型）：

${text}

请自动归类，生成今日总结。使用以下格式（某类没有内容就跳过该板块）：

### 📋 Todo 回顾
识别出待办或任务类记录，逐条列出。

### 💭 感触洞见
识别出感悟、想法类记录，提炼核心主题。

### 💬 精选好句
识别出摘抄、引用类记录，原文呈现。

### ⏰ 重要提醒
识别出提醒、注意事项类记录，高亮展示。

### ✨ 今日寄语
一句有力量的总结。

用中文，语气温和而有深度，避免废话。`

  return callDeepSeek([{ role: 'user', content: prompt }], settings)
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

