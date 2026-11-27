'use strict';
// FOLLOWUP-A-1:主题的举报入口(玩法模板举报已按业主决策删除,不给玩家加举报按钮)。流程照抄动态详情 reportSquare:
// 同一句确认 → 同一份平台举报原因(社区 capabilities 的 reporting.reasons)→ 同一个「选择举报原因」弹层 → 同样的 toast。
// 该接口(#383)只收表单 id + reason(原因文字),不走社区 v1 的幂等举报单。
const modal = require('../../../utils/modal.js');
const toast = require('../../../utils/toast.js');
const reportSheet = require('./community-report-sheet.js');

// 网络失败:结束在途,页面还在才如实提示。
function networkFailed(callbacks) {
  callbacks.done();
  if (callbacks.current()) toast('网络异常，请重试');
}

function reasonLabels(res) {
  const reporting = res && Number(res.code) === 200 && res.data && res.data.reporting;
  if (!reporting || !Array.isArray(reporting.reasons)) return [];
  return reporting.reasons
    .map(function (r) { return r && typeof r.label === 'string' ? r.label.trim() : ''; })
    .filter(Boolean);
}

// current():页面仍在、登录身份没换,才继续下一步或弹结果。submit 发本入口唯一的举报写请求。
function run(page, app, id, submit) {
  if (!id || page._contentReporting) return false;
  // 2026-10-24 游客写前登录:举报写库,游客先弹「登录后继续」,登录后恢复这次举报。
  if (app.ensureLoginFor && !app.ensureLoginFor('report', function () { run(page, app, id, submit); }, { owner: page, target: () => [id, page.data && page.data.id, page.data && page.data.clubId] })) return false;
  const owner = String(app.getUserID() || '');
  const current = function () { return !page._unloaded && !page._disposed && owner === String(app.getUserID() || ''); };
  const done = function () { page._contentReporting = false; };
  page._contentReporting = true;
  modal.show({
    title: '举报内容',
    content: '确认举报这条内容？举报后将提交平台审核。',
    confirmText: '举报',
    success: function (res) {
      if (!res.confirm || !current()) { done(); return; }
      app.sendRequest({
        hideLoading: true, silentError: true, url: '/api/v1/community/capabilities', method: 'GET', data: {},
        success: function (resp) {
          if (!current()) { done(); return; }
          const labels = reasonLabels(resp);
          if (!labels.length) { done(); toast('举报原因暂不可用'); return; }
          reportSheet.open(page, labels, { aborted: false }).then(function (index) {
            if (!current()) { done(); return; }
            submit({ id: id, reason: labels[index] }, {
              done: done, current: current,
              success: function (r) {
                done();
                if (!current()) return;
                if (r && r.code == '200') toast((r && r.msg) || '已提交举报');
                else toast((r && r.msg) || '举报失败');
              }
            });
          }, function (error) {
            done();
            if (current() && error && Number(error.code) !== 499) toast(error.msg || '举报失败');
          });
        },
        fail: function () { done(); if (current()) toast('网络异常，请重试'); }
      });
    },
    fail: done
  });
  return true;
}

// 入口只发一个字面量写接口(UI-GATE U1 只认字面量路径;U5 要求 fail 在同一请求里可见;
// 按钮台账按 handler 认写接口)。
function reportTopic(page, app, id) {
  return run(page, app, id, function (data, callbacks) {
    return app.sendRequest({ hideLoading: true, silentError: true, url: '/api/topic/report', method: 'POST', data: data, success: callbacks.success, fail: function () { networkFailed(callbacks); } });
  });
}

// 2026-11-26 拍板:玩法模板恢复举报。公共库走 /report，个人玩法走 /personal-report。
function reportTemplate(page, app, id, personal) {
  const url = personal ? '/api/template/personal-report' : '/api/template/report';
  return run(page, app, id, function (data, callbacks) {
    return app.sendRequest({ hideLoading: true, silentError: true, url: url, method: 'POST', data: data, success: callbacks.success, fail: function () { networkFailed(callbacks); } });
  });
}

// 评价举报只收评论 id，原因由服务端写成「用户举报」，这里只做一次确认。
function reportComment(page, app, id) {
  if (!id || page._contentReporting) return false;
  if (app.ensureLoginFor && !app.ensureLoginFor('report', function () { reportComment(page, app, id); }, { owner: page, target: () => [id] })) return false;
  const owner = String(app.getUserID() || '');
  const current = function () { return !page._unloaded && !page._disposed && owner === String(app.getUserID() || ''); };
  page._contentReporting = true;
  modal.show({
    title: '举报评价',
    content: '确认举报这条评价？举报后将提交平台审核。',
    confirmText: '举报',
    success: function (res) {
      if (!res.confirm || !current()) { page._contentReporting = false; return; }
      app.sendRequest({
        hideLoading: true, silentError: true, url: '/api/comment/report', method: 'POST', data: { id: id },
        success: function (r) {
          page._contentReporting = false;
          if (!current()) return;
          if (r && r.code == '200') toast((r && r.msg) || '已提交举报');
          else toast((r && r.msg) || '举报失败');
        },
        fail: function () { networkFailed({ done: function () { page._contentReporting = false; }, current: current }); }
      });
    },
    fail: function () { page._contentReporting = false; }
  });
  return true;
}

module.exports = { reportTopic, reportTemplate, reportComment };
