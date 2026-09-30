<script setup lang="ts">
import { computed, ref } from 'vue'
import { useManageApi } from '../composables/useManageApi.ts'
import { useIndexer } from '../composables/useIndexer.ts'
import { toast } from '../composables/useToast.ts'

// 导入：选目录/文件（可多次，累加）→ 预检 → 执行 → 建立索引
// 只支持 .md（非 md 不上传也不扫描）。

const props = defineProps<{ pending: number }>()
const emit = defineEmits<{ (e: 'imported'): void }>()
const api = useManageApi()
const indexer = useIndexer()

type Picked = { path: string; content: string; size: number }
type Plan = {
  count: number
  items: Array<{ from: string; to: string; status: 'new' | 'conflict' }>
  conflicts: Array<{ from: string; to: string }>
  skipped: Array<{ path: string; reason: string }>
  renamed: Array<{ from: string; to: string }>
  categories: Array<{ name: string; count: number }>
}
type Summary = {
  imported: Array<{ from: string; to: string }>
  skipped: Array<{ path: string; reason: string }>
  failed: Array<{ path: string; error: string }>
}

const step = ref<'pick' | 'plan' | 'running' | 'done'>('pick')
const picked = ref<Picked[]>([])
const ignored = ref<Array<{ path: string; reason: string }>>([])
const plan = ref<Plan | null>(null)
const strategy = ref<'skip' | 'overwrite' | 'rename'>('skip')
const imageWarnings = ref<string[]>([])
const progress = ref({ done: 0, total: 0 })
const summary = ref<Summary | null>(null)
const busy = ref(false)
const error = ref('')
const dragging = ref(false)

// 索引入口在面板底部那条常驻栏上（见 ManagePanel），这里只负责"告诉它内容变了"

const dirInput = ref<HTMLInputElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

const totalSize = computed(() => picked.value.reduce((s, f) => s + f.size, 0))
const planDirs = computed(() => plan.value?.categories ?? [])
/** 按源路径索引一下预检结果，列表里就能标出"冲突/会改名" */
const planByFrom = computed(() => new Map((plan.value?.items ?? []).map((i) => [i.from, i])))
const renamedByFrom = computed(() => new Map((plan.value?.renamed ?? []).map((r) => [r.from, r.to])))

/** 规范化相对路径（处理 ./ 与 ../） */
function normalizePath(p: string): string {
  const out: string[] = []
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return out.join('/')
}

/**
 * 收集待导入文件（只留 .md，其余记入 ignored）。
 * **累加**：多次选择 / 多次拖拽会并进同一份清单，同名路径以后来的为准 —— 不再"后一次覆盖前一次"。
 */
async function collect(entries: Array<{ path: string; file: File }>) {
  error.value = ''
  step.value = 'pick'
  summary.value = null

  const byPath = new Map(picked.value.map((f) => [f.path, f]))
  const ignoredMap = new Map(ignored.value.map((i) => [i.path, i]))

  for (const { path, file } of entries) {
    const rel = normalizePath(path)
    if (!rel) continue
    const base = rel.split('/').pop() ?? ''
    if (base.startsWith('.')) {
      ignoredMap.set(rel, { path: rel, reason: '隐藏文件' })
      continue
    }
    if (!base.toLowerCase().endsWith('.md')) {
      ignoredMap.set(rel, { path: rel, reason: '非 Markdown' })
      continue
    }
    ignoredMap.delete(rel)
    byPath.set(rel, { path: rel, content: await file.text(), size: file.size })
  }

  picked.value = [...byPath.values()]
  ignored.value = [...ignoredMap.values()]
}

function onDirChange(e: Event) {
  const input = e.target as HTMLInputElement
  const list = Array.from(input.files ?? [])
  // webkitRelativePath 形如 "我的笔记/前端/react.md"
  void collect(list.map((f) => ({ path: (f as any).webkitRelativePath || f.name, file: f })))
  input.value = ''
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const list = Array.from(input.files ?? [])
  void collect(list.map((f) => ({ path: f.name, file: f })))
  input.value = ''
}

