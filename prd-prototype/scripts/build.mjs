#!/usr/bin/env node
// 构建：把 prd/ 源文件（需求数据 + 原型）合成一份离线单 HTML，并在无头浏览器中执行需求 ↔ 原型对账检查。
// 用法：node scripts/build.mjs <项目目录> [--out 文件名.html] [--md] [--draft] [--json]
//   检查未通过时不写交付文件，只在 <项目>/.prd-build/ 留下 failed 版本供排查。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { launch, fileUrl } from './lib/browser.mjs';
import { HINTS } from './lib/hints.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.resolve(here, '..');
const RT = path.join(SKILL, 'assets', 'runtime');
const VENDOR = path.join(SKILL, 'assets', 'vendor');

function die(msg, code = 2) { console.error('✗ ' + msg); process.exit(code); }
function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--md' || a === '--draft' || a === '--json' || a === '--quiet') o[a.slice(2)] = true;
    else if (a === '--scope-baseline') o.scopeBaseline = true;
    else if (a === '--confirmed-at') {
      const v = argv[++i];
      if (v == null || v.startsWith('--')) die('--confirmed-at 缺少日期值，格式为 YYYY-MM-DD');
      o.confirmedAt = v;
    }
    else if (a === '--out') o.out = argv[++i];
    else if (a.startsWith('--')) die('未知参数：' + a);
    else o._.push(a);
  }
  return o;
}
const read = (f) => fs.readFileSync(f, 'utf8');
function natural(a, b) { return a.localeCompare(b, 'zh-CN', { numeric: true }); }
function walkJs(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir).sort(natural)) {
    const f = path.join(dir, name);
    const st = fs.statSync(f);
    if (st.isDirectory()) out.push(...walkJs(f));
    else if (/\.js$/i.test(name)) out.push(f);
  }
  return out;
}
export function locate(input) {
  const abs = path.resolve(input || '.');
  if (fs.existsSync(path.join(abs, 'prd', 'product.js'))) return { project: abs, prd: path.join(abs, 'prd') };
  if (fs.existsSync(path.join(abs, 'product.js'))) return { project: path.dirname(abs), prd: abs };
  die('没有找到 prd/product.js：' + abs + '\n  新项目请先运行 node scripts/new.mjs <项目目录> --name "产品名"');
}
/* 在 Node 沙箱中读取 product 配置（只取构建需要的元信息） */
export function readProduct(file) {
  let cfg = null;
  const noop = () => {};
  const hp = new Proxy({}, { get: () => () => '' });
  const W = { product: (c) => { cfg = c; }, page: noop, reg: noop, shared: noop, h: hp, acts: {} };
  const sandbox = { window: { W }, W, console: { log: noop, warn: noop, error: noop }, Date, JSON, Math };
  try { vm.runInNewContext(read(file), sandbox, { filename: file, timeout: 2000 }); } catch (e) { die('product.js 执行出错：' + e.message); }
  if (!cfg) die('product.js 中没有调用 W.product({...})');
  return cfg;
}
function escJson(v) { return JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'); }
function checkJs(file, src) {
  if (/<\/script/i.test(src)) die(path.basename(file) + ' 中出现了 </script，内联到 HTML 会被截断；请改写成 "<\\/script"');
}
function isRemote(u) { return /^(?:https?:)?\/\//i.test(u); }
function isInline(u) { return /^(?:data:|#|about:|javascript:|mailto:|tel:|blob:)/i.test(u); }
function mime(f) {
  const ext = path.extname(f).toLowerCase();
  return { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf' }[ext] || 'application/octet-stream';
}
function dataUri(f) { return 'data:' + mime(f) + ';base64,' + fs.readFileSync(f).toString('base64'); }
function attr(tag, name) { const m = new RegExp('\\b' + name + '\\s*=\\s*(["\'])(.*?)\\1', 'i').exec(tag) || new RegExp('\\b' + name + '\\s*=\\s*([^\\s>]+)', 'i').exec(tag); return m ? (m[2] !== undefined ? m[2] : m[1]) : null; }
function localPath(base, u) { try { return path.resolve(base, decodeURI(u.split(/[?#]/)[0])); } catch (e) { return path.resolve(base, u.split(/[?#]/)[0]); } }
/* 处理 CSS 中的 @import 和 url()。
 * @import 远程样式交给 onStyle（按样式阻止或放行）；@import 本地文件则内联进来，保证交付仍是单文件。
 * url() 里的远程地址只作为图片、字体提醒，不在这里阻止。 */
function inlineCssUrls(css, base, warns, src, remote, onStyle, depth = 0) {
  const re = /@import\s+(?:url\(\s*(["']?)([^"')]+)\1\s*\)|(["'])([^"']+)\3)[^;]*;|url\(\s*(["']?)([^"')]+)\5\s*\)/gi;
  return css.replace(re, (m, q1, u1, q3, u3, q5, u5) => {
    if (/^@import/i.test(m)) {
      const u = u1 || u3;
      if (isInline(u)) return m;
      if (isRemote(u)) { onStyle(u); return m; }
      const f = localPath(base, u);
      if (!fs.existsSync(f) || depth > 5) { warns.push('托管原型引用的样式文件不存在：' + u + '（' + src + '）'); return ''; }
      return inlineCssUrls(read(f), path.dirname(f), warns, src, remote, onStyle, depth + 1);
    }
    const u = u5;
    if (isInline(u)) return m;
    if (isRemote(u)) { remote.push(u); warns.push('托管原型引用了网络资源 ' + u + '（' + src + '），断网时可能显示异常'); return m; }
    const f = localPath(base, u);
    if (fs.existsSync(f)) return 'url("' + dataUri(f) + '")';
    warns.push('托管原型引用的文件不存在：' + u + '（' + src + '）');
    return m;
  });
}
/* 把托管原型的本地 CSS / JS / 图片内联，保证最终仍是单文件。
 * 远程脚本和样式：默认作为阻止交付的 blocks；端上写 online: true 时改为 online 提醒（需联网）。
 * 远程图片和字体：只作为 warns 提醒。remote 列出所有远程地址，供断网检查时去重。 */
export function inlineHost(file, opts = {}) {
  if (!fs.existsSync(file)) die('托管原型文件不存在：' + file);
  const base = path.dirname(file);
  const warns = [], blocks = [], online = [], remote = [], netCodes = [];
  const remoteCode = (what, u) => {
    remote.push(u);
    if (opts.online) {
      online.push('托管原型引用了网络' + what + ' ' + u + '，该端已写 online: true 显式放行，交付后需联网才能正常显示或运行');
      netCodes.push({ code: 'ONLINE', url: u });
    } else {
      blocks.push('托管原型引用了网络' + what + ' ' + u + '，断网时原型会失去样式或无法运行。确需联网请在该端写 online: true');
      netCodes.push({ code: 'HOST_NET', url: u });
    }
  };
  const onStyle = (u) => remoteCode('样式', u);
  let html = read(file);
  if (!/<html|<body|<div|<main/i.test(html)) die('托管原型不像 HTML 文件：' + file);
  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    const rel = attr(tag, 'rel') || '';
    const href = attr(tag, 'href');
    if (!href || isInline(href)) return tag;
    if (!/stylesheet|icon/i.test(rel)) return tag;
    if (isRemote(href)) {
      if (/stylesheet/i.test(rel)) remoteCode('样式', href);
      else { remote.push(href); warns.push('托管原型引用了网络资源 ' + href + '，断网时可能显示异常'); }
      return tag;
    }
    const f = localPath(base, href);
    if (!fs.existsSync(f)) { warns.push('托管原型引用的文件不存在：' + href); return ''; }
    if (/icon/i.test(rel)) return tag.replace(href, dataUri(f));
    return '<style>\n' + inlineCssUrls(read(f), path.dirname(f), warns, href, remote, onStyle) + '\n</style>';
  });
  html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (m, attrs, body) => {
    const src = attr('<x ' + attrs + '>', 'src');
    if (!src) return m;
    if (isRemote(src)) { remoteCode('脚本', src); return m; }
    const f = localPath(base, src);
    if (!fs.existsSync(f)) { warns.push('托管原型引用的脚本不存在：' + src); return m; }
    const js = read(f).replace(/<\/script/gi, '<\\/script');
    return '<script' + attrs.replace(/\s*\bsrc\s*=\s*(["'])[^"']*\1|\s*\bsrc\s*=\s*[^\s>]+/i, '') + '>\n' + js + '\n</script>';
  });
  html = html.replace(/(<(?:img|source|video|audio)\b[^>]*?\b(?:src|poster)\s*=\s*)(["'])([^"']+)\2/gi, (m, pre, q, u) => {
    if (isInline(u)) return m;
    if (isRemote(u)) { remote.push(u); warns.push('托管原型引用了网络图片 ' + u + '，断网时不显示'); return m; }
    const f = localPath(base, u);
    if (!fs.existsSync(f)) { warns.push('托管原型引用的图片不存在：' + u); return m; }
    return pre + q + dataUri(f) + q;
  });
  html = html.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (m, a, css) => '<style' + a + '>' + inlineCssUrls(css, base, warns, '内联样式', remote, onStyle) + '</style>');
  const uniq = (a) => Array.from(new Set(a));
  return { html, warns: uniq(warns), blocks: uniq(blocks), online: uniq(online), remote: uniq(remote), netCodes };
}
/* 交付文件不允许引用外部或相对资源（托管原型的 JSON 字符串除外，已单独检查） */
export function auditSingleFile(html) {
  const issues = [];
  const stripped = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  const styles = [];
  const noStyle = stripped.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (m, css) => { styles.push(css); return ''; });
  (noStyle.match(/<[a-z][^>]*>/gi) || []).forEach((tag) => {
    const name = (/^<([a-z0-9-]+)/i.exec(tag) || [])[1].toLowerCase();
    ['src', 'href', 'poster', 'data'].forEach((a) => {
      const v = attr(tag, a);
      if (v == null || isInline(v)) return;
      if (name === 'a' && a === 'href') return;
      issues.push('<' + name + ' ' + a + '="' + v.slice(0, 80) + '">');
    });
  });
  styles.forEach((css) => {
    (css.match(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi) || []).forEach((u) => {
      const v = /url\(\s*(["']?)([^"')]+)\1/i.exec(u)[2];
      if (!isInline(v)) issues.push('CSS ' + u.slice(0, 80));
    });
  });
  (html.match(/<script\b[^>]*\bsrc\s*=/gi) || []).forEach((t) => issues.push(t));
  return issues;
}
/* 范围基线 prd/scope.json：确认范围后记录的页面、状态、功能点编号。没有该文件时不做增删对比。
 * 格式：{ release, confirmedAt, pages: ["M01"], states: ["M01/list"], fns: ["M01/search"] }。
 * 文件存在但格式不对时返回 error，构建会阻止交付。 */
export function readScope(prd) {
  const f = path.join(prd, 'scope.json');
  if (!fs.existsSync(f)) return { data: null };
  let d;
  try { d = JSON.parse(read(f)); } catch (e) { return { error: 'prd/scope.json 不是合法的 JSON：' + e.message }; }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return { error: 'prd/scope.json 应为对象' };
  for (const k of ['pages', 'states', 'fns']) {
    if (!Array.isArray(d[k])) return { error: 'prd/scope.json 缺少 ' + k + ' 或不是数组（三项都要写，没有内容时写 []）' };
    if (d[k].some((x) => typeof x !== 'string')) return { error: 'prd/scope.json 的 ' + k + ' 应为字符串数组' };
  }
  return { data: { release: String(d.release || ''), confirmedAt: String(d.confirmedAt || ''), pages: d.pages || [], states: d.states || [], fns: d.fns || [] } };
}
/* 用构建检查得到的当前清单覆盖 prd/scope.json，返回写入的内容。
 * confirmedAt 默认取构建当天；用户确认日期不是今天时用 --confirmed-at 指定。 */
function writeScopeBaseline(prd, inv, release, confirmedAt) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const data = {
    release,
    confirmedAt: confirmedAt || [d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate())].join('-'),
    pages: inv.pages.map((x) => x.k),
    states: inv.states.map((x) => x.k),
    fns: inv.fns.map((x) => x.k)
  };
  fs.writeFileSync(path.join(prd, 'scope.json'), JSON.stringify(data, null, 2) + '\n');
  return data;
}
function licenseComment(name, file) {
  return '<!--\n' + name + ' 许可\n' + read(path.join(VENDOR, file)).replace(/-->/g, '-- >') + '\n-->\n';
}

export async function build(input, opts = {}) {
  const { project, prd } = locate(input);
  const productFile = path.join(prd, 'product.js');
  const cfg = readProduct(productFile);
  const release = cfg.current || (cfg.releases && cfg.releases.length ? cfg.releases[cfg.releases.length - 1].id : cfg.version || 'V1.0');
  if (opts.draft && opts.scopeBaseline) throw new Error('--draft 只组装不检查，不能写入范围基线');
  if (opts.confirmedAt != null && !opts.scopeBaseline) throw new Error('--confirmed-at 只能和 --scope-baseline 一起用');
  if (opts.confirmedAt != null && !/^\d{4}-\d{2}-\d{2}$/.test(opts.confirmedAt)) throw new Error('--confirmed-at 的格式应为 YYYY-MM-DD');
  const outName = opts.out || cfg.out || ((cfg.name || 'prototype') + '-原型需求.html');
  const outFile = path.resolve(project, outName);
  const tmpDir = path.join(project, '.prd-build');
  fs.mkdirSync(tmpDir, { recursive: true });

  /* 源文件顺序：product → kit → prd/ 根目录其他 JS → pages/** */
  const rootJs = fs.readdirSync(prd).filter((n) => /\.js$/i.test(n) && n !== 'product.js' && n !== 'kit.js').sort(natural).map((n) => path.join(prd, n));
  const files = [productFile];
  if (fs.existsSync(path.join(prd, 'kit.js'))) files.push(path.join(prd, 'kit.js'));
  files.push(...rootJs, ...walkJs(path.join(prd, 'pages')));
  const userJs = files.map((f) => { const src = read(f); checkJs(f, src); return { f, src }; });
  const themeFile = path.join(prd, 'theme.css');
  const theme = fs.existsSync(themeFile) ? read(themeFile) : '';
  if (/<\/style/i.test(theme)) die('theme.css 中出现了 </style');

  /* 托管原型 */
  const buildWarns = [];
  const buildErrs = [];
  const scopeRes = readScope(prd);
  if (scopeRes.error) buildErrs.push({ code: 'SCOPE_FILE', msg: scopeRes.error });
  const scope = scopeRes.data;
  const hostBlocks = [];
  const hostRemote = new Set();
  const netSeen = new Set();   /* 已报告过的网络脚本/样式，格式 “代码|地址”，运行时检查据此去重 */
  const endOnline = {};        /* 端 id → 是否写了 online: true；只对托管端生效 */
  (cfg.ends || []).forEach((e) => {
    if (!e.host) return;
    endOnline[e.id] = e.online === true;
    const f = path.resolve(prd, e.host);
    const r = inlineHost(f, { online: e.online === true });
    const who = '端「' + e.name + '」：';
    r.warns.forEach((w) => buildWarns.push({ code: 'HOST_RES', msg: who + w }));
    r.blocks.forEach((m) => buildErrs.push({ code: 'HOST_NET', msg: who + m }));
    r.online.forEach((m) => buildWarns.push({ code: 'ONLINE', msg: who + m }));
    r.remote.forEach((u) => hostRemote.add(u));
    r.netCodes.forEach((x) => netSeen.add(x.code + '|' + x.url));
    hostBlocks.push('<script type="application/json" id="prd-host-' + e.id + '">' + escJson(r.html) + '</script>');
  });

  const allText = userJs.map((x) => x.src).join('\n');
  const needMermaid = /```\s*mermaid/.test(allText);
  const vendor = [read(path.join(VENDOR, 'purify.min.js')), read(path.join(VENDOR, 'marked.umd.js'))];
  if (needMermaid) vendor.push(read(path.join(VENDOR, 'mermaid.min.js')));
  const rt = (n) => read(path.join(RT, n));
  const scripts = [
    ...vendor,
    rt('core.js'), rt('md.js'), rt('doc.js'), rt('host.js'), rt('audit.js'),
    ...userJs.map((x) => '/* ' + path.relative(prd, x.f).split(path.sep).join('/') + ' */\n' + x.src),
    rt('viewer.js')
  ];
  scripts.forEach((s, i) => { if (/<\/script/i.test(s) && i >= vendor.length) die('运行时脚本中出现 </script'); });
  const title = (cfg.name || '原型') + ' · ' + release + ' · 原型需求';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const assemble = (audit) => [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="generator" content="prd-prototype">',
    '<meta name="prd-release" content="' + esc(release) + '">',
    '<title>' + esc(title) + '</title>',
    '<style>\n' + rt('viewer.css') + '\n</style>',
    '<style>\n' + rt('wire.css') + '\n</style>',
    theme ? '<style>\n/* theme.css */\n' + theme + '\n</style>' : '',
    '</head>',
    '<body>',
    '<div id="app"><header id="top"></header><aside id="left"></aside><main id="stagewrap"><div id="stage"><div id="stage-in"></div></div><div id="flowbar"></div></main><aside id="right"></aside></div>',
    '<script type="application/json" id="prd-audit">' + (audit ? escJson(audit) : '') + '</script>',
    '<script type="application/json" id="prd-scope">' + (scope ? escJson(scope) : '') + '</script>',
    ...hostBlocks,
    ...scripts.map((s) => '<script>\n' + s + '\n</script>'),
    licenseComment('DOMPurify 3.2.7（Apache-2.0 / MPL-2.0）', 'DOMPurify-LICENSE'),
    licenseComment('Marked 18.0.7（MIT）', 'marked-LICENSE'),
    needMermaid ? licenseComment('Mermaid 11.16.0（MIT）', 'mermaid-LICENSE') : '',
    '</body>',
    '</html>',
    ''
  ].filter((x) => x !== '').join('\n');

  const base = path.basename(outName, '.html');
  if (opts.draft) {
    const draft = path.join(tmpDir, base + '.draft.html');
    fs.writeFileSync(draft, assemble(null));
    return { ok: true, draft: true, file: draft, release, name: cfg.name };
  }

  /* 断网检查：复制到系统临时目录，禁止所有网络请求地址后逐状态运行检查，并记录页面发出的网络请求 */
  const offlineDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prd-offline-'));
  const tmp = path.join(offlineDir, base + '.check.html');
  fs.writeFileSync(tmp, assemble(null));
  const browser = await launch();
  let report, markdown = null, jsErrors = [], netReqs = [];
  try {
    const page = await browser.newPage({ width: 1600, height: 1000, offline: true });
    await page.goto(fileUrl(tmp));
    try { await page.waitFor('window.__PRD_READY === true', 20000); } catch (e) { /* 启动失败也继续拿检查结果 */ }
    const hasAudit = await page.evaluate('!!(window.W && W.runAudit)');
    if (!hasAudit) throw new Error('页面没有正常启动（W.runAudit 不存在）：\n' + page.errors.join('\n'));
    report = await page.evaluate('W.runAudit().then(function (r) { W.audit = r; return r; })');
    if (opts.md) markdown = await page.evaluate('W.doc.markdown({ html: false })');
    jsErrors = page.errors.slice();
    netReqs = page.requests.slice();
    await page.close();
  } finally {
    await browser.close();
    try { fs.rmSync(offlineDir, { recursive: true, force: true }); } catch (e) {}
  }
  jsErrors.forEach((m) => {
    /* 资源加载失败（原型引用的图片、字体不存在）不阻止交付，作为提醒；脚本错误仍阻止 */
    if (/Failed to load resource|ERR_FILE_NOT_FOUND|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|net::ERR_/.test(m)) report.warns.push({ code: 'RES', msg: '有资源加载失败：' + m.replace(/^浏览器错误：/, '').replace(/（?file:\/\/\S*）?/g, '').trim() + '。托管原型请检查原文件引用的图片/字体是否存在' });
    else report.errors.push({ code: 'JS', msg: m });
  });
  buildWarns.forEach((w) => report.warns.push(w));
  buildErrs.forEach((w) => report.errors.push(w));
  /* 范围基线外的增删只提醒，不阻止交付；没有基线时 report.scope 为 null */
  if (report.scope) {
    report.scope.added.forEach((a) => report.warns.push({ code: 'SCOPE_ADDED', msg: '范围确认后新增：' + a.kind + ' · ' + a.label + '（不在范围基线中；先列给用户确认，确认保留后再用 --scope-baseline 刷新基线）' }));
    report.scope.removed.forEach((r) => report.warns.push({ code: 'SCOPE_REMOVED', msg: '范围确认后移除：' + r.kind + ' · ' + r.key + '（基线中有，原型里已没有；确认后再用 --scope-baseline 刷新基线）' }));
  }
  /* 断网运行时记录到的网络请求。
   * 脚本和样式按请求类型判定：来自托管端 iframe 且该端写了 online: true 的记为 ONLINE，其余记为 HOST_NET。
   * 同一地址同一代码只报告一次；静态检查已报告过的不再重复。图片、字体等只作为 RES 提醒。 */
  const isNet = (q) => /^(?:https?|wss?):\/\//i.test(q.url);
  const seenRes = new Set(hostRemote);
  netReqs.forEach((q) => {
    if (!isNet(q)) return;
    if (q.type === 'Script' || q.type === 'Stylesheet') {
      const what = q.type === 'Script' ? '脚本 ' : '样式 ';
      const hosted = /^prd-host-audit-(.+)$/.exec(q.frameName || '');
      const allowed = !!hosted && endOnline[hosted[1]] === true;
      const code = allowed ? 'ONLINE' : 'HOST_NET';
      if (netSeen.has(code + '|' + q.url)) return;
      netSeen.add(code + '|' + q.url);
      if (allowed) report.warns.push({ code, msg: '需联网：托管原型运行时加载了网络' + what + q.url + '（该端已写 online: true 显式放行，交付后需联网）' });
      else if (hosted) report.errors.push({ code, msg: '托管原型运行时加载了网络' + what + q.url + '（断网检查时发出）。改为本地文件，或在该端写 online: true 显式放行' });
      else report.errors.push({ code, msg: '原型运行时加载了网络' + what + q.url + '（断网检查时发出）。改为本地文件' });
    } else {
      if (seenRes.has(q.url)) return;
      seenRes.add(q.url);
      report.warns.push({ code: 'RES', msg: '断网检查时原型请求了网络资源（' + (q.type || '未知类型') + '）' + q.url + '，断网时可能显示异常' });
    }
  });
  report.needOnline = report.warns.some((w) => w.code === 'ONLINE');
  report.ok = report.errors.length === 0;
  report.stats.errors = report.errors.length;
  report.stats.warns = report.warns.length;
  report.stats.netRequests = netReqs.filter(isNet).length;
  report.stats.netBlocked = netReqs.filter((q) => isNet(q) && q.failed).length;
  const html = assemble(report);
  const single = auditSingleFile(html);
  single.forEach((m) => report.errors.push({ code: 'SINGLE_FILE', msg: '交付文件引用了外部或相对资源：' + m }));
  report.ok = report.errors.length === 0;

  if (!report.ok) {
    const failed = path.join(tmpDir, base + '.failed.html');
    fs.writeFileSync(failed, assemble(report));
    return { ok: false, report, failed, release, name: cfg.name, outFile };
  }
  /* --scope-baseline：检查通过后用当前清单覆盖基线，再完整构建一次，让交付文件和需求文档都按新基线生成。
     第二次构建失败时恢复原来的 scope.json，避免留下没有对应交付的基线。 */
  if (opts.scopeBaseline) {
    const scopeFile = path.join(prd, 'scope.json');
    const prev = fs.existsSync(scopeFile) ? read(scopeFile) : null;
    const baseline = writeScopeBaseline(prd, report.inventory, release, opts.confirmedAt);
    const again = await build(input, { ...opts, scopeBaseline: false, confirmedAt: undefined });
    if (!again.ok) {
      if (prev == null) fs.rmSync(scopeFile, { force: true }); else fs.writeFileSync(scopeFile, prev);
      return again;
    }
    again.baseline = baseline;
    return again;
  }
  /* 版本变化时归档上一版交付文件 */
  let archived = null;
  if (fs.existsSync(outFile)) {
    const old = read(outFile);
    const m = /<meta name="prd-release" content="([^"]+)">/.exec(old);
    if (m && m[1] !== release) {
      const dir = path.join(project, '归档');
      fs.mkdirSync(dir, { recursive: true });
      archived = path.join(dir, base + '-' + m[1].replace(/[\\/:*?"<>|]/g, '_') + '.html');
      if (!fs.existsSync(archived)) fs.copyFileSync(outFile, archived);
      else archived = null;
    }
  }
  fs.writeFileSync(outFile, html);
  try { fs.unlinkSync(path.join(tmpDir, base + '.failed.html')); } catch (e) {}
  let mdFile = null;
  if (markdown != null) {
    mdFile = path.resolve(project, base.replace(/-原型需求$/, '') + '-需求文档.md');
    fs.writeFileSync(mdFile, markdown);
  }
  return { ok: true, report, file: outFile, size: Buffer.byteLength(html), mdFile, archived, release, name: cfg.name };
}

function printReport(r) {
  const s = r.report.stats;
  const cov = s.interactive ? Math.round((s.covered / s.interactive) * 100) + '%' : '—';
  console.log('原型需求构建：' + r.name + ' ' + r.release);
  console.log('  页面 ' + s.pages + ' · 状态 ' + s.states + ' · 功能点 ' + s.fns + ' · 字段 ' + s.fields + ' · 渲染 ' + s.renders + ' 次 · 交互元素 ' + s.interactive + '（归属到功能点 ' + cov + (s.ignored ? '；另有 ' + s.ignored + ' 个按 ignore 不纳入' : '') + '）');
  console.log('  待确认 ' + s.pending + ' · AI 假设 ' + s.assumed + (s.gaps ? ' · 原型未体现 ' + s.gaps : '') + (s.changes ? ' · 本版变化 ' + s.changes : ''));
  if (!r.ok) {
    console.log('\n✗ 检查未通过：' + r.report.errors.length + ' 个问题。交付文件未更新' + (fs.existsSync(r.outFile) ? '（' + path.basename(r.outFile) + ' 仍是上一次通过检查的版本）' : ''));
    const byCode = {};
    r.report.errors.forEach((e) => { (byCode[e.code] = byCode[e.code] || []).push(e); });
    Object.keys(byCode).forEach((code) => {
      console.log('\n[' + code + '] ' + (HINTS[code] || ''));
      byCode[code].slice(0, 40).forEach((e) => console.log('  - ' + e.msg));
      if (byCode[code].length > 40) console.log('  …另有 ' + (byCode[code].length - 40) + ' 条');
    });
    console.log('\n排查用文件（含右侧检查结果）：' + r.failed);
  }
  if (r.report.warns.length) {
    console.log('\n提醒 ' + r.report.warns.length + ' 条（不阻止交付）：');
    r.report.warns.slice(0, 30).forEach((w) => console.log('  - [' + w.code + '] ' + w.msg));
  }
  if (r.ok) {
    console.log('\n✓ 检查通过，已生成：' + r.file + '（' + Math.round(r.size / 1024) + ' KB）');
    if (r.mdFile) console.log('  Markdown：' + r.mdFile);
    if (r.archived) console.log('  上一版已归档：' + r.archived);
    if (r.baseline) console.log('  已刷新范围基线 prd/scope.json：页面 ' + r.baseline.pages.length + ' · 状态 ' + r.baseline.states.length + ' · 功能点 ' + r.baseline.fns.length + '（' + r.baseline.confirmedAt + '）');
  }
}

const USAGE = `用法：node scripts/build.mjs <项目目录> [选项]
  --md        同时导出需求文档 Markdown（<产品名>-需求文档.md）
  --out 文件  指定交付文件名（默认 <产品名>-原型需求.html）
  --json      以 JSON 输出检查结果
  --draft     只组装、不检查，输出到 .prd-build/（仅供排查画面，不可交付）
  --scope-baseline  检查通过后，把当前页面、状态、功能点记为范围基线（prd/scope.json）。
                    只用于刷新：先构建列出 SCOPE_ADDED / SCOPE_REMOVED，用户确认后再加此参数。
                    首次建基线由 Agent 按确认的范围清单手写 prd/scope.json（格式见 references/spec-format.md）
  --confirmed-at 日期  配合 --scope-baseline，记录用户确认范围的日期（YYYY-MM-DD，默认今天）
检查未通过时不更新交付文件，在 .prd-build/ 留下 failed 版本供排查。`;
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) { console.log(USAGE); process.exit(0); }
  const o = parseArgs(process.argv.slice(2));
  if (!o._[0]) die(USAGE);
  build(o._[0], o).then((r) => {
    if (r.draft) { console.log('草稿（未检查，不可交付）：' + r.file); return; }
    if (o.json) console.log(JSON.stringify({ ok: r.ok, file: r.file || null, failed: r.failed || null, errors: r.report.errors, warns: r.report.warns, stats: r.report.stats }, null, 1));
    else printReport(r);
    process.exit(r.ok ? 0 : 1);
  }).catch((e) => { console.error('✗ 构建失败：' + (e && e.stack || e)); process.exit(2); });
}
