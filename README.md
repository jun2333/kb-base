# kb-base · 本地知识库基座

把一堆 Markdown 变成一个**可浏览、可搜索、可对话**的网站——默认全本地运行、零 API 成本（也可按需切远程）。

这个仓库是**基座**：只有通用能力，没有任何个人内容。你的笔记内容放在自己的**实例**里。

```
实例 ──依赖──▶ 基座        基座永远不知道实例的存在
```

## 包含什么

| 包 | 作用 |
|----|------|
| `@minijun/kb-core` | RAG 引擎（切分 / 索引 / 检索 / 重排 / BM25 混合）+ Agent 工具调用 + 评估框架 + CLI（`kb`） |
| `@minijun/kb-site` | VitePress 主题（AI 助手、批注系统）+ 站点配置派生（`defineSite`、nav / sidebar / 仅本地过滤） |

实例骨架（含首页、《快速上手》文章）放在 `packages/core/templates/instance/`，随 `@minijun/kb-core` 发布，由 `kb init` 复制。

## 使用者怎么搭一个自己的知识库

唯一的路径：**装一个包 → `kb init` → 放内容 → 跑起来**

```bash
mkdir my-kb && cd my-kb
pnpm add @minijun/kb-core               # ① 只装这一个包（提供 kb 命令）
pnpm kb init --install          # ② 生成实例骨架（自包含，不依赖别的包）
pnpm kb index && pnpm dev       # ③ 索引 + 启动
```

实例真正需要的两个依赖（`@minijun/kb-core` + `@minijun/kb-site`）由 `kb init` 自动写进 `package.json`，
**使用者不需要手写包名**；《快速上手》文章也随骨架一起生成到实例的 `docs/getting-started/`。

## 本仓库的开发命令

```bash
pnpm install
pnpm typecheck          # 类型检查
pnpm build              # 构建各包（产出 dist/，发布用）
```

> **改了 `packages/core/src/**` 之后要重新 `pnpm build`。** 发布形态的 `kb` 跑的是
> `dist/`（不再用 tsx 直接加载 TS 源码），所以源码改动不 build 就不生效。
> `packages/site` 没有构建步骤 —— 它发布的是 `.mjs` / `.vue` 源码，由消费者侧的 Vite 编译。

## 目录结构

```
kb-base/
└── packages/
    ├── core/            @minijun/kb-core    RAG + Agent + 评估 + CLI(bin: kb) + 实例骨架
    │   └── templates/instance/      kb init 复制它
    └── site/            @minijun/kb-site    VitePress 主题 + 站点配置派生
```

## `kb` CLI 命令

`kb init [目录]` · `kb import <目录>` · `kb index [--full]` · `kb menu:export [--check|--force]` ·
`kb dev` · `kb serve` · `kb build` · `kb preview` ·
`kb eval [--full]` · `kb eval:baseline` · `kb cases:gen` · `kb cases:review`

> `kb init` 是唯一对外入口，它**不需要实例配置**（实例还没生成呢），所以走的是 CLI 里的独立分支。
> 默认写**版本号**依赖（读 `@minijun/kb-core` / `@minijun/kb-site` 自己的版本，两个包同仓库同版本发布）；
> 想在本地基座源码上开发 / 调试、不装 npm 上的发布版，用 `kb init --local <本仓库目录>`，
> 生成的实例依赖会指向本地路径。

## 设计要点

- **实例 → 基座单向依赖**：基座不含任何个人内容；实例只有内容 + 配置 + 数据
- **配置唯一入口**：实例根 `knowledge.config.mjs`（模型 / 集合名 / 展示 / 内容策略 `onlyLocal`…）；
  菜单与侧边栏默认按目录推导，要精细控制再 `kb menu:export` 生成 `menu.config.mjs` 接管
- **默认本地**：Ollama + 本地 Chroma；也能切任意 OpenAI 兼容服务与远程 Chroma（只改配置）
- **混合检索**：向量 + BM25 两路融合（纯向量在精确词上最弱，BM25 互补）
- **导入与归档**：站点内置「内容管理」面板（`@minijun/kb-site` 组件 + `@minijun/kb-core` 的
  `POST /api/import/*`、`/api/manage/*`、`/api/index`）。已有笔记拖进来 → 落进
  `docs/imported/` 收件箱 → 在面板里归到分类（分类 = `docs/` 下的目录，所以归档就是移动文件）。
  命令行同款能力：`kb import <目录>`
- **评估驱动**：检索层（Hit@5 / Hit@1 / Recall@5 / MRR）+ 生成层（忠实度 / 完整性 / 引用），
  带阈值门禁与基线对比 —— **这是基座自己校准质量用的，实例使用者无需配置**

## License

MIT
