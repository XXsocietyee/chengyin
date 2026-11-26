// 专业编辑器本地草稿：一个 storage key 一次写入完整信封。
// 新草稿按 draftUuid 分桶；既有主题按 topicId 分桶。memberId 只用于恢复前防串号，
// 不能用“当前 key 是我算出来的”替代对信封归属的校验。
// 发布分包专用（fabu 页）：按账号分桶 + 读失败返回 storage_unavailable。主包 utils/publish/pro-editor-draft.js
// 是广场 post-compose 在用的旧版（主包余量不够，不往主包加字节）；fabu 仍能读回旧版写下的未分桶 key。

var publicationRequestId = require('./publication-request-id.js');

var DRAFT_PREFIX = 'pro_editor_draft_';
var ACTIVE_PREFIX = 'pro_editor_active_';

var lang = require('./lang.js');
var value = lang.text;
var clone = lang.clone;

function createDraftUuid(now, randomValue) {
  var ts = Number(now == null ? Date.now() : now).toString(36);
  var random = Number(randomValue == null ? Math.random() : randomValue);
  var entropy = Math.floor(Math.abs(random % 1) * 0x100000000).toString(36);
  return ts + '-' + entropy;
}

function draftKeyFor(identity, memberId, operationScope) {
  identity = identity || {};
  var prefix = DRAFT_PREFIX;
  if (value(memberId)) prefix += 'member_' + encodeURIComponent(value(memberId)) + '_';
  if (operationScope === 'MERCHANT') prefix += 'merchant_';
  var topicId = value(identity.topicId);
  if (topicId) return prefix + 'topic_' + encodeURIComponent(topicId);
  var draftUuid = value(identity.draftUuid);
  if (draftUuid) return prefix + 'new_' + encodeURIComponent(draftUuid);
  throw new Error('topicId 或 draftUuid 至少提供一个');
}

function activeKeyFor(memberId, operationScope) {
  var id = value(memberId);
  if (!id) return '';
  return ACTIVE_PREFIX + encodeURIComponent(id) + (operationScope === 'MERCHANT' ? '_merchant' : '');
}

// 最近一次写下的活动指针。每次按键都会 saveDraft，同一草稿不必反复同步写指针（L04-003）。
var lastActive = null;

function forgetActive(storage, key) {
  if (lastActive && lastActive.storage === storage && lastActive.key === key) lastActive = null;
}

function rememberActiveNewDraft(storage, memberId, draftUuid, operationScope) {
  var key = activeKeyFor(memberId, operationScope);
  var uuid = value(draftUuid);
  if (!key || !uuid || !storage || typeof storage.setStorageSync !== 'function') return false;
  if (lastActive && lastActive.storage === storage && lastActive.key === key && lastActive.uuid === uuid) return true;
  lastActive = null;
  storage.setStorageSync(key, uuid);
  lastActive = { storage: storage, key: key, uuid: uuid };
  return true;
}

function isNewDraftKey(draftKey, memberId) {
  var member = DRAFT_PREFIX + 'member_' + encodeURIComponent(value(memberId)) + '_';
  return draftKey.indexOf(member + 'new_') === 0
    || draftKey.indexOf(member + 'merchant_new_') === 0
    || draftKey.indexOf(DRAFT_PREFIX + 'new_') === 0;
}

