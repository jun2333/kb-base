import DefaultTheme from 'vitepress/theme'
import Layout from './Layout.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  Layout: Layout,
  async enhanceApp({ app, router }) {
    // 只在客户端初始化 mermaid
    if (typeof window !== 'undefined') {
      const { default: mermaid } = await import('mermaid')
      
      mermaid.initialize({
        startOnLoad: false, // 禁用自动加载，手动控制
        theme: 'default',
        securityLevel: 'loose',
      })
      
      // 页面加载后渲染
      setTimeout(() => renderMermaid(), 100)
      
      // 路由切换后重新渲染
      router.onAfterRouteChanged = () => {
        setTimeout(() => renderMermaid(), 100)
      }
    }
  },
}

// 渲染所有 Mermaid 图表
async function renderMermaid() {
  try {
    const { default: mermaid } = await import('mermaid')
    const diagrams = document.querySelectorAll('.language-mermaid pre')
    
    for (const diagram of diagrams) {
      const code = diagram.textContent || ''
      const parent = diagram.parentElement
      
      if (!parent) continue
      
      // 如果已经渲染过，跳过
      if (parent.querySelector('.mermaid')) continue
      
      try {
        // 使用合法的 ID 格式（只包含字母、数字、下划线、连字符）
        const id = `mermaid-${Date.now()}-${Math.floor(Math.random() * 1000000)}`
        const { svg } = await mermaid.render(id, code)
        const wrapper = document.createElement('div')
        wrapper.className = 'mermaid-wrapper'

        const container = document.createElement('div')
        container.className = 'mermaid'
        container.innerHTML = svg

        const btn = document.createElement('button')
        btn.className = 'mermaid-zoom-btn'
        btn.title = '放大查看'
        btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>'
        btn.addEventListener('click', () => openMermaidModal(svg))

        wrapper.appendChild(container)
        wrapper.appendChild(btn)

        if (diagram.parentNode === parent) {
          parent.replaceChild(wrapper, diagram)
        }
      } catch (err) {
        console.error('Mermaid render error:', err)
      }
    }
  } catch (err) {
    console.error('Failed to load mermaid:', err)
  }
}

function openMermaidModal(svg) {
  const overlay = document.createElement('div')
  overlay.className = 'mermaid-modal-overlay'

  const content = document.createElement('div')
  content.className = 'mermaid-modal-content'

  const closeBtn = document.createElement('button')
  closeBtn.className = 'mermaid-modal-close'
  closeBtn.innerHTML = '&times;'
  closeBtn.addEventListener('click', () => overlay.remove())

  const body = document.createElement('div')
  body.className = 'mermaid-modal-body'
  body.innerHTML = svg

  content.appendChild(closeBtn)
  content.appendChild(body)
  overlay.appendChild(content)

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove()
  })

  const onKeydown = (e) => {
    if (e.key === 'Escape') {
      overlay.remove()
      document.removeEventListener('keydown', onKeydown)
    }
  }
  document.addEventListener('keydown', onKeydown)

  document.body.appendChild(overlay)
}
