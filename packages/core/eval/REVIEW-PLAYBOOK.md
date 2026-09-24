# 评估集审核 Playbook

> **用途**：把这份文件（连同 `retrieval-cases.json`、`retrieval-cases.suspects.json`）交给任意大模型，
> 它就能按统一标准**审核脚本生成的评估 case、初筛掉不合格的**。
> **适用项目**：本仓库的 RAG 检索评估（`eval/`）。

---

## 一、背景（给接手者的最小上下文）

- 项目是「本地 RAG 知识库」，文档在 `docs/`，向量库存 Chroma，检索评估集在 `eval/retrieval-cases.json`。
- 评估集格式：

```json
{ "q": "Vue 3 的响应式原理是什么？", "expect": ["vue/reactive.md"], "category": "Vue" }
```

- `expect` 是**期望命中的文档相对路径数组**（一个问题可对应多篇，**任一篇命中即算通过**）。
- `expect` 里的路径**必须真实存在**（相对 `docs/`）。
- 评估集一部分是人工精心写的，一部分是 `pnpm kb cases:gen` **用 LLM 逐篇文档生成**的——**生成的部分质量参差，就是你要审核的对象**。

---

## 二、五步流程

```
① 生成        pnpm kb cases:gen               # 产出 retrieval-cases.generated.json
② 过滤合并    只留技术目录，剔除索引页/说明文档，清洗无效项，合并进 retrieval-cases.json
③ 自动筛可疑  pnpm kb cases:review            # 产出 retrieval-cases.suspects.json（A/B 两类）
④ 审核判断    对可疑项逐条判定「保留 / 改标注 / 删除」（本文档的核心）
⑤ 修正验证    改 retrieval-cases.json → pnpm test:rag → pnpm test:rag:baseline
```

- 步骤 ① 可选参数：`--limit N`（只处理前 N 篇）、`--concurrency N`（默认 4）。
  - 注意：脚本必须用 Ollama 原生 API 的 `think: false`，否则 qwen3 的 thinking 会让耗时增加约 30 倍。
- 步骤 ③ 的两个信号：
  - **A 类：期望文档不在检索 top5**（强信号——标注错，或检索真的弱）
  - **B 类：问题与期望文档的语义相似度 < 0.55**（弱信号，含较多误报）

---

## 三、判断规则（核心）

对每一条可疑项，只能给出三种结论之一：

### ✅ 保留（标注合理，无需改数据）

判据：用 grep 确认**期望文档里确实讲了那个知识点**（只是检索没捞到、或排序偏低）。

> **处置**：把该题写入 `eval/retrieval-cases.reviewed.json` 的 `reviewed` 数组，`verdict` 二选一：
> - `"检索问题"` —— 文档有讲但检索没捞到（**同时记入** `retrieval-optimization-todo.md`）
> - `"无需处理"` —— 命中排名偏低但标注正确、可接受
>
> 归档后该题**不会再出现在可疑清单里**（避免重复审核）。

### ✏️ 改标注

问题本身有价值，但 `expect` 标错了。判据（满足任一）：

- 检索返回的 **top1 明显比原 expect 更贴合问题**；
- 同一知识点**多篇文档都讲**，应补全为多篇（放宽 `expect`）；
- 问题的表述其实**更像另一篇文档的主题**。

改法：把 `expect` 换成（或补上）更合适的文档路径。**保持 `q` 与 `category` 不变。**

### 🗑️ 删除

这条 case 没有评估价值。判据（满足任一）：

- 期望文档是**索引页 / 说明文档**（`index.md`、`GUIDE.md`、`README` 等，不是知识正文）；
- 用 grep 确认**该知识点在文档里根本不存在**（题与文档不匹配）；
- 问题**与文档主题完全无关**（生成时跑偏）。

---

## 四、验证纪律（最重要，别凭感觉）

> **判断"文档有没有讲"必须用 grep 验证，禁止凭语义印象下结论。**

推荐做法：

```bash
# 例：判断 merge-sort.md 有没有讲"时间复杂度"
grep -n '时间复杂度\|O(n' docs/algorithms/merge-sort.md
```

