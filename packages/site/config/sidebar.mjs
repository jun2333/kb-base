import fs from 'node:fs'
import path from 'node:path'

// 自动 sidebar 生成器（基座）。
// 扫描内容根目录，按「目录 → 分组、文件 → 条目」生成 VitePress sidebar，
// 供没有 menu.config.mjs 的新实例开箱即用（有配置文件时完全按配置，不调用这里）。
//
// 约定：
//   - 同一层有 ≥2 篇页面 → 该层一个 sidebar key（`/dir/`）
//   - 目录内 .md → 条目（标题取 frontmatter title，回退 h1，再回退文件名）
//   - 子目录 → 折叠的嵌套分组
// 不引入额外依赖（手写 frontmatter / h1 轻量解析）。

/** 不作为知识内容的目录（跳过） */
export const IGNORED_DIRS = new Set(['node_modules', '.vitepress', '.git', 'public', 'dist'])

/**
 * 基座约定目录的默认显示名（实例的 categories 可覆盖）。
 * 只放"基座自己造出来的目录"，不猜用户的目录名。
 */
export const DEFAULT_LABELS = {
  imported: '待归档', // 导入的收件箱：有内容时才出现在导航里，方便预览
  'getting-started': '快速上手',
}

/** 是否为可纳入导航的内容目录 */
export function isContentDir(name) {
  return !name.startsWith('.') && !IGNORED_DIRS.has(name)
}

/** 列出内容根下的顶层内容目录（已排序） */
export function listContentDirs(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && isContentDir(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b))
}

/**
 * 默认 sidebar：**同一层有 ≥2 篇页面，就给它一份 sidebar**（任意层级都算）。
 *
 * 规则一句话：sidebar 出现在"有并列内容可导航"的地方。
 *   - 一级目录下直接放 11 篇 → 给一份（列出这 11 篇）
 *   - 一级目录下是 4 个子目录 → 各自给自己的（进子目录就聚焦子目录；父层也能看到折叠组）
 *   - 只有 1 篇的目录 → 不给（一条的导航没有意义）
 *
 * VitePress 按"最长匹配前缀"选 key，所以子目录的 key 会覆盖父目录的 key。
 *
 * @param {{ contentRoot?: string, labels?: Record<string, string> }} options
 * @returns {Record<string, unknown[]>} VitePress sidebar 对象
 */
export function buildAutoSidebar({ contentRoot, labels = {} } = {}) {
  const sidebar = {}
  if (!contentRoot || !fs.existsSync(contentRoot)) return sidebar

  const walk = (dir, prefix, segs) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    // 同级直接放了几篇 md？≥2 才给这个目录一份 sidebar
    // （内容根本身不算：首页和站点说明页是"站点级页面"，给它们挂侧边栏很怪）
    const directMd = entries.filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md')).length
    if (segs.length > 0 && directMd >= 2) {
      const items = collect(dir, prefix)
      if (items.length >= 2) {
        const name = segs[segs.length - 1] ?? ''
        sidebar[prefix] = [{ text: labels[name] ?? DEFAULT_LABELS[name] ?? humanize(name), items }]
      }
    }

    // 继续下钻（子目录各自成 key）
    for (const e of entries) {
      if (e.isDirectory() && isContentDir(e.name)) {
        walk(path.join(dir, e.name), `${prefix}${e.name}/`, [...segs, e.name])
      }
    }
  }

  walk(contentRoot, '/', [])
  return sidebar
}

/** 递归收集一个目录下的 sidebar 条目 */
function collect(dir, prefix) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const items = []

  // 文件条目：index.md 排最前，其余按文件名排序
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .sort((a, b) => {
      if (a.name === 'index.md') return -1
      if (b.name === 'index.md') return 1
      return a.name.localeCompare(b.name)
    })
  for (const f of files) {
    const slug = f.name === 'index.md' ? '' : f.name.replace(/\.md$/, '')
    items.push({ text: titleOf(path.join(dir, f.name), f.name), link: `${prefix}${slug}` })
  }

  // 子目录：嵌套为折叠分组
  const dirs = entries
    .filter((e) => e.isDirectory() && isContentDir(e.name))
    .sort((a, b) => a.name.localeCompare(b.name))
  for (const d of dirs) {
    const sub = collect(path.join(dir, d.name), `${prefix}${d.name}/`)
    if (sub.length > 0) items.push({ text: humanize(d.name), collapsed: true, items: sub })
  }

  return items
}

/** 取标题：frontmatter.title → 正文 h1 → 文件名 */
function titleOf(file, fallback) {
  let text = ''
  try {
    text = fs.readFileSync(file, 'utf-8').slice(0, 2000)
  } catch {
    return fallback.replace(/\.md$/, '')
  }
  const fm = text.match(/^---\s*\n([\s\S]*?)\n---/)
  if (fm) {
    const t = fm[1].match(/^title:\s*["']?(.+?)["']?\s*$/m)
    if (t) return t[1].trim()
  }
  const h1 = text.match(/^#\s+(.+)$/m)
  if (h1) return h1[1].trim()
  return fallback.replace(/\.md$/, '')
}

/** 目录名 → 展示名（kebab/snake → 首字母大写） */
function humanize(name) {
  return name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
