// 模板页货架的包内图与编排(2026-10-28 业主定稿原型 v21)。
// 图全部放在本分包 art/ 下：主包已超棘轮,服务端 profile 静态目录要人工上传,
// 包内图打开就能显示，不依赖接口回来的 imgUrl。
// 来源与许可：
//   · props/:Polyfork 低多边形模型的商店渲染图抠图(免费、可商用、免署名，不得转售模型文件);
//   · covers/game/ 有照片的 8 张：Openverse CC0 照片;其余为同一套道具 + 纯色底的合成封面;
//   · covers/topic/:仓库 assets/covers/topic-templates 既有封面 + 2 张 CC0/PDM 照片
//     (城市藏宝猎人 = Flickr「Shanghai Bund」CC0,生活不掉线 = Flickr「Spin City Laundromat」PDM)。
//   · covers/topic/ 自由探索九套(2026-11-22,Wikimedia Commons,仅裁切缩放;业主:画面干净、尽量无人):
//     风味巡游 LR0725 CC BY-SA 4.0、一起动起来 iMahesh CC BY-SA 4.0、咖啡散步 Bex Walton CC BY 2.0、茶里偷闲 Kandukuru Nagarjun CC BY 2.0、
//     周末做点东西 Whippetsgalore CC BY-SA 4.0、今天认真约会 freestocks CC0、朋友别只在群里 Jason M. C., Han CC BY-SA 4.0(裁去手部)、
//     穿出新心情 TWS LUOK Mingaowpuo CC0(裁去店员与相机水印)、夜猫子城市生活 lumoplank CC0。
// 主题按名称、玩法按标题绑定(种子重跑 id 会漂,所以不按 id)。

const BASE = '/pages/templatedetail/art/';
const propSrc = (slug) => BASE + 'props/' + slug + '.png';
const topicCoverSrc = (slug) => BASE + 'covers/topic/' + slug + '.jpg';

const GROUPS = [
  { key: 'shop', name: '到店互动', color: '#FF9F0A' } /* ds-ok 原型分组色 */,
  { key: 'team', name: '小队协作', color: '#0A84FF' } /* ds-ok 原型分组色 */,
  { key: 'city', name: '城市探索', color: '#30D158' } /* ds-ok 原型分组色 */
];

const { GAMES, gameCoverSrc } = require('./game-covers.js');

// 玩法 tab 顶部大卡：推荐语(白色首句 + 灰色后半，最多两行)、封面底部渐变取色。
const FEATURED_GAMES = [
  ['一桌任务宾果', '三项任务，一桌人。', '等餐时抽三张卡，同桌一起完成。', '#2f3636'],
  ['分支故事接力', '轮到你讲下一段。', '2–4 人接力，故事走向由你们决定。', '#423c23'],
  ['招牌菜限时盲猜', '60 秒猜出招牌。', '看三条线索，抢先说出店里的招牌菜。', '#4e4a4a'],
  ['闭眼味觉师', '闭上眼，尝一口。', '从四个选项里猜出杯里是什么。', '#764a22'],
  ['城市取景任务', '拍下今天的城市。', '按主题找画面，一张照片就过关。', '#483933'],
  ['小队竞速点亮', '谁先到，谁点亮。', '和队友分头出发，抢先点亮目标点。', '#262f3f'],
  ['拍下这一刻', '把这一刻拍下来。', '一张照片，完成今天的城市任务。', '#392b3a'],
  ['咖啡风味人格', '测测你的咖啡人格。', '两道选择题，抽一张专属风味卡。', '#373d41']
];



