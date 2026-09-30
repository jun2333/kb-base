<template>
  <div class="annotation-system">
    <!-- 悬浮批注按钮 -->
    <Transition name="fade">
      <div 
        v-if="showButton && selectionInfo" 
        :style="buttonPosition" 
        class="annotation-button"
        @click="openDialog"
      >
        💬 添加批注
      </div>
    </Transition>
    
    <!-- 批注输入对话框 -->
    <Transition name="dialog-fade">
      <div v-if="showDialog" class="kb-overlay kb-overlay-dialog" @click.self="closeDialog">
        <div class="annotation-dialog">
          <div class="dialog-header">
            <h3>添加批注</h3>
            <button class="close-btn" @click="closeDialog">×</button>
          </div>
          
          <div class="selected-text-preview">
            <strong>选中的文本：</strong>
            <p>{{ selectedTextPreview }}</p>
          </div>
          
          <div class="annotation-input-area">
            <label for="annotation-text">批注内容：</label>
            <textarea 
              id="annotation-text"
              v-model="annotationText" 
              placeholder="输入你的批注、疑问或笔记..."
              rows="4"
              autofocus
            ></textarea>
          </div>
          
          <div class="dialog-footer">
            <button class="btn-secondary" @click="closeDialog">取消</button>
            <button class="btn-copy" @click="copyCurrentAnnotation" :disabled="!annotationText.trim()">
              复制
            </button>
            <button class="btn-primary" @click="saveAnnotation" :disabled="!annotationText.trim()">
              保存批注
            </button>
          </div>
        </div>
      </div>
    </Transition>
    
    <!-- 编辑批注对话框 -->
    <Transition name="dialog-fade">
      <div v-if="showEditDialog && editingAnnotation" class="kb-overlay kb-overlay-dialog" @click.self="closeEditDialog">
        <div class="annotation-dialog">
          <div class="dialog-header">
            <h3>编辑批注</h3>
            <button class="close-btn" @click="closeEditDialog">×</button>
          </div>
          
          <div class="selected-text-preview">
            <strong>选中的文本：</strong>
            <p>{{ editingAnnotation.selectedText }}</p>
          </div>
          
          <div class="annotation-input-area">
            <label for="edit-annotation-text">批注内容：</label>
            <textarea 
              id="edit-annotation-text"
              v-model="editingAnnotation.annotation" 
              rows="4"
            ></textarea>
          </div>
          
          <div class="dialog-footer">
            <button class="btn-danger" @click="deleteEditingAnnotation">删除</button>
            <button class="btn-secondary" @click="closeEditDialog">取消</button>
            <button class="btn-primary" @click="updateEditingAnnotation" :disabled="!editingAnnotation.annotation.trim()">
              保存修改
            </button>
          </div>
        </div>
      </div>
    </Transition>
    
    <!-- 高亮区域和提示气泡 -->
    <div 
      v-for="anno in currentPageAnnotations" 
      :key="anno.id"
      class="highlighted-text-wrapper"
      :data-annotation-id="anno.id"
    >
      <span 
        class="highlighted-text"
        @mouseenter="showTooltip(anno)"
        @mouseleave="hideTooltip"
        @click="openEditDialog(anno)"
      >
        {{ anno.selectedText }}
      </span>
      
      <!-- 批注气泡 -->
      <Transition name="tooltip-fade">
        <div 
          v-if="activeTooltip === anno.id" 
          class="annotation-tooltip"
          :style="tooltipPosition"
        >
          <div class="tooltip-content">{{ anno.annotation }}</div>
          <div class="tooltip-meta">
            <span class="tooltip-time">{{ formatTime(anno.createdAt) }}</span>
            <button class="tooltip-edit-btn" @click.stop="openEditDialog(anno)">编辑</button>
          </div>
          <div class="tooltip-arrow"></div>
        </div>
      </Transition>
    </div>
    
    <!-- 导出和统计面板 -->
    <div class="annotation-panel">
      <!-- 遮罩层 -->
      <Transition name="fade">
        <div v-if="showPanel" class="kb-overlay" @click="showPanel = false" />
      </Transition>

      <button 
        class="panel-toggle" 
        @click.stop="showPanel = !showPanel"
        :class="{ active: showPanel, 'panel-toggle-disabled': isBlocked }"
        :disabled="isBlocked"
      >
         批注 ({{ annotationStats.total }})
      </button>
      
      <Transition name="slide-left">
        <div v-if="showPanel" class="panel-content">
          <div class="panel-header">
            <h3>批注管理</h3>
            <button class="close-panel" @click="showPanel = false">×</button>
          </div>
          
          <div class="panel-actions">
            <button class="action-btn primary" @click="copyAnnotationsToClipboard" :disabled="isCopied">
              {{ isCopied ? '✓ 已复制' : '📋 复制批注' }}
            </button>
            <button class="action-btn danger" @click="clearAllAnnotations">
              🗑️ 清空所有
            </button>
          </div>
          
          <div class="panel-annotations" v-if="annotations.length > 0">
            <div 
              v-for="anno in annotations" 
              :key="anno.id"
              class="panel-annotation-item"
            >
              <div class="item-header">
                <span class="item-page">{{ getShortPath(anno.filePath) }}</span>
                <div class="item-actions">
                  <button class="item-btn" @click.stop="startEditAnnotation(anno)">✏️</button>
                  <button class="item-btn danger" @click.stop="deleteAnnotationById(anno.id)">🗑️</button>
                </div>
              </div>
              <div class="item-content">
                <div class="item-text">{{ anno.selectedText }}</div>
                <div class="item-note">{{ anno.annotation }}</div>
              </div>
            </div>
          </div>
          
          <div class="panel-empty" v-else>
            <p>暂无批注</p>
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useData } from 'vitepress'
import { useAnnotations } from '../composables/useAnnotations'
import { usePanelState } from '../composables/usePanelState.js'
import { toast } from '../composables/useToast.ts'

