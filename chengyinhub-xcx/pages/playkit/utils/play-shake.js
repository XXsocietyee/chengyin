// L02-026:计数在主包那一份。分包之间不能同步 require,硬币 / 骰子 / 弹球仍从这里拿,和藏品卡是同一个计数。
module.exports = require('../../../utils/play-shake.js');
