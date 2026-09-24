# 我的知识库

基于 **本地大模型 + 向量检索** 的知识库：把 Markdown 笔记变成可浏览、可搜索、可对话的网站。
基座能力（RAG 引擎、混合检索、站点主题）来自 `@kb/core` 与 `@kb/site`；
检索与回答的质量由基座自带的评估体系持续校准，**你不用配置，也不用准备测试集**。

## 快速开始

```bash
pnpm install
pnpm ollama:pull-chat     # 下载聊天模型（首次，约 5.2GB）
pnpm ollama:pull-embed    # 下载向量模型（首次，约 1.2GB）
pnpm chroma:start         # 启动向量库（需 Docker 在运行）
pnpm kb index             # 建立向量索引
pnpm dev                  # 启动（文档 5173 / API 3000）
```

打开 `http://localhost:5173` 即可；站点右下角是 AI 助手，左下角是批注。

> 首次使用建议先看站内的 **[快速上手](/getting-started/)** 页面。

## 放你自己的内容

- 内容目录由 `knowledge.config.mjs` 的 `contentRoot` 指定（默认 `./docs`）
- **笔记不必搬进来**：`contentRoot` 支持绝对路径，可以直接指向你已有的笔记目录
- **目录即分类**：每建一个目录，导航与侧边栏自动多一块
- 改完内容后跑 `pnpm kb index` 更新索引（增量，很快）

## 常用命令

| 命令 | 作用 |
|------|------|
| `pnpm dev` | 启动前后端 |
| `pnpm kb index` | 增量更新索引（`pnpm kb index --full` 全量重建） |
| `pnpm build` | 构建静态站点（生产） |
| `pnpm chroma:stop` | 停止向量库 |

## 依赖

- Node.js ≥ 20.6、pnpm
- Docker（Chroma 向量库）
- Ollama（本地模型 qwen3:8b + bge-m3）
