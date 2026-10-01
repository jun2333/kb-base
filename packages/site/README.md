# @minijun/kb-site

本地知识库基座的**站点包**：VitePress 主题 + 站点配置派生。

- **主题**：AI 助手（聊天面板 / SSE 解析）、批注系统（选中文本加批注，存 LocalStorage）、
  内容管理面板（导入 / 归档 / 索引状态）、Mermaid 渲染、共享的遮罩与 toast
- **配置派生**（`defineSite`）：从 `knowledge.config.mjs` 与 `menu.config.mjs` 派生出 VitePress 的
  `base` / `nav` / `sidebar` / `search` / 死链策略 / 「仅本地」内容过滤

## 谁在用

**正常不用手动装它** —— `npx kb init`（来自 [`@minijun/kb-core`](https://www.npmjs.com/package/@minijun/kb-core)）
会把 `@minijun/kb-core` 和本包一起写进实例的 `package.json`。实例侧只有两处引用：

```js
// docs/.vitepress/config.mts
import { defineSite } from '@minijun/kb-site'
import { loadMenu } from '@minijun/kb-site/config/menu.mjs'
export default defineSite({ config: instanceConfig, menu, metaUrl: import.meta.url, ... })
```

```js
// docs/.vitepress/theme/index.js —— 想定制主题就在这一层包一层再导出
export { default } from '@minijun/kb-site/theme'
```

## 菜单与侧边栏：默认推导，可一键接管

- **不给配置**：一级目录 = 菜单一项 + **一份完整侧边栏**（整棵子树都在里面，子目录只是嵌套分组）。
  子目录**不单独成 sidebar key** —— VitePress 按最长前缀匹配，子目录自成 key 会让父侧边栏在点进去时整棵消失。
- **给 `menu.config.mjs`**（`pnpm kb menu:export` 生成）：完全按它渲染，不做任何兜底。
- **「仅本地」内容**（`site.onlyLocal`）：与菜单解耦的**内容策略**，一份数据派生
  `srcExclude` / 菜单与侧边栏过滤 / `ignoreDeadLinks`。

## 开发提示

本包没有构建步骤 —— 发布的就是 `.mjs` / `.vue` 源码，由**消费者侧**的 Vite 编译。

> ⚠️ 改了 `config/**` 或主题后，实例要**重启 `pnpm dev`** 才生效（只有客户端组件走 HMR，
> 站点配置不在 VitePress 的监听清单里）。

## 文档

仓库与完整说明：<https://github.com/jun2333/kb-base>

## License

MIT
