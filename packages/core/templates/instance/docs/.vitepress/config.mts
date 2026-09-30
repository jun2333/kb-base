import { fileURLToPath } from 'node:url'
import { defineSite } from '@kb/site'
import { loadMenu } from '@kb/site/config/menu.mjs'
import instanceConfig from '../../knowledge.config.mjs'

// 站点配置由基座 @kb/site 的 defineSite 派生（菜单、侧边栏、仅本地过滤等）。
//
// 菜单与侧边栏：
//   - 有 menu.config.mjs  → 完全按它渲染（不做兜底）
//   - 没有                → 按目录推导（一级目录 = 菜单；同一层 ≥2 篇页面 = 有 sidebar）
// 想自定义就跑 `pnpm kb menu:export` 导出配置文件，之后自己维护。
const menu = await loadMenu(fileURLToPath(new URL('../../', import.meta.url)))

export default defineSite({
  config: instanceConfig,
  menu,
  metaUrl: import.meta.url,
  mode: process.env.NODE_ENV === 'production' ? 'prod' : 'dev',
  includeLocal: process.env.INCLUDE_LOCAL === '1',
})
