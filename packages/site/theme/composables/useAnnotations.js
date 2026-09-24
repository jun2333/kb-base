import { ref, onMounted, watch } from 'vue'
import { useData } from 'vitepress'

const STORAGE_KEY = 'vp-annotations'

export function useAnnotations() {
  // 内容文件路径前缀由实例配置提供（themeConfig.kb.contentFilePrefix）
  const { theme } = useData()
  const contentFilePrefix = () => theme.value?.kb?.contentFilePrefix ?? ''

  const annotations = ref([])
  
  // 从 LocalStorage 加载批注
  onMounted(() => {
    loadAnnotations()
  })
  
  // 监听变化，自动保存
  watch(annotations, () => {
    saveAnnotations()
  }, { deep: true })
  
  function loadAnnotations() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        annotations.value = JSON.parse(saved)
      }
    } catch (e) {
      console.error('Failed to load annotations:', e)
      annotations.value = []
    }
  }
  
  function saveAnnotations() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(annotations.value))
    } catch (e) {
      console.error('Failed to save annotations:', e)
    }
  }
  
  // 添加批注
  function addAnnotation(annotation) {
    const newAnnotation = {
      id: `anno-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...annotation
    }
    
    annotations.value.push(newAnnotation)
    return newAnnotation
  }
  
  // 更新批注
  function updateAnnotation(id, updates) {
    const index = annotations.value.findIndex(a => a.id === id)
    if (index !== -1) {
      annotations.value[index] = {
        ...annotations.value[index],
        ...updates,
        updatedAt: new Date().toISOString()
      }
      return annotations.value[index]
    }
    return null
  }
  
  // 删除批注
  function deleteAnnotation(id) {
    const index = annotations.value.findIndex(a => a.id === id)
    if (index !== -1) {
      annotations.value.splice(index, 1)
      return true
    }
    return false
  }
  
  // 获取当前页面的批注
  function getPageAnnotations(pageUrl) {
    return annotations.value.filter(a => a.pageUrl === pageUrl)
  }
  
  // 根据 filePath 获取批注
  function getAnnotationsByFile(filePath) {
    return annotations.value.filter(a => a.filePath === filePath)
  }
  
  // 导出所有批注为 JSON
  function exportAnnotations() {
    const dataStr = JSON.stringify(annotations.value, null, 2)
    const blob = new Blob([dataStr], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `annotations-${new Date().toISOString().split('T')[0]}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }
  
  // 复制批注到剪贴板（格式化为易读文本）
  function copyAnnotationsToClipboard(onSuccess, onError) {
    if (annotations.value.length === 0) {
      onError('没有批注可复制')
      return
    }
    
    // 格式化为易读的文本
    const textContent = annotations.value.map((anno, index) => {
      // 优先使用 filePath，如果为空则从 pageUrl 提取
      const filePath = anno.filePath || extractPathFromUrl(anno.pageUrl)
      
      return `【批注 ${index + 1}】
文件：${filePath}
选中文本：${anno.selectedText}
批注内容：${anno.annotation}
时间：${formatTimeForCopy(anno.createdAt)}
---`
    }).join('\n\n')
    
    // 复制到剪贴板
    navigator.clipboard.writeText(textContent).then(() => {
      onSuccess(annotations.value.length)
    }).catch(err => {
      console.error('Failed to copy:', err)
      onError('复制失败，请尝试导出为文件')
    })
  }
  
  // 从 URL 提取内容文件路径
  function extractPathFromUrl(url) {
    try {
      const pathname = new URL(url).pathname
      const pathWithoutExt = pathname.replace(/\.html$/, '')
      return `${contentFilePrefix()}${pathWithoutExt}.md`
    } catch {
      return url
    }
  }
  
  // 格式化时间用于复制
  function formatTimeForCopy(isoString) {
    const date = new Date(isoString)
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  }
  
  // 清空所有批注
  function clearAllAnnotations() {
    annotations.value = []
    localStorage.removeItem(STORAGE_KEY)
  }
  
  // 获取批注统计
  function getStats() {
    return {
      total: annotations.value.length,
      byPage: annotations.value.reduce((acc, anno) => {
        acc[anno.pageUrl] = (acc[anno.pageUrl] || 0) + 1
        return acc
      }, {})
    }
  }
  
  return {
    annotations,
    addAnnotation,
    updateAnnotation,
    deleteAnnotation,
    getPageAnnotations,
    getAnnotationsByFile,
    exportAnnotations,
    copyAnnotationsToClipboard,
    clearAllAnnotations,
    getStats
  }
}
