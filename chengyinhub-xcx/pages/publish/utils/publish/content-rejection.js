'use strict';
// 服务端内容安全拒绝(微信 msgSecCheck)的识别。单独成文件(L04-092):活动页只要这一条,
// 不必为它加载整套 publish-issue-target(连带 template-binding / template-adoption)。
// ⚠️ 仍是按服务端中文原话匹配;服务端改成结构化错误码(errorCode / field)之后这里改认码。
function isContentRejection(message) {
  return /未通过安全检查|内容包含违规信息/.test(String(message || ''));
}

module.exports = { isContentRejection };