function readActiveNewDraft(storage, memberId, operationScope) {
  var key = activeKeyFor(memberId, operationScope);
  if (!key || !storage || typeof storage.getStorageSync !== 'function') return '';
  var uuid = value(storage.getStorageSync(key));
  if (!uuid && operationScope === 'MERCHANT') uuid = value(storage.getStorageSync(activeKeyFor(memberId)));
  function ownedDraft(candidate) {
    if (!candidate) return null;
    var result = loadDraft(storage, { draftUuid: candidate }, { memberId: memberId, operationScope: operationScope });
    if (result.status === 'storage_unavailable') throw new Error('本地草稿暂时无法读取');
    return result.status === 'ready' && value(result.envelope.draftUuid) === candidate
      ? result.envelope : null;
  }
  var best = ownedDraft(uuid);
  // The pointer is only an index. Recover from existing envelopes after an index write failure.
  if (typeof storage.getStorageInfoSync === 'function') {
    var keys = storage.getStorageInfoSync().keys || [];
    keys.forEach(function (draftKey) {
      // L04-021:只读新草稿桶。主题桶(_topic_)的信封没有 draftUuid,以前整份读出来再丢掉,
      // 主题草稿越攒越多、每次打开编辑页都要同步反序列化一遍。
      if (!isNewDraftKey(draftKey, memberId)) return;
      var envelope = storage.getStorageSync(draftKey);
      if (!envelope || value(envelope.memberId) !== value(memberId) || !value(envelope.draftUuid)) return;
      if (envelope.operationScope !== undefined && value(envelope.operationScope) !== value(operationScope)) return;
      if (!best || Number(envelope.savedAt || 0) > Number(best.savedAt || 0)) best = envelope;
    });
  }
  var recovered = best ? value(best.draftUuid) : '';
  try {
    if (recovered) rememberActiveNewDraft(storage, memberId, recovered, operationScope);
    else if (uuid && typeof storage.removeStorageSync === 'function') { forgetActive(storage, key); storage.removeStorageSync(key); }
  } catch (error) {} // Index maintenance cannot invalidate an already durable envelope.
  return recovered;
}

function saveDraft(storage, input) {
  input = input || {};
  if (!storage || typeof storage.setStorageSync !== 'function') {
    throw new Error('storage 不可用');
  }
  var memberId = value(input.memberId);
  if (!memberId) throw new Error('memberId 不能为空');

  var identity = { topicId: input.topicId, draftUuid: input.draftUuid };
  var key = draftKeyFor(identity, memberId, input.operationScope);
  // 只在落盘前整体 clone 一次（冻结这一刻的快照），不再逐段 clone（L04-003）。
  // 章节只存在 formData 里；旧信封顶层的 chapters 仍由页面在 formData 缺失时兜底读取。
  var envelope = {
    memberId: input.memberId,
    operationScope: input.operationScope === 'MERCHANT' ? 'MERCHANT' : '',
    baseRevision: value(input.baseRevision),
    formData: input.formData || { chapters: input.chapters || [] },
    pendingMaterials: input.pendingMaterials || [],
    savedAt: input.savedAt == null ? Date.now() : input.savedAt,
  };
  if (input.publishAttempt && input.publishAttempt.status === 'UNKNOWN') {
    envelope.publishAttempt = { status: 'UNKNOWN', topicId: value(input.publishAttempt.topicId) };
    if (input.publishAttempt.kind === 'SERVER_DRAFT') envelope.publishAttempt.kind = 'SERVER_DRAFT';
    ['configVersion', 'registryVersion'].forEach(function(field) {
      var version = input.publishAttempt[field];
      if (typeof version === 'string' && /^[1-9][0-9]{0,18}$/.test(version)
          && (version.length < 19 || version <= '9223372036854775807')) envelope.publishAttempt[field] = version;
    });
    // U03-01:原发布号随未知记录落盘,重进后的重试沿用它。
    var requestId = input.publishAttempt.publishRequestId;
    if (publicationRequestId.valid(requestId)) envelope.publishAttempt.publishRequestId = requestId;   // L04-090:同一规则只有一处
  }
  if (input.serverDraftAttempt && input.serverDraftAttempt.status === 'UNKNOWN') {
    envelope.serverDraftAttempt = {
      status: 'UNKNOWN',
      topicId: value(input.serverDraftAttempt.topicId),
      payload: input.serverDraftAttempt.payload == null ? null : input.serverDraftAttempt.payload,
    };
  }
  if (input.editorMeta) envelope.editorMeta = input.editorMeta;
  if (value(input.topicId)) envelope.topicId = input.topicId;
  else envelope.draftUuid = value(input.draftUuid);

  // 唯一一次写入：章节和待编排素材来自同一个页面快照。
  storage.setStorageSync(key, clone(envelope));
  if (envelope.draftUuid) {
    try { rememberActiveNewDraft(storage, memberId, envelope.draftUuid, input.operationScope); } catch (error) {}
  }
  return key;
}