/** 拖拽：支持目录（用 webkitGetAsEntry 递归） */
async function entriesFromDataTransfer(dt: DataTransfer): Promise<Array<{ path: string; file: File }>> {
  const out: Array<{ path: string; file: File }> = []
  const roots: any[] = []
  for (let i = 0; i < dt.items.length; i++) {
    const entry = (dt.items[i] as any).webkitGetAsEntry?.()
    if (entry) roots.push(entry)
  }
  if (roots.length === 0) {
    for (const f of Array.from(dt.files)) out.push({ path: f.name, file: f })
    return out
  }
  const walk = async (entry: any, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file: File = await new Promise((res, rej) => entry.file(res, rej))
      out.push({ path: prefix + entry.name, file })
    } else if (entry.isDirectory) {
      const reader = entry.createReader()
      for (;;) {
        const batch: any[] = await new Promise((res, rej) => reader.readEntries(res, rej))
        if (!batch.length) break
        for (const child of batch) await walk(child, `${prefix + entry.name}/`)
      }
    }
  }
  for (const r of roots) await walk(r, '')
  return out
}

async function onDrop(e: DragEvent) {
  dragging.value = false
  if (!e.dataTransfer) return
  await collect(await entriesFromDataTransfer(e.dataTransfer))
}

/** 检测本地图片引用（图片不会被导入 → 会裂图） */
function detectImageRefs(): string[] {
  const paths = new Set(picked.value.map((f) => f.path))
  const warns: string[] = []
  for (const f of picked.value) {
    const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''
    for (const m of f.content.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const src = m[1]
      if (/^(https?:)?\/\//i.test(src) || src.startsWith('data:')) continue
      const resolved = normalizePath(`${dir}/${src}`)
      if (!paths.has(resolved)) warns.push(`${f.path} → ${src}`)
    }
  }
  return warns.slice(0, 20)
}

async function doScan() {
  if (picked.value.length === 0) {
    error.value = '还没有选择任何 .md 文件'
    return
  }
  busy.value = true
  error.value = ''
  try {
    plan.value = (await api.post('/api/import/scan', {
      files: picked.value.map((f) => ({ path: f.path })),
    })) as Plan
    imageWarnings.value = detectImageRefs()
    step.value = 'plan'
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    busy.value = false
  }
}

/** 从清单里移除一项；预检结果跟着重算（否则统计就和清单对不上了） */
async function removePicked(path: string) {
  picked.value = picked.value.filter((f) => f.path !== path)
  if (picked.value.length === 0) {
    step.value = 'pick'
    plan.value = null
    imageWarnings.value = []
    return
  }
  await doScan()
}

function clearAll() {
  picked.value = []
  ignored.value = []
  plan.value = null
  imageWarnings.value = []
  error.value = ''
}

async function doImport() {
  if (!plan.value) return
  const pendingBefore = props.pending
  step.value = 'running'
  error.value = ''
  const byPath = new Map(picked.value.map((f) => [f.path, f]))
  const targets = plan.value.items.map((i) => byPath.get(i.from)).filter(Boolean) as Picked[]

  const BATCH = 100
  const agg: Summary = { imported: [], skipped: [], failed: [] }
  progress.value = { done: 0, total: targets.length }

  try {
    for (let i = 0; i < targets.length; i += BATCH) {
      const batch = targets.slice(i, i + BATCH)
      const res = (await api.post('/api/import/execute', {
        files: batch.map((f) => ({ path: f.path, content: f.content })),
        strategy: strategy.value,
      })) as Summary
      agg.imported.push(...res.imported)
      agg.skipped.push(...res.skipped)
      agg.failed.push(...res.failed)
      progress.value = { done: Math.min(i + BATCH, targets.length), total: targets.length }
    }
    summary.value = agg
    step.value = 'done'
    indexer.markDirty()
    emit('imported')

    // 收件箱原来是空的 → 导航里会多出一项「待归档」，但那要重启 dev 才看得到
    if (pendingBefore === 0 && agg.imported.length > 0) {
      toast('收件箱有内容了 —— 导航里的「待归档」要重启 pnpm dev 才会出现', 'warn')
    }
  } catch (err) {
    error.value = (err as Error).message
    step.value = 'plan'
  }
}

function reset() {
  step.value = 'pick'
  picked.value = []
  ignored.value = []
  plan.value = null
  imageWarnings.value = []
  summary.value = null
  error.value = ''
}
</script>

<template>
  <div class="mg-import">
    <!-- ① 选择来源 -->
    <template v-if="step === 'pick'">
      <div
        class="mg-drop"
        :class="{ 'mg-drop-active': dragging }"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="onDrop"
      >
        <p class="mg-drop-title">把 Markdown 拖进来</p>
        <p class="mg-drop-sub">支持文件夹；只收 <code>.md</code>，其他格式会被忽略</p>
        <div class="mg-drop-actions">
          <button class="mg-btn mg-btn-primary" :disabled="busy" @click="dirInput?.click()">选择文件夹</button>
          <button class="mg-btn" :disabled="busy" @click="fileInput?.click()">选择文件</button>
        </div>
        <input ref="dirInput" type="file" webkitdirectory multiple hidden @change="onDirChange" />
        <input ref="fileInput" type="file" multiple accept=".md,text/markdown" hidden @change="onFileChange" />
      </div>

      <div v-if="picked.length > 0" class="mg-block">
        <div class="mg-block-title">已选 {{ picked.length }} 个 <code>.md</code>（{{ (totalSize / 1024).toFixed(0) }} KB）</div>
        <p class="mg-muted">可以继续选择或拖拽，会**累加**到这份清单里。</p>
        <p v-if="ignored.length" class="mg-muted">已忽略 {{ ignored.length }} 个非 Markdown / 隐藏文件</p>
      </div>

      <div v-if="picked.length > 0" class="mg-foot">
        <button class="mg-btn" :disabled="busy" @click="clearAll">清空</button>
        <button class="mg-btn mg-btn-primary" :disabled="busy" @click="doScan">
          {{ busy ? '扫描中…' : '下一步：预检' }}
        </button>
      </div>
    </template>

    <!-- ② 预检（待导入清单就放这一步，可逐项移除） -->
    <template v-else-if="step === 'plan' && plan">
      <p class="mg-plan-head">
        将导入 <b>{{ picked.length }}</b> 个文件 → <code>docs/imported/</code>
      </p>

      <div class="mg-block">
        <div class="mg-block-title">待导入清单<span class="mg-muted">（点 ✕ 可移除，移除后会重新预检）</span></div>
        <div class="mg-picklist">
          <div v-for="f in picked" :key="f.path" class="mg-pickrow">
            <span class="mg-pickrow-name" :title="f.path">{{ f.path }}</span>
            <span v-if="planByFrom.get(f.path)?.status === 'conflict'" class="mg-tag mg-tag-warn">已存在</span>
            <span v-else class="mg-tag">新增</span>
            <span v-if="renamedByFrom.get(f.path)" class="mg-tag">→ {{ renamedByFrom.get(f.path) }}</span>
            <button class="mg-x" title="从清单移除" @click="removePicked(f.path)">✕</button>
          </div>
        </div>
      </div>

      <div v-if="planDirs.length" class="mg-block">
        <div class="mg-block-title">会新增这些分类</div>
        <div class="mg-cats">
          <span v-for="c in planDirs" :key="c.name" class="mg-cat">{{ c.name }} <b>{{ c.count }}</b></span>
        </div>
      </div>

      <div v-if="plan.conflicts.length" class="mg-block">
        <div class="mg-block-title mg-warn">⚠️ {{ plan.conflicts.length }} 个目标已存在</div>
        <ul class="mg-list">
          <li v-for="c in plan.conflicts.slice(0, 8)" :key="c.to">{{ c.to }}</li>
        </ul>
        <label class="mg-radio">
          <span>冲突时：</span>
          <select v-model="strategy">
            <option value="skip">跳过（推荐）</option>
            <option value="overwrite">覆盖</option>
            <option value="rename">重命名保留两份</option>
          </select>
        </label>
      </div>

      <div v-if="plan.skipped.length || ignored.length" class="mg-block">
        <div class="mg-block-title mg-muted">
          🚫 忽略 {{ plan.skipped.length + ignored.length }} 项（非 Markdown / 隐藏文件 / index.md）
        </div>
        <ul class="mg-list mg-muted">
          <li v-for="s in plan.skipped.slice(0, 6)" :key="s.path">{{ s.path }}（{{ s.reason }}）</li>
        </ul>
      </div>

      <div v-if="imageWarnings.length" class="mg-block">
        <div class="mg-block-title mg-warn">⚠️ 发现 {{ imageWarnings.length }} 处本地图片引用</div>
        <p class="mg-muted">只导入 <code>.md</code>，这些图片不会被带进来，显示时可能裂图。</p>
        <ul class="mg-list mg-muted">
          <li v-for="w in imageWarnings.slice(0, 5)" :key="w">{{ w }}</li>
        </ul>
      </div>

      <div class="mg-foot">
        <button class="mg-btn" :disabled="busy" @click="step = 'pick'">返回</button>
        <button class="mg-btn mg-btn-primary" :disabled="busy" @click="doImport">确认导入 {{ picked.length }} 个文件</button>
      </div>
    </template>

    <!-- ③ 执行中 -->
    <template v-else-if="step === 'running'">
      <div class="mg-progress">
        <p>正在导入… {{ progress.done }} / {{ progress.total }}</p>
        <div class="mg-bar"><i :style="{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }" /></div>
      </div>
    </template>

    <!-- ④ 结果 -->
    <template v-else-if="step === 'done' && summary">
      <p class="mg-plan-head">✅ 导入完成：<b>{{ summary.imported.length }}</b> 个 → <code>docs/imported/</code></p>
      <p v-if="summary.skipped.length" class="mg-muted">跳过 {{ summary.skipped.length }} 个</p>
      <p v-if="summary.failed.length" class="mg-warn">失败 {{ summary.failed.length }} 个</p>

      <div class="mg-block mg-callout">
        <div class="mg-block-title">还差一步：更新索引</div>
        <p class="mg-muted">
          导入只是把文件放进内容目录，AI 还搜不到它们 —— 点**面板底部那条**的「更新索引」即可。
        </p>
      </div>

      <div class="mg-foot">
        <button class="mg-btn" @click="reset">继续导入</button>
      </div>
    </template>

    <p v-if="error" class="mg-error">{{ error }}</p>
  </div>
</template>

<style scoped>
.mg-import {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 100%;
  font-size: 13px;
}
.mg-muted {
  color: var(--vp-c-text-2);
}
.mg-warn {
  color: var(--vp-c-warning-1);
}
.mg-drop {
  border: 2px dashed var(--vp-c-divider);
  border-radius: 10px;
  padding: 28px 16px;
  text-align: center;
  transition: all 0.2s;
}
.mg-drop-active {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}
.mg-drop-title {
  font-size: 15px;
  font-weight: 600;
  margin: 0 0 6px;
}
.mg-drop-sub {
  color: var(--vp-c-text-2);
  margin: 0 0 16px;
}
.mg-drop-actions {
  display: flex;
  gap: 8px;
  justify-content: center;
}
.mg-btn {
  padding: 7px 14px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  cursor: pointer;
  font-size: 13px;
}
.mg-btn:hover:not(:disabled) {
  border-color: var(--vp-c-brand-1);
}
.mg-btn:disabled {
  opacity: 0.55;
  cursor: default;
}
.mg-btn-primary {
  background: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
  color: #fff;
}
/* 操作按钮统一放底部右下角 */
.mg-foot {
  margin-top: auto;
  padding-top: 4px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.mg-plan-head {
  margin: 0;
  font-size: 14px;
}
.mg-block {
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  padding: 10px 12px;
}
.mg-block-title {
  font-weight: 600;
  margin-bottom: 6px;
}
.mg-picklist {
  max-height: 190px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.mg-pickrow {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
}
.mg-pickrow-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mg-tag {
  flex: none;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  font-size: 11px;
}
.mg-tag-warn {
  background: var(--vp-c-warning-soft, #fff7ed);
  color: var(--vp-c-warning-1, #b45309);
}
.mg-x {
  flex: none;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--vp-c-text-3);
  cursor: pointer;
}
.mg-x:hover {
  background: var(--vp-c-danger-soft, #fef2f2);
  color: var(--vp-c-danger-1, #dc2626);
}
.mg-cats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.mg-cat {
  background: var(--vp-c-brand-soft);
  border-radius: 999px;
  padding: 2px 10px;
}
.mg-list {
  margin: 0;
  padding-left: 18px;
  max-height: 120px;
  overflow: auto;
  line-height: 1.7;
}
.mg-radio {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.mg-radio select {
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
}
.mg-bar {
  height: 6px;
  border-radius: 999px;
  background: var(--vp-c-divider);
  overflow: hidden;
}
.mg-bar i {
  display: block;
  height: 100%;
  background: var(--vp-c-brand-1);
  transition: width 0.2s;
}
.mg-callout {
  background: var(--vp-c-bg-soft);
}
.mg-log {
  margin: 10px 0 0;
  max-height: 120px;
  overflow: auto;
  font-size: 12px;
  color: var(--vp-c-text-2);
  white-space: pre-wrap;
}
.mg-error {
  color: var(--vp-c-danger-1);
  margin: 0;
}
</style>
