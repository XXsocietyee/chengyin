'use strict';
// 2026-11-22 业主:主题底图可单独选(look.map),路线 / 站点光圈 / 目标光晕跟主题配色。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mapStyle = require('../../utils/map-style.js');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const LOOKS = ['pages/play/utils/theme-look.js', 'pages/publish/utils/publish/theme-look.js', 'pages/publishkit/utils/publish/theme-look.js'];

const LINES = Object.freeze([
  { color: '#F8F8F8F2', width: 6, borderColor: '#0B0B0C99', borderWidth: 2 },
  { color: '#FFFFFF33', width: 12 },
  { color: 'rgba(255,255,255,.3)', width: 8 },
  { color: '#E5484D', width: 5, borderColor: '#000', borderWidth: 1 },
  { color: '#1A1A1A', width: 5, borderColor: '#FFFFFF', borderWidth: 1, dottedLine: true },
]);
// 改动前(master)toneLines / toneCircle 的输出,原样冻结在这里
const DARK_LINES = LINES;
const BEFORE = {
  white: {
    lines: [{ color: '#1F1F1FF2', width: 6, borderColor: '#FFFFFFCC', borderWidth: 2 }, { color: '#1F1F1F2E', width: 12 }, { color: '#1F1F1F2E', width: 8 },
      { color: '#E5484D', width: 5, borderColor: '#0000008C', borderWidth: 1 }, { color: '#1A1A1A', width: 5, borderColor: '#0000008C', borderWidth: 1, dottedLine: true }],
    circles: [{ fillColor: 'rgba(31,31,31,.10)', color: 'rgba(31,31,31,.42)' }, { fillColor: 'rgba(31,31,31,.14)', color: 'rgba(31,31,31,.6)' }],
  },
  paper: {
    lines: [{ color: '#3B2A1CF2', width: 6, borderColor: '#F3EAD8CC', borderWidth: 2 }, { color: '#3B2A1C2E', width: 12 }, { color: '#3B2A1C2E', width: 8 },
      { color: '#E5484D', width: 5, borderColor: '#2A1A0E8C', borderWidth: 1 }, { color: '#1A1A1A', width: 5, borderColor: '#2A1A0E8C', borderWidth: 1, dottedLine: true }],
    circles: [{ fillColor: 'rgba(59,42,28,.10)', color: 'rgba(59,42,28,.42)' }, { fillColor: 'rgba(59,42,28,.14)', color: 'rgba(59,42,28,.6)' }],
  },
};
const DARK_CIRCLES = [{ fillColor: 'rgba(255,255,255,.16)', color: 'rgba(255,255,255,.4)' }, { fillColor: 'rgba(255,255,255,.22)', color: 'rgba(255,255,255,.55)' }];

test('normalize:map 只留四种合法值(大小写不敏感),错值 / 不传都不出现;三份 theme-look 逐字一致', () => {
  const first = read(LOOKS[0]);
  LOOKS.forEach((p) => {
    assert.equal(read(p), first, p);
    const look = require(path.join(ROOT, p));
    ['white', 'black', 'paper', '2077'].forEach((m) => assert.equal(look.normalizeLook({ style: 'STARDUST', map: m }).map, m));
    assert.equal(look.normalizeLook({ style: 'CYBER', map: 'PAPER' }).map, 'paper');
    assert.equal(look.normalizeLook({ style: 'CYBER', map: 2077 }).map, '2077');
    ['', 'night', null, undefined, {}, 1].forEach((m) => assert.equal('map' in look.normalizeLook({ style: 'CYBER', map: m }), false, String(m)));
    assert.equal('map' in look.normalizeLook(null), false);
    assert.equal(look.serializeLook({ style: 'STARDUST' }), '', '没设 map 的默认外观仍存空串');
    assert.equal(JSON.parse(look.serializeLook({ style: 'PAPER', map: '2077' })).map, '2077');
  });
});

test('kindForLook / kindForLookJson / routeMapKind:有 look.map 就用它,没有按风格;预览仍是 white', () => {
  assert.equal(mapStyle.kindForLook({ style: 'CYBER', map: 'white' }), 'white');
  assert.equal(mapStyle.kindForLook({ style: 'STARDUST', map: 'paper' }), 'paper');
  assert.equal(mapStyle.kindForLook({ style: 'PAPER', map: 'bogus' }), 'paper');
  assert.equal(mapStyle.kindForLook({ style: 'PAPER', map: '2077', legacy: true }), 'black', '老主题不看 map');
  assert.equal(mapStyle.kindForLook({ style: 'CYBER' }), '2077');
  assert.equal(mapStyle.kindForLookJson('{"style":"PAPER","map":"2077"}'), '2077');
  assert.equal(mapStyle.kindForLookJson({ style: 'cyber', map: 'black' }), 'black');
  assert.equal(mapStyle.kindForLookJson('{"style":"STARDUST"}'), 'black');
  assert.equal(mapStyle.routeMapKind('{"style":"PAPER","map":"2077"}', false), '2077');
  assert.equal(mapStyle.routeMapKind('{"style":"PAPER","map":"2077"}', true), 'white');
});

