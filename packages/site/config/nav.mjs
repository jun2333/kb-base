import fs from 'node:fs'
import path from 'node:path'
import { isContentDir, listContentDirs, DEFAULT_LABELS } from './sidebar.mjs'

// nav 处理（基座）。
// - 线上构建时过滤掉"落在仅本地路径下"的项（路径来自 knowledge.config.mjs 的 site.onlyLocal）；
// - 过滤后若某分组只剩 1 项，则把该项直接提到顶层（用子项自己的名字与链接）；
// - 没有 menu.config.mjs 时用 buildAutoNav 生成默认菜单（一级目录各一项）。

/** 去掉内部标记（仅本地已改为配置驱动，这里只是防止旧配置里的字段泄漏进 VitePress） */
function strip(item) {
  const { onlyLocal, ...rest } = item
  return rest
}

/** 该 link 是否落在仅本地前缀下（线上隐藏它） */
function hitPrefix(link, prefixes) {
  const l = String(link ?? '').replace(/\/+$/, '')
  return prefixes.some((p) => l === p || l.startsWith(p + '/'))
}

/**
 * 处理导航：过滤落在仅本地路径下的项 + 单项分组提到顶层。
 * @param {Array<Record<string, any>>} nav
 * @param {{ excludeLocal?: boolean, hiddenPrefixes?: string[] }} options
 */
export function buildNav(nav, { excludeLocal = false, hiddenPrefixes = [] } = {}) {
  const source = Array.isArray(nav) ? nav : []
  const result = []
  const hidden = (item) => excludeLocal && hitPrefix(item?.link, hiddenPrefixes)

  for (const raw of source) {
    if (hidden(raw)) continue

    // 叶子项（直接链接）
    if (!Array.isArray(raw.items)) {
      result.push(strip(raw))
      continue
    }

    const items = raw.items.filter((i) => !hidden(i))
    if (items.length === 0) continue // 空分组移除
    if (items.length === 1) {
      result.push(strip(items[0])) // 单项：提到顶层
      continue
    }
    result.push({ ...strip(raw), items: items.map(strip) })
  }

  return result
}

/**
 * 默认导航：**一级目录 = 菜单项**（各链到该目录的默认页：index.md → 没有就取第一篇）。
 * 不含「首页」—— 点站点标题/logo 就是回首页。
 * 不设条数上限：目录多就该显示多，静默少几个会让人完全不知道为什么。
 */
export function buildAutoNav({ contentRoot, labels = {} } = {}) {
  const nav = []
  if (!contentRoot || !fs.existsSync(contentRoot)) return nav

  for (const name of listContentDirs(contentRoot)) {
    const first = firstDoc(path.join(contentRoot, name))
    if (first !== null) nav.push({ text: labels[name] ?? DEFAULT_LABELS[name] ?? humanize(name), link: `/${name}/${first}` })
  }
  return nav
}

/** 目录内第一个可链接文档（相对路径，去 .md；index.md → ''），无则 null */
function firstDoc(dir) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }

  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b))
  if (files.includes('index.md')) return ''
  if (files.length > 0) return files[0].replace(/\.md$/, '')

  const dirs = entries
    .filter((e) => e.isDirectory() && isContentDir(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b))
  for (const d of dirs) {
    const sub = firstDoc(path.join(dir, d))
    if (sub !== null) return `${d}/${sub}`
  }
  return null
}

function humanize(name) {
  return name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
