'use strict';
/**
 * 章节配音(2026-11-25 业主):故事流里正文段 / 章节卡带 voice(纯人声 m4a)时,
 * 读到那一段就念那一段。整页只有一个专用 InnerAudioContext,两段配音永不重叠。
 *
 *  - reveal(list):本次进入视口的配音段(按显示顺序)。每段只念一次(按 key 记);新读到的段顶掉正在念的
 *    和还在排队的,同一屏一次露出多段就按顺序接着念。关着时照样记「已读到」,所以打开后从下一段开始。
 *  - pause():页面切后台。停下且不排队,回前台不自动续。stop():前进 / 离开故事流。destroy():页面卸载。
 *  - duck(on):有配音在念时 on=true,停了 on=false;页面拿它压低音乐音量(不暂停),念完抬回。只在状态翻转时调。
 *  - 开关是「旁白」:on 由页面传入(偏好见 sound-prefs.js),这里不读写存储。
 *  - 放不出来就当没有,不提示。
 */
function createStoryNarration(opts) {
  const o = opts || {};
  const api = o.wx || (typeof wx !== 'undefined' ? wx : {});
  const createAudio = o.createAudio || (() => api.createInnerAudioContext());
  const duck = typeof o.duck === 'function' ? o.duck : () => {};
  let on = o.on !== false;
  let ctx = null;
  let current = null;
  let queue = [];
  let ducked = false;
  const seen = new Set();

  function setDuck(v) {
    if (ducked === v) return;
    ducked = v;
    try { duck(v); } catch (e) {}
  }
  function ensure() {
    if (ctx) return ctx;
    ctx = createAudio();
    const next = () => { if (!current) return; current = null; playNext(); };
    try { ctx.obeyMuteSwitch = false; } catch (e) {}
    if (typeof ctx.onEnded === 'function') ctx.onEnded(next);
    if (typeof ctx.onError === 'function') ctx.onError(next);
    return ctx;
  }
  function start(item) {
    const audio = ensure();
    try { audio.stop(); } catch (e) {}
    current = item;
    setDuck(true);
    try { audio.src = item.url; audio.play(); } catch (e) { current = null; playNext(); }
  }
  function playNext() {
    if (on && queue.length) { start(queue.shift()); return; }
    queue = [];
    setDuck(false);
  }
  function halt(how) {
    queue = [];
    if (current && ctx) { try { ctx[how](); } catch (e) {} }
    current = null;
    setDuck(false);
  }

  function reveal(list) {
    const fresh = [];
    (list || []).forEach((it) => {
      if (!it || !it.key || typeof it.url !== 'string' || !/^https:\/\//.test(it.url) || seen.has(it.key)) return;
      seen.add(it.key);
      fresh.push(it);
    });
    if (!on || !fresh.length) return false;
    queue = fresh.slice(1);
    start(fresh[0]);
    return true;
  }
  function setOn(v) {
    on = !!v;
    if (!on) halt('stop');
    return on;
  }
  function destroy() {
    halt('stop');
    if (ctx) { try { ctx.destroy(); } catch (e) {} ctx = null; }
  }

  return {
    reveal, setOn, destroy,
    stop: () => halt('stop'),
    pause: () => halt('pause'),
    isOn: () => on,
    playing: () => (current ? current.key : ''),
  };
}

/** 本局章节里有没有带配音的正文段 / 章节卡(算进「旁白」开关该不该出)。 */
function hasStoryVoice(chapters) {
  return (Array.isArray(chapters) ? chapters : []).some((c) => c && Array.isArray(c.blocks)
    && c.blocks.some((b) => b && (b.type === 'text' || b.type === 'cap') && typeof b.voice === 'string' && b.voice.trim()));
}

module.exports = { createStoryNarration, hasStoryVoice };
