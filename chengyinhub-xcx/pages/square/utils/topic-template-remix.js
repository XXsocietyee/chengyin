const toast = require('../../../utils/toast.js');
const { bizFailureMessage } = require('../../../utils/response-shape.js');

// L06-064:同一账号对同一模板的一次改编意图只用一个 requestId(服务端 /use 按 requestId 幂等),
// 网络失败后再点按同号重试,不会复制出第二份草稿;与 templatedetail/utils/topic-use-flow.js 同口径。
const pending = {};
function newRequestId() {
  return 'tu-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
}

// isLive():页面仍在且账号未变时才提示/跳转;缺省视为在。
function remixTopicTemplate(app, topicId, isLive) {
  const live = typeof isLive === 'function' ? isLive : () => true;
  const key = String((app.getUserID && app.getUserID()) || '') + '|' + topicId;
  const requestId = pending[key] || (pending[key] = newRequestId());
  return new Promise((resolve) => {
    app.sendRequest({
      url: '/api/template/topic-template/use',
      method: 'POST',
      data: { id: topicId, requestId },
      success(res) {
        const copiedTopicId = res && res.code == '200' && res.data && res.data.topicId
        delete pending[key]; // 有明确结果(成功或服务端拒绝):下一次是新意图
        if (!copiedTopicId) {
          if (live()) toast(bizFailureMessage(res, '模板改编失败'))
          resolve(false)
          return
        }
        if (live()) wx.navigateTo({ url: '/pages/publish/fabu/index?id=' + copiedTopicId })
        resolve(true)
      },
      fail() {
        // requestId 保留,用户再点按同号重试
        if (live()) toast('网络错误，请重试')
        resolve(false)
      },
    })
  })
}

module.exports = { remixTopicTemplate }
