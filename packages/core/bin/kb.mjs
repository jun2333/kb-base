#!/usr/bin/env node
// 免构建启动：注册 tsx 的 TS 加载器后，动态 import TS 源码。
// （发布 npm 前会切换为 tsc 产出的 dist/cli.js）
import { register } from 'tsx/esm/api'

register()
await import('../src/cli.ts')
