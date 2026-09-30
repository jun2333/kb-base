<script setup>
import DefaultTheme from 'vitepress/theme'
import AnnotationSystem from './components/AnnotationSystem.vue'
import AIChat from './components/AIChat.vue'
import ManagePanel from './components/ManagePanel.vue'
import ToastHost from './components/ToastHost.vue'

const { Layout } = DefaultTheme

// 生产环境隐藏：后端服务未部署，批注 / AI 助手 / 内容管理相关接口不可用
// （内容管理会写文件，生产站点更不该暴露）
const isProd = import.meta.env.PROD
</script>

<template>
  <Layout>
    <template #layout-bottom>
      <AnnotationSystem v-if="!isProd" />
      <AIChat v-if="!isProd" />
      <ManagePanel v-if="!isProd" />
      <ToastHost v-if="!isProd" />
    </template>
  </Layout>
</template>