test('不传配色 / 白 / 默认:toneLines、toneCircle 与改动前逐项相同', () => {
  [undefined, '', 'DEFAULT', 'WHITE', 'white', 'GREEN'].forEach((p) => {
    ['', 'black', '2077'].forEach((t) => {
      assert.deepEqual(mapStyle.toneLines(LINES, t, p), DARK_LINES, t + '/' + p);
      assert.deepEqual([mapStyle.toneCircle('candidate', t, p), mapStyle.toneCircle('target', t, p)], DARK_CIRCLES, t + '/' + p);
    });
    ['white', 'paper'].forEach((t) => {
      assert.deepEqual(mapStyle.toneLines(LINES, t, p), BEFORE[t].lines, t + '/' + p);
      assert.deepEqual([mapStyle.toneCircle('candidate', t, p), mapStyle.toneCircle('target', t, p)], BEFORE[t].circles, t + '/' + p);
    });
  });
  assert.equal(mapStyle.toneLines(LINES, 'black'), LINES, '深底不传配色仍原样返回同一数组');
});

test('深底(black / 2077 / 官方默认):白线 / 墨线换亮色,保留原透明度、宽度、描边;队色不动', () => {
  ['', 'black', '2077'].forEach((t) => {
    const out = mapStyle.toneLines(LINES, t, 'RED');
    assert.deepEqual(out[0], { color: '#FF5A4EF2', width: 6, borderColor: '#0B0B0C99', borderWidth: 2 });
    assert.deepEqual(out[1], { color: '#FF5A4E33', width: 12 });
    assert.deepEqual(out[2], { color: '#FF5A4E4D', width: 8 });
    assert.deepEqual(out[3], LINES[3], '队色线不变');
    assert.deepEqual(out[4], { color: '#FF5A4E', width: 5, borderColor: '#FFFFFF', borderWidth: 1, dottedLine: true });
    assert.deepEqual(mapStyle.toneCircle('candidate', t, 'BLUE'), { fillColor: 'rgba(90,200,250,0.16)', color: 'rgba(90,200,250,0.4)' });
    assert.deepEqual(mapStyle.toneCircle('target', t, 'YELLOW'), { fillColor: 'rgba(255,214,10,0.22)', color: 'rgba(255,214,10,0.55)' });
  });
  assert.equal(mapStyle.paletteAccent('BLUE', 'black'), '#5AC8FA');
  assert.equal(mapStyle.paletteAccent('YELLOW', '2077'), '#FFD60A');
});

test('浅底(white / paper):换深色强调色,透明度两档同墨色;白线描边仍换浅色,队色线描边照旧加深', () => {
  ['white', 'paper'].forEach((t) => {
    const out = mapStyle.toneLines(LINES, t, 'BLUE');
    assert.deepEqual(out[0], { color: '#0B57D0F2', width: 6, borderColor: BEFORE[t].lines[0].borderColor, borderWidth: 2 });
    assert.deepEqual(out[1], { color: '#0B57D02E', width: 12 });
    assert.deepEqual(out[2], { color: '#0B57D02E', width: 8 });
    assert.deepEqual(out[3], BEFORE[t].lines[3], '队色线与不传配色时相同');
    assert.deepEqual(out[4], { color: '#0B57D0F2', width: 5, borderColor: '#FFFFFF', borderWidth: 1, dottedLine: true });
    assert.deepEqual(mapStyle.toneCircle('candidate', t, 'RED'), { fillColor: 'rgba(179,38,30,0.1)', color: 'rgba(179,38,30,0.42)' });
    assert.deepEqual(mapStyle.toneCircle('target', t, 'YELLOW'), { fillColor: 'rgba(138,97,0,0.14)', color: 'rgba(138,97,0,0.6)' });
  });
});

