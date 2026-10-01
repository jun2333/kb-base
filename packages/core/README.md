# @minijun/kb-core

本地知识库基座的核心包：**RAG 引擎 + Agent 工具调用 + 评估框架 + CLI（`kb`）+ 实例骨架**。

把一堆 Markdown 变成一个可浏览、可搜索、可对话的网站 —— 默认全本地运行（Ollama + Chroma），
零 API 成本、数据不出本机；也能只改配置切到任意 OpenAI 兼容服务与远程向量库。

## 快速开始

```bash
mkdir my-kb && cd my-kb
pnpm add @minijun/kb-core     # ① 只装这一个包（提供 kb 命令）
npx kb init --install         # ② 生成实例骨架（注意：用 npx，不是 pnpm）
pnpm kb index && pnpm dev     # ③ 建索引 + 启动 → http://localhost:5173
```

> ② **必须用 `npx`**：`pnpm <脚本>` 执行前会做一次依赖检查（内部跑 `pnpm install`），而 ① 装进来的
> 依赖里有带 install 脚本的包（`protobufjs`，来自 chromadb 的 gRPC 客户端），pnpm 默认不执行它们并报
> `ERR_PNPM_IGNORED_BUILDS` → 检查失败 → **`kb` 根本不会启动**。`npx` 只在 `node_modules/.bin` 里
> 找到 `kb` 执行，不经过这层检查。① 结尾那个报错可以无视（包已经装好了）；等 ② 生成出骨架里的
> `pnpm-workspace.yaml`（`allowBuilds`），后续的 `pnpm install` / `pnpm kb xxx` 就都正常了。

站点主题由姊妹包 [`@minijun/kb-site`](https://www.npmjs.com/package/@minijun/kb-site) 提供，
`kb init` 会自动把两个包一起写进实例的 `package.json`，**你不需要手写包名**。

## 里面有什么

- **RAG**：Markdown 扫描 / 切分 / 索引（增量）、向量 + BM25 混合检索、按来源去重、可选重排
- **Agent**：Function Calling 工具调用循环（`search_knowledge` / `get_doc_content`），SSE 流式输出
- **服务**：Koa 后端（`/api/chat`、`/api/import/*`、`/api/manage/*`、`/api/index`）
- **导入与归档**：把散落笔记搬进来、归到分类（分类 = `docs/` 下的目录）
- **评估**：检索层（Hit@5 / Hit@1 / Recall@5 / MRR）+ 生成层（忠实度 / 完整性 / 引用），带阈值门禁与基线
- **CLI**：`kb init | import | index | menu:export | chroma:* | ollama:* | serve | dev | build | preview | eval | eval:baseline | cases:gen | cases:review`

## 文档

- 仓库与完整说明：<https://github.com/jun2333/kb-base>
- 上手文：`kb init` 后会随骨架生成到实例的 `docs/getting-started/`
- 评估集审核流程：本包内 `eval/REVIEW-PLAYBOOK.md`

## 开发提示

本包**发布的是 `dist/` 产物**（`kb` 跑 `dist/cli.js`，不再用 tsx 直接加载 TS 源码）。
在基座仓库里改了 `packages/core/src/**` 之后要重新 `pnpm build` 才生效，且没有 watch。

## License

MIT
