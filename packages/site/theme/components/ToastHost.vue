<script setup lang="ts">
import { useToast } from '../composables/useToast.ts'

// toast 的渲染宿主：全站就这一个（挂在 Layout 上），渲染时 teleport 到 body，
// 固定在整个网页的右上角，跟任何面板无关（面板再大也不会把 toast 拖进去）。

const { items, dismiss } = useToast()
</script>

<template>
  <Teleport to="body">
    <div class="kb-toasts">
      <TransitionGroup name="kb-toast">
        <div
          v-for="t in items"
          :key="t.id"
          class="kb-toast"
          :class="`kb-toast-${t.kind}`"
          :title="'点击关闭'"
          @click="dismiss(t.id)"
        >
          {{ t.message }}
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
