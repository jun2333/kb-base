import { ref } from 'vue'

// 全站共用的右上角提示（toast）。
//
// 为什么做成模块级单例：批注、AI 助手、内容管理分别在不同组件里，各自 maintain 一份
// "toast 状态 + 定时器" 会散掉，样式也不一致（之前就是两套：一个 DOM 直插、一个面板内嵌条）。
// 这里只存数据，渲染交给 <ToastHost>（挂在主题 Layout 上，全站一份）。

export type ToastKind = 'info' | 'success' | 'warn' | 'error'
export type ToastItem = { id: number; message: string; kind: ToastKind }

const items = ref<ToastItem[]>([])
let seq = 0

/**
 * 弹一条提示。
 * @param timeout 毫秒；警告类默认给更长时间（够看清"要重启 dev"这种话）
 */
export function toast(message: string, kind: ToastKind = 'info', timeout?: number): number {
  const id = ++seq
  items.value = [...items.value, { id, message, kind }]
  const ms = timeout ?? (kind === 'warn' ? 8000 : 3000)
  if (ms > 0) setTimeout(() => dismiss(id), ms)
  return id
}

/** 关闭某条（点一下就关） */
export function dismiss(id: number) {
  items.value = items.value.filter((t) => t.id !== id)
}

export function useToast() {
  return { items, toast, dismiss }
}