const { isBlocked, tryOpen, close: closePanel } = usePanelState('annotation')

const route = useRoute()
const { theme } = useData()
const { 
  annotations, 
  addAnnotation, 
  updateAnnotation, 
  deleteAnnotation,
  getPageAnnotations,
  exportAnnotations,
  copyAnnotationsToClipboard: copyAnnotations,
  clearAllAnnotations,
  getStats
} = useAnnotations()

// 状态
const showButton = ref(false)
const buttonPosition = ref({})
const selectionInfo = ref(null)
const showDialog = ref(false)
const showEditDialog = ref(false)
const annotationText = ref('')
const editingAnnotation = ref(null)
const activeTooltip = ref(null)
const tooltipPosition = ref({})
const showPanel = ref(false)
const isCopied = ref(false)

// 面板打开时注册遮罩
watch(showPanel, (val) => {
  if (val) {
    tryOpen()
  } else {
    closePanel()
  }
})

// 新增：保存选中内容的快照（关键！）
const selectedTextSnapshot = ref('')

// 计算属性
const currentPageUrl = computed(() => {
  // SSR 构建阶段没有 window，返回 path 即可
  if (typeof window === 'undefined') return route.fullPath || ''
  // 使用 route.fullPath 确保响应式更新
  const baseUrl = window.location.origin
  const fullPath = route.fullPath || window.location.pathname
  const url = `${baseUrl}${fullPath}`
  console.log('Current page URL:', url)
  return url
})
const currentPageAnnotations = computed(() => {
  const all = getPageAnnotations(currentPageUrl.value)
  console.log('Current page annotations:', all.length, 'for URL:', currentPageUrl.value)
  return all
})
const currentPageAnnotationCount = computed(() => currentPageAnnotations.value.length)
const annotationStats = computed(() => getStats())
const selectedTextPreview = computed(() => {
  // 使用快照而不是实时获取
  return selectedTextSnapshot.value || selectionInfo.value?.text || ''
})

// 监听路由变化，清除选择并重新计算批注
watch(() => route.path, () => {
  console.log('Route changed to:', route.path)
  clearSelection()
  // 强制重新计算 currentPageAnnotations
  // Vue 的 computed 会自动追踪依赖，但这里确保 URL 变化时重新计算
})

// 监听鼠标选择事件
onMounted(() => {
  document.addEventListener('mouseup', handleMouseUp)
  document.addEventListener('click', handleDocumentClick)
})

onUnmounted(() => {
  document.removeEventListener('mouseup', handleMouseUp)
  document.removeEventListener('click', handleDocumentClick)
})

function handleDocumentClick(e) {
  // 点击面板外部时关闭面板
  const panel = document.querySelector('.annotation-panel')
  if (panel && !panel.contains(e.target)) {
    showPanel.value = false
  }
}

function handleMouseDown(e) {
  // 已移除 mousedown 监听器，此函数不再使用
}

