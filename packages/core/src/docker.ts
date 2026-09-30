import net from 'node:net'
import { spawnSync } from 'node:child_process'

// Docker 与端口的小工具。
// 单独一个模块（**不 import 实例配置**）：`kb init` 在"还没有实例"的目录里也要用它挑端口。

export function docker(args: string[], opts: { quiet?: boolean } = {}): { ok: boolean; out: string; err: string } {
  const r = spawnSync('docker', args, { encoding: 'utf-8' })
  if (r.error) return { ok: false, out: '', err: r.error.message }
  const out = (r.stdout ?? '').trim()
  const err = (r.stderr ?? '').trim()
  if (!opts.quiet && !out && !err) return { ok: r.status === 0, out, err }
  return { ok: r.status === 0, out, err }
}

/** Docker 是否可用（没装 / 没启动时给明确提示） */
export function ensureDocker(): void {
  const r = docker(['info'], { quiet: true })
  if (!r.ok) {
    throw new Error(
      `Docker 没在运行（或没装）—— 先把 Docker 启动起来再试：\n  ${r.err.split('\n')[0] || 'docker info 失败'}`,
    )
  }
}

/** 某个端口现在被哪个容器占着（没有则 null）。多实例撞端口时用它报出"是谁占了" */
export function containerPublishing(port: number): string | null {
  const r = docker(['ps', '--filter', `publish=${port}`, '--format', '{{.Names}}'], { quiet: true })
  return r.out.split('\n').filter(Boolean)[0] || null
}

/** 找一个可用端口（给新实例挑向量库端口用） */
export async function findFreePort(start = 8000, tries = 50): Promise<number> {
  for (let p = start; p < start + tries; p++) {
    const free = await new Promise<boolean>((resolve) => {
      const srv = net.createServer()
      srv.once('error', () => resolve(false))
      srv.once('listening', () => srv.close(() => resolve(true)))
      srv.listen(p, '127.0.0.1')
    })
    if (!free) continue
    // docker 发布的端口在 127.0.0.1 上有时仍能绑上，再问一次 docker 更稳
    if (!containerPublishing(p)) return p
  }
  return start
}
