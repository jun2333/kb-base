<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useManageApi } from '../composables/useManageApi.ts'
import { useIndexer } from '../composables/useIndexer.ts'
import { toast } from '../composables/useToast.ts'

// 归档：把 docs/imported/（收件箱）里的东西分配到正式分类，或者直接删掉。
// 分类 = docs/ 下的顶层目录，所以"分配菜单"底层就是移动文件 —— 移完导航/侧边栏自动生效。

const emit = defineEmits<{ (e: 'changed'): void }>()
const api = useManageApi()
const indexer = useIndexer()

type TreeNode = {
  name: string
  path: string
  type: 'file' | 'dir'
  title?: string
  count?: number
  children?: TreeNode[]
}
type Category = { name: string; label: string; count: number }
type Row = { path: string; name: string; type: 'file' | 'dir'; title?: string; count?: number; depth: number }

const tree = ref<TreeNode[]>([])
const total = ref(0)
const categories = ref<Category[]>([])
const selected = ref<string[]>([])
const loading = ref(false)
const error = ref('')
const dragOver = ref('')
const confirmingDelete = ref(false)

/**
 * 导航（菜单/侧边栏）是在 VitePress **加载站点配置时**算出来的，运行期不会重算。
 * 所以「新增了分类」「收件箱从有到无」这类变化，要重启 dev 才看得到 —— 如实提示，
 * 别让用户以为操作失败。
 */
function hintRestartDev(what: string) {
  toast(`${what} —— 导航与侧边栏要重启 pnpm dev 才会更新（内容本身已经落盘）`, 'warn')
}

/** 树 → 扁平行（带缩进），勾选框列表用着最顺手 */
function flatten(nodes: TreeNode[], depth = 0, out: Row[] = []): Row[] {
  for (const n of nodes) {
    out.push({ path: n.path, name: n.name, type: n.type, title: n.title, count: n.count, depth })
    if (n.children) flatten(n.children, depth + 1, out)
  }
  return out
}
const rows = computed(() => flatten(tree.value))

async function refresh() {
  loading.value = true
  error.value = ''
  try {
    const res = (await api.get('/api/manage/tree')) as { tree: TreeNode[]; total: number; categories: Category[] }
    tree.value = res.tree
    total.value = res.total
    categories.value = res.categories
    selected.value = selected.value.filter((p) => rows.value.some((r) => r.path === p))
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    loading.value = false
  }
}

function toggle(path: string) {
  confirmingDelete.value = false
  selected.value = selected.value.includes(path)
    ? selected.value.filter((p) => p !== path)
    : [...selected.value, path]
}
const allChecked = computed(() => rows.value.length > 0 && selected.value.length === rows.value.length)
function toggleAll() {
  confirmingDelete.value = false
  selected.value = allChecked.value ? [] : rows.value.map((r) => r.path)
}

type TreeRes = { tree: TreeNode[]; total: number; categories: Category[] }
function applyTree(res: TreeRes) {
  tree.value = res.tree
  total.value = res.total
  categories.value = res.categories
  selected.value = []
  confirmingDelete.value = false
}

/** 归档所选到某个分类 */
async function archiveTo(target: string) {
  const items = [...selected.value]
  if (items.length === 0) return
  error.value = ''
  const hadCategories = new Set(categories.value.map((c) => c.name))
  try {
    const res = (await api.post('/api/manage/archive', { items, target, strategy: 'skip' })) as TreeRes & {
      moved: Array<{ from: string; to: string }>
      skipped: Array<{ from: string }>
    }
    applyTree(res)
    indexer.markDirty()

    const extra = res.skipped.length ? `，跳过 ${res.skipped.length} 项（目标已存在）` : ''
    toast(`已归档 ${res.moved.length} 项 → ${target}${extra}`, 'success')

    // 归档可能"顺手"创建了新分类目录
    const created = res.categories.filter((c) => !hadCategories.has(c.name)).map((c) => c.label)
    if (created.length) hintRestartDev(`导航里多出分类「${created.join('、')}」`)
    if (total.value === 0) hintRestartDev('收件箱已空~')

    emit('changed')
  } catch (err) {
    error.value = (err as Error).message
  }
}

/** 删除所选（二次确认，避免手滑把收件箱清空） */
async function doDelete() {
  const items = [...selected.value]
  if (items.length === 0) return
  if (!confirmingDelete.value) {
    confirmingDelete.value = true
    return
  }
  error.value = ''
  const hadItems = total.value > 0
  try {
    const res = (await api.post('/api/manage/delete', { items })) as TreeRes & {
      removed: string[]
      failed: Array<{ path: string; error: string }>
    }
    applyTree(res)
    indexer.markDirty()

    if (res.failed.length) {
      toast(`已删除 ${res.removed.length} 项，${res.failed.length} 项失败：${res.failed[0].error}`, 'error')
    } else {
      toast(`已删除 ${res.removed.length} 项`, 'success')
    }
    if (hadItems && total.value === 0) hintRestartDev('收件箱已空~')

    emit('changed')
  } catch (err) {
    error.value = (err as Error).message
    confirmingDelete.value = false
  }
}

function onDragStart(path: string) {
  if (!selected.value.includes(path)) selected.value = [path]
}

