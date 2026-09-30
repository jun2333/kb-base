import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config/index.js'

// 评估基础设施：阈值门禁 + 历史留档 + 基线对比（供 rag-eval / rag-gen-eval 共用）
// 评估目录 / 数据目录由实例配置（knowledge.config.mjs）提供
const EVAL_DIR = config.evalDir
const DATA_DIR = config.dataDir

const THRESHOLDS_PATH = path.join(EVAL_DIR, 'thresholds.json')
const HISTORY_PATH = path.join(DATA_DIR, 'eval-history.jsonl')
const BASELINE_PATH = path.join(DATA_DIR, 'eval-baseline.json')
const CASES_PATH = path.join(EVAL_DIR, 'retrieval-cases.json')
const SUSPECTS_PATH = path.join(EVAL_DIR, 'retrieval-cases.suspects.json')

export type EvalKind = 'retrieval' | 'generation'
export type Metrics = Record<string, number>

export type EvalRecord = {
  ts: string
  kind: EvalKind
  metrics: Metrics
  env: Record<string, string | number>
}

type Threshold = { metric: string; min: number; label?: string }

/** 各指标的显示名（用于对比输出） */
export const METRIC_LABELS: Record<string, string> = {
  hit5: 'Hit@5',
  hit1: 'Hit@1',
  recall5: 'Recall@5',
  mrr: 'MRR',
  citationLegalRate: '引用合法性',
  refusalRate: '负例拒答率',
  faithfulness: '忠实度',
  completeness: '完整性',
  citation: '引用',
}

/** 比率类指标 → 百分比；评分类指标（1~5）→ 两位小数 */
function fmt(value: number, metric: string): string {
  const scoreLike = ['faithfulness', 'completeness', 'citation']
  return scoreLike.includes(metric) ? value.toFixed(2) : `${(value * 100).toFixed(0)}%`
}

const ensureDataDir = () => fs.mkdirSync(DATA_DIR, { recursive: true })

/**
 * 内置默认阈值（实例可以放 eval/thresholds.json 覆盖）。
 * 之所以内置：评估是**基座自己校准质量**用的，实例不该为了跑评估而必须准备文件；
 * 阈值是"底线"不是"目标"，留了余量（当前项目 Hit@1 约 90%，底线 80%）。
 */
const DEFAULT_THRESHOLDS: Record<EvalKind, Threshold[]> = {
  retrieval: [
    { metric: 'hit1', min: 0.8, label: 'Hit@1' },
    { metric: 'recall5', min: 0.88, label: 'Recall@5' },
    { metric: 'mrr', min: 0.85, label: 'MRR' },
  ],
  generation: [
    { metric: 'citationLegalRate', min: 1.0, label: '引用合法性' },
    { metric: 'faithfulness', min: 4.0, label: '忠实度均分' },
  ],
}

function readThresholds(): Record<EvalKind, Threshold[]> {
  try {
    return JSON.parse(fs.readFileSync(THRESHOLDS_PATH, 'utf-8'))
  } catch {
    return DEFAULT_THRESHOLDS
  }
}

/** 评估集缺失时的友好提示（裸 ENOENT 对刚 clone / 刚 init 的人太不友好） */
export function requireCasesFile(pathname: string, what: string): string {
  if (fs.existsSync(pathname)) return pathname
  console.error(`\n❌ 未找到${what}：${pathname}\n`)
  console.error('   评估集是**基座侧**用来校准检索/回答质量的，实例不需要自己准备。')
  console.error('   确实想跑的话，两种办法：')
  console.error(`     • 让它基于你的内容自动出题：kb cases:gen${what.includes('生成') ? '' : ' + kb cases:review'}`)
  console.error('     • 或参考 @minijun/kb-core 的 eval/REVIEW-PLAYBOOK.md 手写一份')
  console.error('')
  process.exit(1)
}

/** 读取历史记录（按 kind 过滤，保持追加顺序） */
export function readHistory(kind: EvalKind): EvalRecord[] {
  try {
    return fs
      .readFileSync(HISTORY_PATH, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as EvalRecord)
      .filter((r) => r.kind === kind)
  } catch {
    return []
  }
}

