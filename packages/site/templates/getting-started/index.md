# 快速上手：搭一个你自己的知识库

> `@kb/*` 是一套**基座**：把一堆 Markdown 笔记，变成一个可浏览、可搜索、**可对话**的网站。
>
> **默认全部在你自己电脑上跑**（本地模型 + 本地向量库）：不花钱、不联网、数据不出本机。
> 需要时也可以切到**远程大模型 / 远程向量库**，只改配置、不用改代码。

## 它能做什么

| 能力 | 说明 |
|------|------|
| **文档站点** | 把 Markdown 丢进目录，自动生成带导航、搜索、侧边栏的网站 |
| **AI 问答** | 右下角助手，基于**你自己的笔记**回答，并在句末标注可点击的来源 |
| **防幻觉** | 检索不到就说"没找到"，不会硬编；引用编号不会指向不存在的来源 |
| **质量保障** | 基座自带评估体系（回归测试 + 阈值门禁），由它自己持续校准检索与回答 —— **你不用配置，也不用准备什么** |
| **本地 / 远程皆可** | 模型与向量库默认本地，也可指向 OpenAI 兼容的远程服务 |

它解决的核心问题是：**你的笔记越写越多，却越来越找不到、用不起来。** 这个基座把它变成"能问的"。

## 它是怎么工作的

```mermaid
flowchart LR
    A[你的 Markdown] -->|切分 + 向量化| B[(向量索引)]
    A -->|切分 + 分词| K[(关键词索引 BM25)]
    Q[你的提问] -->|语义相似| B
    Q -->|关键词匹配| K
    B --> R[两路融合排序]
    K --> R
    R -->|最相关片段| C[交给大模型]
    C -->|流式生成| D[带来源标注的回答]
```

一句话：**文档切块后同时建"向量索引"和"关键词索引"；提问时两路并行检索、融合排序，再让大模型"看着资料"回答。**

为什么要两路：**纯向量在精确词上最弱** —— 英文缩写、专有名词、代码标识符这类词容易和无关内容"飘"到一起。
加上关键词一路（BM25）正好补上这个短板，两路结果归一化后加权融合。

---

## 一、上手前：你要装什么

| 依赖 | 作用 | 怎么装 |
|------|------|--------|
| **Node.js ≥ 20.6** + **pnpm ≥ 9** | 跑前后端与 CLI | 官网下载 Node；`npm i -g pnpm` |
| **Docker** | 跑 Chroma 向量库 | 装 Docker Desktop，保持运行 |
| **Ollama** | 跑本地大模型 | 官网下载，装完确保服务在运行 |

> 只装一次。模型首次需要下载（约 6.5GB），之后就一直本地可用了。
> 如果你打算用**远程大模型**，可以跳过 Ollama 与模型下载。

## 二、三步搭起来

### ① 装包

在一个空目录里装基座的两个包：

```bash
mkdir my-kb && cd my-kb
pnpm init
pnpm add @kb/core @kb/site
```

- `@kb/core`：RAG 引擎 + Agent + CLI（`kb` 命令就来自它）
- `@kb/site`：站点主题与配置派生

### ② 用 `kb` 初始化

```bash
pnpm kb init --install
```

它会在当前目录生成实例骨架：`knowledge.config.mjs`（配置）+ `docs/`（含首页、示例文档、快速上手）+
`.env.example` + `package.json` 脚本。`--install` 会顺带把依赖装好（不加就自己再跑一次 `pnpm install`）。

> **基座还没发布到 npm 时**（本地开发阶段），加 `--local` 指向本地基座目录：
> `pnpm kb init --local ../kb-base --install`
>
> 也支持生成到子目录（`pnpm kb init my-kb`）；不加 `--yes` 时会交互式问你几个问题。

### ③ 放你的内容，然后跑起来

```bash
# 下载本地模型（首次，约 6.5GB；用远程模型可跳过）
pnpm ollama:pull-chat     # 聊天模型 qwen3:8b
pnpm ollama:pull-embed    # 向量模型 bge-m3

pnpm chroma:start         # 启动向量库（需 Docker 正在运行）
pnpm kb index             # 建立向量索引
pnpm dev                  # 启动 → http://localhost:5173
```

打开就能看到站点；右下角的助手可以直接提问。

