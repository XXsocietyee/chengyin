/* 结算层「参与人」一行的视图模型(纯函数,不碰 wx)。
   真源仍是页面的 _loadSignupProfile(姓名 = 参与人信息,手机号 = 账号绑定的微信手机号);
   这里只把它和本层的输入态拼成渲染用对象,不另存一份资料。
   2026-11-22 业主:姓名与手机号付款前仍必填,只是在本层补齐,不再跳资料页 / 参与人页。 */

function maskPhone(phone) {
  const s = String(phone || '');
  return s.length >= 7 ? s.slice(0, 3) + '****' + s.slice(-4) : s;
}

// 与参与人表单(pages/addressinfo validateForm)同一条:去空白后为空即报
function validateName(raw) {
  return String(raw == null ? '' : raw).trim() === '' ? '请输入姓名' : '';
}

/* parts:页面最近一次取成功的 { realName, phone };还没取回时为 null。
   ui:{ nameDraft, nameError, nameBusy, phoneBusy, phoneAlert }(本层输入态)。
   fill=false ⇒ 渲染原来的只读行(带编辑入口);fill=true ⇒ 缺哪样补哪样。 */
function profileView(parts, ui) {
  const u = ui || {};
  const loaded = !!parts;
  const p = parts || {};
  const name = String(p.realName || '');
  const phone = String(p.phone || '');
  const needName = loaded && !name;
  const needPhone = loaded && !phone;
  return {
    fill: needName || needPhone,
    needName,
    needPhone,
    name,
    phoneMasked: maskPhone(phone),
    nameDraft: needName ? String(u.nameDraft || '') : '',
    nameError: needName ? String(u.nameError || '') : '',
    nameBusy: needName && !!u.nameBusy,
    phoneBusy: needPhone && !!u.phoneBusy,
    phoneAlert: needPhone && !!u.phoneAlert,
  };
}

/* 付款前仍缺什么 ⇒ 该亮哪条错。phone 不能代点(付费接口只能用户点),只把那行标红。 */
function missingMarks(parts, nameDraft) {
  const p = parts || {};
  return {
    nameError: p.realName ? '' : validateName(nameDraft),
    phoneAlert: !p.phone,
  };
}

// 参与人保存入参(/api/user/address/action 新增):设为默认参与人,手机号用账号已绑的号
function participantPayload(name, phone, requestId) {
  return { fullName: String(name || '').trim(), mobilePhone: String(phone || ''), isDefault: 1, requestId: requestId || '' };
}

module.exports = { maskPhone, validateName, profileView, missingMarks, participantPayload };
