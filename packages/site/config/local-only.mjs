import fs from 'node:fs'
import path from 'node:path'

// 「仅本地」内容的派生。
//
// 唯一来源：knowledge.config.mjs 的 `site.onlyLocal: ['目录或文件', ...]`
// —— 这是**内容策略**（哪些内容不进线上构建），与"菜单怎么排"（menu.config.mjs）是两件事。
//
// 派生出来的四份东西：
//   paths        → VitePress 的 srcExclude（生产不构建，URL 访问不到）
//   prefixes     → nav 过滤：link 落在这些前缀下的菜单项线上隐藏
//   sidebarKeys  → 侧边栏分组过滤（目录级）
//   links        → 侧边栏条目过滤（文件级）
//   deadLinks    → 忽略"指向已排除内容"的死链

/**
 * 把路径解析为 { path, isFile } 条目，自动区分目录 / 文件。
 * 支持写 '私人笔记'（目录）、'notes/draft.md'（文件）、'notes/draft'（自动补 .md）。
 * @param {string[]} rawPaths 相对 contentRoot 的路径
 * @param {string} contentRoot
 */
export function resolveLocalEntries(rawPaths, contentRoot) {
  const seen = new Set()
  const entries = []

  for (const raw of rawPaths ?? []) {
    const p = String(raw ?? '').replace(/^\/+/, '').replace(/\/+$/, '')
    if (!p || seen.has(p)) continue
    seen.add(p)

    const full = path.join(contentRoot, p)
    if (fs.existsSync(full)) {
      entries.push(fs.statSync(full).isDirectory() ? { path: p } : { path: p, isFile: true })
    } else if (fs.existsSync(full + '.md')) {
      entries.push({ path: p + '.md', isFile: true })
    } else {
      entries.push({ path: p }) // 不存在时按目录处理（容错）
    }
  }
  return entries
}

/** 由 { path, isFile } 条目派生各类"排除"配置 */
export function deriveLocalOnly(entries = []) {
  const list = Array.isArray(entries) ? entries : []
  const entries2 = list.map((i) => ({ path: i.path, isFile: !!i.isFile }))
  const slug = (i) => '/' + i.path.replace(/\.md$/, '')

  return {
    // 生产环境不构建的路径（目录 → dir/**，文件 → 原路径）
    paths: entries2.map((i) => (i.isFile ? i.path : `${i.path}/**`)),
    // nav 过滤用的前缀（形如 '/私人笔记'、'/notes/draft'）
    prefixes: entries2.map(slug),
    // 生产环境忽略的死链（其他文章指向"已排除内容"）
    deadLinks: entries2.map((i) => new RegExp(`^${slug(i)}${i.isFile ? '' : '\\/'}`)),
    // sidebar：目录级分组 key 与文件级链接
    sidebarKeys: entries2.filter((i) => !i.isFile).map((i) => `/${i.path}/`),
    links: entries2.filter((i) => i.isFile).map((i) => slug(i)),
  }
}
