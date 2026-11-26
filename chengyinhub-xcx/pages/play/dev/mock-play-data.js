'use strict';
// 游玩页开发版演示数据(?mock=city|free,仅 app.isDevEnv() 时由 pages/play/index.js 按需 require)。
// AUDIT-1122 L01-066:原样从 index.js 移出,内容未改。
function buildMockPlayData(kind) {
  const free = kind !== 'city';
  const nodes = [
    {
      nodeId: 1001, sortId: 1, name: '街角绿地补给点', address: '复兴公园南门',
      latitude: 31.21784, longitude: 121.46423, imgUrl: '/pages/play/images/d_topic1.png',
      description: '找到最安静的一张长椅，拍下今天的城市颜色。', hookText: '离你最近，适合先热身',
      cardHookLong: '这里不需要按路线走，靠近后完成一次观察打卡。', validationMethod: 2,
      gameTitle: '城市颜色采样', photoRequireDesc: '拍一张能代表此刻心情的城市细节', storyText: '树影、路灯和行人的脚步，会把城市切成很多层。',
      fragmentText: '你拿到了一枚「午后光斑」。'
    },
    {
      nodeId: 1002, sortId: 2, name: '梧桐下的橱窗', address: '思南路街区',
      latitude: 31.21932, longitude: 121.46716, imgUrl: '/pages/play/images/d_topic2.png',
      description: '观察一处橱窗或门牌，找出它和这条街的关系。', hookText: '有合作商家标记', merchantId: 10001,
      cardHookLong: '如果正在营业，可以把这里当成路线中的停靠点。', validationMethod: 1,
      gameTitle: '门牌线索', question: '这条街最常出现的树是什么？', answerReveal: '梧桐', feedbackText: '答案藏在抬头能看到的树冠里。',
      fragmentText: '你拿到了一枚「旧街门牌」。'
    },
    {
      nodeId: 1003, sortId: 3, name: '隐蔽展墙', address: '淮海中路支弄',
      latitude: 31.22224, longitude: 121.47042, imgUrl: '/pages/play/images/d_topic4.png',
      description: '进入支弄，找到一面被海报或涂鸦覆盖的墙。', hookText: '更适合自由绕路发现',
      cardHookLong: '不是必经站，但完成后会解锁一段城市手记。', validationMethod: 5,
      storyText: '支弄里的墙面会保存很多短暂出现过的生活痕迹。', fragmentText: '你拿到了一枚「支弄回声」。'
    },
    {
      nodeId: 1004, sortId: 4, name: '黄昏观景口', address: '新天地北里',
      latitude: 31.22458, longitude: 121.47518, imgUrl: '/pages/play/images/d_topic4.png',
      description: '在天色变化时停留两分钟，记录你看到的城市边界。', hookText: '适合终点收束',
      cardHookLong: '城市定向模式里，这里会作为最后一站。', validationMethod: 3,
      gameTitle: '黄昏选择题', question: '此刻更适合记录什么？', options: { A: '灯光', B: '声音', C: '人流' }, answerReveal: '都可以，关键是停下来观察。',
      fragmentText: '你拿到了一枚「黄昏切面」。'
    }
  ];
  return {
    topicId: free ? 'mock-free-explore' : 'mock-city-route',
    topicName: free ? '自由探索 · 城市附近发现' : '城市定向 · 复兴路微路线',
    mode: free ? 2 : 1,
    selfPlay: free,
    expiresAt: Date.now() + 7 * 24 * 3600 * 1000,
    chapters: [{
      idxLabel: free ? '附近探索' : '第一章',
      name: free ? '今天先从附近开始' : '顺着旧街走到黄昏',
      description: free ? '没有固定路线，挑一个想去的节点出发，完成附近观察打卡。' : '按推荐顺序走完四站，把线索串成一段完整城市故事。',
      cover: '/pages/play/images/d_topic5.png', totalMileage: free ? 1.8 : 2.4, totalTime: free ? 2700 : 3600
    }],
    nodes
  };
}

module.exports = { buildMockPlayData };
