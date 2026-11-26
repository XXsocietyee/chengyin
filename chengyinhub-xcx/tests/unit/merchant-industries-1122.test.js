const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

// 2026-11-22:商家行业补七类(餐饮小吃 / 运动健身 / 娱乐休闲 / 服饰鞋包 / 摄影写真 / 现场音乐 / 亲子游乐)。
// 自由探索模板的位置要这些店,行业表里没有它们就报不了名。

const ROOT = path.resolve(__dirname, '../..')
const NEW_NAMES = ['餐饮小吃', '运动健身', '娱乐休闲', '服饰鞋包', '摄影写真', '现场音乐', '亲子游乐']

// /api/category/list type=MERCHANT 的真实形状:主题类别(type 1)在前,商家行业(type 6)在后。
const THEME = ['城市漫步', '历史人文', '美食探店', '解谜冒险', '夜游', '摄影打卡', '艺术展览', '城市运动', '户外徒步', '亲子同行', '娱乐休闲', '生活美学']
const INDUSTRY = ['咖啡茶饮', '茶馆', '书店', '手作工坊', '古着中古', '文创杂货', '花店', '烘焙甜品', '酒馆小酌', '宠物友好',
  '餐饮小吃', '运动健身', '服饰鞋包', '摄影写真', '现场音乐', '亲子游乐']
const rows = THEME.concat(INDUSTRY).map((categoryName, i) => ({ id: 100 + i, categoryName }))

test('迁移:七类只进 type=6,同类关键字已有在用记录就跳过,逐个关键字回读', () => {
  const sql = fs.readFileSync(path.join(ROOT, '../chengyinhub-admin/sql/migration_20261122_merchant_industries_more.sql'), 'utf8')
  for (const name of NEW_NAMES) assert.ok(sql.includes("'" + name + "'"), name)
  assert.match(sql, /SELECT 6, 0, n\.name/)
  assert.doesNotMatch(sql, /\b(UPDATE|DELETE|ALTER|DROP)\b/, '只新增,不改不删现有行')
  assert.match(sql, /WHERE NOT EXISTS \(SELECT 1 FROM sys_category c WHERE c\.type IN \(1, 6\)/)
  assert.match(sql, /-- runner: assert=scalar-true/)
  assert.match(sql, /\) = 7\s+AS merchant_industries_more_ready;/)
  const sortIds = (sql.match(/'[^']+'(?: AS name)?, (\d+)(?: AS sort_id)?, '/g) || []).map(s => Number(/, (\d+)/.exec(s)[1]))
  assert.deepEqual(sortIds, [31, 32, 33, 34, 35, 36, 37], '排在原十行(21-30)之后')
  const deps = JSON.parse(fs.readFileSync(path.join(ROOT, '../ci/migration-dependencies.json'), 'utf8')).dependencies
  assert.deepEqual(deps['20261122_merchant_industries_more'], ['20261102_merchant_industry_categories'])
})

test('入驻 / 门店信息的行业胶囊:七类各自出现,且认领的是新行业那一行', () => {
  const { buildIndustryOptions } = require('../../pages/merchant/utils/merchant-industry.js')
  const options = buildIndustryOptions(rows, [])
  const byLabel = {}
  options.forEach(o => { byLabel[o.label] = o.name })
  for (const name of NEW_NAMES) assert.equal(byLabel[name], name, name)
  // 同类的主题类别照旧可选,不被新行业挤掉
  assert.equal(byLabel['餐饮美食'], '美食探店')
  assert.equal(byLabel['城市运动'], '城市运动')
  assert.equal(byLabel['摄影'], '摄影打卡')
  assert.equal(byLabel['亲子社交'], '亲子同行')
  // 原十行一行不少
  for (const name of ['咖啡茶饮', '茶馆', '书店', '手作工坊', '古着中古', '文创杂货', '花店', '烘焙甜品', '酒馆小酌', '宠物友好']) {
    assert.equal(byLabel[name], name, name)
  }
  assert.equal(new Set(options.map(o => o.key)).size, options.length, '一条记录只出一个胶囊')
  assert.equal(new Set(options.map(o => o.label)).size, options.length, '胶囊名不重复')
})

test('只有老名字的库:「运动健身」「美食烹饪」照旧认领', () => {
  const { buildIndustryOptions } = require('../../pages/merchant/utils/merchant-industry.js')
  const labels = buildIndustryOptions([{ id: 11, categoryName: '美食烹饪' }, { id: 12, categoryName: '运动健身' }], []).map(o => o.label)
  assert.deepEqual(labels, ['餐饮美食', '运动健身'])
})

test('七类都有图标:行业胶囊与地图 / 列表品类图标', () => {
  const { tagIconName } = require('../../pages/merchant/components/cy/tag-sheet/model.js')
  const { resolveCategoryIcon } = require('../../utils/category-icon.js')
  // L07-017(业主 11-24 默认 A):胶囊图标统一走个人主页那套规则;「服饰鞋包」在那套里没有图标
  assert.deepEqual(NEW_NAMES.map(tagIconName), ['noodles', 'sport', 'game-handle', '', 'camera', 'music', 'baby'])
  assert.deepEqual(NEW_NAMES.map(resolveCategoryIcon),
    ['category-food', 'category-fitness', 'play-filled', 'category-clothing', 'camera', 'play-filled', 'mtab-customers'])
})

test('章节招募品类与商家地图筛选直接读 type=MERCHANT,不走写死的名单', () => {
  const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')
  assert.match(read('pages/publish/fabu/index.js'), /data: \{ type: 'MERCHANT', parentid: '0' \}/)
  assert.match(read('pages/searchmap/index.wxml'), /<cy-category-sheet show="\{\{merchantCategorySheetVisible\}\}" type="MERCHANT"/)
  assert.match(read('pages/merchant/apply/index.js'), /data: \{ type: 'MERCHANT', parentid: '0' \}/)
  assert.match(read('pages/merchant/decor/index.js'), /data:\{type:'MERCHANT',parentid:0\}/)
})
