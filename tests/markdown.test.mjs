import assert from 'node:assert/strict'
import test from 'node:test'

import { renderMarkdown } from '../markdown.js'

test('renders the supported Markdown subset', () => {
  assert.equal(
    renderMarkdown('### 今日\n- **完成**记录\n\n慢一点'),
    '<h3>今日</h3><ul><li><strong>完成</strong>记录</li></ul><p>慢一点</p>'
  )
})

test('escapes HTML before adding supported markup', () => {
  const html = renderMarkdown('### <img src=x onerror=alert(1)>\n- **<script>bad()</script>**')

  assert.equal(html.includes('<img'), false)
  assert.equal(html.includes('<script>'), false)
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.match(html, /<strong>&lt;script&gt;bad\(\)&lt;\/script&gt;<\/strong>/)
})