onMounted(refresh)
defineExpose({ refresh })
</script>

<template>
  <div class="mg-archive">
    <div class="mg-bar-top">
      <span v-if="total > 0">收件箱还有 <b>{{ total }}</b> 项待归档</span>
      <span v-else class="mg-muted">收件箱空了 🎉</span>
    </div>

    <div class="mg-toolbar">
      <span class="mg-muted">{{ selected.length ? `已选 ${selected.length} 项` : '勾选左边的内容，再点右边分类' }}</span>
      <div class="mg-toolbar-actions">
        <template v-if="confirmingDelete">
          <span class="mg-warn">删除后不可恢复，确认？</span>
          <button class="mg-btn mg-btn-mini" @click="confirmingDelete = false">取消</button>
          <button class="mg-btn mg-btn-mini mg-btn-danger" @click="doDelete">确认删除 {{ selected.length }} 项</button>
        </template>
        <template v-else>
          <button
            class="mg-btn mg-btn-mini mg-btn-danger"
            :disabled="selected.length === 0"
            @click="doDelete"
          >
            删除
          </button>
        </template>
      </div>
    </div>

    <div class="mg-two">
      <!-- 左：待归档 -->
      <div class="mg-col">
        <div class="mg-col-head">
          <label class="mg-check">
            <input type="checkbox" :checked="allChecked" :disabled="rows.length === 0" @change="toggleAll" />
            <span>待归档（{{ rows.length }}）</span>
          </label>
          <span class="mg-muted">可拖到右边</span>
        </div>
        <div class="mg-col-body">
          <p v-if="loading" class="mg-muted">加载中…</p>
          <p v-else-if="rows.length === 0" class="mg-muted">还没有导入任何内容。</p>
          <div
            v-for="r in rows"
            :key="r.path"
            class="mg-row"
            :class="{ 'mg-row-on': selected.includes(r.path) }"
            :style="{ paddingLeft: `${8 + r.depth * 16}px` }"
            draggable="true"
            @dragstart="onDragStart(r.path)"
            @click="toggle(r.path)"
          >
            <input type="checkbox" :checked="selected.includes(r.path)" @click.stop @change="toggle(r.path)" />
            <span class="mg-row-icon">{{ r.type === 'dir' ? '📁' : '📄' }}</span>
            <span class="mg-row-name">{{ r.title || r.name }}</span>
            <span v-if="r.type === 'dir'" class="mg-muted">{{ r.count }}</span>
          </div>
        </div>
      </div>

      <!-- 右：分类 -->
      <div class="mg-col">
        <div class="mg-col-head"><span>归档到分类</span></div>
        <div class="mg-col-body">
          <button
            v-for="c in categories"
            :key="c.name"
            class="mg-catbtn"
            :class="{ 'mg-catbtn-over': dragOver === c.name, 'mg-catbtn-empty': c.count === 0 }"
            :disabled="selected.length === 0"
            @dragover.prevent="dragOver = c.name"
            @dragleave="dragOver = ''"
            @drop.prevent="dragOver = ''; archiveTo(c.name)"
            @click="archiveTo(c.name)"
          >
            <span>{{ c.label }}</span>
            <span class="mg-muted">{{ c.count === 0 ? '空' : c.count }}</span>
          </button>
          <p v-if="categories.length === 0" class="mg-muted">
            还没有分类。分类就是 <code>docs/</code> 下的一个目录 —— 在文件系统里建好，这里就会出现。
          </p>
        </div>
      </div>
    </div>

    <p v-if="error" class="mg-error">{{ error }}</p>
  </div>
</template>

<style scoped>
.mg-archive {
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 13px;
}
.mg-muted {
  color: var(--vp-c-text-2);
}
.mg-warn {
  color: var(--vp-c-warning-1);
}
.mg-bar-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.mg-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.mg-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.mg-two {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  min-height: 300px;
}
.mg-col {
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.mg-col-head {
  padding: 8px 10px;
  border-bottom: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.mg-col-body {
  padding: 6px;
  overflow: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mg-check {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}
.mg-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
}
.mg-row:hover {
  background: var(--vp-c-bg-soft);
}
.mg-row-on {
  background: var(--vp-c-brand-soft);
}
.mg-row-icon {
  font-size: 12px;
}
.mg-row-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mg-catbtn {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  cursor: pointer;
  text-align: left;
}
.mg-catbtn:hover:not(:disabled) {
  border-color: var(--vp-c-brand-1);
}
.mg-catbtn:disabled {
  opacity: 0.5;
  cursor: default;
}
.mg-catbtn-over {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}
.mg-catbtn-empty {
  border-style: dashed;
}
.mg-btn {
  padding: 6px 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  cursor: pointer;
  font-size: 12px;
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
.mg-btn-danger {
  color: var(--vp-c-danger-1, #dc2626);
  border-color: var(--vp-c-danger-1, #dc2626);
}
.mg-btn-danger:hover:not(:disabled) {
  background: var(--vp-c-danger-soft, #fef2f2);
}
.mg-btn-mini {
  padding: 3px 10px;
}
.mg-error {
  color: var(--vp-c-danger-1);
  margin: 0;
}
</style>