- 有命中 → 标注合理 → 保留（记入检索优化待办）
- 无命中 → 文档没讲 → 删除该 case（或改问题）

**判断"标注是否错"**：看 `suspects.json` 里 A 类条目附带的 `top`（实际命中 top3）。
若 top1 明显更合理 → 改标注；若 top 也都是无关文档 → 大概率是检索问题（保留）。

---

## 五、常见问题模式（历史经验）

| 模式 | 表现 | 处置 |
|------|------|------|
| **索引页误入** | `expect` 是 `xxx/index.md` | 删除 |
| **"软问题"** | 问题措辞离文档表述太远（如问"及时响应代码审查请求"，文档写"代码审查文化"） | 多为评估集质量问题，可改述；无法改述则删除 |
| **关键信息在代码块** | 知识点只存在于文档的代码块（如 `app.getPath('userData')`） | 保留（真实检索难点），记入待办 |
| **知识点散落多篇** | cluster 相关知识在 `node-core`/`node-deployment`/`node-high-concurrency` 都有 | 改标注为**多篇** expect |
| **生成失败** | `q` 是 `}`、```` ``` ````、空串、或残留提示词（`用户可能提出的问题：`） | 删除 / 清洗 |
| **多文档误判** | 原脚本只看 `expect[0]`，多篇题会误报"未命中" | 判断时务必用"**任一 expect 命中即算命中**" |

---

## 六、输出格式（必须按此输出）

对每条可疑项输出一行，最后给统计：

```
| q | 原 expect | 判定 | 新 expect | 理由 |
|---|-----------|------|-----------|------|
| 归并排序的时间复杂度是多少？ | algorithms/merge-sort.md | 删除 | — | grep 确认文档仅 33 行、未讲复杂度 |
| 如何实现前端项目的微前端架构？ | engineering/architecture.md | 改标注 | engineering/micro-frontend.md | top1 命中 micro-frontend.md 更贴合 |
| FMP和LCP有什么区别？ | performance/metrics.md | 保留 | — | grep 确认 L68/L79 有 FMP/LCP，属检索问题 |

统计：保留 X 条 / 改标注 Y 条 / 删除 Z 条
```

**改标注与删除的条目，请同时给出可直接执行的 JSON 补丁**（或明确列出 `q → 新 expect` / 要删的 `q`），便于自动化落地。

---

## 七、命令与文件速查

| 项 | 位置 |
|----|------|
| 评估集 | `eval/retrieval-cases.json` |
| 生成初稿 | `eval/retrieval-cases.generated.json`（gitignore） |
| 可疑清单 | `eval/retrieval-cases.suspects.json`（gitignore） |
| **已审核记录** | `eval/retrieval-cases.reviewed.json`（`verdict` 为「检索问题 / 无需处理」，review 时跳过） |
| 阈值配置 | `eval/thresholds.json` |
| 检索优化待办 | `eval/retrieval-optimization-todo.md` |
| 文档根目录 | `docs/`（`expect` 相对于它） |

| 命令 | 作用 |
|------|------|
| `pnpm kb cases:gen [--limit N]` | 生成初稿 |
| `pnpm kb cases:review` | 自动筛可疑（A/B 两类） |
| `pnpm test:rag` | 检索评估 + 阈值门禁（约 30s~2min） |
| `pnpm test:rag:baseline` | 固化当前成绩为基线 |

---

## 八、验收（改完必须做）

1. `pnpm test:rag` —— 确认指标没有下降、门禁通过；
2. `pnpm test:rag:baseline` —— 固化新基线；
3. 若题集规模变了，对比会提示「题集已变化，不可比」，属正常（基线需重新固化）。

> **自动提醒**：`pnpm test:rag` 会检测「评估集是否比可疑清单新」——只要你改过 `retrieval-cases.json` 而没重跑 `pnpm kb cases:review`，它就会在末尾提示：
> ```
> ⚠️  评估集比可疑清单新（或清单不存在）——建议重跑刷新：
>    kb cases:review
> ```
> 看到这条提示，就说明 `suspects.json` 已过时，需重跑 review 才会一致。

> **原则**：评估集讲究「**精而不滥**」——宁可少而准，不要多而脏。标注错了比没有更糟（它会误导优化方向）。
