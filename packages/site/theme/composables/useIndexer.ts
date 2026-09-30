import { ref } from 'vue'
import { useManageApi } from './useManageApi.ts'

// 建立/更新索引（SSE 进度）。
//
// **模块级单例**：索引是"整个内容库"的状态，不属于某个 tab —— 导入、归档、删除都会让它过期，
// 而「归档」tab 在收件箱空时是不显示的。所以状态与入口都收在面板底部那条常驻栏里（见 ManagePanel），
// 两个 tab 只负责在改动后调 markDirty()。

const indexing = ref(false)
const indexed = ref(false)
const dirty = ref(false)
const logs = ref<string[]>([])
const error = ref('')

export function useIndexer() {
  const api = useManageApi()

  async function build(full = false): Promise<boolean> {
    indexing.value = true
    indexed.value = false
    logs.value = []
    error.value = ''
    try {
      await api.stream('/api/index', { full }, (e) => {
        if (e.type === 'log') logs.value.push(String(e.data))
        else if (e.type === 'error') error.value = String(e.data)
      })
      indexed.value = !error.value
      if (indexed.value) dirty.value = false
      return indexed.value
    } catch (err) {
      error.value = (err as Error).message
      return false
    } finally {
      indexing.value = false
    }
  }

  /** 内容变了（导入 / 归档 / 删除）→ 标记索引已过期 */
  function markDirty() {
    dirty.value = true
    indexed.value = false
  }

  return { indexing, indexed, dirty, logs, error, build, markDirty }
}