// 主题名 → 封面文件名 + 卡片取色(封面主色,与原型同一算法预先算好)。
const THEMES = {
  '城市藏宝猎人': ['treasure-hunter', 'hsla(19,35%,34%,.85)'],
  '异常事务局：不存在的坐标': ['anomaly-coordinate', 'hsla(216,62%,34%,.85)'],
  '末日广播：最后一座中继站': ['apocalypse-broadcast', 'hsla(264,35%,34%,.85)'],
  '时间污染：被删除的今天': ['time-pollution', 'hsla(36,35%,34%,.85)'],
  '风味巡游': ['flavor-tour', 'hsla(31,35%,34%,.85)'],
  '不惑之年': ['midlife-day', 'hsla(97,35%,34%,.85)'],
  '预制人生': ['prebuilt-life', 'hsla(26,35%,34%,.85)'],
  '高温末日逃生': ['heat-escape', 'hsla(209,35%,34%,.85)'],
  '上海像一部旧电影': ['old-movie', 'hsla(211,35%,34%,.85)'],
  '生活不掉线': ['life-backup', 'hsla(199,35%,34%,.85)'],
  // 2026-11-22 自由探索九套(业主:模板图不对、画面要干净少人)——服务端 imgUrl 依赖 OSS 签名，失败即落空态图标，改为包内图
  '一起动起来': ['fe-move', 'hsla(27,35%,34%,.85)'],
  '咖啡散步': ['fe-coffee', 'hsla(21,35%,34%,.85)'],
  '茶里偷闲': ['fe-tea', 'hsla(26,35%,34%,.85)'],
  '周末做点东西': ['fe-craft', 'hsla(17,35%,34%,.85)'],
  '今天认真约会': ['fe-date', 'hsla(215,35%,34%,.85)'],
  '朋友别只在群里': ['fe-friends', 'hsla(36,35%,34%,.85)'],
  '穿出新心情': ['fe-style', 'hsla(20,35%,34%,.85)'],
  '夜猫子城市生活': ['fe-night', 'hsla(20,35%,34%,.85)']
};

// ===== 标签(业主 2026-10-28:按类型等多个维度分类;「场景」维度不要)=====
// 一个主题 / 玩法可以挂多个标签;没有内容的标签自动不出现，等有内容再露出。
// 横滑行只放 ROW 里那几个，其余进「全部分类」半屏，按组列出。
const byNames = (names) => (t) => names.indexOf(t.key) >= 0;
const byTitles = (titles) => (g) => titles.indexOf(g.title) >= 0;
const FREE_EXPLORE = ['风味巡游', '不惑之年', '预制人生', '高温末日逃生', '上海像一部旧电影'];
const STORIES = ['城市藏宝猎人', '异常事务局：不存在的坐标', '末日广播：最后一座中继站', '时间污染：被删除的今天'];

const TOPIC_TAG_GROUPS = [
  { name: '类型', tags: [
    { key: 'explore', name: '城市探索', icon: 'cat-city', test: byNames(FREE_EXPLORE.filter((n) => n !== '高温末日逃生')) },
    { key: 'story', name: '剧情叙事', icon: 'tag-story', test: byNames(STORIES) },
    { key: 'survival', name: '生存逃脱', icon: 'tag-firstaid', test: byNames(['末日广播：最后一座中继站', '高温末日逃生', '异常事务局：不存在的坐标']) },
    { key: 'puzzle', name: '解谜推理', icon: 'tag-puzzle', test: byNames(['城市藏宝猎人', '异常事务局：不存在的坐标', '时间污染：被删除的今天']) },
    { key: 'life', name: '生活实用', icon: 'cat-life', test: byNames(['生活不掉线']) }
  ] },
  { name: '风格', tags: [
    { key: 'scifi', name: '科幻异常', icon: 'cat-scifi', test: byNames(['异常事务局：不存在的坐标', '末日广播：最后一座中继站', '时间污染：被删除的今天']) },
    { key: 'nostalgia', name: '怀旧人文', icon: 'tag-lamp', test: byNames(['上海像一部旧电影', '城市藏宝猎人', '时间污染：被删除的今天']) },
    { key: 'calm', name: '治愈放松', icon: 'cat-indoor', test: byNames(['不惑之年', '预制人生']) }
  ] },
  { name: '适合谁', tags: [
    { key: 'solo', name: '一个人', icon: 'cat-solo', test: (t) => t.key && t.key !== '生活不掉线' },
    { key: 'date', name: '约会', icon: 'tag-balloon', test: byNames(['上海像一部旧电影', '风味巡游']) },
    { key: 'newcomer', name: '初来上海', icon: 'tag-suitcase', test: byNames(['风味巡游', '城市藏宝猎人', '上海像一部旧电影']) },
    { key: 'local', name: '本地居民', icon: 'tag-local', test: byNames(['生活不掉线', '预制人生']) }
  ] },
  { name: '时长', tags: [
    { key: 't1h', name: '一小时内', icon: 'tag-clock1', test: (t) => t.seconds > 0 && t.seconds <= 3600 },
    { key: 't2h', name: '两小时内', icon: 'cat-quick', test: (t) => t.seconds > 3600 && t.seconds <= 7200 },
    { key: 'halfday', name: '半天', icon: 'tag-clocktower', test: (t) => t.seconds > 7200 },
    { key: 'multiday', name: '可以跨天', icon: 'tag-tent', test: byNames(FREE_EXPLORE) }
  ] }
];
const TOPIC_ROW = ['explore', 'story', 'survival', 'puzzle', 'scifi', 'nostalgia', 'solo', 't2h'];

