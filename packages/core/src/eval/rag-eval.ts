import fs from 'node:fs'
import path from 'node:path'
import { getRetriever } from '../rag/retriever.js'
import { config } from '../config/index.js'
import { finalize, printCompare, warnIfCasesChanged, requireCasesFile } from './eval-utils.js'

// 检索质量回归测试集：数据在 eval/retrieval-cases.json（与逻辑分离，便于扩充/维护）。
// 指标口径：
//   Hit@k     —— topK 内是否命中"至少一篇"期望文档（宽松）
//   Hit@1     —— 期望文档是否排第一（严格）
//   Recall@k  —— topK 内命中的期望文档数 / 期望文档总数（多篇期望的部分分，最严格）
//   MRR       —— 最佳命中排名的倒数平均（排名越靠前越高）
type EvalCase = { q: string; expect: string[]; category: string }

// 测试集路径由实例配置提供（evalDir）
const CASES_PATH = requireCasesFile(path.join(config.evalDir, 'retrieval-cases.json'), '检索评估集（retrieval-cases.json）')
const cases: EvalCase[] = JSON.parse(fs.readFileSync(CASES_PATH, 'utf-8'))

const TOP_K = 5

/** 路径规范化：去掉 ./ 前缀、统一分隔符，保证精确比较 */
const normalize = (p: string) => p.replace(/^\.\//, '').replace(/\\/g, '/')

type Result = { bestRank: number; hitCount: number }

/** 精确匹配（不再用子串）：返回最佳命中排名 + topK 内命中的期望文档数 */
function evaluate(sources: string[], expect: string[], k: number): Result {
  const expected = new Set(expect.map(normalize))
  const topK = sources.slice(0, k).map(normalize)
  let bestRank = 0
  const hit = new Set<string>()

  topK.forEach((src, i) => {
    if (expected.has(src)) {
      if (bestRank === 0) bestRank = i + 1
      hit.add(src)
    }
  })
  return { bestRank, hitCount: hit.size }
}

type Stat = { total: number; hitK: number; hit1: number; recallSum: number; mrrSum: number }
const newStat = (): Stat => ({ total: 0, hitK: 0, hit1: 0, recallSum: 0, mrrSum: 0 })

async function main() {
  const retriever = await getRetriever(TOP_K)
  const overall = newStat()
  const byCategory = new Map<string, Stat>()

  for (const c of cases) {
    const docs = await retriever.invoke(c.q)
    const sources = docs.map((d) => d.metadata.source as string)
    const { bestRank, hitCount } = evaluate(sources, c.expect, TOP_K)
    const recall = hitCount / c.expect.length

    const stat = byCategory.get(c.category) ?? newStat()
    for (const s of [overall, stat]) {
      s.total++
      if (bestRank > 0) s.hitK++
      if (bestRank === 1) s.hit1++
      s.recallSum += recall
      s.mrrSum += bestRank > 0 ? 1 / bestRank : 0
    }
    byCategory.set(c.category, stat)

    const icon = bestRank === 1 ? '🥇' : bestRank > 0 ? '✅' : '❌'
    console.log(`${icon} [${c.category}] ${c.q}`)
    console.log(`   期望: ${c.expect.join(', ')}`)
    console.log(`   命中排名: ${bestRank || '未命中'} | 覆盖 ${hitCount}/${c.expect.length}`)
    sources.forEach((s, i) => console.log(`   ${i + 1}. ${s}`))
    console.log()
  }

  const pct = (n: number, total: number) => `${((n / total) * 100).toFixed(0)}%`
  const line = (name: string, s: Stat) =>
    `${name}：${s.total} 题 | Hit@${TOP_K} ${pct(s.hitK, s.total)} | Hit@1 ${pct(s.hit1, s.total)} | Recall@${TOP_K} ${(s.recallSum / s.total).toFixed(3)} | MRR ${(s.mrrSum / s.total).toFixed(3)}`

  console.log('==== 总览 ====')
  console.log(`Hit@${TOP_K}: ${overall.hitK}/${overall.total} (${pct(overall.hitK, overall.total)})`)
  console.log(`Hit@1: ${overall.hit1}/${overall.total} (${pct(overall.hit1, overall.total)})`)
  console.log(`Recall@${TOP_K}: ${(overall.recallSum / overall.total).toFixed(3)}`)
  console.log(`MRR: ${(overall.mrrSum / overall.total).toFixed(3)}`)

  console.log('\n==== 分类统计（定位弱项）====')
  for (const [name, s] of byCategory) console.log(line(name, s))

  // 指标快照 -> 对比 -> 留档 -> 阈值门禁
  const metrics = {
    hit5: overall.hitK / overall.total,
    hit1: overall.hit1 / overall.total,
    recall5: overall.recallSum / overall.total,
    mrr: overall.mrrSum / overall.total,
  }
  const env = {
    embeddingModel: config.embedding.model,
    topK: TOP_K,
    cases: cases.length,
  }
  printCompare('retrieval', metrics, env)
  const passed = finalize('retrieval', metrics, env)
  warnIfCasesChanged()
  if (!passed) process.exit(1)
}

export default main
