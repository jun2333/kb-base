import crypto from 'node:crypto'
import path from 'node:path'
import { ChromaClient } from 'chromadb'
import { config } from './config/index.js'
import { chromaClientArgs } from './config/clients.js'
import { docker, ensureDocker, containerPublishing } from './docker.js'

// 向量库容器的起停（`kb chroma:start` / `kb chroma:stop`）。
//
// 为什么要收进基座、而不是在实例里写两条 docker 命令：
//   1. **容器名必须按实例区分**。以前固定叫 `chroma`，本地两个实例就会互相顶掉 ——
//      `docker rm -f chroma` + run 会把容器连同**挂载点**一起换成另一个实例的数据目录，
//      表现为"另一个实例的索引凭空消失"（实际数据还在，只是容器不指向它了）。
//   2. **端口要跟配置一致**。端口写在 knowledge.config.mjs 的 chroma.port 里，
//      起容器时直接读它，就不存在"脚本写 8000、配置写 8001"这种错位。

const IMAGE = 'chromadb/chroma:latest'
const LEGACY_NAME = 'chroma' // 老版本用的固定名，留着只为了提示

/** 实例根 = docs 的父目录 */
const INSTANCE_ROOT = path.dirname(config.docsPath)

/**
 * 容器名：`kb-chroma-<实例目录名>`。
 * 目录名净化后为空（比如纯中文目录名）时退回用路径哈希，保证唯一。
 */
export function containerName(): string {
  const dir = path.basename(INSTANCE_ROOT)
  const safe = dir
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
  const suffix = safe || crypto.createHash('sha1').update(INSTANCE_ROOT).digest('hex').slice(0, 8)
  return `kb-chroma-${suffix}`
}

/** 容器要挂的数据目录（向量库落盘位置） */
export function dataDir(): string {
  return path.join(config.dataDir, 'chroma')
}

/**
 * 确认 `chroma.port` 上跑的是**本实例自己的**容器。
 *
 * 为什么要这一步：端口一旦撞上别人（另一个实例的容器、自己随手起的 Chroma），
 * 索引会**静默写进别人家的库** —— 报"成功"，而本实例的 `data/chroma` 一个字节都没有。
 * 之前 testDoc 就踩过：它的 8001 上恰好有另一个容器，索引写进去了，删掉那个容器后向量就没了。
 *
 * docker 不可用 / 端口上没容器时直接放行（远程向量库、手动起的 Chroma 都算正常用法）。
 */
export function assertOwnChromaContainer(): void {
  const p = config.chroma.port
  if (!p) return // 远程向量库，不涉及本地容器
  const holder = containerPublishing(p)
  if (!holder || holder === containerName()) return
  if (!holder.startsWith('kb-chroma-')) return // 不是我们的容器（用户自己起的），不拦
  throw new Error(
    `端口 ${p} 上跑的是**另一个实例**的向量库容器（${holder}）。\n` +
      `  继续下去会把索引写进它的库里，而本实例的 data/chroma 什么都没有。\n` +
      `  换一个端口（knowledge.config.mjs 的 chroma.port），或先 pnpm chroma:start 起本实例自己的容器。`,
  )
}

/** 该容器实际对外暴露的端口：以实例配置为准 */
export function port(): number {
  const p = config.chroma.port
  if (!p) {
    throw new Error(
      `本实例连的是远程向量库（${config.chroma.url}），不需要本地容器。\n` +
        `  想改回本地：把 knowledge.config.mjs 里 chroma 的 url 去掉，只留 host/port。`,
    )
  }
  return p
}

/** 等向量库能应答（`docker run -d` 是立刻返回的，容器起来还要一两秒） */
async function waitForChroma(timeoutMs = 20000): Promise<boolean> {
  const client = new ChromaClient(chromaClientArgs())
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      await client.heartbeat()
      return true
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  return false
}

export async function startChroma(): Promise<void> {
  ensureDocker()
  const name = containerName()
  const p = port()
  const dir = dataDir()

  // 老版本留下的固定名容器：它可能正占着这个端口，且挂的是别的实例的数据目录
  const legacy = docker(['ps', '-a', '--filter', `name=^${LEGACY_NAME}$`, '--format', '{{.Names}}'], { quiet: true })
  if (legacy.out === LEGACY_NAME) {
    console.log(`⚠️  发现旧版容器 \`${LEGACY_NAME}\`（老版本固定用这个名字，可能正占着端口 8000 且挂的是别的实例的数据目录）`)
    console.log(`   如果它没用了，可以删掉它：docker rm -f ${LEGACY_NAME}`)
  }

  // 端口冲突要说清是谁占的 —— 多实例时这是最容易卡住的地方
  const holder = containerPublishing(p)
  if (holder && holder !== name) {
    throw new Error(
      `端口 ${p} 已经被容器 \`${holder}\` 占用了。\n` +
        `  两个实例各用各的容器，端口也得分开：改一下本实例 knowledge.config.mjs 里的 chroma.port，再重试。`,
    )
  }

  // 每次都重建：docker 的 bind mount 在**创建时**就固定了，复用旧容器会让它一直挂在老路径上
  docker(['rm', '-f', name], { quiet: true })
  const run = docker(['run', '-d', '-p', `${p}:8000`, '--name', name, '-v', `${dir}:/data`, IMAGE])
  if (!run.ok) {
    // 端口被非容器进程占用时 docker 也会失败，把原始信息带出来
    throw new Error(`启动向量库容器失败：\n${run.err.split('\n').slice(0, 3).join('\n')}`)
  }

  const ready = await waitForChroma()
  console.log(`✅ 向量库已启动：容器 ${name}`)
  console.log(`   端口 ${p}   数据目录 ${dir}`)
  console.log(
    ready
      ? `   已就绪，可以接着跑：pnpm index`
      : `   ⚠️ 容器起来了但 20 秒内没应答，检查一下：docker logs ${name}`,
  )
}

export function stopChroma(): void {
  ensureDocker()
  const name = containerName()
  const exists = docker(['ps', '-a', '--filter', `name=^${name}$`, '--format', '{{.Names}}'], { quiet: true })
  if (exists.out !== name) {
    console.log(`（没有容器 ${name}，无需停止。注意：这只停当前实例的容器）`)
    return
  }
  docker(['stop', name], { quiet: true })
  docker(['rm', name], { quiet: true })
  console.log(`✅ 已停止并移除容器 ${name}（数据留在 ${dataDir()}，不会丢）`)
}
