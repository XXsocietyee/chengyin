'use strict';
/**
 * 游玩页声音偏好(2026-11-25 业主):工具菜单只两个开关,互不牵连。
 *  - 旁白 voiceOn:所有人声 —— 章节配音(正文段 / 章节卡的 voice)+ 站点语音讲解。
 *  - 背景音乐 musicOn:所有音乐 —— 主题配乐循环、章节配乐片段(chapter.audioUrl)、站点配乐。
 * 按账号存本机(play.voiceOn.<账号> / play.musicOn.<账号>);读写都兜 try/catch,读不到 = 开。
 * 迁移:旧的 play.narrationOn 管的是章节配乐片段自动播,旧的 play.bgmOn 管主题 / 站点配乐。
 * 新的音乐偏好没存过时,用旧值播种(任一存过 false 就是关),并当场写下;旁白一律默认开。
 */
const VOICE_KEY = 'play.voiceOn';
const MUSIC_KEY = 'play.musicOn';
const LEGACY_NARRATION_KEY = 'play.narrationOn';
const LEGACY_BGM_KEY = 'play.bgmOn';

function keyOf(base, member) { const m = String(member || ''); return m ? base + '.' + m : base; }
function get(api, key) { try { return api.getStorageSync(key); } catch (e) { return ''; } }
function set(api, key, on) { try { api.setStorageSync(key, !!on); return true; } catch (e) { return false; } }
function isSet(v) { return v === true || v === false; }

function read(member, wxApi) {
  const api = wxApi || (typeof wx !== 'undefined' ? wx : {});
  const voice = get(api, keyOf(VOICE_KEY, member));
  let music = get(api, keyOf(MUSIC_KEY, member));
  if (!isSet(music)) {
    music = get(api, LEGACY_NARRATION_KEY) !== false && get(api, LEGACY_BGM_KEY) !== false;
    set(api, keyOf(MUSIC_KEY, member), music);
  }
  return { voiceOn: voice !== false, musicOn: music !== false };
}
function write(member, which, on, wxApi) {
  const api = wxApi || (typeof wx !== 'undefined' ? wx : {});
  return set(api, keyOf(which === 'music' ? MUSIC_KEY : VOICE_KEY, member), on);
}

module.exports = { read, write, VOICE_KEY, MUSIC_KEY, LEGACY_NARRATION_KEY, LEGACY_BGM_KEY };