function loadDraft(storage, identity, options) {
  options = options || {};
  if (!storage || typeof storage.getStorageSync !== 'function') {
    return { status: 'storage_unavailable', envelope: null };
  }
  var stored;
  try {
    stored = storage.getStorageSync(draftKeyFor(identity, options.memberId, options.operationScope));
    if (!stored && options.operationScope === 'MERCHANT') stored = storage.getStorageSync(draftKeyFor(identity, options.memberId));
    // A failed read is not proof that a previous UNKNOWN envelope does not exist.
    if (!stored) stored = storage.getStorageSync(draftKeyFor(identity));
  } catch (error) {
    return { status: 'storage_unavailable', envelope: null };
  }
  if (!stored || typeof stored !== 'object') return { status: 'missing', envelope: null };
  var envelope = clone(stored);
  if (value(envelope.memberId) !== value(options.memberId)) {
    return { status: 'member_mismatch', envelope: null };
  }
  if (envelope.operationScope !== undefined && value(envelope.operationScope) !== value(options.operationScope)) {
    return { status: 'scope_mismatch', envelope: null };
  }
  var scopeUnknown = envelope.operationScope === undefined;
  var storedRevision = value(envelope.baseRevision);
  var currentRevision = value(options.currentBaseRevision);
  var checkingTopicRevision = value(identity && identity.topicId)
    && Object.prototype.hasOwnProperty.call(options, 'currentBaseRevision');
  if (checkingTopicRevision && (!storedRevision || !currentRevision || storedRevision !== currentRevision)) {
    return { status: 'revision_conflict', envelope: envelope, scopeUnknown: scopeUnknown };
  }
  return { status: 'ready', envelope: envelope, scopeUnknown: scopeUnknown };
}

function removeDraft(storage, identity, options) {
  options = options || {};
  if (!storage || typeof storage.removeStorageSync !== 'function'
      || typeof storage.getStorageSync !== 'function' || !value(options.memberId)) return false;
  var removed = false;
  var keys = [draftKeyFor(identity, options.memberId, options.operationScope), draftKeyFor(identity, options.memberId), draftKeyFor(identity)];
  keys.forEach(function (key) {
    var envelope = storage.getStorageSync(key);
    // 旧版写下的无 scope 信封也一并删（L04-006）：loadDraft 会接受它，留着就会在发布后被当成新草稿复活。
    if (envelope && value(envelope.memberId) === value(options.memberId)
        && (envelope.operationScope === undefined || value(envelope.operationScope) === value(options.operationScope))) {
      storage.removeStorageSync(key);
      removed = true;
    }
  });
  var uuid = value(identity && identity.draftUuid);
  // 删掉的正是活动指针指向的那份 → 指针一并删;下次打开按新草稿桶重新找最新一份。
  // 不再为比对指针把所有草稿信封整份读一遍(L04-021)。
  var activeKey = activeKeyFor(options.memberId, options.operationScope);
  if (removed && uuid && activeKey && value(storage.getStorageSync(activeKey)) === uuid) {
    forgetActive(storage, activeKey); storage.removeStorageSync(activeKey);
  }
  return removed;
}

module.exports = {
  createDraftUuid: createDraftUuid,
  draftKeyFor: draftKeyFor,
  loadDraft: loadDraft,
  readActiveNewDraft: readActiveNewDraft,
  rememberActiveNewDraft: rememberActiveNewDraft,
  removeDraft: removeDraft,
  saveDraft: saveDraft,
};
