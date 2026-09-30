import fs from 'node:fs'
import path from 'node:path'
import { config } from './config/index.js'

// 导入：把用户已有的 Markdown 搬进知识库。
//
// 约定（与「一个根」的设计配套）：
// - 内容固定在 <实例根>/docs/；导入的东西先进 docs/imported/（收件箱），
//   之后在站点的「归档」里一件件/一批批归到正式分类（目录）。
// - 只支持 .md；排除 .git / node_modules / .vitepress / 隐藏文件；源里的 index.md 也跳过（会与站点首页冲突）。
// - 保留被选目录内部的相对结构；若所有文件都在同一个顶层目录下，则剥掉那层（避免多出一层没意义的目录名）。
//
// 「预检」与「执行」拆成两步：plan() 只读盘不写盘，run() 才落盘。

/** 导入的收件箱目录（相对 docs/） */
export const IMPORT_DIR = 'imported'

const EXCLUDED_DIRS = new Set(['node_modules', '.vitepress', '.git', 'dist', 'public'])

export type Strategy = 'skip' | 'overwrite' | 'rename'

/** 一条待导入内容：path 为相对路径；content 缺省表示由调用方稍后补齐 */
export type ImportEntry = { path: string; content?: string }

/** 为什么忽略某个路径（返回 null 表示要导入） */
export function shouldSkip(rel: string): string | null {
  const parts = rel.split('/').filter(Boolean)
  if (parts.length === 0) return '空路径'
  for (const p of parts.slice(0, -1)) {
    if (EXCLUDED_DIRS.has(p)) return `忽略目录 ${p}/`
    if (p.startsWith('.')) return '隐藏目录'
  }
  const base = parts[parts.length - 1]
  if (base.startsWith('.')) return '隐藏文件'
  if (!base.toLowerCase().endsWith('.md')) return '非 Markdown'
  if (base === 'index.md') return '与站点首页冲突'
  return null
}

/**
 * 文件名 / 目录名规范化。
 * 中文原样保留（语义优先，不转拼音）；只处理会破坏 URL 或文件系统的字符。
 */
export function normalizeName(name: string): string {
  return name
    .replace(/[#?%&+:*"<>|\\]/g, '-') // URL 保留字符 / 各平台非法字符
    .replace(/\s+/g, '-') // 空白 → 连字符
    .replace(/-{2,}/g, '-') // 合并重复
    .replace(/^[-.]+|[-.]+$/g, '') // 去首尾
    .slice(0, 200) // 过长截断
}

export type PlanItem = {
  /** 源相对路径 */
  from: string
  /** 目标相对路径（相对 docs/，如 imported/前端/react.md） */
  to: string
  status: 'new' | 'conflict'
}

export type ImportPlan = {
  count: number
  items: PlanItem[]
  /** 已存在同名（默认跳过，可切策略） */
  conflicts: PlanItem[]
  /** 被忽略的（非 md / 隐藏 / index.md…） */
  skipped: Array<{ path: string; reason: string }>
  /** 因文件名字符被规范化而改名的 */
  renamed: Array<{ from: string; to: string }>
  /** 顶层分类预览（相对 imported/ 的第一层；空表示平铺在最外层） */
  categories: Array<{ name: string; count: number }>
}

/** 所有路径若共享同一个顶层目录，返回它（用于剥掉"被选目录名"这层） */
function commonTop(paths: string[]): string | null {
  if (paths.length === 0) return null
  if (!paths.every((p) => p.split('/').length > 1)) return null
  const firsts = new Set(paths.map((p) => p.split('/')[0]))
  return firsts.size === 1 ? [...firsts][0] : null
}

/** 源相对路径 → 目标相对路径（相对 docs/），顺带给出改名信息 */
function targetOf(rel: string, top: string | null): { to: string; renamed: { from: string; to: string } | null } {
  const trimmed = top ? rel.split('/').slice(1).join('/') : rel
  const parts = trimmed.split('/').filter(Boolean)
  const safe = parts.map((p, i) => {
    // 最后一段是文件名：去掉 .md 后规范化，再补回来
    if (i === parts.length - 1) return `${normalizeName(p.replace(/\.md$/i, ''))}.md`
    return normalizeName(p)
  })
  const raw = [IMPORT_DIR, ...parts].join('/')
  const to = [IMPORT_DIR, ...safe].join('/')
  const rawBase = parts[parts.length - 1]
  const safeBase = safe[safe.length - 1]
  return { to, renamed: rawBase === safeBase ? null : { from: rawBase, to: safeBase } }
}

/** 预检：只读盘，不写盘 */
export function plan(entries: ImportEntry[]): ImportPlan {
  const paths = entries.map((e) => e.path).filter(Boolean)
  const top = commonTop(paths)

  const items: PlanItem[] = []
  const skipped: Array<{ path: string; reason: string }> = []
  const renamedMap = new Map<string, string>()

  for (const e of entries) {
    const reason = shouldSkip(e.path)
    if (reason) {
      skipped.push({ path: e.path, reason })
      continue
    }
    const { to, renamed } = targetOf(e.path, top)
    if (renamed) renamedMap.set(renamed.from, renamed.to)
    const exists = fs.existsSync(path.join(config.docsPath, to))
    items.push({ from: e.path, to, status: exists ? 'conflict' : 'new' })
  }

  const countByTop = new Map<string, number>()
  for (const it of items) {
    const rest = it.to.slice(IMPORT_DIR.length + 1).split('/')
    const key = rest.length > 1 ? rest[0] : ''
    countByTop.set(key, (countByTop.get(key) ?? 0) + 1)
  }

  return {
    count: items.length,
    items,
    conflicts: items.filter((i) => i.status === 'conflict'),
    skipped,
    renamed: [...renamedMap.entries()].map(([from, to]) => ({ from, to })),
    categories: [...countByTop.entries()]
      .filter(([name]) => name)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
  }
}

/** 递归读一个目录，只收 .md；非 md / 隐藏文件记入 ignored */
export function readDir(srcDir: string): { entries: ImportEntry[]; ignored: Array<{ path: string; reason: string }> } {
  const root = path.resolve(srcDir)
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`目录不存在：${root}`)
  }

  const entries: ImportEntry[] = []
  const ignored: Array<{ path: string; reason: string }> = []

  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, e.name)
      const rel = path.relative(root, abs).split(path.sep).join('/')
      if (e.isDirectory()) {
        if (EXCLUDED_DIRS.has(e.name) || e.name.startsWith('.')) {
          ignored.push({ path: rel, reason: `忽略目录 ${e.name}/` })
          continue
        }
        walk(abs)
      } else if (e.isFile()) {
        if (!e.name.toLowerCase().endsWith('.md')) {
          ignored.push({ path: rel, reason: '非 Markdown' })
          continue
        }
        entries.push({ path: rel, content: fs.readFileSync(abs, 'utf-8') })
      }
    }
  }
  walk(root)

  // 源里的 index.md 交给 plan() 统一判（这里不做，保证 CLI 与面板口径一致）
  return { entries, ignored }
}

