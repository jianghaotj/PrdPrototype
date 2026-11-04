#!/usr/bin/env node
// 探测已有 HTML 原型：在与构建相同的环境（内联资源 + sandbox iframe）中加载原型，执行进入步骤，
// 列出全局函数、页面/弹层容器、当前可见的可交互元素和建议选择器，并提示会影响托管的风险。
// 用法：node scripts/probe-host.mjs <原型.html> [--steps '<JSON 数组>'] [--boot '<JSON 数组>'] [--width 1440] [--height 900] [--shot 截图.png] [--all] [--json]
//   --steps 与页面状态的 enter 写法相同，如 '[{"js":"showPage(\"customers\")"},{"click":"#btn-new"}]'
//   --boot  与 end.boot 写法相同，每次加载原型后先执行
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, fileUrl, sleep } from './lib/browser.mjs';
import { inlineHost } from './build.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const o = { width: 1440, height: 900, steps: [], boot: [] };
function json(v, name) { try { return JSON.parse(v); } catch (e) { console.error(name + ' 不是合法 JSON：' + e.message); process.exit(2); } }
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--steps') o.steps = json(argv[++i], '--steps');
  else if (a === '--boot') o.boot = json(argv[++i], '--boot');
  else if (a === '--width') o.width = +argv[++i];
  else if (a === '--height') o.height = +argv[++i];
  else if (a === '--shot') o.shot = argv[++i];
  else if (a === '--all') o.all = true;
  else if (a === '--json') o.json = true;
  else if (!o.file) o.file = a;
}
const USAGE = `用法：node scripts/probe-host.mjs <原型.html> [选项]
  --steps '[...]'  先执行进入步骤再探测，写法同页面状态的 enter
  --boot '[...]'   模拟 end.boot，每次加载原型后先执行
  --width 1440 --height 900  原型视口尺寸
  --shot 文件.png   截图
  --all            同时列出隐藏的可交互元素
  --json           以 JSON 输出`;
if (argv.includes('--help') || argv.includes('-h')) { console.log(USAGE); process.exit(0); }
if (!o.file || !fs.existsSync(o.file)) { console.error(USAGE); process.exit(2); }

