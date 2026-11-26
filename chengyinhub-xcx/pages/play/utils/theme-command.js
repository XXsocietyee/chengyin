// pages/play/utils/theme-command.js —— 主题玩法(背包 / 共同方案 / 玩家操作 / 交易)共用的会话命令客户端。
// L02-091:原先四个模块各写一份同样的适配器(req → createGameSessionClient,netFail 走 fail),而且每次调用都新建一个。
const sessionClient = require('../../../utils/game-session-client.js');

/** 返回 client():第一次调用时按 req 建一个会话客户端,之后复用同一个 */
function clientFor(req) {
  let made = null;
  return function client() {
    if (!made) {
      made = sessionClient.createGameSessionClient({ sendRequest(options) {
        req(options.url, options.method, options.data, options.header, true).then(res => res.netFail ? options.fail() : options.success(res), options.fail);
      } });
    }
    return made;
  };
}

module.exports = { clientFor };
