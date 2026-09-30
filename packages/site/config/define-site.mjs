import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitepress'
import { buildNav } from './nav.mjs'
import { buildDefaultMenu } from './menu.mjs'
import { resolveLocalEntries, deriveLocalOnly } from './local-only.mjs'

// 基座：由「实例配置」生成 VitePress 站点配置。
// 实例的 docs/.vitepress/config.mts 只需几行：defineSite({ config, menu, metaUrl })。
//
// 约定：
// - 内容根 = 站点根 = 实例根下的 docs/（固定，不可配）
// - 菜单/侧边栏 = menu.config.mjs（有就完全按它，没有就按目录推导）；带 onlyLocal 的项线上隐藏，并派生 srcExclude / sidebar 过滤 / 死链忽略
// - 首页 hero 的 GitHub 按钮从 site.socialLinks 派生（首页模板不写死仓库地址）


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

/**
 * 首页 hero 的 GitHub 按钮：**从 `site.socialLinks` 派生**，不写死在首页里。
 * 这样"仓库地址"只有一处配置，却同时喂了两处展示（右上角图标 + 首页按钮）。
 * @returns {{ theme: string, text: string, link: string } | null}
 */
function githubHeroAction(site) {
  const link = (site.socialLinks ?? []).find((s) => s?.icon === 'github')?.link
  return typeof link === 'string' && link ? { theme: 'alt', text: 'GitHub', link } : null
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
 *   config: Record<string, any>,   // knowledge.config.mjs 的 default 导出
 *   menu?: { nav?: any[], sidebar?: Record<string, any> } | null,
 *                                  // menu.config.mjs 的内容（实例的 config.mts 用顶层 await 读它）
 *                                  // 缺省 = 走默认行为（按目录推导）
 *   metaUrl?: string,              // 传 import.meta.url；用于推断 siteRoot
 *   siteRoot?: string,             // 或显式指定站点根（含 .vitepress 的目录）
 *   mode?: 'dev' | 'prod',
 *   includeLocal?: boolean,
 * }} options
 */
export function defineSite({
  config = {},
  menu = null,
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

  // 内容根 = 站点根（固定为实例根下的 docs/）
  const contentRoot = path.resolve(siteRoot)

  // 菜单与侧边栏：有 menu.config.mjs 就**完全按它来**（不做兜底），否则按目录推导
  const effective = menu ?? buildDefaultMenu({ contentRoot, labels: categories })
  const navSource = effective.nav ?? []
  const sidebarData = effective.sidebar ?? {}

  // 「仅本地」= 内容策略，来自 knowledge.config.mjs 的 site.onlyLocal（与菜单配置解耦）
  const derived = deriveLocalOnly(resolveLocalEntries(site.onlyLocal ?? [], contentRoot))

  // link 落在仅本地路径下的菜单项，线上隐藏（分组会被裁掉/提升）
  const nav = buildNav(navSource, { excludeLocal, hiddenPrefixes: derived.prefixes })

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

    /**
     * 首页 hero 支持从配置派生 action：
     * 配了 `site.socialLinks` 里的 github，就自动给 `layout: home` 的页面补一个 GitHub 按钮
     * —— 首页模板里因此不用写死仓库地址。（已自带 GitHub 按钮的页面不会被重复加。）
     */
    transformPageData(pageData) {
      if (pageData.frontmatter?.layout !== 'home') return
      const action = githubHeroAction(site)
      if (!action) return

      const hero = (pageData.frontmatter.hero ??= {})
      const actions = (hero.actions ??= [])
      const hasGithub = actions.some(
        (a) => a?.link === action.link || /github/i.test(String(a?.text ?? '')),
      )
      if (!hasGithub) actions.push(action)
    },

    vite: {
      // 主题来自 workspace/npm 包，SSR 阶段需要内联处理
      ssr: { noExternal: ['@minijun/kb-site'] },
    },
  })
}