/* 在原型窗口内执行（会被序列化，不能引用外部变量） */
const PROBE = function (opts) {
  var doc = document, win = window;
  function vis(el) {
    if (!el.isConnected) return false;
    if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    var r = el.getBoundingClientRect();
    return (r.width >= 1 || r.height >= 1) && el.getClientRects().length > 0;
  }
  function txt(el) { return (el.innerText || el.textContent || el.value || '').replace(/\s+/g, ' ').trim(); }
  function count(s) { try { return doc.querySelectorAll(s).length; } catch (e) { return 0; } }
  var NOISE = /^(?:active|show|open|on|hover|selected|current|is-|has-|ng-|v-|el-col|col-|flex|row|mt|mb|ml|mr|p[xytrbl]?-?\d)/;
  function esc(v) { return String(v).replace(/"/g, '\\"'); }
  function base(el) {
    var tag = el.tagName.toLowerCase();
    if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) return '#' + el.id;
    var attrs = ['data-fn', 'data-id', 'data-action', 'data-page', 'data-tab', 'name', 'aria-label', 'title', 'placeholder', 'onclick'];
    for (var i = 0; i < attrs.length; i++) {
      var v = el.getAttribute(attrs[i]);
      if (v && v.length < 60) { var s = tag + '[' + attrs[i] + '="' + esc(v) + '"]'; if (count(s) === 1) return s; }
    }
    var cls = Array.prototype.slice.call(el.classList).filter(function (c) { return !NOISE.test(c); });
    return cls.length ? tag + '.' + cls.slice(0, 2).join('.') : tag;
  }
  function suggest(el) {
    var b = base(el);
    if (count(b) === 1) return { sel: b };
    var p = el.parentElement;
    while (p && p !== doc.body) {
      if (p.id && /^[A-Za-z][\w-]*$/.test(p.id)) {
        var s = '#' + p.id + ' ' + b;
        return count(s) === 1 ? { sel: s } : { sel: s, text: txt(el).slice(0, 12), count: count(s) };
      }
      p = p.parentElement;
    }
    return { sel: b, text: txt(el).slice(0, 12), count: count(b) };
  }
  var INTER = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[onclick],[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=switch],[tabindex]:not([tabindex="-1"])';
  var set = Array.prototype.slice.call(doc.querySelectorAll(INTER));
  Array.prototype.forEach.call(doc.body.getElementsByTagName('*'), function (el) {
    if (set.indexOf(el) >= 0) return;
    if (win.getComputedStyle(el).cursor !== 'pointer') return;
    if (el.parentElement && win.getComputedStyle(el.parentElement).cursor === 'pointer') return;
    set.push(el);
  });
  var groups = {}, order = [];
  set.filter(function (el) { return opts.all || vis(el); }).forEach(function (el) {
    var s = suggest(el);
    var t = txt(el).slice(0, 30) || el.getAttribute('placeholder') || el.getAttribute('title') || '';
    var key = s.sel + '|' + (s.text ? t : '');
    if (!groups[key]) {
      var region = el.closest('[id]');
      groups[key] = { tag: el.tagName.toLowerCase(), text: t, sel: s.sel, textFilter: s.text || '', matches: s.count || 1, n: 0, region: region && region !== el ? '#' + region.id : '', visible: vis(el), via: el.matches(INTER) ? '' : 'cursor:pointer' };
      order.push(key);
    }
    groups[key].n++;
  });
  /* 同一选择器的多个元素（如表格每行的“编辑”）合并显示 */
  var bySel = {};
  order.forEach(function (k) { var g = groups[k]; (bySel[g.sel] = bySel[g.sel] || []).push(g); });
  var items = [];
  Object.keys(bySel).forEach(function (sel) {
    var list = bySel[sel];
    if (list.length > 3 && list.every(function (g) { return g.textFilter; })) {
      var texts = []; list.forEach(function (g) { if (texts.indexOf(g.text) < 0) texts.push(g.text); });
      items.push({ tag: list[0].tag, text: texts.slice(0, 4).join(' / ') + (texts.length > 4 ? ' …' : ''), sel: sel, textFilter: '', n: list.reduce(function (a, g) { return a + g.n; }, 0), region: list[0].region, visible: true, via: list[0].via, repeated: true });
    } else list.forEach(function (g) { items.push(g); });
  });
  var CONT = '[id^="page"],[id$="-page"],[id$="Page"],.page,[data-page],[data-view],[class*="tab-pane"],[role=tabpanel],[role=dialog],dialog,[class*="modal"],[class*="dialog"],[class*="drawer"],[class*="popup"],[class*="sheet"],[class*="mask"],[id$="Mask"],[class*="overlay"],[class*="-pop"],[class*="popover"],[class*="tooltip"],[class*="empty"],[id*="empty"],[id*="Empty"],section[id],main[id]';
  var cseen = [];
  var conts = Array.prototype.slice.call(doc.querySelectorAll(CONT)).filter(function (el) {
    if (cseen.some(function (x) { return x.contains(el) && x !== el && !el.id; })) return false;
    cseen.push(el); return true;
  }).slice(0, 80).map(function (el) {
    var s = suggest(el);
    var tt = el.querySelector('h1,h2,h3,h4,.title,[class*="title"]');
    return { sel: s.sel, cls: typeof el.className === 'string' ? el.className : '', visible: vis(el), title: tt ? txt(tt).slice(0, 24) : '' };
  });
  var fns = Object.getOwnPropertyNames(win).filter(function (k) {
    try { return typeof win[k] === 'function' && !/^(?:webkit|on|__prd|alert$|confirm$|prompt$)/.test(k) && !/\[native code\]/.test(Function.prototype.toString.call(win[k])); } catch (e) { return false; }
  }).slice(0, 80);
  var hashes = Array.prototype.slice.call(doc.querySelectorAll('a[href^="#"]')).map(function (a) { return a.getAttribute('href'); }).filter(function (h, i, arr) { return h.length > 1 && arr.indexOf(h) === i; }).slice(0, 40);
  return { title: doc.title, hash: location.hash, fns: fns, hashes: hashes, containers: conts, items: items, dialogs: (win.__prdDialogs || []).slice() };
};

const RISKS = [
  [/self\s*!==?\s*(?:window\.)?top|top\s*!==?\s*(?:window\.)?self|window\.frameElement|parent\s*!==?\s*(?:window\.)?self/, 'iframe 自检测', '原型会判断自己是否在 iframe 中（可能隐藏外壳）。检查截图；必要时在 end.boot 中撤销它的改动'],
  [/(?:window\.)?(?:top|parent)\.location/, '跳转顶层窗口', '原型会尝试跳转 window.top / parent。托管时已被 sandbox 阻止，对应按钮点击后无反应；如是跨页面导航，用 ignore 标注或改为由 enter 进入'],
  [/\b(?:alert|confirm|prompt)\s*\(/, '原生对话框', '原型使用 alert / confirm / prompt。检查时会自动确认；原生对话框无法标注，把它的文案和规则写进触发它的功能点'],
  [/localStorage|sessionStorage/, '本地存储', '原型使用浏览器存储，演示状态可能残留。可用 end.boot 清理，或配置 end.resetKeys'],
  [/new\s+Date\s*\(\s*\)|Date\.now\s*\(/, '依赖当前时间', '原型按当前时间计算（如剩余时间），演示数据可能随日期变化'],
  [/fetch\s*\(|XMLHttpRequest|axios\./, '网络请求', '原型会发网络请求，离线或 file:// 下可能失败']
];

const host = inlineHost(path.resolve(o.file));
const rt = (n) => fs.readFileSync(path.join(here, '..', 'assets', 'runtime', n), 'utf8');
const wrapper = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'prd-probe-')), 'probe.html');
fs.writeFileSync(wrapper, '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}iframe{border:0;display:block}</style></head><body>' +
  '<iframe id="f" style="width:' + o.width + 'px;height:' + o.height + 'px"></iframe>' +
  '<script type="application/json" id="prd-host-x">' + JSON.stringify(host.html).replace(/</g, '\\u003c') + '</script>' +
  '<script>window.W = {}; W.sharedFns = function () { return []; };</script><script>' + rt('host.js') + '</script></body></html>');

const b = await launch();
let res, errors, stepErr = null;
try {
  const page = await b.newPage({ width: o.width, height: o.height });
  await page.goto(fileUrl(wrapper));
  const cfg = JSON.stringify({ id: 'x', name: '原型', boot: o.boot });
  try {
    await page.evaluate('W.host.enter(document.getElementById("f"), ' + cfg + ', { enter: ' + JSON.stringify(o.steps) + ' }, null, null, { shim: true }).then(function () { return 1; })', 60000);
  } catch (e) { stepErr = e.message; }
  res = await page.evaluate('(function(){ var w = document.getElementById("f").contentWindow; return new w.Function("opts", "return (" + ' + JSON.stringify(PROBE.toString()) + ' + ")(opts)")(' + JSON.stringify({ all: !!o.all }) + '); })()');
  if (o.shot) await page.screenshot(o.shot);
  errors = page.errors.slice();
} finally {
  await b.close();
  try { fs.rmSync(path.dirname(wrapper), { recursive: true, force: true }); } catch (e) {}
}
const risks = RISKS.filter((r) => r[0].test(host.html)).map((r) => ({ name: r[1], tip: r[2] }));
if (o.json) { console.log(JSON.stringify({ ...res, risks, resourceWarnings: host.warns, stepError: stepErr, errors }, null, 1)); process.exit(stepErr ? 1 : 0); }

console.log('原型：' + res.title + '（' + path.basename(o.file) + '，视口 ' + o.width + '×' + o.height + '，与构建时相同的 iframe 环境' + (res.hash ? '，hash ' + res.hash : '') + '）');
if (o.boot.length) console.log('已执行 boot ' + o.boot.length + ' 步');
if (o.steps.length) console.log(stepErr ? '✗ 进入步骤失败：' + stepErr : '已执行进入步骤 ' + o.steps.length + ' 步');
if (risks.length) { console.log('\n需要留意：'); risks.forEach((r) => console.log('  ! ' + r.name + '：' + r.tip)); }
if (host.warns.length) { console.log('\n资源：'); host.warns.forEach((w) => console.log('  - ' + w)); }
if (res.dialogs.length) console.log('\n本次触发的原生对话框（已自动确认）：' + res.dialogs.map((d) => d[0] + '「' + d[1].slice(0, 30) + '」').join('、'));
console.log('\n可在 enter 的 js 步骤中调用的全局函数：' + (res.fns.length ? res.fns.join('、') : '（无）'));
if (res.hashes.length) console.log('页面内 hash 链接：' + res.hashes.join('  '));
console.log('\n页面 / 弹层容器（可用于 match）：');
res.containers.forEach((c) => console.log('  ' + (c.visible ? '● 可见  ' : '○ 隐藏  ') + c.sel + (c.title ? '  「' + c.title + '」' : '') + (c.cls ? '  class="' + c.cls.slice(0, 60) + '"' : '')));
console.log('\n' + (o.all ? '全部' : '当前可见') + '的可交互元素（可用于功能点 sel；同一功能的多个元素可用共同容器作为 sel）：');
res.items.forEach((it) => console.log('  ' + (it.visible ? '' : '[隐藏] ') + it.tag + '「' + it.text + '」' + (it.n > 1 ? ' ×' + it.n : '') + '  sel: ' + it.sel + (it.textFilter ? '  text: "' + it.textFilter + '"（选择器共匹配 ' + it.matches + ' 个）' : '') + (it.repeated ? '  （重复元素，建议用所在容器作为 sel）' : '') + (it.region ? '  所在区域 ' + it.region : '') + (it.via ? '  （' + it.via + ' 推断为可点击）' : '')));
if (errors.length) { console.log('\n原型运行时的控制台错误：'); errors.forEach((e) => console.log('  - ' + e)); }
if (o.shot) console.log('\n截图：' + path.resolve(o.shot));
process.exit(stepErr ? 1 : 0);
