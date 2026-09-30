import { spawnSync } from 'node:child_process'
import { config } from './config/index.js'

// 本地模型（Ollama）的管理：`kb ollama:pull` / `kb ollama:stop`。
//
// 为什么要收进基座：**模型名在配置里**（`models.chat` / `models.embedding`）。
// 实例脚本里再抄一遍就会漂移 —— 改了配置里的模型，脚本还去拉旧的那个（和 chroma 端口同一个病）。
// 顺带它还能判断"你配的根本不是本地 Ollama"，并直接说清楚不用拉。

type OllamaModel = { label: string; model: string }

/** 哪些"模型位"指向本地 Ollama（没指向的就不该去拉） */
function ollamaModels(): OllamaModel[] {
  const out: OllamaModel[] = []
  if (config.chat.ollamaNative) out.push({ label: '聊天模型', model: config.chat.model })
  if (config.embedding.ollamaNative) out.push({ label: '向量模型', model: config.embedding.model })
  return out
}

function ensureOllama(): void {
  const r = spawnSync('ollama', ['--version'], { encoding: 'utf-8' })
  if (r.error) {
    throw new Error(
      '没找到 ollama 命令 —— 先装 Ollama 并启动它：https://ollama.com/download\n' +
        '  （如果你想用远程模型，把 knowledge.config.mjs 里的 models.baseUrl 改掉，就不需要本地 Ollama 了）',
    )
  }
}

/** 已拉下来的模型名（`ollama list` 的第一列） */
function installedModels(): Set<string> {
  const r = spawnSync('ollama', ['list'], { encoding: 'utf-8' })
  if (r.status !== 0) return new Set()
  const names = (r.stdout ?? '')
    .split('\n')
    .slice(1) // 去掉表头
    .map((l) => l.trim().split(/\s+/)[0])
    .filter(Boolean)
  return new Set(names)
}

/** `bge-m3` 与 `bge-m3:latest` 视为同一个 */
function hasModel(installed: Set<string>, want: string): boolean {
  if (installed.has(want)) return true
  const bare = want.split(':')[0]
  for (const n of installed) if (n.split(':')[0] === bare) return true
  return false
}

export function pullModels(): void {
  const models = ollamaModels()
  if (models.length === 0) {
    console.log('本实例的模型都指向远程服务，不需要本地拉模型：')
    console.log(`  聊天模型 ${config.chat.model} → ${config.chat.baseUrl}`)
    console.log(`  向量模型 ${config.embedding.model} → ${config.embedding.baseUrl}`)
    console.log('（把 models.baseUrl 改回本地 Ollama 才会用到这个命令）')
    return
  }

  ensureOllama()
  const installed = installedModels()

  let pulled = 0
  for (const { label, model } of models) {
    if (hasModel(installed, model)) {
      console.log(`✅ ${label} ${model} 已在本地，跳过`)
      continue
    }
    console.log(`\n⬇️  拉取${label} ${model} ...`)
    const r = spawnSync('ollama', ['pull', model], { stdio: 'inherit' })
    if (r.status !== 0) throw new Error(`拉取 ${model} 失败`)
    pulled++
  }

  console.log(pulled > 0 ? '\n✅ 模型就绪' : '\n✅ 模型都已就绪')
  console.log('   接着跑：pnpm index        # 建索引（AI 才搜得到）')
}

export function stopModels(): void {
  const models = ollamaModels()
  if (models.length === 0) {
    console.log('本实例的模型都在远程，本地没有要停的东西。')
    return
  }
  ensureOllama()

  for (const { label, model } of models) {
    // `ollama stop` 只对"正在运行"的模型有效；没加载过会报错 —— 不算失败
    const r = spawnSync('ollama', ['stop', model], { encoding: 'utf-8' })
    console.log(r.status === 0 ? `⏹  已停止${label} ${model}` : `（${label} ${model} 未在运行，跳过）`)
  }
  console.log('（模型文件仍在本地，不会被删除）')
}
