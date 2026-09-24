import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitepress'
import { buildAutoSidebar } from './sidebar.mjs'
import { buildNav, buildAutoNav, collectLocalPaths } from './nav.mjs'
import { resolveLocalEntries, deriveLocalOnly } from './local-only.mjs'

// 基座：由「实例配置」生成 VitePress 站点配置。
// 实例的 docs/.vitepress/config.mts 只需几行：defineSite({ config, manualSidebar, metaUrl })。
//
// 约定：
// - 内容根 = config.contentRoot（相对配置文件），可与站点根不同（内容外置）
// - nav = config.site.nav（唯一来源）；带 onlyLocal 的项线上隐藏，并派生 srcExclude / sidebar 过滤 / 死链忽略
// - sidebar = config.site.autoSidebar ? 自动生成 + 手写覆盖 : 纯手写

const CONFIG_FILENAME = 'knowledge.config.mjs'

/** 从某目录向上查找文件，返回其所在目录 */
function findConfigDir(startDir) {
  let dir = startDir
  for (;;) {
    if (fs.existsSync(path.join(dir, CONFIG_FILENAME))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

/** 生产环境过滤掉「仅本地」的 sidebar 分组与链接 */
function filterSidebar(sidebar, { excludeLocal, sidebarKeys, links }) {
  if (!excludeLocal) return sidebar
  const result = {}

  for (const [key, groups] of Object.entries(sidebar)) {
    if (sidebarKeys.includes(key)) continue

    const filtered = groups
      .map((group) => {
        if (!group.items) return group // 兼容「直接链接」形式
        return { ...group, items: group.items.filter((item) => !links.includes(item.link ?? '')) }
      })
      .filter((group) => !group.items || group.items.length > 0)

    if (filtered.length > 0) result[key] = filtered
  }

  return result
}

/**
 * @param {{
 *   config: Record<string, any>,     // knowledge.config.mjs 的 default 导出
 *   manualSidebar?: Record<string, any>, // 实例手写 sidebar（sidebar.manual.mts）
 *   metaUrl?: string,                // 传 import.meta.url；用于推断 siteRoot
 *   siteRoot?: string,               // 或显式指定站点根（含 .vitepress 的目录）
 *   mode?: 'dev' | 'prod',
 *   includeLocal?: boolean,
 * }} options
 */
export function defineSite({
  config = {},
  manualSidebar = {},
  metaUrl,
  siteRoot: siteRootOption,
  mode = 'prod',
  includeLocal = false,
} = {}) {
  const siteRoot = siteRootOption ?? (metaUrl ? path.dirname(path.dirname(fileURLToPath(metaUrl))) : process.cwd())
  const configDir = findConfigDir(siteRoot) ?? path.dirname(siteRoot)

  const isProd = mode === 'prod'
  const excludeLocal = isProd && !includeLocal
  const site = config.site ?? {}
  const categories = config.categories ?? {}

  // 内容根可与站点根不同（内容外置时用 srcDir 指过去）
  const contentRoot = path.resolve(configDir, config.contentRoot ?? './docs')
  const srcDir = contentRoot === path.resolve(siteRoot) ? undefined : contentRoot

  // nav 是「仅本地」的唯一来源
  const navSource =
    Array.isArray(site.nav) && site.nav.length > 0
      ? site.nav
      : buildAutoNav({ contentRoot, labels: categories })

  const derived = deriveLocalOnly(resolveLocalEntries(collectLocalPaths(navSource), contentRoot))

  const sidebarData = site.autoSidebar
    ? { ...buildAutoSidebar({ contentRoot, exclude: derived.dirs, labels: categories }), ...manualSidebar }
    : manualSidebar

  const nav = buildNav(navSource, { excludeLocal })

  const L = { excludeLocal, sidebarKeys: derived.sidebarKeys, links: derived.links }

  // 传给主题运行时使用的实例信息（组件通过 useData().themeConfig.kb 读取）
  const contentRel = path.relative(configDir, contentRoot).split(path.sep).join('/')
  const kb = {
    // API 地址：默认按配置端口拼；跨机部署时可显式指定
    apiBase: site.apiBase ?? `http://localhost:${config.port ?? 3000}`,
    chat: {
      title: site.chat?.title ?? '知识库助手',
      welcome: site.chat?.welcome ?? '你好！我是这个知识库的助手',
      hints: site.chat?.hints ?? '可以就知识库里的内容提问',
    },
    // 批注记录文件路径时使用的前缀（内容根相对实例根，如 '/docs'）
    contentFilePrefix: contentRel && !contentRel.startsWith('..') ? `/${contentRel}` : '',
  }

  return defineConfig({
    title: site.title ?? '知识库',
    description: site.description ?? '个人知识库',

    ...(srcDir ? { srcDir } : {}),

    // GitHub Pages 等子路径部署时由 BASE_PATH 注入（构建期写死进产物）
    base: process.env.BASE_PATH || '/',

    // 生产环境不构建「仅本地」路径（无法通过 URL 访问）
    srcExclude: excludeLocal ? derived.paths : [],

    // 生产环境忽略"指向已排除内容"的死链；全量模式额外忽略 localhost 链接
    ignoreDeadLinks: isProd
      ? excludeLocal
        ? derived.deadLinks
        : [...derived.deadLinks, /localhost/]
      : false,

    themeConfig: {
      nav,
      sidebar: filterSidebar(sidebarData, L),
      search: { provider: 'local' },
      socialLinks: site.socialLinks ?? [],
      footer: site.footer ?? { message: '', copyright: '' },
      kb,
    },

    vite: {
      // 主题来自 workspace/npm 包，SSR 阶段需要内联处理
      ssr: { noExternal: ['@kb/site'] },
    },
  })
}
