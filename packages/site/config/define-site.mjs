import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { defineConfig } from 'vitepress'
import { buildNav } from './nav.mjs'
import { buildDefaultMenu } from './menu.mjs'
import { resolveLocalEntries, deriveLocalOnly } from './local-only.mjs'

const require = createRequire(import.meta.url)

/**
 * highlight.js 的深层导入清单，转成**绝对路径**。
 *
 * 为什么非得是绝对路径：`theme/components/AIChat.vue` 里 import 的
 * `highlight.js/lib/core` 等是 CJS，而 highlight.js 的 `es/*.js` 只是
 * 「薄 ESM 包装 + import CJS 的 lib/」—— Node 能 interop，**浏览器不能**，
 * 直接发给浏览器会报 `does not provide an export named 'default'` 并整站白屏。
 * 所以必须让 Vite 预打包（esbuild 做 CJS→ESM 互操作）。
 *
 * 而 `optimizeDeps.include` 的条目是**从项目根解析**的，highlight.js 只软链在
 * 本包自己的 node_modules 里（实例根没有），用裸包名会报
 * `Failed to resolve dependency` → 白屏照旧。
 * 所以这里从本包自身位置解析出绝对路径再交给 Vite。
 *
 * 生产构建走 Rollup（自带 commonjs 互操作），不依赖这段，但留着无害。
 */
const HLJS_LANGUAGES = [
  'javascript',
  'typescript',
  'python',
  'css',
  'xml',
  'bash',
  'json',
  'less',
  'scss',
  'yaml',
  'markdown',
  'go',
  'rust',
  'java',
]

/**
 * 解析 highlight.js 在本包下的真实位置（它只软链在本包自己的 node_modules 里，
 * 实例根解析不到）。返回包根目录 + 需要预打包的 ESM 入口。
 */
function resolveHljs() {
  try {
    const root = path.dirname(require.resolve('highlight.js/package.json'))
    return {
      root,
      include: [
        path.join(root, 'es', 'core.js'),
        ...HLJS_LANGUAGES.map((l) => path.join(root, 'es', 'languages', `${l}.js`)),
      ],
    }
  } catch {
    return { root: null, include: null }
  }
}

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
const hljs = resolveHljs()

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

      // highlight.js 的 es/ 是「薄 ESM 包装 + import CJS 的 lib/」的 dual-package 写法：
      //   es/core.js  →  import HighlightJS from '../lib/core.js'
      // Node 能对 CJS 做 interop，**浏览器不能** —— 把 lib/core.js 当 ESM 发给浏览器会报
      //   "does not provide an export named 'default'"，整站白屏。
      //
      // 所以主题不能被当成「预打包依赖」：那时 Vite 不往里扫，highlight.js 会被原样发给浏览器。
      // exclude 掉之后 Vite 按**源码**处理主题，主题里的 `highlight.js/lib/core` 会相对主题自身
      // 解析（命中 site 包私有 node_modules 里的软链）并被按需预打包 → esbuild 做 CJS→ESM 互操作。
      // 这也正是本地 link: 联调时能正常工作的原因。
      //
      // ⚠️ 注意别改成 `optimizeDeps.include: ['highlight.js/lib/core']` —— 实测行不通：
      // include 的条目是**从项目根**解析的，而 highlight.js 只软链在 site 包自己的
      // node_modules 里（不在实例根），会报 "Failed to resolve dependency"。
      // 只影响 dev：生产构建走 Rollup（自带 commonjs 互操作）。
      // 让 highlight.js 从**任何位置**都能解析 —— 它只是本包的依赖，软链在
      // node_modules/.pnpm/... 里，实例根解析不到；而 optimizeDeps.include 的条目
      // 是从项目根解析的（裸包名会报 Failed to resolve dependency）。
      // 有了 alias 之后，include 和 AIChat.vue 里的裸导入都会命中同一个绝对路径。
      ...(hljs.root
        ? {
            resolve: { alias: { 'highlight.js': hljs.root } },
            optimizeDeps: { include: hljs.include },
          }
        : {}),
    },
  })
}
