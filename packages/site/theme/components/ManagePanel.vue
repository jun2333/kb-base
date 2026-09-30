<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useManageApi } from '../composables/useManageApi.ts'
import { usePanelState } from '../composables/usePanelState.js'
import { useIndexer } from '../composables/useIndexer.ts'
import { toast } from '../composables/useToast.ts'
import ImportTab from './ImportTab.vue'
import ArchiveTab from './ArchiveTab.vue'

// 「内容管理」面板：导入 + 归档 + 菜单。
// 与 AI 助手 / 批注同级的内置能力，只在本地开发时显示（生产构建由 Layout 关掉）。

const { isBlocked, tryOpen, close: closePanel } = usePanelState('manage')
const api = useManageApi()
const indexer = useIndexer()

const isOpen = ref(false)
const isFullscreen = ref(false)
const tab = ref<'import' | 'archive'>('import')
const pending = ref(0)
const offline = ref(false)
const archiveRef = ref<InstanceType<typeof ArchiveTab> | null>(null)

async function refreshPending() {
  try {
    const res = (await api.get('/api/import/stat')) as { pending?: number }
    pending.value = res.pending ?? 0
    offline.value = false
  } catch {
    offline.value = true
  }
}

/** 收件箱为空就把「归档」tab 收起来 —— 点进去也没东西可归档，白占一个位置 */
const showArchive = computed(() => pending.value > 0)

/** 没东西可归档时，别把人留在归档 tab 上（比如刚把最后一批归档完） */
watch([showArchive, isOpen], () => {
  if (!showArchive.value && tab.value === 'archive') tab.value = 'import'
})

async function open() {
  if (!tryOpen()) return
  tab.value = 'import' // 默认落在导入：没有待归档内容时归档 tab 根本不出现
  isOpen.value = true
  await refreshPending()
}

function handleClose() {
  isOpen.value = false
  closePanel()
}

/**
 * 底部那条「索引」状态栏 —— **常驻**，不挂在任何一个 tab 上。
 * 原因：索引过期可能由导入、归档、删除里任何一件事引起，而「归档」tab 在收件箱空时是不显示的；
 * 挂在 tab 里就会出现"归档完 tab 消失、更新索引按钮也够不着"。
 */
const indexStatus = computed(() => {
  if (indexer.indexing.value) return { text: '正在建立索引…', kind: 'muted' }
  if (indexer.error.value) return { text: `索引失败：${indexer.error.value}`, kind: 'error' }
  if (indexer.dirty.value) return { text: '内容有改动，索引未更新 —— AI 还搜不到新内容', kind: 'warn' }
  if (indexer.indexed.value) return { text: '索引已更新 ✅', kind: 'ok' }
  return { text: '导入、归档或删除之后，点右边让 AI 搜到新内容', kind: 'muted' }
})

/** 索引进度就取最后一行日志（形如"已写入 300/2772"） */
const lastIndexLog = computed(() => indexer.logs.value[indexer.logs.value.length - 1] ?? '')

async function runIndex() {
  if (await indexer.build(false)) {
    toast('索引已更新', 'success')
  } else if (indexer.error.value) {
    toast(indexer.error.value, 'error')
  }
}

function switchTab(t: 'import' | 'archive') {
  tab.value = t
  if (t === 'archive') archiveRef.value?.refresh()
}
</script>