const GAME_TAG_GROUPS = [
  { name: '用途', tags: [
    { key: 'promo', name: '营销引流', icon: 'tag-promo', test: byTitles(['今晚的暗号', '老板的秘密题', '收集这枚风味印章', '新品盲测局', '招牌菜限时盲猜', '咖啡风味人格']) },
    { key: 'plugin', name: '插件玩法', icon: 'tag-map', test: byTitles(['拍下这一刻', '集合点亮', '今日角色任务', '城市接力棒', '今日城市签', '午夜电台', '治愈音乐角']) },
    { key: 'icebreak', name: '社交破冰', icon: 'tag-icebreak', test: byTitles(['一桌任务宾果', '分支故事接力', '便利店调酒师', '今日搭配任务']) },
    { key: 'teambuild', name: '团建', icon: 'tag-teambuild', test: byTitles(['小队能量接力', '小队竞速点亮', '一桌任务宾果', '分支故事接力']) }
  ] },
  { name: '玩法', tags: [
    { key: 'riddle', name: '解谜', icon: 'tag-puzzle', test: byTitles(['街角谜题', '今晚的暗号', '老板的秘密题', '细节观察挑战']) },
    { key: 'quiz', name: '问答抢答', icon: 'tag-quiz', test: byTitles(['老板的秘密题', '招牌菜限时盲猜', '咖啡风味人格', '小队能量接力']) },
    { key: 'blind', name: '盲猜盲测', icon: 'tag-blind', test: byTitles(['闭眼味觉师', '新品盲测局', '招牌菜限时盲猜']) },
    { key: 'photo', name: '拍照打卡', icon: 'tag-photo', test: byTitles(['拍下这一刻', '城市取景任务']) },
    { key: 'relay', name: '接力', icon: 'tag-relay', test: byTitles(['城市接力棒', '分支故事接力', '小队能量接力']) },
    { key: 'roleplay', name: '角色扮演', icon: 'tag-roleplay', test: byTitles(['今日角色任务', '集合点亮']) },
    { key: 'collect', name: '收集', icon: 'tag-collect', test: byTitles(['收集这枚风味印章', '今日城市签']) },
    { key: 'silent', name: '无声挑战', icon: 'tag-silent', test: byTitles(['沉默点单']) }
  ] },
  { name: '题材', tags: [
    { key: 'sport', name: '运动', icon: 'tag-ball', test: byTitles(['低碳行动', '小队竞速点亮']) },
    { key: 'versus', name: '竞技对抗', icon: 'tag-trophy', test: byTitles(['小队竞速点亮', '小队能量接力', '招牌菜限时盲猜']) },
    { key: 'taste', name: '味觉', icon: 'tag-taste', test: byTitles(['闭眼味觉师', '便利店调酒师', '咖啡风味人格']) },
    { key: 'music', name: '音乐', icon: 'tag-music', test: byTitles(['治愈音乐角', '午夜电台']) },
    { key: 'fashion', name: '时尚', icon: 'tag-fashion', test: byTitles(['今日搭配任务']) }
  ] },
  { name: '适合的店', tags: [
    { key: 'cafe', name: '咖啡馆', icon: 'tag-cafe', test: byTitles(['咖啡风味人格', '闭眼味觉师', '治愈音乐角', '新品盲测局']) },
    { key: 'dining', name: '餐饮', icon: 'tag-dining', test: byTitles(['招牌菜限时盲猜', '一桌任务宾果', '沉默点单']) },
    { key: 'bar', name: '酒吧', icon: 'tag-bar', test: byTitles(['闭眼味觉师', '午夜电台', '便利店调酒师']) },
    { key: 'store', name: '便利店', icon: 'tag-vending', test: byTitles(['便利店调酒师', '沉默点单']) },
    { key: 'retail', name: '服饰零售', icon: 'tag-rack', test: byTitles(['今日搭配任务', '新品盲测局']) },
    { key: 'books', name: '书店唱片店', icon: 'tag-books', test: byTitles(['治愈音乐角']) },
    { key: 'street', name: '街头户外', icon: 'tag-pin', test: byTitles(['街角谜题', '城市取景任务', '低碳行动', '城市接力棒', '小队竞速点亮']) }
  ] },
  { name: '人数', tags: [
    { key: 'p1', name: '单人可玩', icon: 'cat-solo', test: (g) => /单人/.test(g.players || '') },
    { key: 'p2', name: '双人', icon: 'cat-multi', test: (g) => /双人|2-4/.test(g.players || '') },
    { key: 'p3', name: '小队', icon: 'tag-p3', test: (g) => /小队|2-4|同桌/.test(g.players || '') }
  ] },
  { name: '时间', tags: [
    { key: 'quick', name: '5 分钟内', icon: 'tag-quick', test: (g) => Number(g.duration) > 0 && Number(g.duration) <= 5 },
    { key: 'night', name: '深夜限定', icon: 'tag-night', test: byTitles(['午夜电台']) },
    { key: 'daily', name: '每日一次', icon: 'tag-daily', test: byTitles(['今日城市签', '今日搭配任务', '今日角色任务']) }
  ] },
  { name: '分区', tags: [
    { key: 'shop', name: '到店互动', icon: 'cat-shop', test: (g) => g._grp === 'shop' },
    { key: 'team', name: '小队协作', icon: 'cat-team', test: (g) => g._grp === 'team' },
    { key: 'city', name: '城市探索', icon: 'cat-city', test: (g) => g._grp === 'city' }
  ] }
];
const GAME_ROW = ['promo', 'plugin', 'riddle', 'sport', 'versus', 'icebreak', 'taste', 'quick'];

