import path from 'node:path'
import { config } from '../config/index.js'
import { readHistory, readBaseline, writeBaseline, type EvalKind } from './eval-utils.js'

// 把"当前历史里每种评估的最新一条"固化为基线，供后续"较基线"对比。
// 用法：pnpm test:rag:baseline（通常在认可某次结果后执行）
const KINDS: EvalKind[] = ['retrieval', 'generation']

const baseline = readBaseline()
let updated = 0

for (const kind of KINDS) {
  const last = readHistory(kind).at(-1)
  if (!last) {
    console.log(`- ${kind}: 暂无历史记录，跳过`)
    continue
  }
  baseline[kind] = last
  console.log(`- ${kind}: 已固化基线（${last.ts}）`)
  updated++
}

if (updated > 0) {
  writeBaseline(baseline)
  console.log(`\n基线已更新 -> ${path.join(config.dataDir, 'eval-baseline.json')}`)
} else {
  console.log('\n没有可固化的记录——请先跑一次 `pnpm test:rag`')
}
