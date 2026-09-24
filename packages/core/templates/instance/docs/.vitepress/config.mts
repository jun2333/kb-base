import { defineSite } from '@kb/site'
import instanceConfig from '../../knowledge.config.mjs'
import manualSidebar from './sidebar.manual.mts'

// 站点配置全部由基座 @kb/site 的 defineSite 派生（导航、侧边栏、仅本地过滤等）。
export default defineSite({
  config: instanceConfig,
  manualSidebar,
  metaUrl: import.meta.url,
  mode: process.env.NODE_ENV === 'production' ? 'prod' : 'dev',
  includeLocal: process.env.INCLUDE_LOCAL === '1',
})
