import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { listContentDirs, buildAutoSidebar } from './sidebar.mjs'
import { buildAutoNav } from './nav.mjs'

// 菜单配置（顶部菜单 + 侧边栏）与默认行为。
//
// 语义（重要）：**没有配置文件 → 走默认行为；有配置文件 → 完全按配置来，不做任何兜底。**
// 之所以不混合（自动 + 手写）：混合时"哪一项生效"很难讲清 —— 实例里就出现过
// "把 autoSidebar 改成 true 却还是手写的"这种困惑。
//
// 默认行为（约定大于配置）：
//   一级目录 = 菜单项（名字取目录名，链接到该目录默认页：index.md，没有就取第一篇）
//   一级目录 ≥2 条内容 = 该目录一份 sidebar（整棵子树都在里面，子目录只是嵌套分组；
//   子目录不单独成 key —— 否则最长前缀匹配会让父侧边栏在点进子目录时整棵消失）

/** 菜单配置文件名（实例根，与 knowledge.config.mjs 平级） */
export const MENU_FILE = 'menu.config.mjs'

export function menuFilePath(instanceRoot) {
  return path.join(instanceRoot, MENU_FILE)
}

export function hasMenuConfig(instanceRoot) {
  return fs.existsSync(menuFilePath(instanceRoot))
}

/**
 * 读取菜单配置。不存在则返回 null（调用方回退到默认行为）。
 * 实例的 docs/.vitepress/config.mts 里用顶层 await 调它（VitePress 的配置支持顶层 await）。
 */
export async function loadMenu(instanceRoot) {
  const p = menuFilePath(instanceRoot)
  if (!fs.existsSync(p)) return null
  const mod = await import(pathToFileURL(p).href)
  const menu = mod.default ?? {}
  return {
    nav: Array.isArray(menu.nav) ? menu.nav : [],
    sidebar: menu.sidebar && typeof menu.sidebar === 'object' && !Array.isArray(menu.sidebar) ? menu.sidebar : {},
  }
}

/** 默认行为：按目录推导出 { nav, sidebar }（menu:export 导出的就是它） */
export function buildDefaultMenu({ contentRoot, labels = {} } = {}) {
  return {
    nav: buildAutoNav({ contentRoot, labels }),
    sidebar: buildAutoSidebar({ contentRoot, labels }),
  }
}
