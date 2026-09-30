// @minijun/kb-core 对外 API（无副作用：不含顶层 await，可安全被类型/工具引用）
export { createApp, startServer } from './server.js'
export { loadConfig, findConfigPath } from './config/loader.js'
export { getRetriever, searchDocs, invalidateRetriever } from './rag/retriever.js'
export { createTools } from './agent/tools.js'
export { runAgentLoop } from './agent/loop.js'
export { SYSTEM_PROMPT } from './agent/prompt.js'
export type { KnowledgeConfig, ResolvedConfig, NavItem } from './config/types.js'