function handleMouseUp(e) {
  // 立即捕获选区，防止后续操作导致选区丢失
  const selection = window.getSelection()
  
  if (!selection || selection.isCollapsed) {
    showButton.value = false
    selectionInfo.value = null
    return
  }
  
  const selectedText = selection.toString().trim()
  if (!selectedText) {
    showButton.value = false
    selectionInfo.value = null
    return
  }
  
  // 检查是否在文章内容区域
  const anchorNode = selection.anchorNode
  if (!anchorNode) return
  
  const contentArea = anchorNode.parentElement?.closest('.vp-doc, .VPDocContent')
  if (!contentArea) {
    showButton.value = false
    selectionInfo.value = null
    return
  }
  
  // 立即保存选区信息（关键：在显示按钮之前就保存）
  const range = selection.getRangeAt(0)
  const rect = range.getBoundingClientRect()
  
  // 保存选区信息
  selectionInfo.value = {
    text: selectedText,
    range: range.cloneRange(),
    filePath: extractFilePathFromUrl(window.location.href),
    startContainer: range.startContainer,
    startOffset: range.startOffset,
    endContainer: range.endContainer,
    endOffset: range.endOffset
  }
  
  // 计算按钮位置（选区右上角）
  buttonPosition.value = {
    left: `${rect.right + 10}px`,
    top: `${rect.top - 10}px`
  }
  
  showButton.value = true
}

function extractFilePathFromUrl(url) {
  // 从 URL 中提取内容文件路径（前缀由实例配置提供：themeConfig.kb.contentFilePrefix）
  // 例：https://host/ai-agent/core.html → /docs/ai-agent/core.md
  try {
    const pathname = new URL(url).pathname
    const pathWithoutExt = pathname.replace(/\.html$/, '')
    const prefix = theme.value?.kb?.contentFilePrefix ?? ''
    return `${prefix}${pathWithoutExt}.md`
  } catch {
    return pathname
  }
}

function openDialog() {
  if (!selectionInfo.value) return
  
  // 关键：创建选中内容的快照，防止后续失焦导致丢失
  selectedTextSnapshot.value = selectionInfo.value.text
  
  // 立即隐藏按钮，防止重复点击
  showButton.value = false
  
  showDialog.value = true
  annotationText.value = ''
}

function closeDialog() {
  showDialog.value = false
  annotationText.value = ''
  showButton.value = false
  
  // 清空快照和选区信息
  selectedTextSnapshot.value = ''
  selectionInfo.value = null
}

function saveAnnotation() {
  if (!annotationText.value.trim() || !selectedTextSnapshot.value) return
  
  const annotation = {
    pageUrl: window.location.href,
    filePath: extractFilePathFromUrl(window.location.href),
    selectedText: selectedTextSnapshot.value,
    annotation: annotationText.value.trim()
  }
  
  addAnnotation(annotation)
  closeDialog()
  
  // 显示成功提示
  showToast('批注已保存')
}

function copyCurrentAnnotation() {
  if (!annotationText.value.trim() || !selectedTextSnapshot.value) return
  
  const filePath = extractFilePathFromUrl(window.location.href)
  const fileName = filePath.split('/').pop() || filePath
  const now = new Date()
  const timeStr = now.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
  
  const text = `【批注】
文件：${filePath}
选中文本：${selectedTextSnapshot.value}
批注内容：${annotationText.value.trim()}
时间：${timeStr}
---`
  
  navigator.clipboard.writeText(text).then(() => {
    showToast('已复制到剪贴板')
    closeDialog()
  }).catch(() => {
    showToast('复制失败')
  })
}

function openEditDialog(anno) {
  editingAnnotation.value = { ...anno }
  showEditDialog.value = true
  hideTooltip()
}

function closeEditDialog() {
  showEditDialog.value = false
  editingAnnotation.value = null
}

function updateEditingAnnotation() {
  if (!editingAnnotation.value || !editingAnnotation.value.annotation.trim()) return
  
  updateAnnotation(editingAnnotation.value.id, {
    annotation: editingAnnotation.value.annotation.trim()
  })
  
  closeEditDialog()
  showToast('批注已更新')
}

function deleteEditingAnnotation() {
  if (!editingAnnotation.value) return
  deleteAnnotation(editingAnnotation.value.id)
  closeEditDialog()
  showToast('批注已删除')
}

