import { loadConfig } from './loader.js'

// 实例配置：由仓库根的 knowledge.config.mjs 驱动（定位与归一化见 ./loader.ts）。
// 顶层 await —— 所有 import 本模块的代码会自动等待配置加载完成。
export const config = await loadConfig()

export { findConfigPath, CONTENT_DIR } from './loader.js'
export type { KnowledgeConfig, ResolvedConfig, NavItem } from './types.js'