export type ImportSummary = {
  imported: Array<{ from: string; to: string }>
  skipped: Array<{ path: string; reason: string }>
  failed: Array<{ path: string; error: string }>
}

/** 同目录下找一个不冲突的名字：a.md → a-2.md → a-3.md（只改文件名，层级不变） */
function dedupeTarget(to: string): string {
  const idx = to.lastIndexOf('/')
  const dir = idx >= 0 ? to.slice(0, idx) : ''
  const base = to.slice(idx + 1).replace(/\.md$/i, '')
  for (let i = 2; i < 1000; i++) {
    const candidate = `${dir ? `${dir}/` : ''}${base}-${i}.md`
    if (!fs.existsSync(path.join(config.docsPath, candidate))) return candidate
  }
  throw new Error('同名文件过多')
}

/**
 * 执行导入：写入 <实例根>/docs/imported/。
 * 源目录不会被修改或删除（调用方负责"复制"语义，这里只做写入）。
 * 目标路径的算法与 plan() 完全一致（同一套 commonTop + targetOf）。
 */
export function run(
  entries: ImportEntry[],
  opts: { strategy?: Strategy; onProgress?: (done: number, total: number, rel: string) => void } = {},
): ImportSummary {
  const strategy: Strategy = opts.strategy ?? 'skip'
  const top = commonTop(entries.map((e) => e.path).filter(Boolean))
  const total = entries.length
  const summary: ImportSummary = { imported: [], skipped: [], failed: [] }

  let done = 0
  for (const e of entries) {
    opts.onProgress?.(done, total, e.path)
    done++

    const reason = shouldSkip(e.path)
    if (reason) {
      summary.skipped.push({ path: e.path, reason })
      continue
    }
    if (typeof e.content !== 'string') {
      summary.failed.push({ path: e.path, error: '缺少文件内容' })
      continue
    }

    try {
      const { to } = targetOf(e.path, top)
      const abs = path.join(config.docsPath, to)

      let finalTo = to
      if (fs.existsSync(abs)) {
        if (strategy === 'skip') {
          summary.skipped.push({ path: e.path, reason: '已存在（按跳过处理）' })
          continue
        }
        if (strategy === 'rename') finalTo = dedupeTarget(to)
        // overwrite：直接覆盖
      }

      const finalAbs = path.join(config.docsPath, finalTo)
      fs.mkdirSync(path.dirname(finalAbs), { recursive: true })
      fs.writeFileSync(finalAbs, e.content, 'utf-8')
      summary.imported.push({ from: e.path, to: finalTo })
    } catch (err) {
      summary.failed.push({ path: e.path, error: (err as Error).message })
    }
  }
  opts.onProgress?.(total, total, '')
  return summary
}

/** 收件箱里还有多少待归档的 md */
export function importedCount(): number {
  const dir = path.join(config.docsPath, IMPORT_DIR)
  if (!fs.existsSync(dir)) return 0
  let n = 0
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name))
      else if (e.name.toLowerCase().endsWith('.md')) n++
    }
  }
  walk(dir)
  return n
}
