import fs from 'node:fs'
import path from 'node:path'

// 自动 sidebar 生成器（基座）。
// 扫描内容根目录，按「目录 → 分组、文件 → 条目」生成 VitePress sidebar，
// 供没有手写 sidebar 的新实例开箱即用。手写部分见 sidebar.manual.mts。
//
// 约定：
//   - 顶层目录 → 一个 sidebar key（`/dir/`）
//   - 目录内 .md → 条目（标题取 frontmatter title，回退 h1，再回退文件名）
//   - 子目录 → 折叠的嵌套分组
// 不引入额外依赖（手写 frontmatter / h1 轻量解析）。

/** 不作为知识内容的目录（跳过） */
export const IGNORED_DIRS = new Set(['node_modules', '.vitepress', '.git', 'public', 'dist'])

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
 * @param {{ contentRoot?: string, exclude?: string[], labels?: Record<string, string> }} options
 * @returns {Record<string, unknown[]>} VitePress sidebar 对象
 */
export function buildAutoSidebar({ contentRoot, exclude = [], labels = {} } = {}) {
  const sidebar = {}
  if (!contentRoot || !fs.existsSync(contentRoot)) return sidebar

  for (const name of listContentDirs(contentRoot)) {
    if (exclude.includes(name)) continue
    const items = collect(path.join(contentRoot, name), `/${name}/`)
    if (items.length > 0) {
      sidebar[`/${name}/`] = [{ text: labels[name] ?? humanize(name), items }]
    }
  }
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