test('主题详情 / 广场路线:预览与没设配色原样,玩家按配色换色', () => {
  const ink = [LINES[4]];
  assert.equal(mapStyle.routeMapLines(ink, '{"style":"PAPER","palette":"RED"}', true), ink);
  assert.equal(mapStyle.routeMapLines(ink, '{"style":"PAPER"}', false), ink);
  assert.equal(mapStyle.routeMapLines(ink, '{"style":"PAPER","palette":"WHITE"}', false), ink);
  assert.equal(mapStyle.routeMapLines(ink, '', false), ink);
  assert.equal(mapStyle.routeMapLines(ink, '{"style":"PAPER","palette":"RED"}', false)[0].color, '#FF5A4E', '没配 key 时 tone 为空,按深底');
  assert.equal(mapStyle.paletteForLookJson('{"palette":"blue"}'), 'BLUE');
  assert.equal(mapStyle.paletteForLookJson('{"palette":"GREEN"}'), '');
  assert.equal(mapStyle.paletteForLookJson('not json'), '');
});

test('接线:play 三张主地图与路线卡、free-map、topic 都把配色交给 map-style', () => {
  const wxml = read('pages/play/index.wxml');
  assert.equal((wxml.match(/tone="\{\{fmTone\}\}" palette="\{\{fmPalette\}\}"/g) || []).length, 3);
  assert.match(wxml, /tone="\{\{routeMap\.tone\}\}" palette="\{\{routeMap\.palette\}\}"/);
  assert.match(read('pages/play/utils/play-look.js'), /fmPalette: \(look && !look\.legacy && look\.palette\) \|\| ''/);
  assert.match(read('pages/play/utils/route-card-map.js'), /palette: \(look && !look\.legacy && look\.palette\) \|\| ''/);
  assert.match(read('pages/play/index.js'), /tone: st\.tone, palette: st\.palette/);
  const fm = read('components/cy/free-map/index.js');
  assert.match(fm, /: base, this\.data\.tone, this\.data\.palette\)/);
  assert.match(read('pages/topic/index/index.js'), /routeMapLines\(this\.data\.routePolyline, info\.lookJson, routeMapPreview\(info\)\)/);
});

test('仓库里仍没有地图 key 与样式序号', () => {
  assert.deepEqual(mapStyle.MAP_STYLE, { subkey: '', black: 0, white: 0, paper: 0, cyber: 0 });
  const src = read('utils/map-style.js');
  assert.doesNotMatch(src, /subkey:\s*'[^']+'/);
  assert.doesNotMatch(src, /[A-Z0-9]{5}(-[A-Z0-9]{5}){5}/, '没有腾讯位置服务 key 形态的字面量');
});

test('深色卡纸的纸本主题配黑底图,牛皮纸/宣纸仍是纸本底图', () => {
  const ms = require('../../utils/map-style.js')
  assert.equal(ms.kindForLookJson('{"style":"PAPER","params":{"paper":"CARD"}}'), 'black')
  assert.equal(ms.kindForLookJson({ style: 'PAPER', params: { paper: 'card' } }), 'black')
  assert.equal(ms.kindForLookJson('{"style":"PAPER","params":{"paper":"KRAFT"}}'), 'paper')
  assert.equal(ms.kindForLookJson('{"style":"PAPER","params":{"paper":"XUAN"}}'), 'paper')
  assert.equal(ms.kindForLookJson('{"style":"PAPER"}'), 'paper')
  assert.equal(ms.kindForLookJson('{"style":"PAPER","params":{"paper":"CARD"},"map":"paper"}'), 'paper')
  assert.equal(ms.kindForLook({ legacy: true, style: 'PAPER', params: { paper: 'CARD' } }), 'black')
})

test('路线详情深底没有强调色时墨线换白线,浅底与预览照旧', () => {
  const ms = require('../../utils/map-style.js')
  const ink = [{ points: [], color: '#1A1A1A', width: 5, dottedLine: true, borderColor: '#FFFFFF', borderWidth: 1 }]
  const dark = ms.routeMapLines(ink, '{"style":"STARDUST","palette":"WHITE"}', false)
  assert.equal(dark[0].color, '#FFFFFF'); assert.equal(dark[0].borderColor, '#00000055'); assert.equal(dark[0].width, 5)
  assert.equal(ms.routeMapLines(ink, '{"style":"CYBER"}', false)[0].color, '#FFFFFF')
  assert.deepEqual(ms.routeMapLines(ink, '{"style":"PAPER","params":{"paper":"KRAFT"}}', false), ink)
  assert.deepEqual(ms.routeMapLines(ink, '{"style":"STARDUST"}', true), ink)
  assert.equal(ms.routeMapLines(ink, '{"style":"STARDUST","palette":"RED"}', false)[0].color.slice(0, 7), '#FF5A4E')
})
