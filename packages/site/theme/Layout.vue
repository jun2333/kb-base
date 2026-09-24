<script setup>
import DefaultTheme from 'vitepress/theme'
import AnnotationSystem from './components/AnnotationSystem.vue'
import AIChat from './components/AIChat.vue'

const { Layout } = DefaultTheme

// 生产环境隐藏：后端服务未部署，批注 / AI 助手相关接口不可用
const isProd = import.meta.env.PROD
</script>

<template>
  <Layout>
    <template #layout-bottom>
      <AnnotationSystem v-if="!isProd" />
      <AIChat v-if="!isProd" />
    </template>
  </Layout>
</template>
