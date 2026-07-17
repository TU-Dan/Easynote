function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function renderMarkdown(text) {
  const bold = line => line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  let html = ''
  let inList = false

  for (const line of escapeHtml(text).split('\n')) {
    if (/^#{2,3}\s/.test(line)) {
      if (inList) { html += '</ul>'; inList = false }
      html += line.replace(/^#{2,3}\s+(.+)$/, (_, title) => `<h3>${bold(title)}</h3>`)
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
