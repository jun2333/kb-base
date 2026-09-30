// 一个知识库实例的配置类型。
// 数据来源：仓库根的 knowledge.config.mjs（用 @type {import(...).KnowledgeConfig} 引用本文件）。

/** 菜单项（menu.config.mjs 的 nav） */
export type NavItem = {
  text?: string
  link?: string
  items?: NavItem[]
}

/** 模型端点：可指向本地 Ollama（默认）或任意 OpenAI 兼容服务 */
export type ModelSpec =
  | string
  | {
      model?: string
      /** 服务地址（OpenAI 兼容，通常以 /v1 结尾） */
      baseUrl?: string
      /** 从哪个环境变量读取 API Key（远程服务用）。密钥本身放 .env，这里只写变量名，避免入库 */
      apiKeyEnv?: string
    }

/** 向量库连接：默认本地 Chroma；远程 / 云可给 url + tokenEnv */
export type ChromaSpec = {
  /** 完整地址（优先于 host/port）；远程或云服务用这个 */
  url?: string
  host?: string
  port?: number
  ssl?: boolean
  /** 从哪个环境变量读取 token。token 本身放 .env，这里只写变量名，避免入库 */
  tokenEnv?: string
  tenant?: string
  database?: string
}

/** 解析后的模型端点 */
export type ResolvedModel = {
  baseUrl: string
  model: string
  apiKey: string
  /** 是否为本地 Ollama（决定能否走原生 /api/chat 的 think 参数） */
  ollamaNative: boolean
}

/** 解析后的向量库连接 */
export type ResolvedChroma = {
  url: string
  /** 本地容器端口（kb chroma:start 用它）。配了远程 url 时为 undefined */
  port?: number
  token?: string
  tenant?: string
  database?: string
}

/** knowledge.config.mjs 的形状（用户书写，路径可为相对或绝对） */
export type KnowledgeConfig = {
  /** 实例名（仅用于展示 / 日志） */
  name?: string
  /** 索引范围（glob 模式） */
  index: { include?: string[]; exclude?: string[] }
  /** 数据目录：index-manifest / chroma / eval-history / eval-baseline */
  dataDir: string
  /** 评估目录：测试集 / 阈值 / 已审核 / 报告 */
  evalDir: string
  /** 向量集合名（一实例一库） */
  collectionName: string
  /**
   * 模型配置。默认走本地 Ollama；也可指向任意 OpenAI 兼容服务（远程大模型）。
   * 简写（字符串）等价于本地模型名；对象可指定 baseUrl / apiKeyEnv。
   */
  models: {
    /** 两个模型共用的默认服务地址（默认本地 Ollama） */
    baseUrl?: string
    /** 两个模型共用的默认 API Key 环境变量名 */
    apiKeyEnv?: string
    chat?: ModelSpec
    embedding?: ModelSpec
  }
  /** 文本切分 */
  chunk: { size?: number; overlap?: number }
  /** Rerank 重排（cross-encoder 精排，默认关闭：慢，本项目实测性价比低） */
  rerank: { enabled?: boolean; candidates?: number }
  /** 检索策略（混合检索：向量 + BM25 关键词） */
  retrieval?: {
    hybrid?: {
      /** 是否启用混合检索（默认 true） */
      enabled?: boolean
      /** 两路各取多少候选做融合 */
      candidates?: number
      /** 向量路权重 */
      vectorWeight?: number
      /** BM25 路权重 */
      bm25Weight?: number
    }
  }
  /** 向量库：默认本地 Chroma；远程 / 云给 url + tokenEnv */
  chroma: ChromaSpec
  /** 后端服务端口 */
  port?: number
  /** .env 文件路径（相对配置文件） */
  envFile?: string
  /** 目录名 → 分类显示名（评估统计 / 出题用）；缺省则按目录名原样 */
  categories?: Record<string, string>
  /** 站点配置（docs/.vitepress 消费） */
  site?: {
    title?: string
    description?: string
    /**
     * 「仅本地」的内容路径（相对内容根，可省 .md）——这是**内容策略**，与菜单配置无关。
     * 列在这里的目录/文件**只在本地产出**：线上不构建、不进菜单、不进侧边栏、不算死链。
     */
    onlyLocal?: string[]
    /** AI 助手调用的后端地址（默认按 port 拼 http://localhost:<port>） */
    apiBase?: string
    /** 社交链接（页脚/侧栏图标），透传给 VitePress themeConfig.socialLinks */
    socialLinks?: Array<{ icon: string; link: string }>
    /** 页脚 */
    footer?: { message?: string; copyright?: string }
    /** AI 助手的文案（默认通用文案） */
    chat?: {
      title?: string
      welcome?: string
      hints?: string
    }
  }
}

/**
 * 解析后的配置：路径全部为绝对路径、env 已合并，供代码直接使用。
 * 字段名尽量沿用旧 `config`，以减少下游改动。
 */
export type ResolvedConfig = {
  name: string
  /** 内容根目录绝对路径（固定为 <实例根>/docs；旧名 docsPath，保持兼容） */
  docsPath: string
  /** 数据目录绝对路径 */
  dataDir: string
  /** 评估目录绝对路径 */
  evalDir: string
  indexInclude: string[]
  indexExclude: string[]
  collectionName: string
  /** 聊天模型端点（本地 Ollama 或远程 OpenAI 兼容服务） */
  chat: ResolvedModel
  /** 向量模型端点 */
  embedding: ResolvedModel
  chunkSize: number
  chunkOverlap: number
  rerankEnabled: boolean
  rerankCandidates: number
  /** 混合检索（向量 + BM25） */
  hybridEnabled: boolean
  hybridCandidates: number
  hybridVectorWeight: number
  hybridBm25Weight: number
  /** 向量库连接 */
  chroma: ResolvedChroma
  port: number
  envFile: string
  categories: Record<string, string>
  site: {
    title: string
    description: string
    /** 仅本地路径（线上不构建、不进菜单/侧边栏） */
    onlyLocal: string[]
  }
}
