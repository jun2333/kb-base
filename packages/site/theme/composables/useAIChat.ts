import { ref, shallowRef } from 'vue'
import { useData } from 'vitepress'

export interface ChatSource {
  source: string
  title: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  sources?: ChatSource[]
  streaming?: boolean
  stopped?: boolean
}

export function useAIChat() {
  // 后端地址由实例配置提供（themeConfig.kb.apiBase），默认按默认端口拼
  const { theme } = useData()
  const apiBase = () => (theme.value as any)?.kb?.apiBase ?? 'http://localhost:3000'

  const messages = ref<ChatMessage[]>([])
  const isLoading = ref(false)
  const abortController = shallowRef<AbortController | null>(null)

  // 流式内容直接更新回调，绕过 Vue 响应式
  let onToken: ((token: string) => void) | null = null
  let onSources: ((sources: ChatSource[]) => void) | null = null
  let onDone: (() => void) | null = null

  // 来源延迟渲染：先缓存检索结果，等收到第一个 token（流式真正开始）再展示，
  // 避免"参考来源先出、文字迟迟不来"的割裂体验
  let pendingSources: ChatSource[] | null = null
  let streamStarted = false

  function flushPendingSources() {
    if (pendingSources && !streamStarted) {
      streamStarted = true
      onSources?.(pendingSources)
      pendingSources = null
    }
  }

  async function sendMessage(content: string) {
    if (!content.trim() || isLoading.value) return

    messages.value.push({ role: 'user', content })

    const assistantMsg: ChatMessage = {
      role: 'assistant',
      content: '',
      streaming: true,
    }
    messages.value.push(assistantMsg)
    isLoading.value = true
    pendingSources = null
    streamStarted = false

    abortController.value = new AbortController()

    try {
      const history = messages.value
        .slice(0, -2)
        .map((m) => ({ role: m.role, content: m.content }))

      const response = await fetch(`${apiBase()}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: content, history }),
        signal: abortController.value.signal,
      })

      if (!response.ok) {
        const lastMsg = messages.value[messages.value.length - 1]
        if (lastMsg?.role === 'assistant') {
          lastMsg.content = `请求失败 (${response.status})`
          lastMsg.streaming = false
        }
        isLoading.value = false
        return
      }

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const json = JSON.parse(line.slice(6))
            if (json.type === 'sources') {
              const lastMsg = messages.value[messages.value.length - 1]
              if (lastMsg?.role === 'assistant') {
                lastMsg.sources = json.data
              }
              pendingSources = json.data
            } else if (json.type === 'token') {
              flushPendingSources()
              onToken?.(json.data)
            } else if (json.type === 'done') {
              // 模型可能没有任何输出，兜底展示来源
              flushPendingSources()
              onDone?.()
              const lastMsg = messages.value[messages.value.length - 1]
              if (lastMsg?.role === 'assistant') {
                lastMsg.streaming = false
              }
            } else if (json.type === 'error') {
              const lastMsg = messages.value[messages.value.length - 1]
              if (lastMsg?.role === 'assistant') {
                lastMsg.content = `错误: ${json.data}`
                lastMsg.streaming = false
              }
            }
          } catch {
            // skip malformed SSE lines
          }
        }
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        // 用户手动停止：已输出的内容保留，未展示的来源补上
        flushPendingSources()
      } else {
        const lastMsg = messages.value[messages.value.length - 1]
        if (lastMsg?.role === 'assistant') {
          lastMsg.content = '连接失败，请检查服务器是否启动'
          lastMsg.streaming = false
        }
      }
    } finally {
      isLoading.value = false
    }
  }

  function stopGeneration() {
    abortController.value?.abort()
    const lastMsg = messages.value[messages.value.length - 1]
    if (lastMsg?.role === 'assistant') {
      lastMsg.streaming = false
      lastMsg.stopped = true
    }
    isLoading.value = false
  }

  function resendMessage(index: number) {
    const userMsg = messages.value[index - 1]
    if (userMsg?.role === 'user') {
      messages.value.splice(index, 1)
      sendMessage(userMsg.content)
    }
  }

  function clearMessages() {
    messages.value = []
  }

  function registerStreamCallbacks(
    tokenCb: (token: string) => void,
    sourcesCb: (sources: ChatSource[]) => void,
    doneCb: () => void
  ) {
    onToken = tokenCb
    onSources = sourcesCb
    onDone = doneCb
  }

  return { messages, isLoading, sendMessage, stopGeneration, resendMessage, clearMessages, registerStreamCallbacks }
}
