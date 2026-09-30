import fs from 'node:fs'
import path from 'node:path'
import { config } from './config/index.js'
import { IMPORT_DIR, normalizeName, type Strategy } from './import.js'

// 归档：把 docs/imported/（收件箱）里的东西移到正式分类下。
//
// 分类 = docs/ 下的顶层目录 —— 与「目录即分类」一致，所以归档就是移动文件，
// 移完之后导航/侧边栏/categories/onlyLocal 全部自动生效，不需要另建分类模型。
//
// - 归档单个文件 → 打平到目标分类：imported/a/b/c.md → 前端/c.md
// - 归档整个目录 → 保留内部结构：  imported/前端/react/ → 前端/react/

/** 不参与"分类"的顶层目录（站点壳 / 站点元信息 / 收件箱本身） */
const NON_CATEGORY = new Set([IMPORT_DIR, 'getting-started', 'example', 'node_modules', '.vitepress', '.git', 'public', 'dist'])

export type TreeNode = {
  name: string
  /** 相对 docs/imported/ 的路径；根节点的子项以此作为归档入参 */
  path: string
  type: 'file' | 'dir'
  title?: string
  count?: number
  children?: TreeNode[]
}

export type Category = { name: string; label: string; count: number }

/** 取文件标题：frontmatter.title → 正文 h1 → 文件名 */
function titleOf(file: string): string {
  let text = ''
  try {
    text = fs.readFileSync(file, 'utf-8').slice(0, 2000)
  } catch {
    return path.basename(file, '.md')
  }
  const fm = text.match(/^---\s*\n([\s\S]*?)\n---/)
  if (fm) {
    const t = fm[1].match(/^title:\s*["']?(.+?)["']?\s*$/m)
    if (t) return t[1].trim()
  }
  const h1 = text.match(/^#\s+(.+)$/m)
  return h1 ? h1[1].trim() : path.basename(file, '.md')
}

/** 收件箱树：docs/imported/ 下的文件与目录（只列 md） */
export function inboxTree(): { tree: TreeNode[]; total: number } {
  const root = path.join(config.docsPath, IMPORT_DIR)
  if (!fs.existsSync(root)) return { tree: [], total: 0 }

  let total = 0
  const walk = (dir: string, rel: string): TreeNode[] => {
    const out: TreeNode[] = []
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const abs = path.join(dir, e.name)
      const childRel = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        const children = walk(abs, childRel)
        const count = countMd(abs)
        if (count > 0) out.push({ name: e.name, path: childRel, type: 'dir', count, children })
      } else if (e.name.toLowerCase().endsWith('.md')) {
        total++
        out.push({ name: e.name, path: childRel, type: 'file', title: titleOf(abs) })
      }
    }
    return out
  }

  return { tree: walk(root, ''), total }
}

function countMd(dir: string): number {
  let n = 0
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += countMd(path.join(dir, e.name))
    else if (e.name.toLowerCase().endsWith('.md')) n++
  }
  return n
}

/**
 * 现有分类：docs/ 下的顶层目录（带 md 计数与显示名）。
 * 空目录也列出来 —— 用户刚"新建分类"时它还是空的，不显示会让人以为没建成功。
 */
export function listCategories(): Category[] {
  const root = config.docsPath
  if (!fs.existsSync(root)) return []
  const out: Category[] = []
  for (const e of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!e.isDirectory() || e.name.startsWith('.') || NON_CATEGORY.has(e.name)) continue
    out.push({ name: e.name, label: config.categories[e.name] ?? e.name, count: countMd(path.join(root, e.name)) })
  }
  return out
}


export type ArchiveSummary = {
  moved: Array<{ from: string; to: string; type: 'file' | 'dir' }>
  skipped: Array<{ from: string; reason: string }>
  failed: Array<{ from: string; error: string }>
}

/** 防目录穿越：只允许规范化的相对路径，且不能跑出 docs/ */
function safeTarget(target: string): string {
  const segs = target.split('/').filter(Boolean).map(normalizeName)
  if (segs.length === 0) throw new Error('目标分类为空')
  if (segs.some((s) => s === '.' || s === '..')) throw new Error('目标分类不合法')
  if (NON_CATEGORY.has(segs[0])) throw new Error(`「${segs[0]}」是保留目录，不能作为分类`)
  return segs.join('/')
}

/** 同目录下找不冲突的名字（文件带 .md，目录不带） */
function dedupe(abs: string, isDir: boolean): string {
  const dir = path.dirname(abs)
  const base = isDir ? path.basename(abs) : path.basename(abs, '.md')
  for (let i = 2; i < 1000; i++) {
    const candidate = path.join(dir, isDir ? `${base}-${i}` : `${base}-${i}.md`)
    if (!fs.existsSync(candidate)) return candidate
  }
  throw new Error('同名项过多')
}

