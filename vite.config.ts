import { fileURLToPath, URL } from 'node:url'

import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import Icons from 'unplugin-icons/vite'
import IconsResolver from 'unplugin-icons/resolver'
import vueDevTools from 'vite-plugin-vue-devtools'
import { visualizer } from 'rollup-plugin-visualizer'

// 全流程工具链核心配置文件：开发 / 构建 / 代理 / 分析 都在这里统一挂载
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const isAnalyze = mode === 'analyze'

  return {
    plugins: [
      vue(),
      // Tailwind CSS v4 通过 postcss.config.js 接入（见该文件）
      // 自动导入 Vue / Router / Pinia API，减少样板 import
      AutoImport({
        imports: ['vue', 'vue-router', 'pinia'],
        resolvers: [ElementPlusResolver({ importStyle: false })],
        dts: 'src/auto-imports.d.ts',
        eslintrc: { enabled: false },
      }),
      // 组件自动注册：Element Plus 按需 + 本地组件 + 图标
      Components({
        resolvers: [
          ElementPlusResolver({ importStyle: false }),
          IconsResolver({ prefix: 'i', enabledCollections: ['ep'] }),
        ],
        dirs: ['src/components'],
        dts: 'src/components.d.ts',
      }),
      Icons({ compiler: 'vue3', autoInstall: false }),
      // 开发期 Vue DevTools 面板
      mode === 'development' && vueDevTools(),
      // 包体积分析：pnpm build:analyze
      isAnalyze &&
        visualizer({
          filename: 'stats.html',
          template: 'treemap',
          gzipSize: true,
          brotliSize: true,
        }),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      host: '127.0.0.1',
      port: 5173,
      open: false,
      // 后端联调代理（默认指向本地 Spring Boot）
      proxy: {
        '/api': {
          target: env.VITE_API_PROXY || 'http://127.0.0.1:8080',
          changeOrigin: true,
          // 后端 CORS 白名单只含 5173，本 worktree 固定 5174：
          // 去掉 Origin 让代理请求以同源身份到达后端，避免 POST 预检被 403
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.removeHeader('origin')
              proxyReq.removeHeader('referer')
            })
          },
        },
      },
    },
    preview: {
      host: '127.0.0.1',
      port: 4173,
      // 预览也要代理 /api：E2E 跑在 4173，没有代理时后台登录/审核全部 404，
      // 前端会静默回退本地种子，测出来的不是真实行为
      proxy: {
        '/api': {
          target: env.VITE_API_PROXY || 'http://127.0.0.1:8080',
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.removeHeader('origin')
              proxyReq.removeHeader('referer')
            })
          },
        },
      },
    },
    build: {
      target: 'es2022',
      // production 下生成 hidden sourcemap，便于 Sentry 上传后还原堆栈
      sourcemap: mode === 'production' ? 'hidden' : true,
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          // rolldown（Vite 8 内核）只接受函数式分包策略
          manualChunks(rawId: string) {
            const id = rawId.replace(/\\/g, '/')
            if (!id.includes('node_modules')) return
            if (id.includes('element-plus')) return 'vendor-ui'
            if (id.includes('/vue/') || id.includes('vue-router') || id.includes('pinia')) {
              return 'vendor-vue'
            }
            return 'vendor'
          },
        },
      },
    },
    define: {
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.1.0'),
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    },
  }
})
