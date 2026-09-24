import fs from 'node:fs'
import path from 'node:path'
import { isContentDir, listContentDirs } from './sidebar.mjs'
import { linkToPath } from './local-only.mjs'

// nav 处理（基座）。
// - 线上构建时过滤带 onlyLocal 的项（分组或叶子均可标记）；
// - 过滤后若某分组只剩 1 项，则把该项直接提到顶层（用子项自己的名字与链接）；
// - `site.nav` 缺省时用 buildAutoNav 生成极简导航（首页 + 前几个内容目录）。
//
// nav 同时是「仅本地」的唯一来源：带 onlyLocal 的项由 collectLocalPaths 收集，
// 供 srcExclude / sidebar 过滤 / 死链忽略使用（见 local-only.mjs），无需另维护列表。

/** 去掉内部标记，避免泄漏进 VitePress 配置 */
function strip(item) {
  const { onlyLocal, ...rest } = item
  return rest
}

/**
 * 收集 nav 中标记为「仅本地」的路径（唯一来源）。
 * onlyLocal 支持：路径字符串 / 路径数组 / true（退化为按该项 link 推导）。
 * @param {Array<Record<string, any>>} nav
 * @returns {string[]}
 */
export function collectLocalPaths(nav) {
  const out = []
  const push = (v) => {
    if (typeof v === 'string') out.push(v)
    else if (Array.isArray(v)) v.forEach((x) => typeof x === 'string' && out.push(x))
  }
  const walk = (item) => {
    if (!item) return
    if (item.onlyLocal === true) {
      if (item.link) out.push(linkToPath(item.link))
    } else {
      push(item.onlyLocal)
    }
    for (const c of item.items ?? []) walk(c)
  }
  for (const item of nav ?? []) walk(item)
  return out
}

/**
 * 处理导航：过滤仅本地项 + 单项分组提到顶层。
 * @param {Array<Record<string, any>>} nav
 * @param {{ excludeLocal?: boolean }} options
 */
export function buildNav(nav, { excludeLocal = false } = {}) {
  const source = Array.isArray(nav) ? nav : []
  const result = []

  const hidden = (item) => excludeLocal && Boolean(item.onlyLocal)

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
 * 缺省导航：首页 + 前 N 个内容目录（各链到其第一个文档）。
 * 供没有 site.nav 的新实例开箱即用。
 */
export function buildAutoNav({ contentRoot, exclude = [], labels = {}, max = 6 } = {}) {
  const nav = [{ text: '首页', link: '/' }]
  if (!contentRoot || !fs.existsSync(contentRoot)) return nav

  for (const name of listContentDirs(contentRoot)) {
    if (exclude.includes(name)) continue
    const first = firstDoc(path.join(contentRoot, name))
    if (first !== null) nav.push({ text: labels[name] ?? humanize(name), link: `/${name}/${first}` })
    if (nav.length >= max) break
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
