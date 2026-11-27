'use strict';
/**
 * 边走边听后台音频(2026-11-26 §3.1):基于单实例 wx.getBackgroundAudioManager(),
 * 复用 app.json requiredBackgroundModes: ["audio"] 能力,锁屏/切后台继续按章播旁白。
 *
 *  - 全局只有一份 BackgroundAudioManager,事件监听只绑定一次并路由到当前活跃控制器,避免切章/重进重复挂回调。
 *  - 每次播之前必先填 title(微信强制要求非空)、epname、singer、coverImgUrl,再赋 src 起播。
 *  - onEnded 自动切下一段(auto-advance);onNext / onPrev 支持系统锁屏控制;onError 静默跳下一段不崩。
 */

let sharedMgr = null;
let sharedOwner = null;
let sharedHooked = false;

function isValidTrack(item) {
  return !!(item && item.key && typeof item.url === 'string' && /^https:\/\//.test(item.url));
}

function createWalkAudio(opts) {
  const o = opts || {};
  const api = o.wx || (typeof wx !== 'undefined' ? wx : {});
  const customGetManager = typeof o.getManager === 'function' ? o.getManager : null;
  const onChange = typeof o.onChange === 'function' ? o.onChange : () => {};
  const onComplete = typeof o.onComplete === 'function' ? o.onComplete : () => {};

  let localMgr = null;
  let localHooked = false;
  let queue = [];
  let index = -1;
  let meta = { title: '', epname: '', singer: '城瘾', coverImgUrl: '' };
  let active = false;
  let playing = false;
  let switching = false;

  function currentTrack() {
    return index >= 0 && index < queue.length ? queue[index] : null;
  }
  function emit() {
    const item = currentTrack();
    try {
      onChange({
        active,
        playing,
        index,
        key: item ? item.key : '',
        item,
      });
    } catch (e) {}
  }
  function deactivate(completed) {
    active = false;
    playing = false;
    index = -1;
    queue = [];
    emit();
    if (completed) { try { onComplete(); } catch (e) {} }
  }

  function handleEnded() {
    if (!active || switching) return;
    if (index + 1 < queue.length) {
      playAt(index + 1);
      return;
    }
    deactivate(true);
  }
  function handleError() {
    if (!active || switching) return;
    if (index + 1 < queue.length) {
      playAt(index + 1);
      return;
    }
    deactivate(false);
  }
  function handlePlay() {
    if (!active) return;
    playing = true;
    emit();
  }
  function handlePause() {
    if (!active || switching) return;
    playing = false;
    emit();
  }
  function handleStop() {
    if (!active || switching) return;
    deactivate(false);
  }
  function handleNext() {
    if (!active || index + 1 >= queue.length) return;
    playAt(index + 1);
  }
  function handlePrev() {
    if (!active || index <= 0) return;
    playAt(index - 1);
  }

  const hooks = {
    ended: handleEnded,
    error: handleError,
    play: handlePlay,
    pause: handlePause,
    stop: handleStop,
    next: handleNext,
    prev: handlePrev,
  };

  function bindOnce(mgr, isShared) {
    if (isShared) {
      if (sharedHooked) return;
      sharedHooked = true;
      const forward = (name) => () => { if (sharedOwner && sharedOwner[name]) sharedOwner[name](); };
      if (typeof mgr.onEnded === 'function') mgr.onEnded(forward('ended'));
      if (typeof mgr.onError === 'function') mgr.onError(forward('error'));
      if (typeof mgr.onPlay === 'function') mgr.onPlay(forward('play'));
      if (typeof mgr.onPause === 'function') mgr.onPause(forward('pause'));
      if (typeof mgr.onStop === 'function') mgr.onStop(forward('stop'));
      if (typeof mgr.onNext === 'function') mgr.onNext(forward('next'));
      if (typeof mgr.onPrev === 'function') mgr.onPrev(forward('prev'));
      return;
    }
    if (localHooked) return;
    localHooked = true;
    if (typeof mgr.onEnded === 'function') mgr.onEnded(handleEnded);
    if (typeof mgr.onError === 'function') mgr.onError(handleError);
    if (typeof mgr.onPlay === 'function') mgr.onPlay(handlePlay);
    if (typeof mgr.onPause === 'function') mgr.onPause(handlePause);
    if (typeof mgr.onStop === 'function') mgr.onStop(handleStop);
    if (typeof mgr.onNext === 'function') mgr.onNext(handleNext);
    if (typeof mgr.onPrev === 'function') mgr.onPrev(handlePrev);
  }

  function ensureManager() {
    if (customGetManager) {
      if (!localMgr) localMgr = customGetManager();
      if (!localMgr) return null;
      bindOnce(localMgr, false);
      return localMgr;
    }
    if (o.wx) {
      if (!localMgr && typeof api.getBackgroundAudioManager === 'function') {
        localMgr = api.getBackgroundAudioManager();
      }
      if (!localMgr) return null;
      bindOnce(localMgr, false);
      return localMgr;
    }
    if (!sharedMgr && typeof api.getBackgroundAudioManager === 'function') {
      sharedMgr = api.getBackgroundAudioManager();
    }
    if (!sharedMgr) return null;
    bindOnce(sharedMgr, true);
    sharedOwner = hooks;
    return sharedMgr;
  }

  function playAt(nextIndex) {
    if (nextIndex < 0 || nextIndex >= queue.length) {
      deactivate(true);
      return false;
    }
    const mgr = ensureManager();
    if (!mgr) {
      deactivate(false);
      return false;
    }
    const item = queue[nextIndex];
    index = nextIndex;
    active = true;
    playing = true;
    switching = true;
    try {
      mgr.title = String(item.title || meta.title || '城瘾故事旁白');
      if (item.epname || meta.epname) mgr.epname = String(item.epname || meta.epname);
      mgr.singer = String(item.singer || meta.singer || '城瘾');
      if (item.coverImgUrl || meta.coverImgUrl) mgr.coverImgUrl = String(item.coverImgUrl || meta.coverImgUrl);
      mgr.src = item.url;
    } catch (e) {
      switching = false;
      handleError();
      return false;
    }
    switching = false;
    emit();
    return true;
  }

  function start(list, options) {
    const m = options || {};
    const valid = (Array.isArray(list) ? list : []).filter(isValidTrack);
    if (!valid.length) return false;
    queue = valid.slice();
    meta = {
      title: String(m.title || ''),
      epname: String(m.epname || ''),
      singer: String(m.singer || '城瘾'),
      coverImgUrl: String(m.coverImgUrl || ''),
    };
    let startIdx = 0;
    if (m.startKey) {
      const found = queue.findIndex((it) => it.key === m.startKey);
      if (found >= 0) startIdx = found;
    } else if (typeof m.startIndex === 'number' && m.startIndex >= 0 && m.startIndex < queue.length) {
      startIdx = m.startIndex;
    }
    return playAt(startIdx);
  }

  function pause() {
    const mgr = customGetManager || o.wx ? localMgr : (sharedOwner === hooks ? sharedMgr : null);
    if (mgr && active) { try { mgr.pause(); } catch (e) {} }
    playing = false;
    emit();
  }

  function stop() {
    const mgr = customGetManager || o.wx ? localMgr : (sharedOwner === hooks ? sharedMgr : null);
    const wasActive = active;
    switching = true;
    active = false;
    playing = false;
    index = -1;
    queue = [];
    if (mgr && wasActive) { try { mgr.stop(); } catch (e) {} }
    switching = false;
    emit();
  }

  function destroy() {
    stop();
    if (sharedOwner === hooks) sharedOwner = null;
    localMgr = null;
  }

  return {
    start,
    pause,
    stop,
    destroy,
    isActive: () => active,
    isPlaying: () => playing,
    current: currentTrack,
    playingKey: () => { const c = currentTrack(); return c ? c.key : ''; },
    getQueue: () => queue.slice(),
  };
}

function _resetSharedForTest() {
  sharedMgr = null;
  sharedOwner = null;
  sharedHooked = false;
}

module.exports = { createWalkAudio, _resetSharedForTest };
