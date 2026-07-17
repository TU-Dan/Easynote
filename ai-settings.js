export const DEFAULT_AI_BASE_URL = 'https://api.deepseek.com'

export function normalizeAiBaseUrl(value = '') {
  const raw = value.trim() || DEFAULT_AI_BASE_URL
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error('API Base URL 格式不正确')
  }

  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !localHttp) {
    throw new Error('API Base URL 必须使用 HTTPS（本地调试除外）')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('API Base URL 不能包含账号、查询参数或锚点')
  }

  return url.href.replace(/\/$/, '')
}

export function isCustomAiEndpoint(baseUrl) {
  return normalizeAiBaseUrl(baseUrl) !== DEFAULT_AI_BASE_URL
}

export function validateAiSettings(settings = {}) {
  const apiKey = String(settings.apiKey || '').trim()
  const baseUrl = normalizeAiBaseUrl(settings.baseUrl)
  if (!apiKey) throw new Error('请输入 DeepSeek API Key')
  if (isCustomAiEndpoint(baseUrl) && settings.approvedBaseUrl !== baseUrl) {
    throw new Error('请确认你信任这个服务地址')
  }
  return { ...settings, apiKey, baseUrl }
}
