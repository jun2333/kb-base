import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { config } from './config/index.js'

// 菜单配置（menu.config.mjs）的导出。
//
// 设计：默认行为是**按目录推导**（一级目录 = 菜单；同一层 ≥2 篇页面 = 有 sidebar）。
// 当用户想把菜单/侧边栏固定下来自己维护时，跑 `kb menu:export` 把"当前目录结构推导出的结果"
// 落成一份配置文件；之后站点**完全按配置渲染，不再兜底** —— 语义从"两处混合"变成"二选一"，可预测。

const MENU_FILE = 'menu.config.mjs'

/** 实例根 = docsPath 的父目录 */
const INSTANCE_ROOT = path.dirname(config.docsPath)

/**
 * 解析实例里安装的 @minijun/kb-site（core 不依赖它，靠运行时从实例解析 —— 和 `kb dev` 调 vitepress 同理）。
 * 菜单/侧边栏的推导规则只在 @minijun/kb-site 里实现一份，避免两处规则不一致。
 */
async function loadSiteMenu() {
  const require = createRequire(path.join(INSTANCE_ROOT, 'package.json'))
  const resolved = require.resolve('@minijun/kb-site/config/menu.mjs')
  return import(pathToFileURL(resolved).href) as Promise<{
    MENU_FILE: string
    hasMenuConfig: (root: string) => boolean
    loadMenu: (root: string) => Promise<{ nav: unknown[]; sidebar: Record<string, unknown> } | null>
    buildDefaultMenu: (o: { contentRoot: string; labels?: Record<string, string> }) => {
      nav: unknown[]
      sidebar: Record<string, unknown>
    }
  }>
}

/** 解析实例的 @minijun/kb-site/config/local-only.mjs（用于 --check 跳过「仅本地」内容） */
async function loadLocalOnly() {
  const require = createRequire(path.join(INSTANCE_ROOT, 'package.json'))
  const resolved = require.resolve('@minijun/kb-site/config/local-only.mjs')
  return import(pathToFileURL(resolved).href) as Promise<{
    resolveLocalEntries: (paths: string[], contentRoot: string) => Array<{ path: string; isFile?: boolean }>
  }>
}

  /**
   * --check 用的"仅本地"前缀过滤器（形如 '/私人笔记'、'/notes/draft'）。
   * 这些内容**本来就不该出现在菜单配置里**，报成"缺失"只会淹没真正的差异。
   */
async function localOnlyPrefixes(): Promise<string[]> {
  const raw = config.site.onlyLocal ?? []
  if (raw.length === 0) return []
  const { resolveLocalEntries } = await loadLocalOnly()
  return resolveLocalEntries(raw, config.docsPath).map((e) => '/' + e.path.replace(/\.md$/, ''))
}

/** 对象 → 好看的 JS 字面量（合法标识符的 key 不加引号） */
function toJs(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent)
  const padIn = '  '.repeat(indent + 1)

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const body = value.map((v) => `${padIn}${toJs(v, indent + 1)}`).join(',\n')
    return `[\n${body}\n${pad}]`
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return '{}'
    const body = entries
      .map(([k, v]) => {
        const key = /^[A-Za-z_$][\w$]*$/.test(k) ? k : `'${k.replace(/'/g, "\\'")}'`
        return `${padIn}${key}: ${toJs(v, indent + 1)}`
      })
      .join(',\n')
    return `{\n${body}\n${pad}}`
  }
  if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  return JSON.stringify(value)
}

/** 收集一棵 nav/sidebar 结构里出现过的所有 link */
function collectLinks(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => collectLinks(v, out))
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'link' && typeof v === 'string') out.add(v)
      else collectLinks(v, out)
    }
  }
  return out
}

const HEADER = `// 菜单与侧边栏配置（由 \`pnpm kb menu:export\` 生成）。
//
// ⚠️ 存在本文件时，站点**完全按它渲染**，不再按目录自动推导 —— 也就是说：
//    新增/改名/删除文件后，这里也要跟着改（用 \`pnpm kb menu:export --check\` 看还差哪些）。
//    想改回"全自动"，删掉本文件即可。
//
// 结构说明：
//   nav     —— 顶部菜单：[{ text, link }] 或带子项的 [{ text, items: [...] }]
//              （想让某些内容只在本地产出？那是**内容策略**，写在 knowledge.config.mjs
//                的 site.onlyLocal 里；link 落在那些路径下的菜单项会自动在线上隐藏）
//   sidebar —— 侧边栏：{ '/目录路径/': [{ text: '分组名', items: [{ text, link }] }] }
//              key 决定"哪些页面显示这一份"：VitePress 取最长匹配的前缀
`

export type ExportResult = {
  file: string
  created: boolean
  added?: string[]
  removed?: string[]
}

/** 导出（或检查）菜单配置 */
export async function runMenuExport(opts: { force?: boolean; check?: boolean } = {}): Promise<ExportResult> {
  const site = await loadSiteMenu()
  const file = path.join(INSTANCE_ROOT, MENU_FILE)
  const expected = site.buildDefaultMenu({ contentRoot: config.docsPath, labels: config.categories })

  // --check：只对比"目录推导的结果"和"配置里写的"，不改文件
  if (opts.check) {
    // 「仅本地」内容不进菜单配置，不算差异（否则一片私有目录会把真正的差异淹掉）
    const prefixes = await localOnlyPrefixes()
    const isLocal = (link: string) =>
      prefixes.some((p) => {
        const l = link.replace(/\/+$/, '')
        return l === p || l.startsWith(p + '/')
      })
    const keep = (set: Set<string>) => new Set([...set].filter((l) => !isLocal(l)))

    const current = await site.loadMenu(INSTANCE_ROOT)
    const want = keep(collectLinks({ nav: expected.nav, sidebar: expected.sidebar }))
    if (!current) return { file, created: false, added: [...want], removed: [] }

    const has = keep(collectLinks({ nav: current.nav, sidebar: current.sidebar }))
    return {
      file,
      created: false,
      added: [...want].filter((l) => !has.has(l)),
      removed: [...has].filter((l) => !want.has(l)),
    }
  }

  const exists = fs.existsSync(file)
  if (exists && !opts.force) return { file, created: false }

  const body = `${HEADER}export default ${toJs({ nav: expected.nav, sidebar: expected.sidebar })}\n`
  fs.writeFileSync(file, body, 'utf-8')
  return { file, created: true }
}