export function appendHistory(record: EvalRecord): void {
  ensureDataDir()
  fs.appendFileSync(HISTORY_PATH, JSON.stringify(record) + '\n')
}

export function readBaseline(): Partial<Record<EvalKind, EvalRecord>> {
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf-8'))
  } catch {
    return {}
  }
}

export function writeBaseline(baselines: Partial<Record<EvalKind, EvalRecord>>): void {
  ensureDataDir()
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(baselines, null, 2))
}

/**
 * 对比"上次/基线"并打印。**必须在 appendHistory 之前调用**，否则"上次"会变成本次。
 * env 用于判断是否可比：题集规模（cases）变了就不可比，避免误读成"质量下降"。
 */
export function printCompare(kind: EvalKind, metrics: Metrics, env: Record<string, string | number> = {}): void {
  const prev = readHistory(kind).at(-1)
  const baseline = readBaseline()[kind]

  // 题集规模不同 → 指标不可比
  const comparable = (ref: EvalRecord) => {
    const refCases = ref.env?.cases
    const curCases = env.cases
    return !(refCases !== undefined && curCases !== undefined && refCases !== curCases)
  }

  const compareOne = (name: string, ref: EvalRecord) => {
    const parts = Object.keys(metrics).map((m) => {
      const cur = metrics[m]
      const old = ref.metrics[m]
      if (old === undefined) return `${METRIC_LABELS[m] ?? m} ${fmt(cur, m)}`
      const diff = cur - old
      const delta =
        Math.abs(diff) < 1e-9
          ? '持平'
          : `${diff > 0 ? '↑' : '↓'}${(Math.abs(diff) * 100).toFixed(0)}%`
      return `${METRIC_LABELS[m] ?? m} ${fmt(cur, m)} (${delta})`
    })
    console.log(`${name}：${parts.join(' | ')}`)
  }

  console.log('\n==== 对比 ====')
  if (prev) {
    comparable(prev)
      ? compareOne('较上次', prev)
      : console.log(`较上次：题集已变化（${prev.env.cases} → ${env.cases} 题），不可比`)
  }
  if (baseline) {
    comparable(baseline)
      ? compareOne('较基线', baseline)
      : console.log(`较基线：题集已变化（${baseline.env.cases} → ${env.cases} 题），不可比`)
  }
  if (!prev && !baseline) console.log('（首次记录，暂无对比基准）')
}

/**
 * 评估集比可疑清单新时，提醒重跑 review。
 * （改过 retrieval-cases.json 后，suspects 快照就旧了）
 */
export function warnIfCasesChanged(): void {
  try {
    const casesM = fs.statSync(CASES_PATH).mtimeMs
    const suspectsM = fs.existsSync(SUSPECTS_PATH) ? fs.statSync(SUSPECTS_PATH).mtimeMs : 0
    if (casesM > suspectsM) {
      console.log('\n⚠️  评估集比可疑清单新（或清单不存在）——建议重跑刷新：')
      console.log('   kb cases:review')
    }
  } catch {
    // 文件缺失等异常忽略
  }
}

/**
 * 写入历史 + 阈值门禁，返回是否通过。调用方据此决定 process.exit 码。
 */
export function finalize(kind: EvalKind, metrics: Metrics, env: Record<string, string | number>): boolean {
  appendHistory({ ts: new Date().toISOString(), kind, metrics, env })

  const thresholds = readThresholds()[kind] ?? []
  const failed = thresholds.filter((t) => (metrics[t.metric] ?? 0) < t.min)

  if (failed.length === 0) {
    console.log(`\n✅ 阈值门禁通过（${kind}）`)
    return true
  }
  console.log(`\n❌ 阈值门禁未通过（${kind}）：`)
  for (const f of failed) {
    console.log(
      `   - ${f.label ?? METRIC_LABELS[f.metric] ?? f.metric}: ${fmt(metrics[f.metric] ?? 0, f.metric)} < 要求 ${fmt(f.min, f.metric)}`,
    )
  }
  return false
}
