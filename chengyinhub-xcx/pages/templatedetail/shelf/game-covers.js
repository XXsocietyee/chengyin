// L06-169:玩法标题 → 包内封面的单表。货架(art.js)与玩法详情页共用;详情页只要封面,不必装整份货架编排。
const gameCoverSrc = (slug) => '/pages/templatedetail/art/covers/game/' + slug + '.jpg';

// 标题 → [道具/封面文件名, 分组, 一行短介绍]。只有这 25 个上货架(业主 2026-10-27 定的保留清单)。
const GAMES = {
  '今晚的暗号': ['secret-code', 'shop', '说出暗号拿奖励'],
  '老板的秘密题': ['secret-question', 'shop', '答对店铺小问题'],
  '拍下这一刻': ['photo-moment', 'city', '一张照片过关'],
  '收集这枚风味印章': ['flavor-stamp', 'shop', '到店集印章'],
  '新品盲测局': ['blind-test', 'shop', '抢先试新品'],
  '今日搭配任务': ['style-mission', 'shop', '搭出今日风格'],
  '集合点亮': ['gather', 'team', '到点领身份'],
  '小队竞速点亮': ['team-race', 'team', '抢先点亮目标'],
  '街角谜题': ['street-puzzle', 'city', '找线索解暗号'],
  '城市取景任务': ['city-camera', 'city', '按主题拍一张'],
  '城市接力棒': ['relay', 'team', '解题传给下一队'],
  '今日角色任务': ['role-mission', 'team', '抽身份做任务'],
  '招牌菜限时盲猜': ['signature-dish', 'shop', '限时猜菜名'],
  '咖啡风味人格': ['coffee-personality', 'shop', '两题测风味'],
  '分支故事接力': ['branch-story', 'team', '轮流讲故事'],
  '细节观察挑战': ['detail-observation', 'city', '90 秒找细节'],
  '一桌任务宾果': ['table-bingo', 'team', '同桌破冰'],
  '小队能量接力': ['team-energy', 'team', '小队答题接力'],
  '闭眼味觉师': ['blind-taste', 'shop', '闭眼猜味道'],
  '沉默点单': ['silent-order', 'shop', '不说话点单'],
  '便利店调酒师': ['diy-drink', 'shop', '调一杯起个名'],
  '治愈音乐角': ['music-corner', 'shop', '听完一首歌'],
  '午夜电台': ['midnight-radio', 'shop', '只在深夜开放'],
  '低碳行动': ['low-carbon', 'city', '步数换爪印'],
  '今日城市签': ['daily-city-sign', 'city', '每天一张签']
};

function gameCover(title) {
  const row = GAMES[String(title || '').trim()];
  return row ? gameCoverSrc(row[0]) : '';
}

module.exports = { GAMES, gameCoverSrc, gameCover };
