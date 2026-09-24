# kb-base · 本地知识库基座

把一堆 Markdown 变成一个**可浏览、可搜索、可对话**的网站——默认全本地运行、零 API 成本（也可按需切远程）。

这个仓库是**基座**：只有通用能力，没有任何个人内容。你的笔记内容放在自己的**实例**里。

```
实例 ──依赖──▶ 基座        基座永远不知道实例的存在
```

## 包含什么

| 包 | 作用 |
|----|------|
| `@kb/core` | RAG 引擎（切分 / 索引 / 检索 / 重排 / BM25 混合）+ Agent 工具调用 + 评估框架 + CLI（`kb`） |
| `@kb/site` | VitePress 主题（AI 助手、批注系统）+ 站点配置派生（`defineSite`、nav / sidebar / 仅本地过滤） |

实例骨架放在 `packages/core/templates/instance/`，随 `@kb/core` 发布，由 `kb init` 复制。

## 使用者怎么搭一个自己的知识库

唯一的路径：**装包 → `kb init` → 放内容 → 跑起来**

```bash
mkdir my-kb && cd my-kb
pnpm init
pnpm add @kb/core @kb/site      # ① 装包
pnpm kb init --install          # ② 生成实例骨架
pnpm kb index && pnpm dev       # ③ 索引 + 启动
```

完整版见 `@kb/site` 提供的《快速上手》文章（会随 `kb init` 一起进到实例的 `docs/getting-started/`）。

## 本仓库的开发命令

```bash
pnpm install
pnpm typecheck          # 类型检查
pnpm build              # 构建各包（产出 dist/，发布用）
pnpm sync:starter <实例目录>   # 把《快速上手》文章同步到某个实例
```

## 目录结构

```
kb-base/
├── packages/
│   ├── core/            @kb/core    RAG + Agent + 评估 + CLI(bin: kb) + 实例骨架
│   │   └── templates/instance/      kb init 复制它
│   └── site/            @kb/site    VitePress 主题 + 站点配置派生 + 《快速上手》文章
└── scripts/
    └── sync-starter.mjs 把《快速上手》文章同步到某个实例
```

## `kb` CLI 命令

`kb init [目录]` · `kb index [--full]` · `kb dev` · `kb serve` · `kb build` · `kb preview` ·
`kb eval [--full]` · `kb eval:baseline` · `kb cases:gen` · `kb cases:review`

> `kb init` 是唯一对外入口，它**不需要实例配置**（实例还没生成呢），所以走的是 CLI 里的独立分支。
> 过渡期（基座未发布）用 `kb init --local <本仓库目录>`，生成的实例依赖指向本地基座；
> 发布后默认写版本号（直接读 `@kb/core` / `@kb/site` 自己的版本）。

## 设计要点

- **实例 → 基座单向依赖**：基座不含任何个人内容；实例只有内容 + 配置 + 数据
- **配置唯一入口**：实例根 `knowledge.config.mjs`（内容目录 / 模型 / 集合名 / nav…）
- **默认本地**：Ollama + 本地 Chroma；也能切任意 OpenAI 兼容服务与远程 Chroma（只改配置）
- **混合检索**：向量 + BM25 两路融合（纯向量在精确词上最弱，BM25 互补）
- **评估驱动**：检索层（Hit@5 / Hit@1 / Recall@5 / MRR）+ 生成层（忠实度 / 完整性 / 引用），
  带阈值门禁与基线对比 —— **这是基座自己校准质量用的，实例使用者无需配置**

## 状态

本地开发阶段：包名为 `@kb/*`，实例通过本地路径依赖基座。发布 npm 后 `kb init` 会写版本号依赖。
