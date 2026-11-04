#!/usr/bin/env node
// 构建：把 prd/ 源文件（需求数据 + 原型）合成一份离线单 HTML，并在无头浏览器中执行需求 ↔ 原型对账检查。
// 用法：node scripts/build.mjs <项目目录> [--out 文件名.html] [--md] [--draft] [--json]
//   检查未通过时不写交付文件，只在 <项目>/.prd-build/ 留下 failed 版本供排查。
import fs from 'node:fs';
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
function inlineCssUrls(css, base, warns, src) {
  return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (m, q, u) => {
    if (isInline(u)) return m;
    if (isRemote(u)) { warns.push('托管原型引用了网络资源 ' + u + '（' + src + '），断网时可能显示异常'); return m; }
    const f = localPath(base, u);
    if (fs.existsSync(f)) return 'url("' + dataUri(f) + '")';
    warns.push('托管原型引用的文件不存在：' + u + '（' + src + '）');
    return m;
  });
}
/* 把托管原型的本地 CSS / JS / 图片内联，保证最终仍是单文件 */
export function inlineHost(file) {
  if (!fs.existsSync(file)) die('托管原型文件不存在：' + file);
  const base = path.dirname(file);
  const warns = [];
  let html = read(file);
  if (!/<html|<body|<div|<main/i.test(html)) die('托管原型不像 HTML 文件：' + file);
  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    const rel = attr(tag, 'rel') || '';
    const href = attr(tag, 'href');
    if (!href || isInline(href)) return tag;
    if (!/stylesheet|icon/i.test(rel)) return tag;
    if (isRemote(href)) { warns.push('托管原型引用了网络资源 ' + href + '，断网时可能显示异常'); return tag; }
    const f = localPath(base, href);
    if (!fs.existsSync(f)) { warns.push('托管原型引用的文件不存在：' + href); return ''; }
    if (/icon/i.test(rel)) return tag.replace(href, dataUri(f));
    return '<style>\n' + inlineCssUrls(read(f), path.dirname(f), warns, href) + '\n</style>';
  });
  html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (m, attrs, body) => {
    const src = attr('<x ' + attrs + '>', 'src');
    if (!src) return m;
    if (isRemote(src)) { warns.push('托管原型引用了网络脚本 ' + src + '，断网时原型可能无法运行'); return m; }
    const f = localPath(base, src);
    if (!fs.existsSync(f)) { warns.push('托管原型引用的脚本不存在：' + src); return m; }
    const js = read(f).replace(/<\/script/gi, '<\\/script');
    return '<script' + attrs.replace(/\s*\bsrc\s*=\s*(["'])[^"']*\1|\s*\bsrc\s*=\s*[^\s>]+/i, '') + '>\n' + js + '\n</script>';
  });
  html = html.replace(/(<(?:img|source|video|audio)\b[^>]*?\b(?:src|poster)\s*=\s*)(["'])([^"']+)\2/gi, (m, pre, q, u) => {
    if (isInline(u)) return m;
    if (isRemote(u)) { warns.push('托管原型引用了网络图片 ' + u + '，断网时不显示'); return m; }
    const f = localPath(base, u);
    if (!fs.existsSync(f)) { warns.push('托管原型引用的图片不存在：' + u); return m; }
    return pre + q + dataUri(f) + q;
  });
  html = html.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (m, a, css) => '<style' + a + '>' + inlineCssUrls(css, base, warns, '内联样式') + '</style>');
  return { html, warns: Array.from(new Set(warns)) };
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
function licenseComment(name, file) {
  return '<!--\n' + name + ' 许可\n' + read(path.join(VENDOR, file)).replace(/-->/g, '-- >') + '\n-->\n';
}

export async function build(input, opts = {}) {
  const { project, prd } = locate(input);
  const productFile = path.join(prd, 'product.js');
  const cfg = readProduct(productFile);
  const release = cfg.current || (cfg.releases && cfg.releases.length ? cfg.releases[cfg.releases.length - 1].id : cfg.version || 'V1.0');
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
  const hostBlocks = [];
  (cfg.ends || []).forEach((e) => {
    if (!e.host) return;
    const f = path.resolve(prd, e.host);
    const r = inlineHost(f);
    r.warns.forEach((w) => buildWarns.push({ code: 'HOST_RES', msg: '端「' + e.name + '」：' + w }));
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

  const tmp = path.join(tmpDir, base + '.check.html');
  fs.writeFileSync(tmp, assemble(null));
  const browser = await launch();
  let report, markdown = null, jsErrors = [];
  try {
    const page = await browser.newPage({ width: 1600, height: 1000 });
    await page.goto(fileUrl(tmp));
    try { await page.waitFor('window.__PRD_READY === true', 20000); } catch (e) { /* 启动失败也继续拿检查结果 */ }
    const hasAudit = await page.evaluate('!!(window.W && W.runAudit)');
    if (!hasAudit) throw new Error('页面没有正常启动（W.runAudit 不存在）：\n' + page.errors.join('\n'));
    report = await page.evaluate('W.runAudit().then(function (r) { W.audit = r; return r; })');
    if (opts.md) markdown = await page.evaluate('W.doc.markdown({ html: false })');
    jsErrors = page.errors.slice();
    await page.close();
  } finally {
    await browser.close();
  }
  jsErrors.forEach((m) => {
    /* 资源加载失败（原型引用的图片、字体不存在）不阻止交付，作为提醒；脚本错误仍阻止 */
    if (/Failed to load resource|ERR_FILE_NOT_FOUND|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|net::ERR_/.test(m)) report.warns.push({ code: 'RES', msg: '有资源加载失败：' + m.replace(/^浏览器错误：/, '').replace(/file:\/\/[^）]*\.prd-build\//, '') + '。托管原型请检查原文件引用的图片/字体是否存在' });
    else report.errors.push({ code: 'JS', msg: m });
  });
  buildWarns.forEach((w) => report.warns.push(w));
  report.ok = report.errors.length === 0;
  report.stats.errors = report.errors.length;
  report.stats.warns = report.warns.length;
  const html = assemble(report);
  const single = auditSingleFile(html);
  single.forEach((m) => report.errors.push({ code: 'SINGLE_FILE', msg: '交付文件引用了外部或相对资源：' + m }));
  report.ok = report.errors.length === 0;
  try { fs.unlinkSync(tmp); } catch (e) {}

  if (!report.ok) {
    const failed = path.join(tmpDir, base + '.failed.html');
    fs.writeFileSync(failed, assemble(report));
    return { ok: false, report, failed, release, name: cfg.name, outFile };
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
  }
}

const USAGE = `用法：node scripts/build.mjs <项目目录> [选项]
  --md        同时导出需求文档 Markdown（<产品名>-需求文档.md）
  --out 文件  指定交付文件名（默认 <产品名>-原型需求.html）
  --json      以 JSON 输出检查结果
  --draft     只组装、不检查，输出到 .prd-build/（仅供排查画面，不可交付）
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