function showTooltip(anno) {
  activeTooltip.value = anno.id
  
  // 计算气泡位置
  const element = document.querySelector(`[data-annotation-id="${anno.id}"]`)
  if (element) {
    const rect = element.getBoundingClientRect()
    tooltipPosition.value = {
      left: `${rect.left}px`,
      top: `${rect.bottom + 10}px`
    }
  }
}

function hideTooltip() {
  activeTooltip.value = null
}

function scrollToHighlight(id) {
  const element = document.querySelector(`[data-annotation-id="${id}"]`)
  if (element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    showTooltip({ id })
  }
}

function formatTime(isoString) {
  const date = new Date(isoString)
  return date.toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function getShortPath(filePath) {
  if (!filePath) return ''
  const parts = filePath.split('/')
  return parts[parts.length - 1] || filePath
}

function startEditAnnotation(anno) {
  editingAnnotation.value = { ...anno }
  showEditDialog.value = true
}

function deleteAnnotationById(id) {
  deleteAnnotation(id)
  showToast('批注已删除')
}

/** 统一走右上角的共享 toast（样式与宿主见 ToastHost.vue / custom.css） */
function showToast(message) {
  toast(message, 'success')
}

function copyAnnotationsToClipboard() {
  if (isCopied.value) return // 防抖：已复制时不能继续点
  
  copyAnnotations(
    (count) => {
      isCopied.value = true
      setTimeout(() => {
        isCopied.value = false
      }, 3000)
    },
    (error) => {
      showToast(error)
    }
  )
}

function clearSelection() {
  showButton.value = false
  selectedTextSnapshot.value = ''
  selectionInfo.value = null
  window.getSelection()?.removeAllRanges()
}
</script>

<style scoped>
.annotation-system {
  position: relative;
}

/* 悬浮按钮 */
.annotation-button {
  position: fixed;
  background: #3eaf7c;
  color: white;
  padding: 8px 16px;
  border-radius: 20px;
  font-size: 14px;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  transition: all 0.2s ease;
  user-select: none;
}

.annotation-button:hover {
  background: #369b6e;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

/* 对话框（遮罩与层级见 custom.css 的 .kb-overlay / .kb-overlay-dialog） */
.annotation-dialog {
  background: white;
  border-radius: 8px;
  padding: 24px;
  width: 90%;
  max-width: 500px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.dialog-header h3 {
  margin: 0;
  font-size: 18px;
  color: #2c3e50;
}

.close-btn {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: #999;
  line-height: 1;
}

.close-btn:hover {
  color: #333;
}

.selected-text-preview {
  background: #f5f5f5;
  padding: 12px;
  border-radius: 4px;
  margin-bottom: 16px;
  font-size: 14px;
}

.selected-text-preview p {
  margin: 8px 0 0 0;
  color: #666;
  font-style: italic;
}

.annotation-input-area label {
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
  color: #2c3e50;
}

.annotation-input-area textarea {
  width: 100%;
  padding: 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
  resize: vertical;
  font-family: inherit;
}

.annotation-input-area textarea:focus {
  outline: none;
  border-color: #3eaf7c;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 16px;
}

.btn-primary, .btn-secondary, .btn-danger, .btn-copy {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-primary {
  background: #3eaf7c;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #369b6e;
}

.btn-primary:disabled {
  background: #ccc;
  cursor: not-allowed;
}

.btn-secondary {
  background: #f0f0f0;
  color: #333;
}

.btn-secondary:hover {
  background: #e0e0e0;
}

.btn-danger {
  background: #ff4d4f;
  color: white;
}

.btn-danger:hover {
  background: #ff7875;
}

.btn-copy {
  background: #1890ff;
  color: white;
}

.btn-copy:hover:not(:disabled) {
  background: #40a9ff;
}

.btn-copy:disabled {
  background: #ccc;
  cursor: not-allowed;
}

/* 高亮文本 */
.highlighted-text-wrapper {
  position: relative;
  display: inline;
}

.highlighted-text {
  background: linear-gradient(120deg, #ffeaa7 0%, #ffeaa7 100%);
  background-repeat: no-repeat;
  background-size: 100% 40%;
  background-position: 0 88%;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.highlighted-text:hover {
  background: linear-gradient(120deg, #fdcb6e 0%, #fdcb6e 100%);
  background-repeat: no-repeat;
  background-size: 100% 40%;
  background-position: 0 88%;
}

/* 批注气泡 */
.annotation-tooltip {
  position: fixed;
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 12px;
  max-width: 300px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1500;
}

.tooltip-content {
  font-size: 14px;
  color: #333;
  margin-bottom: 8px;
  line-height: 1.5;
}

.tooltip-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: #999;
  border-top: 1px solid #eee;
  padding-top: 8px;
}

.tooltip-edit-btn {
  background: none;
  border: none;
  color: #3eaf7c;
  cursor: pointer;
  font-size: 12px;
  padding: 0;
}

.tooltip-edit-btn:hover {
  text-decoration: underline;
}

.tooltip-arrow {
  position: absolute;
  top: -6px;
  left: 20px;
  width: 0;
  height: 0;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-bottom: 6px solid white;
}

/* 批注面板 */
.annotation-panel {
  position: fixed;
  left: 20px;
  bottom: 20px;
  z-index: 1001;
}

.panel-toggle {
  background: #3eaf7c;
  color: white;
  border: none;
  padding: 12px 20px;
  border-radius: 24px;
  font-size: 14px;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  transition: all 0.3s ease;
  position: relative;
  z-index: 1003;
}

.panel-toggle:hover {
  background: #369b6e;
  transform: translateY(-2px);
}

.panel-toggle.active {
  background: #2d8a63;
}

.panel-toggle-disabled {
  opacity: 0.4;
  cursor: not-allowed !important;
}

.panel-toggle-disabled:hover {
  background: #3eaf7c;
  transform: none;
}

.panel-content {
  position: absolute;
  bottom: 60px;
  left: 0;
  width: 320px;
  max-height: 70vh;
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
  overflow-y: auto;
  z-index: 1002;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid #eee;
}

.panel-header h3 {
  margin: 0;
  font-size: 16px;
  color: #2c3e50;
}

.close-panel {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: #999;
}

.panel-stats {
  padding: 16px;
  background: #f9f9f9;
  font-size: 14px;
  color: #666;
}

.panel-stats p {
  margin: 4px 0;
}

.panel-actions {
  padding: 12px 16px;
  display: flex;
  gap: 8px;
  border-bottom: 1px solid #eee;
}

.action-btn {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: white;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s ease;
}

.action-btn:hover {
  background: #f5f5f5;
  border-color: #3eaf7c;
}

.action-btn.primary {
  background: #3eaf7c;
  color: white;
  border-color: #3eaf7c;
}

.action-btn.primary:hover:not(:disabled) {
  background: #369b6e;
}

.action-btn.primary:disabled {
  background: #8fd1a8;
  border-color: #8fd1a8;
  cursor: not-allowed;
  opacity: 0.8;
}

.action-btn.danger {
  color: #ff4d4f;
  border-color: #ff4d4f;
}

.action-btn.danger:hover {
  background: #fff1f0;
}

.panel-annotations {
  max-height: calc(100vh - 200px);
  overflow-y: auto;
}

.panel-annotation-item {
  padding: 10px 16px;
  border-bottom: 1px solid #f0f0f0;
  transition: background 0.2s ease;
}

.panel-annotation-item:hover {
  background: #fafafa;
}

.item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.item-page {
  font-size: 11px;
  color: #3eaf7c;
  font-weight: 500;
}

.item-actions {
  display: flex;
  gap: 4px;
}

.item-btn {
  padding: 2px 6px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  opacity: 0.6;
  transition: opacity 0.2s;
}

.item-btn:hover {
  opacity: 1;
}

.item-btn.danger:hover {
  background: #fff1f0;
  border-radius: 2px;
}

.item-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.item-text {
  font-size: 12px;
  color: #333;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.item-note {
  font-size: 12px;
  color: #666;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.item-time {
  font-size: 11px;
  color: #999;
}

.panel-empty {
  padding: 32px 16px;
  text-align: center;
  color: #999;
  font-size: 14px;
}

.panel-empty .hint {
  font-size: 12px;
  margin-top: 8px;
  color: #bbb;
}

/* 过渡动画 */
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from, .fade-leave-to {
  opacity: 0;
}

.dialog-fade-enter-active, .dialog-fade-leave-active {
  transition: opacity 0.3s ease;
}

.dialog-fade-enter-from, .dialog-fade-leave-to {
  opacity: 0;
}

.tooltip-fade-enter-active, .tooltip-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.tooltip-fade-enter-from, .tooltip-fade-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

.slide-left-enter-active, .slide-left-leave-active {
  transition: all 0.3s ease;
}

.slide-left-enter-from, .slide-left-leave-to {
  opacity: 0;
  transform: translateX(-20px);
}
</style>
