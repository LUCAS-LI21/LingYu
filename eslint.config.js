import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'docs/.vitepress/cache/**',
      'docs/.vitepress/dist/**',
      'src/auto-imports.d.ts',
      'src/components.d.ts',
      'stats.html',
      // 侦察/验证产物与抓取快照，不是源码
      '.verify_tmp/**',
      '.dsh-tmp/**',
      'data/**',
      'scripts/_recon-out/**',
      'scripts/probe-out/**',
      'scripts/probe-*.mjs',
      'batch-agent.mjs',
      'crawl-*.mjs',
      '*.token',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
      },
    },
    rules: {
      // 页面组件用单文件命名是常态
      'vue/multi-word-component-names': 'off',
      // TS 已做类型检查，no-undef 只会误伤自动导入
      'no-undef': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      'vue/attributes-order': 'off',
    },
  },
  prettier,
)
