'use strict';
/* ESLint —— 小规则集,全部 warn(AUDIT-1122 F2,2026-11-22)
 *
 * 目的:让 CI 看见常见缺陷的数量,不拦合并。规则一律 'warn',CI 步骤不设 --max-warnings。
 * 新增规则同样只能是 'warn';要升级成 'error' 须先把存量清零并单独评审。
 * 本文件已写进 project.config.json packOptions.ignore,不会进小程序包。
 * 本机:npm run lint:eslint
 */
const RULES = {
  'no-undef': 'warn',
  'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
  'no-unreachable': 'warn',
  'no-dupe-keys': 'warn',
  'no-duplicate-case': 'warn',
  'no-dupe-else-if': 'warn',
  'no-self-assign': 'warn',
  'no-fallthrough': 'warn',
  'no-empty': ['warn', { allowEmptyCatch: false }],
  'no-unsafe-finally': 'warn',
  'use-isnan': 'warn',
  'valid-typeof': 'warn',
};

const COMMON = {
  console: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
  setInterval: 'readonly', clearInterval: 'readonly',
  require: 'readonly', module: 'writable', exports: 'writable',
};

const MINIPROGRAM = Object.assign({}, COMMON, {
  wx: 'readonly', App: 'readonly', Page: 'readonly', Component: 'readonly', Behavior: 'readonly',
  getApp: 'readonly', getCurrentPages: 'readonly', requirePlugin: 'readonly', requireMiniProgram: 'readonly',
  __wxConfig: 'readonly', worklet: 'readonly',
});

const NODE = Object.assign({}, COMMON, {
  process: 'readonly', Buffer: 'readonly', __dirname: 'readonly', __filename: 'readonly',
  global: 'readonly', globalThis: 'readonly', setImmediate: 'readonly', URL: 'readonly',
  TextEncoder: 'readonly', TextDecoder: 'readonly', fetch: 'readonly', structuredClone: 'readonly',
});

module.exports = [
  { ignores: ['node_modules/**', 'artifacts/**', '.mcp-artifacts/**', 'docs/**', 'miniprogram_npm/**'] },
  {
    files: ['**/*.js'],
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: MINIPROGRAM },
    rules: RULES,
  },
  {
    files: ['scripts/**/*.js', 'tests/**/*.js', 'eslint.config.js'],
    languageOptions: { globals: NODE },
  },
];