> 文档有更新时，重新跑一次 `pnpm kb index` 即可（增量，只处理改动过的文件）。
> 命令分两类：`dev` / `build` / `preview` 是脚本；`kb index` 这类是基座 CLI `kb` 的子命令，用 `pnpm kb <子命令>` 调用。

## 三、放你的内容

**内容放在哪、模型用哪个、向量库连哪**——全部集中在根目录的一个文件里：`knowledge.config.mjs`。

```js
export default {
  name: 'my-knowledge',
  contentRoot: './docs',      // ← 你的内容目录（支持绝对路径，可放仓库外）
  collectionName: 'my_kb',    // 向量集合名（一个实例一个库）
  models: {
    baseUrl: 'http://localhost:11434/v1',  // 默认本地 Ollama
    apiKeyEnv: 'OPENAI_API_KEY',           // 远程时 Key 从这个环境变量读
    chat: 'qwen3:8b',
    embedding: 'bge-m3',
  },
  chroma: { host: 'localhost', port: 8000 },
  // ...
}
```

几个要点：

- **笔记不必搬进来**：`contentRoot` 支持**绝对路径**，可以直接指向你已有的笔记目录（甚至另一个仓库），不用复制。
- **目录即分类**：`contentRoot` 下每建一个目录，站点的导航/侧边栏就多一块，不用手写。
- **导航可定制**：在 `site.nav` 里写菜单；**给某项加 `onlyLocal`**，它就会线上隐藏，并从编译、侧边栏中一并排除（只维护这一份配置）：

  ```js
  site: {
    nav: [
      { text: '前端', items: [{ text: 'React', link: '/react/concept' }] },
      { text: '私人笔记', link: '/private/x', onlyLocal: 'private' }, // 整个目录仅本地
    ],
  }
  ```

### 想换成远程大模型 / 远程向量库？

默认走本地，**只改这几行**即可切到远程（密钥只从环境变量读，不写进配置）：

```js
models: {
  chat:      { baseUrl: 'https://api.deepseek.com/v1',   model: 'deepseek-chat',        apiKeyEnv: 'DEEPSEEK_API_KEY' },
  embedding: { baseUrl: 'https://api.siliconflow.cn/v1', model: 'BAAI/bge-m3',          apiKeyEnv: 'SILICONFLOW_API_KEY' },
},
chroma: {
  url: 'https://xxx.chromadb.cloud',   // 远程用 url（http/https）+ token
  tokenEnv: 'CHROMA_TOKEN',
  tenant: '…', database: '…',
},
```

- 聊天模型支持**任意 OpenAI 兼容接口**（DeepSeek / 硅基流动 / OpenAI…），向量模型同理
- 本地 Ollama 会自动走原生接口（可用 `think:false` 提速）；远程则走标准接口
- 配好后**重新 `pnpm kb index`**（换了向量模型必须重建索引，向量空间不同）

## 四、常用命令速查

| 命令 | 作用 |
|------|------|
| `pnpm dev` | 启动前后端（文档 5173 / API 3000） |
| `pnpm kb index` | 增量更新向量索引（改完文档跑这个） |
| `pnpm kb index --full` | 全量重建索引（换向量模型后必须） |
| `pnpm chroma:start` / `pnpm chroma:stop` | 启动 / 停止向量库 |
| `pnpm build` | 构建静态站点（生产） |
| `pnpm kb init [目录]` | 生成一个新的知识库实例 |

## 五、遇到问题

| 现象 | 原因 / 解决 |
|------|------------|
| 启动后提问报错、搜不到东西 | 向量库没起：`docker ps` 看 chroma 是否在跑，否则 `pnpm chroma:start` |
| `pnpm kb index` 连不上 | 同上；Docker 关闭后需重新启动容器 |
| 回答很慢 / 卡住 | 本地模型首轮加载较慢，属正常；`ollama ps` 看模型是否已加载 |
| 改了文档但问答没变 | 忘了重新索引：再跑一次 `pnpm kb index` |
| 端口被占用 | 改 `knowledge.config.mjs` 的 `port`，或关掉占用 5173/3000 的程序 |
| 远程模型报 401 / 鉴权失败 | 检查配置里的 `apiKeyEnv` 对应的环境变量是否已在 `.env` 中设置 |
| 换过向量模型后检索变差 | 向量空间变了，需要 `pnpm kb index --full` 重建索引 |

## 六、下一步

- **想发布出去**：`pnpm build` 产出静态站点；个人内容可通过 `onlyLocal` 控制在本地。
