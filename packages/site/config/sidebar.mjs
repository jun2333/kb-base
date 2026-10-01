import fs from 'node:fs'
import path from 'node:path'

// 自动 sidebar 生成器（基座）。
// 扫描内容根目录，按「目录 → 分组、文件 → 条目」生成 VitePress sidebar，
// 供没有 menu.config.mjs 的新实例开箱即用（有配置文件时完全按配置，不调用这里）。
//
// 约定：
//   - **只有一级目录**会给一份 sidebar key（`/dir/`），整棵子树都在这份里
//   - 目录内 .md → 条目（标题取 frontmatter title，回退 h1，再回退文件名）
//   - 子目录 → 嵌套分组（默认展开）
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
 * 默认 sidebar：**每个一级目录一份，整棵子树都在里面**（≥2 条可导航内容才给）。
 *
 * 规则一句话：只在"一级目录"这一层切侧边栏。
 *   - 进 `服务端` 的任意一篇文章（含它的子目录）→ 左侧始终是**完整的那棵树**
 *   - 子目录只是树里的嵌套分组，**不再单独成 key**
 *   - 只有 1 条内容的目录 → 不给（一条的导航没有意义）
 *
 * ⚠️ 为什么不给子目录单独注册 key：VitePress 按"最长匹配前缀"选 key，
 * 子目录的 key 会**覆盖**父目录的 key —— 于是点进子目录时整棵父侧边栏会消失、
 * 只剩子目录那几条（视觉上像"跳到了另一个页面"，还会丢失上下文）。
 *
 * @param {{ contentRoot?: string, labels?: Record<string, string> }} options
 * @returns {Record<string, unknown[]>} VitePress sidebar 对象
 */
export function buildAutoSidebar({ contentRoot, labels = {} } = {}) {
  const sidebar = {}
  if (!contentRoot || !fs.existsSync(contentRoot)) return sidebar

  for (const name of listContentDirs(contentRoot)) {
    const items = collect(path.join(contentRoot, name), `/${name}/`)
    // ≥2 条才给：1 条的话侧边栏里就孤零零一项，不如不给
    // （子目录里的页面会跟着父目录这一份，所以「只有子目录」的目录也不会漏）
    if (items.length < 2) continue
    sidebar[`/${name}/`] = [
      { text: labels[name] ?? DEFAULT_LABELS[name] ?? humanize(name), items },
    ]
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

  // 子目录：嵌套分组（默认展开 —— 折叠会让"这层还有东西"变得不明显）
  const dirs = entries
    .filter((e) => e.isDirectory() && isContentDir(e.name))
    .sort((a, b) => a.name.localeCompare(b.name))
  for (const d of dirs) {
    const sub = collect(path.join(dir, d.name), `${prefix}${d.name}/`)
    if (sub.length > 0) items.push({ text: humanize(d.name), items: sub })
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