<template>
  <!-- 遮罩统一用 .kb-overlay（见 custom.css）。两件事要留意：
       ① 它必须是 .mg-root 的**兄弟**，不能放进去 —— .mg-root 自己有 z-index（1001）会形成层叠上下文，
          遮罩（999）若在里面就会把没设 z-index 的面板压住。
       ② 这里**不绑点击关闭**：导入/归档里可能正选着东西，点一下就丢掉太容易踩。要关用右上角 ✕。 -->
  <div v-if="isOpen" class="kb-overlay" />

  <div class="mg-root">

    <!-- 别的面板（助手 / 批注）开着时**整个隐藏**：留着半透明的按钮，hover 还会动效，
         又点不了，只会让人以为能点。跟遮罩一起构成"一次只开一个面板"的效果。 -->
    <button
      v-if="isOpen || !isBlocked"
      class="mg-trigger"
      title="内容管理：导入与归档"
      @click="isOpen ? handleClose() : open()"
    >
      <svg v-if="!isOpen" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 5v14M5 12h14" />
      </svg>
      <svg v-else viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
      <span v-if="pending > 0 && !isOpen" class="mg-badge">{{ pending }}</span>
    </button>

    <div v-if="isOpen" class="mg-panel" :class="{ 'mg-panel-full': isFullscreen }">
      <div class="mg-header">
        <div class="mg-tabs">
          <button class="mg-tab" :class="{ 'mg-tab-on': tab === 'import' }" @click="switchTab('import')">导入</button>
          <button
            v-if="showArchive"
            class="mg-tab"
            :class="{ 'mg-tab-on': tab === 'archive' }"
            @click="switchTab('archive')"
          >
            归档
            <span class="mg-tab-badge">{{ pending }}</span>
          </button>
        </div>
        <div class="mg-header-actions">
          <button class="mg-icon-btn" :title="isFullscreen ? '退出全屏' : '全屏'" @click="isFullscreen = !isFullscreen">
            {{ isFullscreen ? '⤡' : '⤢' }}
          </button>
          <button class="mg-icon-btn" title="关闭" @click="handleClose">✕</button>
        </div>
      </div>

      <div class="mg-indexbar" :class="`mg-indexbar-${indexStatus.kind}`">
        <div class="mg-indexbar-text">
          <span :title="indexStatus.text">{{ indexStatus.text }}</span>
          <span v-if="indexer.indexing.value && lastIndexLog" class="mg-indexbar-log">{{ lastIndexLog }}</span>
        </div>
        <button class="mg-btn" :class="{ 'mg-btn-primary': indexer.dirty.value }" :disabled="indexer.indexing.value" @click="runIndex">
          {{ indexer.indexing.value ? '索引中…' : '更新索引' }}
        </button>
      </div>

      <div class="mg-body">
        <div v-if="offline" class="mg-offline">
          后端服务没起来 —— 先在项目里跑 <code>pnpm kb serve</code>（或 <code>pnpm dev</code>），再重试。
          <button class="mg-retry" @click="refreshPending">重试</button>
        </div>

        <ImportTab v-show="tab === 'import'" :pending="pending" @imported="refreshPending" />
        <ArchiveTab v-show="tab === 'archive'" ref="archiveRef" @changed="refreshPending" />
      </div>

    </div>
  </div>
</template>

<style scoped>
.mg-root {
  position: fixed;
  bottom: 84px;
  right: 24px;
  z-index: 1001;
  font-family: var(--vp-font-family-base);
}
.mg-trigger {
  position: relative;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: none;
  background: var(--vp-c-brand-1);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  transition: transform 0.2s, box-shadow 0.2s;
}
.mg-trigger:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
}
.mg-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--vp-c-warning-1, #d97706);
  color: #fff;
  font-size: 11px;
  line-height: 18px;
  text-align: center;
}
.mg-panel {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 760px;
  height: 600px;
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 140px);
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-border);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.14);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.mg-panel-full {
  position: fixed;
  inset: 24px;
  width: auto;
  height: auto;
  max-width: none;
  max-height: none;
}
.mg-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--vp-c-divider);
}
.mg-tabs {
  display: flex;
  gap: 4px;
}
.mg-tab {
  padding: 6px 14px;
  border: none;
  background: transparent;
  color: var(--vp-c-text-2);
  cursor: pointer;
  border-radius: 6px;
  font-size: 13px;
}
.mg-tab:hover {
  background: var(--vp-c-bg-soft);
}
.mg-tab-on {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  font-weight: 600;
}
.mg-tab-badge {
  margin-left: 6px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--vp-c-warning-1, #d97706);
  color: #fff;
  font-size: 11px;
}
.mg-header-actions {
  display: flex;
  gap: 4px;
}
.mg-icon-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--vp-c-text-2);
  cursor: pointer;
  border-radius: 6px;
  font-size: 14px;
}
.mg-icon-btn:hover {
  background: var(--vp-c-bg-soft);
}
.mg-body {
  flex: 1;
  overflow: auto;
  padding: 14px;
}
.mg-indexbar {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  /* 高度定住：失败文案可能很长，不让它把这条撑高（全文放 title 里，hover 可看） */
  min-height: 40px;
  padding: 6px 14px;
  border-bottom: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  font-size: 12px;
  color: var(--vp-c-text-2);
}
.mg-indexbar-text {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  overflow: hidden;
}
/* 单行省略：太长就截断，别换行把整条撑高 */
.mg-indexbar-text > span {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mg-indexbar-log {
  color: var(--vp-c-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mg-indexbar-warn .mg-indexbar-text {
  color: var(--vp-c-warning-1);
}
.mg-indexbar-error .mg-indexbar-text {
  color: var(--vp-c-danger-1);
}
.mg-indexbar-ok .mg-indexbar-text {
  color: var(--vp-c-brand-1);
}
.mg-indexbar .mg-btn {
  flex: none;
  padding: 5px 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  cursor: pointer;
  font-size: 12px;
}
.mg-indexbar .mg-btn:disabled {
  opacity: 0.55;
  cursor: default;
}
.mg-indexbar .mg-btn-primary {
  background: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
  color: #fff;
}
.mg-offline {
  margin-bottom: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--vp-c-warning-soft, #fff7ed);
  color: var(--vp-c-warning-1, #b45309);
  font-size: 13px;
}
.mg-retry {
  margin-left: 8px;
  border: 1px solid currentColor;
  background: transparent;
  color: inherit;
  border-radius: 6px;
  padding: 3px 10px;
  cursor: pointer;
  font-size: 12px;
}
</style>