const flat = (groups) => groups.reduce((all, g) => all.concat(g.tags), []);
const TOPIC_TAGS = flat(TOPIC_TAG_GROUPS);
const GAME_TAGS = flat(GAME_TAG_GROUPS);

// 业主 2026-10-28:测试主题，不上货架(按名称，接口回来也不显示;数据库另有软删迁移)
const HIDDEN_TOPICS = ['野生邻居观察局'];

const FEATURED_TOPICS = ['异常事务局：不存在的坐标', '风味巡游', '末日广播：最后一座中继站', '上海像一部旧电影', '时间污染：被删除的今天', '城市藏宝猎人', '高温末日逃生'];

// 主题 tab「全部」下的横滑货架:[标题，判据]
const TOPIC_SHELVES = [
  ['两小时内玩完', (t) => t.seconds > 0 && t.seconds <= 7200],
  ['科幻异常', TOPIC_TAGS.find((t) => t.key === 'scifi').test],
  ['城市记忆', TOPIC_TAGS.find((t) => t.key === 'nostalgia').test],
  ['一个人也能玩', TOPIC_TAGS.find((t) => t.key === 'solo').test]
];

// 主题名可能带版本后缀(如「预制人生 · 四站试玩版」),先精确再按前缀认。
function themeKey(name) {
  const text = String(name || '').trim();
  if (THEMES[text]) return text;
  return Object.keys(THEMES).find((k) => text.indexOf(k) === 0) || '';
}

// 暂缓主题按名字(含版本后缀)认,不依赖 THEMES 里有没有封面(L06-047:暂缓主题的封面已不随包)。
function isHiddenTopic(name) {
  const text = String(name || '').trim();
  return HIDDEN_TOPICS.some((h) => text === h || text.indexOf(h) === 0);
}

function topicArt(name) {
  const key = themeKey(name);
  return key ? { key: key, cover: topicCoverSrc(THEMES[key][0]), glow: THEMES[key][1] } : null;
}

function gameArt(title) {
  const key = String(title || '').trim();
  const row = GAMES[key];
  if (!row) return null;
  const feat = FEATURED_GAMES.find((f) => f[0] === key);
  return {
    slug: row[0], grp: row[1], short: row[2],
    prop: propSrc(row[0]), cover: gameCoverSrc(row[0]),
    lead: feat ? feat[1] : '', rest: feat ? feat[2] : '', tint: feat ? feat[3] : ''
  };
}

module.exports = {
  GROUPS, GAMES, FEATURED_GAMES, THEMES, FEATURED_TOPICS, TOPIC_SHELVES, HIDDEN_TOPICS, isHiddenTopic,
  TOPIC_TAG_GROUPS, TOPIC_TAGS, TOPIC_ROW, GAME_TAG_GROUPS, GAME_TAGS, GAME_ROW,
  propSrc, gameCoverSrc, topicCoverSrc, themeKey, topicArt, gameArt
};
