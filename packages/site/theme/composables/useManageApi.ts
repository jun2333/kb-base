import { useData } from 'vitepress'

// 「内容管理」（导入 / 归档 / 索引）的后端调用。
// 后端地址与 AI 助手一致：themeConfig.kb.apiBase（由实例配置的 port 派生）。

export type SseEvent = { type: 'log' | 'progress' | 'done' | 'error'; data?: unknown; [k: string]: unknown }

export function useManageApi() {
  const { theme } = useData()
  const base = () => ((theme.value as any)?.kb?.apiBase as string) ?? 'http://localhost:3000'

  async function post<T = any>(path: string, body: unknown = {}): Promise<T> {
    const res = await fetch(base() + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = (await res.json()) as T & { error?: string }
    if (!res.ok) throw new Error((data as any)?.error || `请求失败（${res.status}）`)
    return data
  }

  async function get<T = any>(path: string): Promise<T> {
    const res = await fetch(base() + path)
    if (!res.ok) throw new Error(`请求失败（${res.status}）`)
    return (await res.json()) as T
  }

  /** 读 SSE 流（POST），每个事件回调一次 */
  async function stream(path: string, body: unknown, onEvent: (e: SseEvent) => void, signal?: AbortSignal) {
    const res = await fetch(base() + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
    if (!res.ok || !res.body) throw new Error(`请求失败（${res.status}）`)

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const chunks = buffer.split('\n\n')
      buffer = chunks.pop() ?? ''
      for (const chunk of chunks) {
        const line = chunk.split('\n').find((l) => l.startsWith('data:'))
        if (!line) continue
        try {
          onEvent(JSON.parse(line.slice(5).trim()) as SseEvent)
        } catch {
          /* 忽略坏行 */
        }
      }
    }
  }

  return { base, post, get, stream }
}