/** 删除目录里的空目录（归档之后清理收件箱） */
function pruneEmptyDirs(dir: string): void {
  if (!fs.existsSync(dir)) return
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) pruneEmptyDirs(path.join(dir, e.name))
  }
  if (dir === path.join(config.docsPath, IMPORT_DIR)) return // 收件箱本身保留
  if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
}

/** 把一个目录的内容**合并**进已存在的目标目录（同名归档时用，避免出现 前端/前端/） */
function mergeDirInto(
  from: string,
  destRoot: string,
  strategy: Strategy,
  summary: ArchiveSummary,
  rel: string,
): void {
  for (const entry of fs.readdirSync(from)) {
    const childFrom = path.join(from, entry)
    const isDir = fs.statSync(childFrom).isDirectory()
    let childTo = path.join(destRoot, entry)

    if (fs.existsSync(childTo)) {
      if (strategy === 'skip') {
        summary.skipped.push({ from: `${rel}/${entry}`, reason: '目标已存在' })
        continue
      }
      if (strategy === 'rename') childTo = dedupe(childTo, isDir)
      else fs.rmSync(childTo, { recursive: true, force: true })
    }

    fs.renameSync(childFrom, childTo)
    summary.moved.push({ from: `${rel}/${entry}`, to: path.relative(config.docsPath, childTo).split(path.sep).join('/'), type: isDir ? 'dir' : 'file' })
  }
  fs.rmdirSync(from)
}

/**
 * 归档：把收件箱里的条目移到目标分类下。
 * @param items 相对 docs/imported/ 的路径（文件或目录）
 * @param target 目标分类（可带子路径，如 '前端' 或 '前端/react'）
 */
export function archive(items: string[], target: string, strategy: Strategy = 'skip'): ArchiveSummary {
  const inbox = path.join(config.docsPath, IMPORT_DIR)
  const destRoot = path.join(config.docsPath, safeTarget(target))
  fs.mkdirSync(destRoot, { recursive: true })
  const destLast = path.basename(destRoot)

  const summary: ArchiveSummary = { moved: [], skipped: [], failed: [] }

  for (const rel of items) {
    try {
      const from = path.join(inbox, rel)
      if (!from.startsWith(inbox + path.sep) || !fs.existsSync(from)) {
        summary.failed.push({ from: rel, error: '源不存在' })
        continue
      }
      const isDir = fs.statSync(from).isDirectory()
      const name = normalizeName(path.basename(from, isDir ? undefined : '.md')) + (isDir ? '' : '.md')

      // 目录名与目标分类同名 → 合并内容（否则会变成 前端/前端/）
      if (isDir && name === destLast) {
        mergeDirInto(from, destRoot, strategy, summary, rel)
        continue
      }

      let to = path.join(destRoot, name)

      if (fs.existsSync(to)) {
        if (strategy === 'skip') {
          summary.skipped.push({ from: rel, reason: '目标已存在' })
          continue
        }
        if (strategy === 'rename') to = dedupe(to, isDir)
        else if (isDir && fs.statSync(to).isDirectory()) {
          // overwrite 目录：合并（逐个文件覆盖）
          fs.cpSync(from, to, { recursive: true, force: true })
          fs.rmSync(from, { recursive: true, force: true })
          summary.moved.push({ from: rel, to: path.relative(config.docsPath, to), type: 'dir' })
          continue
        } else {
          fs.rmSync(to, { recursive: true, force: true })
        }
      }

      fs.mkdirSync(path.dirname(to), { recursive: true })
      fs.renameSync(from, to)
      summary.moved.push({ from: rel, to: path.relative(config.docsPath, to).split(path.sep).join('/'), type: isDir ? 'dir' : 'file' })
    } catch (err) {
      summary.failed.push({ from: rel, error: (err as Error).message })
    }
  }

  pruneEmptyDirs(inbox)
  return summary
}


export type RemoveSummary = {
  removed: string[]
  failed: Array<{ path: string; error: string }>
}

/**
 * 从收件箱**直接删除**（不归档）。
 * 用途：导进来一批东西，其中有些根本不要（临时笔记、跑题内容），归档反而脏了分类。
 *
 * 安全约束：只允许动 `docs/imported/` 里面的东西（解析后的绝对路径必须仍在收件箱内），
 * 所以"误删分类里的正文"这种事故不可能发生；而且 import 从来没改过源目录，原稿也还在。
 */
export function remove(items: string[]): RemoveSummary {
  const inbox = path.resolve(path.join(config.docsPath, IMPORT_DIR))
  const out: RemoveSummary = { removed: [], failed: [] }

  for (const rel of items) {
    try {
      const abs = path.resolve(path.join(inbox, rel))
      if (abs === inbox || !abs.startsWith(inbox + path.sep)) {
        throw new Error('路径越界（只能删收件箱里的东西）')
      }
      if (!fs.existsSync(abs)) throw new Error('不存在')
      fs.rmSync(abs, { recursive: true, force: true })
      out.removed.push(rel)
    } catch (err) {
      out.failed.push({ path: rel, error: (err as Error).message })
    }
  }

  pruneEmptyDirs(inbox)
  return out
}
