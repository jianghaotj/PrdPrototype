#!/usr/bin/env node
// 技能回归测试：构建门禁（正例 + 每类反例）、托管模式、版本迭代、浏览器端交互、安全清洗、脚手架。
// 用法：node scripts/test-skill.mjs [--keep]   --keep 保留临时目录便于排查
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { build, auditSingleFile } from './build.mjs';
import { launch, fileUrl, sleep } from './lib/browser.mjs';
import { installTheme } from './lib/theme.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.resolve(here, '..');
const EXAMPLE = path.join(SKILL, 'examples', 'leave-approval');
const HOSTFX = path.join(SKILL, 'tests', 'fixtures', 'host-crm');
const KEEP = process.argv.includes('--keep');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'prd-skill-test-'));
let pass = 0, failN = 0;
const fails = [];
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { failN++; fails.push(name); console.log('  ✗ ' + name + (extra ? '\n      ' + String(extra).slice(0, 600) : '')); }
}
function copyDir(src, dst, filter) {
  fs.mkdirSync(dst, { recursive: true });
  for (const n of fs.readdirSync(src)) {
    if (n === '.prd-build' || n === '归档') continue;
    const s = path.join(src, n), d = path.join(dst, n);
    if (filter && !filter(s)) continue;
    if (fs.statSync(s).isDirectory()) copyDir(s, d, filter); else fs.copyFileSync(s, d);
  }
}
let caseN = 0;
function variant(src, edits, opt = {}) {
  const dir = path.join(TMP, 'case-' + (++caseN));
  copyDir(src, dir, opt.withOutput ? null : (s) => !/\.html$/.test(s) || /existing/.test(s));
  for (const [rel, from, to] of edits) {
    const f = path.join(dir, rel);
    const s = fs.readFileSync(f, 'utf8');
    if (typeof from === 'string' ? !s.includes(from) : !from.test(s)) throw new Error('测试用例的替换目标不存在：' + rel + ' :: ' + String(from).slice(0, 80));
    fs.writeFileSync(f, s.replace(from, to));
  }
  return dir;
}
const PROD_FILE = () => 'prd/product.js';
const M02 = 'prd/pages/M02-apply.js', P01 = 'prd/pages/P01-todo.js', P02 = 'prd/pages/P02-review.js', P03 = 'prd/pages/P03-stats.js', M03 = 'prd/pages/M03-detail.js', PROD = 'prd/product.js';
const codes = (r) => r.report.errors.map((e) => e.code);
const hasCode = (r, c) => codes(r).includes(c);
function outputs(dir) { return fs.readdirSync(dir).filter((n) => /-原型需求\.html$/.test(n)); }

console.log('原型需求技能回归测试\n临时目录：' + TMP + '\n');

/* ---------- 1. 正例 ---------- */
console.log('1. 样例项目构建');
const exDir = variant(EXAMPLE, []);
const ex = await build(exDir, { md: true });
ok(ex.ok, '请假审批样例（手机端 + PC 端）检查通过', ex.ok ? '' : JSON.stringify(ex.report.errors.slice(0, 5)));
ok(ex.ok && ex.report.stats.interactive > 40 && ex.report.stats.covered === ex.report.stats.interactive, '全部可交互元素都归属到功能点（' + (ex.report && ex.report.stats.covered) + '/' + (ex.report && ex.report.stats.interactive) + '）');
ok(ex.ok && ex.report.stats.renders >= 15 * 4, '每个状态在默认数据和每个数据场景下都渲染过（' + (ex.report && ex.report.stats.renders) + ' 次）');
const exHtml = ex.ok ? fs.readFileSync(ex.file, 'utf8') : '';
ok(ex.ok && auditSingleFile(exHtml).length === 0 && !/<script[^>]+src=/i.test(exHtml) && !/<link[^>]+href=/i.test(exHtml), '交付文件为自包含单 HTML，无外部资源');
ok(ex.ok && !/mermaid/i.test(exHtml.slice(0, 200000)) || exHtml.indexOf('Mermaid 11') < 0, '未使用流程图时不内嵌 Mermaid（体积 ' + Math.round((ex.size || 0) / 1024) + ' KB）');
ok(ex.ok && /id="prd-audit"[^>]*>\{/.test(exHtml), '检查结果写入交付文件');
{
  const d = variant(EXAMPLE, [[P03, "desc: '选择要统计的自然月，切换后表格和合计同时刷新。',", "desc: '',"]]);
  const bad = await build(d, {});
  const hadFailed = !bad.ok && fs.existsSync(bad.failed);
  fs.writeFileSync(path.join(d, 'prd/pages/P03-stats.js'), fs.readFileSync(path.join(EXAMPLE, 'prd/pages/P03-stats.js'), 'utf8'));
  const good = await build(d, {});
  ok(hadFailed && good.ok && !fs.existsSync(bad.failed), '修复后构建通过时清理上次的失败排查文件');
}
const md = ex.mdFile ? fs.readFileSync(ex.mdFile, 'utf8') : '';
ok(['M01 请假首页', 'M02 发起请假', 'M03 请假详情', 'M04 我的', 'P01 待我审批', 'P02 审批详情', 'P03 请假统计'].every((t) => md.includes('#### ' + t)), 'Markdown 包含全部页面章节');
ok(/\| 假期类型 `type` \| 枚举 \| 是 \|/.test(md) && md.includes('**异常与边界**') && md.includes('| 状态 | 出现条件 |'), 'Markdown 包含字段表、异常与边界、状态出现条件');
ok(md.includes('## 9 待确认与 AI 假设') || /## \d+ 待确认与 AI 假设/.test(md), 'Markdown 包含待确认与 AI 假设章节');
ok(!/<span class="bdg|<a id=|\]\(#\/p\//.test(md) && !/【待确认】【待确认】/.test(md), 'Markdown 不含 HTML 徽标、原型内链接和重复标记');

console.log('\n2. 托管模式（已有 HTML）');
const hostDir = variant(HOSTFX, []);
const hr = await build(hostDir, {});
ok(hr.ok, '为已有 crm.html 补需求后检查通过', hr.ok ? '' : JSON.stringify(hr.report.errors.slice(0, 5)));
const hostHtml = hr.ok ? fs.readFileSync(hr.file, 'utf8') : '';
ok(hr.ok && hostHtml.includes('prd-host-web') && hostHtml.includes('function showPage') && auditSingleFile(hostHtml).length === 0, '原型的外部 CSS/JS 已内联，交付仍为单文件');
ok(fs.readFileSync(path.join(hostDir, 'existing', 'crm.html'), 'utf8') === fs.readFileSync(path.join(HOSTFX, 'existing', 'crm.html'), 'utf8'), '托管模式不修改用户原文件');

let onFile = null;   /* 端写了 online: true 的交付文件，供浏览器端检查“需联网”标记 */
console.log('\n2b. 离线门禁（断网检查：托管外链脚本/样式阻止交付，图片字体只提醒，显式放行需联网）');
{
  const CDN_JS = '<script src="https://cdn.example.com/lib.js"></script>\n</head>';
  const CDN_CSS = '<link rel="stylesheet" href="https://cdn.example.com/x.css">\n</head>';
  const CDN_IMG = '<img src="https://cdn.example.com/a.png">\n</head>';
  const dirJs = variant(HOSTFX, [['existing/crm.html', '</head>', CDN_JS]]);
  const rJs = await build(dirJs, {});
  ok(!rJs.ok && rJs.report.errors.some((e) => e.code === 'HOST_NET' && /lib\.js/.test(e.msg)) && outputs(dirJs).length === 0, '托管原型引用 CDN 脚本：构建被拦住（HOST_NET），不生成交付文件', rJs.ok ? '构建竟然通过了' : JSON.stringify(rJs.report.errors.slice(0, 2)));
  const dirCss = variant(HOSTFX, [['existing/crm.html', '</head>', CDN_CSS]]);
  const rCss = await build(dirCss, {});
  ok(!rCss.ok && rCss.report.errors.some((e) => e.code === 'HOST_NET' && /x\.css/.test(e.msg)), '托管原型引用 CDN 样式表：构建被拦住（HOST_NET）', rCss.ok ? '构建竟然通过了' : JSON.stringify(rCss.report.errors.slice(0, 2)));
  const dirImg = variant(HOSTFX, [['existing/crm.html', '</head>', CDN_IMG]]);
  const rImg = await build(dirImg, {});
  ok(rImg.ok && rImg.report.warns.some((w) => w.code === 'HOST_RES' && /a\.png/.test(w.msg)) && !rImg.report.errors.some((e) => e.code === 'HOST_NET'), '托管原型引用网络图片：只提醒（HOST_RES），构建通过', rImg.ok ? '' : JSON.stringify(rImg.report.errors.slice(0, 2)));
  const dirOn = variant(HOSTFX, [['existing/crm.html', '</head>', CDN_JS.replace('</head>', CDN_CSS)], ['prd/product.js', "host: '../existing/crm.html', width", "host: '../existing/crm.html', online: true, width"]]);
  const rOn = await build(dirOn, {});
  onFile = rOn.ok ? rOn.file : null;
  ok(rOn.ok && rOn.report.needOnline === true && rOn.report.warns.some((w) => w.code === 'ONLINE' && /lib\.js/.test(w.msg)) && rOn.report.warns.some((w) => w.code === 'ONLINE' && /x\.css/.test(w.msg)), '端写 online: true 显式放行：构建通过，并给出“需联网”提醒（ONLINE）且标记 needOnline', rOn.ok ? '' : JSON.stringify(rOn.report.errors.slice(0, 2)));
  const dirImp = variant(HOSTFX, [['existing/crm.html', '</head>', "<style>@import url('https://cdn.example.com/boot.css');</style>\n</head>"]]);
  const rImp = await build(dirImp, {});
  ok(!rImp.ok && rImp.report.errors.some((e) => e.code === 'HOST_NET' && /boot\.css/.test(e.msg)), '托管原型 CSS 的 @import url(https://…) 外链样式：构建被拦住（HOST_NET）', rImp.ok ? '构建竟然通过了' : JSON.stringify(rImp.report.errors.slice(0, 2)));
  const dirFont = variant(HOSTFX, [['existing/crm.html', '</head>', "<style>@font-face{font-family:F;src:url(https://cdn.example.com/f.woff2)}</style>\n</head>"]]);
  const rFont = await build(dirFont, {});
  ok(rFont.ok && rFont.report.warns.some((w) => w.code === 'HOST_RES' && /f\.woff2/.test(w.msg)) && !rFont.report.errors.some((e) => e.code === 'HOST_NET') && !rFont.report.needOnline, '@font-face 引用网络字体：只提醒（HOST_RES），构建通过', rFont.ok ? '' : JSON.stringify(rFont.report.errors.slice(0, 2)));
  const dirRtCss = variant(HOSTFX, [['existing/crm.html', '</head>', "<style>.kpi{background:url(https://cdn.example.com/rt3.css)}</style>\n</head>"], ['prd/product.js', "host: '../existing/crm.html', width", "host: '../existing/crm.html', boot: [{ js: \"var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'https://cdn.example.com/rt3.css'; document.head.appendChild(l)\" }], width"]]);
  const rRtCss = await build(dirRtCss, {});
  ok(!rRtCss.ok && rRtCss.report.errors.some((e) => e.code === 'HOST_NET' && /rt3\.css/.test(e.msg)), '同一地址先作为 url() 图片提醒、运行时又作为样式表加载：仍按样式阻止（HOST_NET）', rRtCss.ok ? '构建竟然通过了' : JSON.stringify(rRtCss.report.errors.slice(0, 2)));
  const dirBoot = (online) => variant(HOSTFX, [['prd/product.js', "host: '../existing/crm.html', width", "host: '../existing/crm.html', " + (online ? 'online: true, ' : '') + "boot: [{ js: \"var s = document.createElement('script'); s.src = 'https://cdn.example.com/rt2.js'; document.head.appendChild(s)\" }], width"]]);
  const rBoot = await build(dirBoot(false), {});
  ok(!rBoot.ok && rBoot.report.errors.some((e) => e.code === 'HOST_NET' && /rt2\.js/.test(e.msg) && /托管原型运行时/.test(e.msg)), '托管原型运行时加载网络脚本（该端未放行）：构建被拦住（HOST_NET），提示指向 online: true', rBoot.ok ? '构建竟然通过了' : JSON.stringify(rBoot.report.errors.slice(0, 2)));
  const rBootOn = await build(dirBoot(true), {});
  ok(rBootOn.ok && rBootOn.report.needOnline === true && rBootOn.report.warns.some((w) => w.code === 'ONLINE' && /rt2\.js/.test(w.msg)) && !rBootOn.report.errors.some((e) => e.code === 'HOST_NET'), '同一脚本在该端写 online: true：构建通过，给出 ONLINE 提醒并标记需联网', rBootOn.ok ? '' : JSON.stringify(rBootOn.report.errors.slice(0, 2)));
  const dirRt = variant(EXAMPLE, [['prd/pages/M01-home.js', 'render: function (c) {', "render: function (c) {\n    (function(){ var s = document.createElement('script'); s.src = 'https://cdn.example.com/rt.js'; document.head.appendChild(s); var i = new Image(); i.src = 'https://cdn.example.com/rt.png'; })();"]]);
  const rRt = await build(dirRt, {});
  ok(!rRt.ok && rRt.report.errors.some((e) => e.code === 'HOST_NET' && /rt\.js/.test(e.msg)) && rRt.report.warns.some((w) => w.code === 'RES' && /rt\.png/.test(w.msg)), '断网运行时：页面动态加载的脚本被拦住（HOST_NET），动态加载的图片只提醒（RES）', rRt.ok ? '构建竟然通过了' : JSON.stringify(rRt.report.errors.slice(0, 2)));
  ok(rRt.report.stats.netRequests >= 2 && rRt.report.stats.netBlocked === rRt.report.stats.netRequests, '断网检查确实拦下了页面发出的网络请求（loadingFailed：' + (rRt.report && rRt.report.stats.netBlocked) + '/' + (rRt.report && rRt.report.stats.netRequests) + '）');
  const dirNat = variant(EXAMPLE, [[PROD, "id: 'pc', name: '审批台（PC）', device: 'pc', home: 'P01',", "id: 'pc', name: '审批台（PC）', device: 'pc', home: 'P01', online: true,"], ['prd/pages/M01-home.js', 'render: function (c) {', "render: function (c) {\n    (function(){ var s = document.createElement('script'); s.src = 'https://cdn.example.com/nat.js'; document.head.appendChild(s); })();"]]);
  const rNat = await build(dirNat, {});
  ok(!rNat.ok && rNat.report.errors.some((e) => e.code === 'HOST_NET' && /nat\.js/.test(e.msg)) && !rNat.report.warns.some((w) => w.code === 'ONLINE') && !rNat.report.needOnline, '原生端写 online: true 不放行另一端（手机端）运行时加载的脚本，也不标需联网');
  const dirMiss = variant(EXAMPLE, [['prd/pages/M01-home.js', 'render: function (c) {', "render: function (c) {\n    (function(){ var i = new Image(); i.src = 'nope-missing.png'; })();"]]);
  const rMiss = await build(dirMiss, {});
  const resMsgs = rMiss.report.warns.filter((w) => w.code === 'RES').map((w) => w.msg);
  ok(rMiss.ok && resMsgs.length > 0 && !resMsgs.some((m) => /file:|prd-offline|\/tmp|\.check\.html/.test(m)), '资源加载失败的提醒不暴露临时目录路径', resMsgs.join(' | '));
  ok(ex.ok && ex.report.stats.netRequests === 0 && !ex.report.errors.some((e) => e.code === 'HOST_NET'), '原生样例断网检查通过，断网运行时没有发出任何网络请求（' + (ex.report && ex.report.stats.netRequests) + ' 次）');
  const offlineDirs = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('prd-offline-')).length;
  const offBefore = offlineDirs();
  await build(variant(EXAMPLE, []), {});
  ok(offlineDirs() === offBefore, '断网检查用的临时目录构建后已清理');
}

/* ---------- 3. 反例：每一类问题都要被拦住 ---------- */
console.log('\n3. 门禁反例（每项都应构建失败，且不生成交付文件）');
const NEG = [
  ['原型多出需求没有的按钮', 'UNREGISTERED', [[P03, "'<div data-fn=\"dept-table\">'", "h.btn('批量删除', { act: 'toast' }) + '<div data-fn=\"dept-table\">'"]]],
  ['只在某个数据场景出现的未登记按钮', 'UNREGISTERED', [['prd/pages/M01-home.js', "var list = empty", "var extra = c.s.balance.annual === 0 ? h.btn('购买假期', { act: 'toast' }) : ''; var list = empty"], ['prd/pages/M01-home.js', "body: h.fn('balance'", "body: extra + h.fn('balance'"]]],
  ['需求有、原型没有', 'FN_UNUSED', [[P03, "h.btn(h.i('download', 16) + '导出明细', { fn: 'export', act: 'toast', msg: '演示：开始导出' })", "''"]]],
  ['data-fn 指向不存在的功能点', 'FN_UNKNOWN', [[P03, "data-fn=\"month-pick\"", "data-fn=\"month-picker\""]]],
  ['有输入控件但没有字段定义', 'FIELD_MISSING', [[P03, /fields: \[\n        \{ key: 'month'[^\n]*\n      \],/, '']]],
  ['控件绑定的字段未定义', 'FIELD_UNDECLARED', [[M02, "field: 'reason' }", "field: 'remark' }"]]],
  ['列表没有空数据说明', 'LIST_EMPTY', [[P01, "      empty: '显示“没有待审批的请假”，并提供“查看已处理”链接',\n", '']]],
  ['有提交按钮但没有异常处理', 'ERRORS', [[P02, /      errors: \['员工已撤回[^\n]*\n/, '']]],
  ['功能点没有交互说明', 'FN_DESC', [[P03, "desc: '选择要统计的自然月，切换后表格和合计同时刷新。',", "desc: '',"]]],
  ['功能点没有来源也没标假设', 'FN_SRC', [[P03, "      src: '需求材料 · 痛点 3'\n", '']]],
  ['状态没有出现条件', 'STATE_WHEN', [[P03, "when: '默认显示上个自然月'", "when: ''"]]],
  ['页面没有目标', 'PAGE', [[P03, "goal: 'HR 每月按部门查看请假天数，导出后用于考勤核算，替代手工核对。',", '']]],
  ['跳转到不存在的页面', 'GO_TARGET', [[M03, "h.go('M01', 'list') + '>撤回</a>'", "h.go('M09', 'list') + '>撤回</a>'"]]],
  ['跳转到不存在的状态', 'GO_TARGET', [[M03, "'<a' + h.go('M03', 'pending') + '>取消</a>", "'<a' + h.go('M03', 'waiting') + '>取消</a>"]]],
  ['缺少本期不做', 'PRODUCT', [[PROD, /  scope: \{\n    out: \[[\s\S]*?\n    \]\n  \},\n/, '']]],
  ['已移除的功能点仍在原型中', 'FN_REMOVED', [[P03, "status: 'assumed', statusNote: '导出格式和大数据量处理方式是 AI 补充的'", "status: 'assumed', statusNote: 'x', changes: [{ ver: 'V1.0', type: 'removed', note: '不做了' }]"]]],
  ['版本变化引用未登记版本', 'RELEASE', [[P03, "      src: '需求材料 · 痛点 3'\n", "      src: '需求材料 · 痛点 3', changes: [{ ver: 'V9.9', type: 'added' }]\n"]]],
  ['流程步骤引用不存在的状态', 'FLOW', [[PROD, "{ p: 'M03', st: 'withdraw'", "{ p: 'M03', st: 'cancel'"]]],
  ['页面渲染抛异常', 'RENDER', [[P03, "var rows = [['教育产品部'", "var rows = c.s.notExist.x || [['教育产品部'"]]],
  ['页面 ID 重复', 'BOOT', [[P03, "id: 'P03', end: 'pc'", "id: 'P01', end: 'pc'"]]]
];
for (const [name, code, edits] of NEG) {
  const dir = variant(EXAMPLE, edits);
  let r;
  try { r = await build(dir, {}); } catch (e) { ok(false, name + ' → ' + code, e.message); continue; }
  ok(!r.ok && hasCode(r, code) && outputs(dir).length === 0 && fs.existsSync(r.failed) && (code !== 'UNREGISTERED' || r.report.errors.filter((e) => e.code === code).length === 1), name + ' → ' + code, r.ok ? '构建竟然通过了' : '实际：' + Array.from(new Set(codes(r))).join(',') + ' ' + JSON.stringify(r.report.errors.filter((e) => e.code === code || true).slice(0, 2)));
}
{
  const dir = variant(EXAMPLE, [[P03, "desc: '选择要统计的自然月，切换后表格和合计同时刷新。',", "desc: '',"]], { withOutput: true });
  fs.writeFileSync(path.join(dir, '请假审批-原型需求.html'), 'OLD');
  const r = await build(dir, {});
  ok(!r.ok && fs.readFileSync(path.join(dir, '请假审批-原型需求.html'), 'utf8') === 'OLD', '检查失败时不覆盖已有交付文件');
}
{
  const dir = variant(EXAMPLE, [[M02, "'<div class=\"mt16\">' + h.demo(", "'<div class=\"mt16\">' + ("]]);
  const r = await build(dir, {});
  ok(!r.ok && hasCode(r, 'UNREGISTERED'), '演示切换不包在 h.demo() 里会被当作未登记功能');
}

{
  const dir = variant(EXAMPLE, [[P03, "h.btn(h.i('download', 16) + '导出明细', { fn: 'export', act: 'toast', msg: '演示：开始导出' })", "h.btn(h.i('download', 16) + '导出明细', { fn: 'export', act: 'toast', msg: '演示：开始导出' }) + '<a class=\"lnk\" data-fn=\"dept-table\" data-act=\"toast\">删除</a>'"]]);
  const r = await build(dir, {});
  ok(!r.ok && r.report.errors.some((e) => e.code === 'ERRORS' && /部门请假汇总/.test(e.msg)), '“删除”链接（不只是按钮）也要求写异常处理 → ERRORS');
  const dir2 = variant(EXAMPLE, [[P01, "h.btn('审批', { sz: 'sm', k: 'pri', go: 'P02', st: 'detail' })],\n      ['张一鸣", "h.btn('进入审批', { sz: 'sm', k: 'pri', go: 'P02', st: 'detail' }) + h.btn('查看提交记录', { sz: 'sm', go: 'P02', st: 'detail' })],\n      ['张一鸣"]]);
  const r2 = await build(dir2, {});
  ok(r2.ok, '“进入审批”“查看提交记录”这类导航按钮不会被误判为提交操作', r2.ok ? '' : JSON.stringify(r2.report.errors.slice(0, 2)));
  const dir3 = variant(EXAMPLE, [[P03, "{ id: 'month', label: '按月查看', when: '默认显示上个自然月' }", "{ id: 'month', label: '按月查看', when: '默认显示上个自然月 [待确认]' }"], [P03, "empty: '当月没有已通过的请假时显示“本月没有请假记录”'", "empty: '显示“本月没有请假记录” [AI 假设]'"]]);
  const r3 = await build(dir3, { md: true });
  const md3 = r3.mdFile ? fs.readFileSync(r3.mdFile, 'utf8') : '';
  ok(r3.ok && r3.report.stats.pending === ex.report.stats.pending + 1 && r3.report.stats.assumed === ex.report.stats.assumed + 1 && /状态「按月查看」：默认显示上个自然月 \|/.test(md3), '状态出现条件、空数据说明里的标记也计入待确认 / AI 假设清单', JSON.stringify(r3.report && r3.report.stats));
  const dir4 = variant(EXAMPLE, [[P03, "      src: '需求材料 · 痛点 3'\n", "      src: '需求材料 · 痛点 3', gap: '原型未画出年份切换，以需求为准'\n"]]);
  const r4 = await build(dir4, {});
  ok(r4.ok && r4.report.warns.some((w) => w.code === 'GAP_NATIVE'), '原生原型里写 gap 只给提醒（应该直接画出来）');
}

{
  const dir = variant(EXAMPLE, [[P03, "{ key: 'month', name: '月份', type: '年月', required: true,", "{ key: 'month', name: '月份', type: '年月', requried: true, required: true, src: 'x',"]]);
  const r = await build(dir, {});
  ok(r.ok && r.report.warns.filter((w) => w.code === 'UNKNOWN_KEY').length === 2, '拼错或放错位置的字段名给出 UNKNOWN_KEY 提醒');
  const dir2 = variant(EXAMPLE, [[PROD, "'加班、调休、出差申请（二期）',", "{ text: '加班、调休、出差申请（二期）', changes: [{ ver: 'V9', type: 'modified' }] },"]]);
  const r2 = await build(dir2, {});
  ok(!r2.ok && r2.report.errors.filter((e) => e.code === 'RELEASE').length >= 2, '“本期不做”等产品级条目上的 changes 也校验版本和 note → RELEASE');
}

console.log('\n4. 托管模式反例');
const HNEG = [
  ['原型多出的按钮没有登记也没写进 ignore', 'UNREGISTERED', [['prd/product.js', "        { sel: '#btn-export', why: '原型多出的“导出 Excel”，本期不做' },\n", '']]],
  ['ignore 没写原因', 'HOST', [['prd/product.js', "{ sel: '.ai-fab', why: '原型多出的 AI 助手入口，本期不做' }", "'.ai-fab'"]]],
  ['进入步骤找不到元素', 'HOST_ENTER', [['prd/pages/C01-customers.js', "enter: [{ click: '#btn-new' }]", "enter: [{ click: '#btn-create' }]"]]],
  ['进入后 match 不成立', 'HOST_ENTER', [['prd/pages/C01-customers.js', "match: '#modal-new' }", "match: '#modal-edit' }"]]],
  ['功能点选择器在原型里找不到', 'FN_UNUSED', [['prd/pages/C01-customers.js', "sel: '#btn-new',", "sel: '#btn-add', text: '新建',"]]],
  ['托管页面功能点缺少 sel', 'HOST_SEL', [['prd/pages/D01-dashboard.js', "id: 'kpis', name: '本月指标', sel: '.kpis',", "id: 'kpis', name: '本月指标',"]]]
];
{
  const dir = variant(HOSTFX, [['prd/product.js', "      ignore: [", "      boot: [{ js: \"confirm('确定要继续吗？'); alert('欢迎')\" }],\n      ignore: ["]]);
  const t0 = Date.now();
  const r = await build(dir, {});
  ok(r.ok && Date.now() - t0 < 60000 && r.report.warns.some((w) => w.code === 'HOST_DIALOG'), '原型弹出原生 confirm / alert 时检查不会卡住，并给出提醒（' + Math.round((Date.now() - t0) / 1000) + ' 秒）', r.ok ? '' : JSON.stringify(r.report.errors.slice(0, 2)));
  const dir2 = variant(HOSTFX, [['prd/product.js', "{ sel: '.ai-fab', why: '原型多出的 AI 助手入口，本期不做' }", "{ sel: '.ai-fab', name: 'AI 助手入口', why: '另行评审', label: '评审范围外' }"]]);
  const r2 = await build(dir2, { md: true });
  const md2 = r2.mdFile ? fs.readFileSync(r2.mdFile, 'utf8') : '';
  ok(r2.ok && /### 原型中有、评审范围外/.test(md2) && /AI 助手入口 `\.ai-fab`/.test(md2) && /### 原型中有、本期不做/.test(md2), 'ignore 支持自定义标签（如“评审范围外”）和可读名称，需求文档分组列出');
  const dir3 = variant(HOSTFX, [['prd/pages/C01-customers.js', "      src: '需求材料'\n    },\n    {\n      id: 'table'", "      src: '需求材料'\n    },\n    { id: 'import', name: '批量导入', desc: '上传 Excel 批量导入客户，重复手机号跳过。', gap: '原型未画出导入入口，以需求为准', src: '需求材料' },\n    {\n      id: 'table'"]]);
  const r3 = await build(dir3, { md: true });
  const md3 = r3.mdFile ? fs.readFileSync(r3.mdFile, 'utf8') : '';
  ok(r3.ok && /### 需求中有、原型未体现[\s\S]*批量导入/.test(md3) && r3.report.stats.gaps === 1, '托管：需求有、原型缺的功能点用 gap 记录，单列“需求中有、原型未体现”');
}
for (const [name, code, edits] of HNEG) {
  const dir = variant(HOSTFX, edits);
  let r;
  try { r = await build(dir, {}); } catch (e) { ok(false, name + ' → ' + code, e.message); continue; }
  ok(!r.ok && hasCode(r, code), name + ' → ' + code, r.ok ? '构建竟然通过了' : '实际：' + Array.from(new Set(codes(r))).join(','));
}

/* ---------- 5. 版本迭代 ---------- */
console.log('\n5. 版本迭代');
const relDir = variant(EXAMPLE, [], { withOutput: true });
fs.copyFileSync(ex.file, path.join(relDir, '请假审批-原型需求.html'));
const relEdits = [
  [PROD, "    { id: 'V1.0', date: '2026-11-03', summary: '首版：员工手机端发起与查看请假，主管 PC 端审批，HR 查看月度统计' }", "    { id: 'V1.0', date: '2026-11-03', summary: '首版' },\n    { id: 'V1.1', date: '2026-12-01', summary: '统计支持导出；去掉申请人历史' }"],
  [P02, "status: 'assumed', statusNote: '需求材料没有提到主管需要看历史记录，这是 AI 为“辅助判断”补充的，评审确认是否保留'", "status: 'assumed', statusNote: 'x', changes: [{ ver: 'V1.1', type: 'removed', note: '评审决定去掉，避免主管看到病假详情' }]"],
  [P02, "'<div class=\"box fill mt16\" data-fn=\"history\"><div class=\"b md\">本年度已请</div><div class=\"row g24 mt8 md\"><span>年假 3 天</span><span>病假 1 天</span><span>事假 0.5 天</span></div><div class=\"sm mut2 mt8\">年假剩余 3.5 天（已扣除本单）</div></div>'", "''"],
  [P03, "      src: '需求材料 · 痛点 3'\n    },\n    {\n      id: 'dept-table'", "      src: '需求材料 · 痛点 3',\n      changes: [{ ver: 'V1.1', type: 'modified', note: '可选范围扩大到近 24 个月' }]\n    },\n    {\n      id: 'dept-table'"]
];
for (const [rel, from, to] of relEdits) { const f = path.join(relDir, rel); const s = fs.readFileSync(f, 'utf8'); if (!s.includes(from)) throw new Error('迭代用例替换目标不存在'); fs.writeFileSync(f, s.replace(from, to)); }
const rr = await build(relDir, { md: true });
ok(rr.ok, 'V1.1 构建通过', rr.ok ? '' : JSON.stringify(rr.report.errors.slice(0, 3)));
ok(rr.ok && rr.archived && fs.existsSync(rr.archived) && /V1\.0\.html$/.test(rr.archived), '上一版交付文件自动归档到 归档/');
const rmd = rr.mdFile ? fs.readFileSync(rr.mdFile, 'utf8') : '';
ok(/### V1\.1 变化明细[\s\S]*移除[\s\S]*申请人本年度请假[\s\S]*评审决定去掉/.test(rmd) && /修改[\s\S]*统计月份/.test(rmd), '变更记录列出本版新增/修改/移除及原因');
ok(rr.ok && rr.report.stats.changes === 2, '本版变化计数正确（' + (rr.report && rr.report.stats.changes) + '）');
{
  const d = variant(relDir, [[P03, "id: 'P03', end: 'pc', group: '统计', title: '请假统计',", "id: 'P03', end: 'pc', group: '统计', title: '请假统计', changes: [{ ver: 'V1.1', type: 'added' }],"], [PROD, "  goals: [\n    '员工在手机上", "  goals: [\n    { text: 'HR 可导出明细用于核算', changes: [{ ver: 'V1.1', type: 'added' }] },\n    '员工在手机上"]]);
  const r = await build(d, { md: true });
  const m = r.mdFile ? fs.readFileSync(r.mdFile, 'utf8') : '';
  ok(r.ok && r.report.stats.changes === 4 && /新增 \| 建设目标 \| HR 可导出明细用于核算/.test(m), '新增页面的功能点自动算作本版新增（不重复计入明细）；建设目标的变化进入变更记录', JSON.stringify(r.report && r.report.stats));
}

/* ---------- 6. 浏览器端 ---------- */
console.log('\n6. 浏览器端交互');
const b = await launch();
try {
  const page = await b.newPage({ width: 1600, height: 1000 });
  const go = async (file, hash) => { await page.goto('about:blank'); await page.goto(fileUrl(file) + (hash || '')); await page.waitFor('window.__PRD_READY === true'); await sleep(400); };
  await go(ex.file, '#/doc');
  const d0 = await page.evaluate('({ toc: document.querySelectorAll("#left .nv-i").length, pages: document.querySelectorAll("#docbody a[id^=d-pg-]").length, badge: (document.querySelector(".audit-badge")||{}).textContent || "", sum: document.querySelectorAll("#right .issue").length })');
  ok(d0.pages === 7 && d0.toc >= 10 && /检查通过/.test(d0.badge), '需求文档：目录、7 个页面章节、检查通过徽标', JSON.stringify(d0));
  ok(!/需联网/.test(d0.badge), '未放行网络资源的原型：顶部徽标不显示“需联网”');
  if (onFile) {
    await go(onFile, '#/doc');
    const on = await page.evaluate('({ badge: (document.querySelector(".audit-badge")||{}).textContent || "", issues: Array.from(document.querySelectorAll("#right .issue.w")).map(function (x) { return x.textContent; }), md: W.doc.markdown({ html: false }).slice(0, 800) })');
    ok(/需联网/.test(on.badge), '需联网的交付物：顶部徽标显示“需联网”（' + on.badge + '）');
    ok(on.issues.some((t) => /lib\.js/.test(t)) && on.issues.some((t) => /x\.css/.test(t)), '需联网的交付物：检查面板列出网络脚本和样式地址，不被截断');
    ok(/需联网/.test(on.md), '需联网的交付物：需求文档摘要行和 Markdown 标注“需联网”');
    await go(ex.file, '#/doc');
  }
  await page.evaluate('location.hash = "#/doc/d-pg-P02"; 1');
  await sleep(400);
  const anchorTop = await page.evaluate('Math.round(document.getElementById("d-pg-P02").getBoundingClientRect().top)');
  ok(anchorTop > 40 && anchorTop < 300, '文档目录跳转到对应章节（top=' + anchorTop + '）');
  const mdLen = await page.evaluate('W.doc.markdown({ html: false }).length');
  ok(mdLen > 8000 && Math.abs(mdLen - md.length) < 400, '页面内导出的 Markdown 与构建导出一致（' + mdLen + ' / ' + md.length + '）');

  await go(ex.file, '#/p/M01/list');
  let dg = await page.evaluate('W.viewerDiag()');
  ok(dg.page === 'M01' && dg.dots.length === 3 && dg.cards >= 3, '页面视图：圆点与本页功能点对应（' + dg.dots.join(',') + '）', JSON.stringify(dg));
  await page.evaluate('document.querySelector(".fdot[data-fdot=records]").click(); 1');
  await sleep(200);
  const selOk = await page.evaluate('document.querySelector(".fc[data-fid=records]").classList.contains("on") && !document.querySelector(".fc[data-fid=records]").classList.contains("fold") && document.querySelectorAll("#dots .fbox").length > 0');
  ok(selOk, '点击圆点：选中并展开对应卡片，画板高亮目标区域');
  await page.evaluate('document.querySelector("#right .chip[data-nav=\'M01|empty\']").click(); 1');
  await sleep(400);
  dg = await page.evaluate('W.viewerDiag()');
  const emptyText = await page.evaluate('document.querySelector("#ab").textContent.indexOf("还没有请假记录") >= 0');
  ok(dg.state === 'empty' && emptyText, '状态切换：右侧状态标签切到“无请假记录”并应用数据场景');
  await page.evaluate('document.querySelector("[data-tool=reset]").click(); 1');
  await sleep(300);
  await go(ex.file, '#/p/M01/empty');
  ok(await page.evaluate('W.store.hasRecords === false && document.querySelector("#ab").textContent.indexOf("还没有请假记录") >= 0'), '直接打开状态链接（刷新、分享链接、截图）时也应用该状态的演示数据');
  await page.evaluate('location.hash = "#/p/M01/list"; 1');
  await sleep(300);
  ok(await page.evaluate('W.store.hasRecords === true'), '从目录或地址切换状态时应用目标状态的演示数据');
  await page.evaluate('W.nav("M01", "empty", "hasRecords=true"); 1');
  await sleep(300);
  ok(await page.evaluate('W.store.hasRecords === true && W.store.balance.annual === 5'), '跳转时按钮上的 data-set 晚于目标状态的 set 生效');
  await page.evaluate('document.querySelector("[data-tool=reset]").click(); 1');
  await sleep(200);

  await go(ex.file, '#/p/P02/reject');
  dg = await page.evaluate('W.viewerDiag()');
  ok(dg.dots.length === 1 && dg.dots[0] === 'reject-form', '弹层状态只显示最高层的功能点圆点', JSON.stringify(dg.dots));

  await go(ex.file, '#/p/P01/list?f=f2&i=0');
  await page.evaluate('document.querySelector("#ab button[data-go=P02]").click(); 1');
  await sleep(400);
  const fb = await page.evaluate('({ hash: location.hash, i: document.querySelector("#flowbar").dataset.i })');
  ok(/#\/p\/P02\/detail\?f=f2&i=1/.test(fb.hash) && fb.i === '1', '流程演示：点击画板按钮自动前进到下一步', JSON.stringify(fb));
  await page.evaluate('document.querySelector("#flowbar [data-fb=next]").click(); 1');
  await sleep(300);
  ok(await page.evaluate('/P02\\/reject/.test(location.hash)'), '流程条“下一步”可用');

  await page.evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "n" })); 1');
  ok(await page.evaluate('document.body.classList.contains("no-dots")'), '快捷键 N 切换圆点显示');
  await page.evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "n" })); 1');
  await page.evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "h" })); 1');
  ok(await page.evaluate('document.body.classList.contains("hot")'), '快捷键 H 显示热区');
  await page.evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "h" })); 1');

  await page.setViewport(900, 900);
  await go(ex.file, '#/p/P01/list');
  const narrow = await page.evaluate('({ right: getComputedStyle(document.querySelector("#right")).display, scale: W.viewerDiag().scale })');
  await page.evaluate('document.querySelector("[data-tool=right]").click(); 1');
  await sleep(250);
  const opened = await page.evaluate('getComputedStyle(document.querySelector("#right")).display');
  ok(narrow.right === 'none' && opened === 'block' && narrow.scale < 1, '窄屏：侧栏收起为抽屉，画板等比缩小');
  await page.setViewport(1600, 1000);

  /* 托管 */
  if (hr.ok) {
    await go(hr.file, '#/p/D01');
    await page.waitFor('document.querySelectorAll("#dots .fdot").length > 0', 8000).catch(() => {});
    dg = await page.evaluate('W.viewerDiag()');
    const xd = await page.evaluate('document.querySelectorAll("#dots .xbox").length');
    ok(dg.page === 'D01' && dg.dots.includes('kpis') && xd >= 1, '托管：圆点定位到原型元素，“本期不做”元素被标出', JSON.stringify(dg) + ' xdot=' + xd);
    await page.evaluate('document.querySelector("#hostf").contentDocument.getElementById("kpi-follow").click(); 1');
    await sleep(700);
    dg = await page.evaluate('W.viewerDiag()');
    ok(dg.page === 'C01' && dg.state === 'list', '托管：在原型里点击跳转后，右侧需求自动切换到对应页面', JSON.stringify(dg));
    await page.evaluate('document.querySelector("#hostf").contentDocument.getElementById("btn-new").click(); 1');
    await sleep(700);
    dg = await page.evaluate('W.viewerDiag()');
    ok(dg.state === 'new' && dg.dots.length === 1 && dg.dots[0] === 'form', '托管：打开弹窗后识别为弹层状态，只标弹层内功能点', JSON.stringify(dg));
    await page.evaluate('location.hash = "#/p/D01"; 1');
    await sleep(1200);
    ok((await page.evaluate('W.viewerDiag()')).page === 'D01', '托管：从目录切换页面会重新进入原型对应画面');
    const before = await page.evaluate('location.href');
    await page.evaluate('(function(){ var d = document.querySelector("#hostf").contentDocument; var sc = d.createElement("script"); sc.textContent = "try { top.location.href = \\"about:blank#hijack\\"; } catch (e) {}"; d.body.appendChild(sc); return 1; })()');
    await sleep(500);
    ok((await page.evaluate('location.href')) === before && (await page.evaluate('!!window.__PRD_READY')), '托管：sandbox 阻止原型跳走整个评审页');
    page.errors.length = 0;
  }

  /* 版本视图 */
  if (rr.ok) {
    await go(rr.file, '#/p/P02/detail');
    const before = await page.evaluate('W.viewerDiag().dots.length');
    const hasRemoved = await page.evaluate('!!document.querySelector(".fc[data-fid=history]")');
    await page.evaluate('document.querySelector("[data-tool=chg]").click(); 1');
    await sleep(400);
    const after = await page.evaluate('({ dots: W.viewerDiag().dots.length, removed: !!document.querySelector(".fc.removed[data-fid=history]") })');
    ok(!hasRemoved && after.removed && after.dots < before, '本版变化：显示已移除项（删除线）、只标变化的圆点', JSON.stringify({ before, hasRemoved, after }));
    await page.evaluate('location.hash = "#/doc"; 1');
    await sleep(400);
    const docOnly = await page.evaluate('({ h: document.querySelector("#docbody").textContent.indexOf("V1.1 本版变化") >= 0, pages: document.querySelectorAll("#docbody a[id^=d-pg-]").length })');
    ok(docOnly.h && docOnly.pages === 2, '本版变化：需求文档只列有变化的页面', JSON.stringify(docOnly));
    await page.evaluate('document.querySelector("[data-tool=chg]").click(); 1');
  }
  ok(page.errors.length === 0, '浏览过程中没有控制台错误', page.errors.join('\n'));
  await page.close();
} finally {
  await b.close();
}

/* ---------- 7. 安全 ---------- */
console.log('\n7. 内容安全');
{
  const dir = variant(EXAMPLE, [[P03, "desc: '选择要统计的自然月，切换后表格和合计同时刷新。',", "desc: '选择月份 <img src=\"data:image/gif;base64,R0lGODlhAQABAAAAACw=\" onerror=\"window.__xss=1\"> <a href=\"javascript:window.__xss=2\">链接</a> <script>window.__xss=3<\\/script> <iframe src=\"about:blank\"></iframe>',"]]);
  const r = await build(dir, {});
  ok(r.ok, '含恶意 HTML 的需求文字仍可构建', r.ok ? '' : JSON.stringify(r.report.errors.slice(0, 3)));
  if (r.ok) {
    const b2 = await launch();
    try {
      const pg = await b2.newPage();
      await pg.goto(fileUrl(r.file) + '#/p/P03/month');
      await pg.waitFor('window.__PRD_READY === true');
      await sleep(400);
      await pg.evaluate('document.querySelectorAll("#right a[href^=javascript]").forEach(function(a){a.click()}); location.hash="#/doc"; 1');
      await sleep(500);
      const x = await pg.evaluate('({ xss: window.__xss || 0, js: document.querySelectorAll("a[href^=javascript]").length, onerr: document.querySelectorAll("[onerror]").length, ifr: document.querySelectorAll("#docbody iframe, #right iframe").length })');
      ok(x.xss === 0 && x.js === 0 && x.onerr === 0 && x.ifr === 0, '需求文字经过 DOMPurify 清洗：脚本、事件属性、javascript: 链接均被移除', JSON.stringify(x));
      await pg.close();
    } finally { await b2.close(); }
  }
}

/* ---------- 8. 脚手架 ---------- */
{
  const dir = variant(EXAMPLE, [[P03, "desc: '选择要统计的自然月，切换后表格和合计同时刷新。',", "desc: '选择要统计的自然月，切换后刷新。示意图：![](./shot.png)',"]]);
  const r = await build(dir, {});
  ok(!r.ok && hasCode(r, 'IMG_SRC'), '需求文字引用本地图片 → IMG_SRC');
  const dir2 = variant(EXAMPLE, [[P03, "desc: '选择要统计的自然月，切换后表格和合计同时刷新。',", "desc: '选择月份，TODO 补充口径',"]]);
  const r2 = await build(dir2, {});
  ok(!r2.ok && hasCode(r2, 'TEXT'), '需求文字留有占位（TODO）→ TEXT');
}

console.log('\n8. 脚手架');
{
  const dir = path.join(TMP, 'scaffold');
  execFileSync(process.execPath, [path.join(here, 'new.mjs'), dir, '--name', '测试产品', '--end', 'pc:管理后台', '--end', 'mobile:学员端'], { stdio: 'pipe' });
  ok(fs.existsSync(path.join(dir, 'prd', 'product.js')) && fs.existsSync(path.join(dir, 'prd', 'kit.js')) && fs.readdirSync(path.join(dir, 'prd', 'pages')).length === 2, '新建项目生成 product.js、kit.js 和每端首页模板');
  const r = await build(dir, {});
  ok(!r.ok && hasCode(r, 'PRODUCT') && hasCode(r, 'PAGE') && hasCode(r, 'STATE_WHEN') && hasCode(r, 'FN_DESC'), '空模板构建会逐项提示需要补的需求内容，而不是崩溃');
  let refused = false;
  try { execFileSync(process.execPath, [path.join(here, 'new.mjs'), dir, '--name', 'x'], { stdio: 'pipe' }); } catch (e) { refused = true; }
  ok(refused, '已有项目时拒绝覆盖');
  const hdir = path.join(TMP, 'scaffold-host');
  execFileSync(process.execPath, [path.join(here, 'new.mjs'), hdir, '--name', '托管', '--host', path.join(HOSTFX, 'existing', 'crm.html')], { stdio: 'pipe' });
  const hrr = await build(hdir, {});
  ok(!hrr.ok && hasCode(hrr, 'UNREGISTERED') && !hasCode(hrr, 'JS'), '托管模板构建能加载原型并列出未登记元素');
}

/* ---------- 9. 规范包（主题） ---------- */
console.log('\n9. 规范包（主题）');
const read = (f) => fs.readFileSync(f, 'utf8');
/* allowed: 选择器必须以 allowedPrefix 开头。wire.css 限定到 .ab；规范包只给 PC 画板，限定到 .ab[data-device="pc"] */
function unscopedSelectors(css, allowed = /^(\.ab\b|:where\(\.ab\)|\.hot \.ab\b)/) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const bad = [];
  const re = /([^{}]+)\{/g;
  let m;
  while ((m = re.exec(clean))) {
    const head = m[1].trim();
    if (head.startsWith('@')) continue;
    head.split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => {
      if (/^(to|from|\d+(\.\d+)?%)$/.test(s)) return;
      if (!allowed.test(s)) bad.push(s);
    });
  }
  return bad;
}
const PC_SCOPE = /^\.ab\[data-device="pc"\]/;
/* 每个状态的计算样式指纹：画板内所有元素的标签、class、关键计算样式。 */
const FP_JS = `(function(){
  var root = document.getElementById('ab');
  if (!root) return 'NO_AB';
  var props = ['color','background-color','font-size','font-weight','font-family','line-height','display','border-top-width','border-top-color','border-radius','padding-top','padding-left','margin-top','margin-left','text-align','opacity','position'];
  var all = [root].concat(Array.prototype.slice.call(root.querySelectorAll('*')));
  return all.map(function(el){
    var cs = getComputedStyle(el);
    return el.tagName + '.' + (el.getAttribute('class') || '') + ':' + props.map(function(p){ return cs.getPropertyValue(p); }).join('|');
  }).join('\\n');
})()`;
/* 逐个页面状态打开交付文件，返回 { 'P01/list': 指纹, ... }，以及每个页面的端类型 */
async function fingerprintAll(bt, file) {
  const pg = await bt.newPage({ width: 1600, height: 1000 });
  const out = {}, devices = {};
  try {
    await pg.goto(fileUrl(file));
    await pg.waitFor('window.__PRD_READY === true');
    const list = JSON.parse(await pg.evaluate('JSON.stringify(Object.keys(W.pages).map(function(id){ var p = W.pages[id]; return [id, (W.end(p.end) || {}).device || "pc", p.states.map(function(s){ return s.id; })]; }))'));
    for (const [pid, dev, states] of list) {
      devices[pid] = dev;
      for (const st of states) {
        await pg.evaluate('localStorage.clear(); 1');
        await pg.goto('about:blank');
        await pg.goto(fileUrl(file) + '#/p/' + pid + '/' + st);
        await pg.waitFor('window.__PRD_READY === true');
        await sleep(300);
        out[pid + '/' + st] = await pg.evaluate(FP_JS);
      }
    }
  } finally { await pg.close(); }
  return { fp: out, devices };
}
function digestOf(fp) {
  const h = crypto.createHash('sha256');
  Object.keys(fp).sort().forEach((k) => h.update(k + '\n' + fp[k] + '\n'));
  return h.digest('hex');
}
{
  const dir = path.join(TMP, 'theme-scaffold');
  execFileSync(process.execPath, [path.join(here, 'new.mjs'), dir, '--name', '主题测试', '--theme', 'gaodeng-pc', '--end', 'pc:管理后台'], { stdio: 'pipe' });
  ok(fs.existsSync(path.join(dir, 'prd', 'theme.css')) && fs.existsSync(path.join(dir, 'prd', 'theme-kit.js')), '选用规范包时 prd/ 下生成 theme.css 和 theme-kit.js');
  ok(/width: 1440, height: 900/.test(fs.readFileSync(path.join(dir, 'prd', 'product.js'), 'utf8')), '选用规范包时 PC 端默认 1440×900');
  let badTheme = false;
  try { execFileSync(process.execPath, [path.join(here, 'new.mjs'), path.join(TMP, 'theme-bad'), '--name', 'x', '--theme', 'no-such'], { stdio: 'pipe' }); } catch (e) { badTheme = true; }
  ok(badTheme, '规范包名称不存在时拒绝生成');
  let badHost = false;
  try { execFileSync(process.execPath, [path.join(here, 'new.mjs'), path.join(TMP, 'theme-host'), '--name', 'x', '--theme', 'gaodeng-pc', '--host', path.join(HOSTFX, 'existing', 'crm.html')], { stdio: 'pipe' }); } catch (e) { badHost = true; }
  ok(badHost, '托管模式不能与 --theme 同用');
  let badNoValue = false;
  try { execFileSync(process.execPath, [path.join(here, 'new.mjs'), path.join(TMP, 'theme-novalue'), '--name', 'x', '--theme'], { stdio: 'pipe' }); } catch (e) { badNoValue = true; }
  ok(badNoValue && !fs.existsSync(path.join(TMP, 'theme-novalue', 'prd', 'product.js')), '--theme 不带规范包名时报错，不生成线框项目');
}
const themed = variant(EXAMPLE, []);
installTheme(path.join(themed, 'prd'), 'gaodeng-pc');
const tr = await build(themed, {});
ok(tr.ok && fs.readFileSync(tr.file, 'utf8').includes('.ab[data-device="pc"] .btn.pri'), '带规范包的样例构建通过，主题样式内联进交付文件', tr.ok ? '' : JSON.stringify(tr.report.errors.slice(0, 3)));
if (tr.ok) {
  const bt = await launch();
  try {
    const pg = await bt.newPage({ width: 1600, height: 1000 });
    const open = async (file, hash) => { await pg.goto('about:blank'); await pg.goto(fileUrl(file) + hash); await pg.waitFor('window.__PRD_READY === true'); await sleep(400); };
    await open(tr.file, '#/p/P01/list');
    const sz = JSON.parse(await pg.evaluate(`JSON.stringify({
      pri: getComputedStyle(document.querySelector('#ab .btn.pri')).backgroundColor,
      priText: getComputedStyle(document.querySelector('#ab .btn.pri')).color,
      sm: getComputedStyle(document.querySelector('#ab .btn.sm')).height,
      td: getComputedStyle(document.querySelector('#ab .tbl td')).height,
      th: getComputedStyle(document.querySelector('#ab .tbl th')).height,
      tag: getComputedStyle(document.querySelector('#ab .tag')).borderRadius
    })`));
    ok(sz.pri === 'rgb(50, 100, 250)' && sz.priText === 'rgb(255, 255, 255)', '主按钮使用规范品牌色 #3264FA，文字白色（' + sz.pri + '）', JSON.stringify(sz));
    ok(sz.sm === '32px' && sz.td === '54px' && sz.th === '54px' && sz.tag === '2px', '按钮 32 高、表格单元格和表头 54 高、标签圆角 2px', JSON.stringify(sz));
    await open(tr.file, '#/p/P02/reject');
    const dlg = JSON.parse(await pg.evaluate(`JSON.stringify({
      w: getComputedStyle(document.querySelector('#ab .dlg')).width,
      head: getComputedStyle(document.querySelector('#ab .dlg h3')).height
    })`));
    ok(dlg.w === '480px' && dlg.head === '56px', '弹窗默认宽 480、头部 56（' + JSON.stringify(dlg) + '）');
    const kit = JSON.parse(await pg.evaluate(`(function () {
      var root = document.getElementById('ab');
      root.insertAdjacentHTML('beforeend', W.h.btn('测试', { sz: 'xs', cls: 'probe' }));
      var xs = getComputedStyle(document.querySelector('#ab .btn.probe')).height;
      document.querySelector('#ab .btn.probe').remove();
      var big = W.h.modal('t', 'b', '', { size: 'xl' });
      return JSON.stringify({
        xs: xs,
        pager3: W.h.pager(3),
        pager23: W.h.pager(23),
        pager23p2: W.h.pager(23, { page: 2 }),
        modalXl: big.indexOf('width:960px') >= 0,
        empty: W.h.empty('暂无数据', '', '', { kind: 'system' }),
        emptyTable: W.h.table(['a'], [], { empty: '暂无数据' })
      });
    })()`));
    ok(kit.xs === '24px', '辅助按钮 sz:xs 为 24 高', kit.xs);
    ok(kit.pager3.indexOf('共 3 条') >= 0 && kit.pager3.indexOf('pg-n') < 0, '分页：不足 10 行隐藏页码，保留“共 N 条”（按规范原文）', kit.pager3);
    ok(kit.pager23.indexOf('第 1~10 条 / 共 23 条') >= 0 && kit.pager23p2.indexOf('第 11~20 条 / 共 23 条') >= 0, '分页：超过 10 行显示页码和“第 X~Y 条 / 共 N 条”');
    ok(kit.modalXl && kit.empty.indexOf('data-empty="system"') >= 0 && kit.emptyTable.indexOf('class="emp"') >= 0 && kit.emptyTable.indexOf('<table') < 0, '弹窗四档宽度可选；整表无数据用缺省页替代表格');
  } finally { await bt.close(); }

  /* 外壳不受主题影响：同一路由下，有主题与无主题的外壳计算样式一致 */
  const shellProbe = `(function () {
    var sels = ['#top', '#top .brand', '#top .vbtn', '#left .nv-i', '#right .np h2', '#right .chip', '#right .np-sec h3', '.audit-badge'];
    var props = ['color', 'background-color', 'font-size', 'font-weight', 'font-family', 'line-height', 'border-radius', 'height', 'padding-left'];
    return sels.map(function (s) {
      var el = document.querySelector(s);
      if (!el) return s + ':none';
      var cs = getComputedStyle(el);
      return s + ':' + props.map(function (p) { return cs.getPropertyValue(p); }).join('|');
    }).join('\\n');
  })()`;
  const sb = await launch();
  try {
    const pg = await sb.newPage({ width: 1600, height: 1000 });
    const probe = async (file) => { await pg.goto('about:blank'); await pg.goto(fileUrl(file) + '#/p/P01/list'); await pg.waitFor('window.__PRD_READY === true'); await sleep(400); return pg.evaluate(shellProbe); };
    const plain = await probe(ex.file);
    const withTheme = await probe(tr.file);
    ok(plain === withTheme && plain.indexOf('none') < 0, '外壳关键元素的计算样式不受规范包影响', plain === withTheme ? '' : 'plain:\n' + plain + '\ntheme:\n' + withTheme);
  } finally { await sb.close(); }
}
/* 组件扩展守卫（不依赖样例页面）：theme-kit.js 覆盖的 h.empty、h.table、h.modal 在手机端必须与不带规范包时输出完全一致；
   PC 端确实走规范版（否则覆盖没生效）。样例的手机页没有调用这三个组件，所以单靠指纹测试覆盖不到。 */
{
  const RUNTIME_CORE = path.join(SKILL, 'assets', 'runtime', 'core.js');
  const KIT = path.join(SKILL, 'themes', 'gaodeng-pc', 'theme-kit.js');
  const mkH = (withKit, device) => {
    const win = { console, document: {}, addEventListener() {}, location: { href: 'about:blank' } };
    win.window = win;
    const ctx = vm.createContext(win);
    vm.runInContext(read(RUNTIME_CORE), ctx);
    if (withKit) vm.runInContext(read(KIT), ctx);
    ctx.W.device = device;
    return ctx.W.h;
  };
  const kitCases = {
    empty: (h) => h.empty('暂无数据', '请稍后再试', '<button>刷新</button>'),
    emptyNoDesc: (h) => h.empty('暂无数据', '', ''),
    emptySystem: (h) => h.empty('加载失败', '网络异常', '', { kind: 'system' }),
    tableEmpty: (h) => h.table(['a', 'b'], [], { empty: '暂无数据', emptyDesc: 'd' }),
    tableRows: (h) => h.table(['a'], [['x']], {}),
    modal: (h) => h.modal('标题', '正文', '<button>确定</button>'),
    modalSizeM: (h) => h.modal('标题', '正文', '', { size: 'm' }),
  };
  const run = (h, fn) => { try { return fn(h); } catch (e) { return 'THROW ' + e.message; } };
  const mobileDiff = Object.keys(kitCases).filter((k) => run(mkH(false, 'mobile'), kitCases[k]) !== run(mkH(true, 'mobile'), kitCases[k]));
  ok(mobileDiff.length === 0, '手机端调用 h.empty、h.table、h.modal，输出与不带规范包时完全一致（' + Object.keys(kitCases).length + ' 种调用）', mobileDiff.join(', '));
  const pcSame = Object.keys(kitCases).filter((k) => run(mkH(false, 'pc'), kitCases[k]) === run(mkH(true, 'pc'), kitCases[k]));
  ok(pcSame.length < Object.keys(kitCases).length, 'PC 端 h.empty、h.table、h.modal 使用规范版（覆盖已生效）');
  ok(run(mkH(true, 'mobile'), (h) => h.pager(23)) === '', '手机端 h.pager 返回空串（手机端没有分页组件）');
}
/* 选择器作用域守卫：wire.css 限定在 .ab 内；规范包只给 PC 画板，限定在 .ab[data-device="pc"] 内 */
{
  const wire = read(path.join(SKILL, 'assets', 'runtime', 'wire.css'));
  const packTheme = read(path.join(SKILL, 'themes', 'gaodeng-pc', 'theme.css'));
  const packTokens = read(path.join(SKILL, 'themes', 'gaodeng-pc', 'tokens.css'));
  const bad = [...unscopedSelectors(wire), ...unscopedSelectors(packTheme, PC_SCOPE), ...unscopedSelectors(packTokens, PC_SCOPE)];
  ok(bad.length === 0, 'wire.css 限定在 .ab 内，规范包限定在 .ab[data-device="pc"] 内', bad.slice(0, 10).join(' | '));
}
/* 规范包预览页：自己的 .ab 作用域里能取到变量（改动前的基准：正文色、字号、品牌按钮、色块） */
{
  const bp = await launch();
  try {
    const pg = await bp.newPage({ width: 1440, height: 900 });
    const pv = (f) => path.join(SKILL, 'themes', 'gaodeng-pc', 'preview', f);
    for (const f of ['colors.html', 'type.html', 'components.html']) {
      await pg.goto('about:blank');
      await pg.goto(fileUrl(pv(f)));
      await sleep(300);
      const r = JSON.parse(await pg.evaluate(`JSON.stringify({
        body: getComputedStyle(document.body).color,
        font: getComputedStyle(document.body).fontFamily,
        h1: getComputedStyle(document.querySelector('h1')).fontSize,
        transparentChips: [].slice.call(document.querySelectorAll('.chip')).filter(function (c) { return getComputedStyle(c).backgroundColor === 'rgba(0, 0, 0, 0)'; }).length,
        chips: document.querySelectorAll('.chip').length
      })`));
      ok(r.body === 'rgb(26, 34, 51)' && /PingFang/.test(r.font) && r.h1 === '28px', f + '：正文色、苹方字体、标题 28px 取到规范值（' + JSON.stringify(r) + '）');
      ok(r.chips === 0 || r.transparentChips === 0, f + '：色块都有颜色（' + r.chips + ' 个）');
    }
    await pg.goto('about:blank');
    await pg.goto(fileUrl(pv('components.html')));
    await sleep(300);
    const b = JSON.parse(await pg.evaluate(`JSON.stringify((function () {
      var el = document.querySelector('.btn-primary.btn-lg:not([disabled])');
      var cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, h: cs.height };
    })())`));
    ok(b.bg === 'rgb(50, 100, 250)' && b.h === '40px', '预览页主按钮为品牌色 #3264FA、40 高（' + JSON.stringify(b) + '）');
  } finally { await bp.close(); }
}

/* 请假审批：交付文件的指纹与仓库已提交的产物一致（改动前后渲染不变）。
   手机画板不套规范包：带规范包的构建，手机页的指纹与不带规范包的一致；PC 页则有变化。 */
{
  const COMMITTED = path.join(EXAMPLE, '请假审批-原型需求.html');
  const fb = await launch();
  try {
    const cur = await fingerprintAll(fb, ex.file);
    const committed = await fingerprintAll(fb, COMMITTED);
    const n = Object.keys(cur.fp).length;
    ok(n === 15, '请假审批样例共 15 个页面状态（' + n + '）', n);
    const d1 = digestOf(cur.fp), d2 = digestOf(committed.fp);
    ok(d1 === d2 && n === Object.keys(committed.fp).length, '请假审批样例渲染与仓库已提交的产物一致（' + n + ' 个页面状态的计算样式指纹）', d1 + ' / ' + d2);

    const themedFp = await fingerprintAll(fb, tr.file);
    const mobileKeys = Object.keys(cur.fp).filter((k) => cur.devices[k.split('/')[0]] === 'mobile');
    const pcKeys = Object.keys(cur.fp).filter((k) => cur.devices[k.split('/')[0]] !== 'mobile');
    const mobileDiff = mobileKeys.filter((k) => themedFp.fp[k] !== cur.fp[k]);
    ok(mobileKeys.length > 0 && mobileDiff.length === 0, '带规范包时，手机页的渲染与不带规范包时一致（' + mobileKeys.length + ' 个状态）', mobileDiff.slice(0, 5).join(', '));
    const pcDiff = pcKeys.filter((k) => themedFp.fp[k] !== cur.fp[k]);
    ok(pcKeys.length > 0 && pcDiff.length === pcKeys.length, '带规范包时，PC 页全部按规范包输出（' + pcDiff.length + '/' + pcKeys.length + ' 个状态有变化）');
  } finally { await fb.close(); }
}

/* ---------- 范围基线与验收条件 ---------- */
console.log('\n范围基线与验收条件');
{
  const SUBMIT_LINE = "id: 'submit', name: '提交申请',";
  const acVariant = (acText) => variant(EXAMPLE, [[M02, SUBMIT_LINE, SUBMIT_LINE + '\n      ' + acText + ',']]);
  const scopeWarns = (r) => r.report.warns.filter((w) => w.code.startsWith('SCOPE_'));

  /* 验收条件（ac） */
  const acWarns = ex.report.warns.filter((w) => w.code === 'AC_MISSING');
  ok(ex.ok && acWarns.some((w) => w.msg.includes('「提交申请」')) && acWarns.length === 5, '核心流程里没写 ac 的功能点按页面合并为 AC_MISSING 提醒（样例 ' + acWarns.length + ' 条，每页一条）', acWarns.map((w) => w.msg).join('\n'));
  ok(ex.ok && !/验收条件/.test(md), '没有写 ac 时，需求文档不出现“验收条件”一章');
  ok(exHtml.includes('id="prd-scope"'), '交付文件含范围基线占位（无基线时为空）');

  const acGood = variant(EXAMPLE, [[P03, "desc: '选择要统计的自然月，切换后表格和合计同时刷新。',", "desc: '选择要统计的自然月，切换后表格和合计同时刷新。',\n      ac: { pre: '已有请假单据', act: '选择上个月后查看统计', expect: '表格和合计同时刷新为上个月数据' },"]]);
  const rGood = await build(acGood, { md: true });
  const acMd = rGood.mdFile ? fs.readFileSync(rGood.mdFile, 'utf8') : '';
  ok(rGood.ok && /## \d+ 验收条件/.test(acMd) && acMd.includes('| P03 请假统计 | 统计月份 | 已有请假单据 | 选择上个月后查看统计 | 表格和合计同时刷新为上个月数据 |'), 'ac 写对时构建通过，需求文档单列“验收条件”一章', rGood.ok ? '' : JSON.stringify(rGood.report.errors));

  const rSubmit = await build(acVariant("ac: { act: '点击“提交申请”，时长超过可用余额', expect: '不提交，时长一行下方提示余额不足' }"), {});
  ok(rSubmit.ok && !rSubmit.report.warns.some((w) => w.code === 'AC_MISSING' && w.msg.includes('「提交申请」')), '核心流程功能点写了 ac 后不再出现在 AC_MISSING 中');

  const acBad = [
    ["ac: '写成了一句文字'", 'ac 写成文字而不是对象'],
    ["ac: { act: '点击“提交申请”', expect: '' }", 'expect 为空'],
    ["ac: { act: '点击', expect: '提示余额不足' }", 'act 太短'],
  ];
  for (const [acText, label] of acBad) {
    const r = await build(acVariant(acText), {});
    ok(!r.ok && codes(r).includes('AC'), '验收条件不合格（' + label + '）时阻止交付', r.ok ? 'ok' : JSON.stringify(r.report.errors.slice(0, 3)));
  }
  const rUnknown = await build(acVariant("ac: { act: '点击“提交申请”', expect: '提示余额不足', note: '多余字段' }"), {});
  ok(rUnknown.ok && rUnknown.report.warns.some((w) => w.code === 'UNKNOWN_KEY' && w.msg.includes('ac')), 'ac 里有未识别的字段时给提醒，不阻止交付');

  /* 范围基线：没有基线 */
  const scopeDir = variant(EXAMPLE, []);
  const sNone = await build(scopeDir, { md: true });
  ok(sNone.ok && scopeWarns(sNone).length === 0 && !/范围确认后新增/.test(fs.readFileSync(sNone.mdFile, 'utf8')), '没有范围基线时不做增删对比，需求文档不出现“范围确认后新增”');

  /* 流程 A：用户确认清单后按清单手写 scope.json（写页面之前），第一次构建就要能发现清单外的新增 */
  const LIST_BASE = {
    release: 'V1.0', confirmedAt: '2026-11-04',
    pages: ['M01', 'M02', 'M03', 'M04', 'P01', 'P02', 'P03'],
    states: ['M01/list', 'M01/empty', 'M02/form', 'M02/err', 'M02/confirm', 'M03/pending', 'M03/approved', 'M03/rejected', 'M03/withdraw', 'M04/me', 'P01/list', 'P01/empty', 'P02/detail', 'P02/reject', 'P03/month'],
    fns: ['M01/balance', 'M01/create', 'M01/records', 'M02/form', 'M02/submit', 'M02/confirm', 'M03/info', 'M03/progress', 'M03/withdraw', 'M03/again', 'M04/profile', 'P01/filter', 'P01/table', 'P02/summary', 'P02/history', 'P02/decide', 'P02/reject-form', 'P03/month-pick', 'P03/dept-table', 'P03/export', '公共/pc-shell/pc-nav', '公共/m-shell/m-tab']
  };
  const withList = (dir) => { fs.writeFileSync(path.join(dir, 'prd', 'scope.json'), JSON.stringify(LIST_BASE, null, 2)); return dir; };
  const M04 = 'prd/pages/M04-me.js';
  const sA0 = await build(withList(variant(EXAMPLE, [])), {});
  ok(sA0.ok && scopeWarns(sA0).length === 0, '按确认清单手写的基线与样例一致时，第一次构建没有增删提醒', JSON.stringify(scopeWarns(sA0)));
  const sA1 = await build(withList(variant(EXAMPLE, [[M04, "{ id: 'me', label: '默认', when: '任何员工进入' }", "{ id: 'me', label: '默认', when: '任何员工进入' },\n    { id: 'guest', label: '访客', when: '测试用的新增状态' }"]])), {});
  ok(sA1.ok && scopeWarns(sA1).some((w) => w.code === 'SCOPE_ADDED' && w.msg.includes('状态「访客」')), '清单之外新增的状态，第一次构建就报 SCOPE_ADDED', sA1.ok ? JSON.stringify(scopeWarns(sA1)) : JSON.stringify(sA1.report.errors.slice(0, 3)));
  const flowPage = variant(EXAMPLE, []);
  withList(flowPage);
  fs.writeFileSync(path.join(flowPage, 'prd', 'pages', 'M05-extra.js'), fs.readFileSync(path.join(flowPage, M04), 'utf8').replace("id: 'M04'", "id: 'M05'"));
  const sA2 = await build(flowPage, { md: true });
  const pageAdds = scopeWarns(sA2).filter((w) => w.code === 'SCOPE_ADDED');
  ok(sA2.ok && pageAdds.length === 3 && pageAdds.some((w) => w.msg.includes('页面 · M05')) && pageAdds.some((w) => w.msg.includes('状态「默认」')) && pageAdds.some((w) => w.msg.includes('功能点「个人信息」')), '清单之外新增的整页（M05）第一次构建就报 SCOPE_ADDED，页面、状态、功能点各一条', JSON.stringify(pageAdds.map((w) => w.msg)));
  ok(/## \d+ 范围确认后新增/.test(fs.readFileSync(sA2.mdFile, 'utf8')), '清单之外新增的页面列入需求文档“范围确认后新增”一章');

  /* 文档流程：基线在 new.mjs 之后写，且含脚手架生成的公共导航。两件事都要成立：
     1) 脚手架生成的公共功能点 ID 与 LIST_BASE 一致；2) 漏写公共导航时，第一次构建确实会误报两条 SCOPE_ADDED */
  const scaffold = path.join(TMP, 'scaffold-nav');
  execFileSync(process.execPath, [path.join(SKILL, 'scripts', 'new.mjs'), scaffold, '--name', '测试产品', '--end', 'pc:管理后台', '--end', 'mobile:员工手机端'], { stdio: 'pipe' });
  const kit = fs.readFileSync(path.join(scaffold, 'prd', 'kit.js'), 'utf8');
  ok(kit.includes("id: 'pc-shell'") && kit.includes("id: 'pc-nav'") && kit.includes("id: 'm-shell'") && kit.includes("id: 'm-tab'"), 'new.mjs 生成的 kit.js 公共导航 ID 为 pc-shell/pc-nav、m-shell/m-tab，与文档示例一致', kit.slice(0, 300));
  const noPublic = { ...LIST_BASE, fns: LIST_BASE.fns.filter((k) => !k.startsWith('公共/')) };
  const nd = variant(EXAMPLE, []);
  fs.writeFileSync(path.join(nd, 'prd', 'scope.json'), JSON.stringify(noPublic, null, 2));
  const sNP = await build(nd, {});
  const npAdds = scopeWarns(sNP).filter((w) => w.code === 'SCOPE_ADDED');
  ok(sNP.ok && npAdds.length === 2 && npAdds.some((w) => w.msg.includes('顶部导航与账号菜单')) && npAdds.some((w) => w.msg.includes('功能点「底部导航」')), '基线漏写公共导航时，第一次构建报两条 SCOPE_ADDED（PC 顶部导航、手机底部导航）', JSON.stringify(npAdds.map((w) => w.msg)));
  const specDoc = fs.readFileSync(path.join(SKILL, 'references', 'spec-format.md'), 'utf8');
  ok(specDoc.includes('公共/pc-shell/pc-nav') && !/pc-shell\/nav\b/.test(specDoc), '范围基线文档的公共功能点示例与脚手架生成的 ID 一致（pc-nav）');
  const noStates = variant(EXAMPLE, []);
  fs.writeFileSync(path.join(noStates, 'prd', 'scope.json'), JSON.stringify({ release: 'V1.0', confirmedAt: '2026-11-04', pages: ['M01'], fns: [] }));
  const sNoStates = await build(noStates, {});
  ok(!sNoStates.ok && codes(sNoStates).includes('SCOPE_FILE'), '范围基线缺少 states 时阻止交付（三项都要写）');

  /* 写入基线 */
  const sBase = await build(scopeDir, { scopeBaseline: true, md: true });
  const baseFile = path.join(scopeDir, 'prd', 'scope.json');
  const base = fs.existsSync(baseFile) ? JSON.parse(fs.readFileSync(baseFile, 'utf8')) : null;
  ok(sBase.ok && base && base.pages.length === 7 && base.states.includes('M02/form') && base.fns.includes('M02/submit') && base.release === sBase.release && /^\d{4}-\d{2}-\d{2}$/.test(base.confirmedAt || ''), '--scope-baseline 检查通过后写入 prd/scope.json（页面 7，含状态和功能点，记录版本与日期）', sBase.ok ? '' : JSON.stringify(sBase.report.errors.slice(0, 3)));
  const sSame = await build(scopeDir, {});
  ok(sSame.ok && scopeWarns(sSame).length === 0, '基线与当前清单一致时没有增删提醒');

  /* 基线之后新增功能点 */
  const addDir = variant(scopeDir, [['prd/pages/M04-me.js', '  fns: [\n', "  fns: [\n    { id: 'extra', name: '新增测试功能', desc: '确认范围后加入的功能点。', ui: false, src: '测试' },\n"]]);
  const sAdd = await build(addDir, { md: true });
  const addWarns = scopeWarns(sAdd);
  ok(sAdd.ok && addWarns.length === 1 && addWarns[0].code === 'SCOPE_ADDED' && addWarns[0].msg.includes('新增测试功能'), '基线之后新增的功能点给出 SCOPE_ADDED 提醒，且不阻止交付', JSON.stringify(addWarns));
  const addMd = sAdd.mdFile ? fs.readFileSync(sAdd.mdFile, 'utf8') : '';
  ok(/## \d+ 范围确认后新增/.test(addMd) && addMd.includes('| 功能点 | M04 我的 · 功能点「新增测试功能」 |'), '需求文档单列“范围确认后新增”，列出新增的功能点');

  /* 基线里有、原型里已没有 */
  const rmDir = variant(scopeDir, []);
  const rmFile = path.join(rmDir, 'prd', 'scope.json');
  const rmData = JSON.parse(fs.readFileSync(rmFile, 'utf8'));
  rmData.fns.push('M04/ghost');
  fs.writeFileSync(rmFile, JSON.stringify(rmData, null, 2));
  const sRm = await build(rmDir, { md: true });
  ok(sRm.ok && scopeWarns(sRm).some((w) => w.code === 'SCOPE_REMOVED' && w.msg.includes('M04/ghost')) && /确认之后已从原型中移除/.test(fs.readFileSync(sRm.mdFile, 'utf8')), '基线中有、原型中已删除的功能点给出 SCOPE_REMOVED 提醒，并列入文档');

  /* 刷新基线：新增内容纳入基线后不再提醒 */
  const sRefresh = await build(addDir, { scopeBaseline: true, md: true });
  const refreshedData = JSON.parse(fs.readFileSync(path.join(addDir, 'prd', 'scope.json'), 'utf8'));
  ok(sRefresh.ok && sRefresh.baseline && refreshedData.fns.includes('M04/extra') && scopeWarns(sRefresh).length === 0 && /确认之后没有新增的页面、状态或功能点/.test(fs.readFileSync(sRefresh.mdFile, 'utf8')), '--scope-baseline 刷新后，新增内容纳入基线，不再提醒，文档也不再列出');

  /* 检查未通过时不刷新基线 */
  const failDir = variant(scopeDir, [[P03, "desc: '选择要统计的自然月，切换后表格和合计同时刷新。',", "desc: '',"]]);
  const failFile = path.join(failDir, 'prd', 'scope.json');
  const before = fs.readFileSync(failFile, 'utf8');
  const sFail = await build(failDir, { scopeBaseline: true });
  ok(!sFail.ok && fs.readFileSync(failFile, 'utf8') === before, '检查未通过时不刷新基线，原来的 scope.json 保持不变');

  /* 基线文件格式错误 */
  const badDir = variant(EXAMPLE, []);
  fs.writeFileSync(path.join(badDir, 'prd', 'scope.json'), '{"pages": "M01"}');
  const sBad = await build(badDir, {});
  ok(!sBad.ok && codes(sBad).includes('SCOPE_FILE'), '范围基线格式不对（pages 不是数组）时阻止交付，并给出 SCOPE_FILE');

  /* 刷新时记录用户确认日期 */
  const sDate = await build(scopeDir, { scopeBaseline: true, confirmedAt: '2026-11-03' });
  const dateBase = JSON.parse(fs.readFileSync(path.join(scopeDir, 'prd', 'scope.json'), 'utf8'));
  ok(sDate.ok && dateBase.confirmedAt === '2026-11-03', '--confirmed-at 指定后，基线记录用户确认范围的日期');
  const badDate = await build(scopeDir, { scopeBaseline: true, confirmedAt: '11/03' }).then(() => false, () => true);
  const dateNoBase = await build(scopeDir, { confirmedAt: '2026-11-03' }).then(() => false, () => true);
  ok(badDate && dateNoBase, '--confirmed-at 格式不对，或没有和 --scope-baseline 一起用时拒绝执行');
  const cliNoVal = (() => { try { execFileSync(process.execPath, [path.join(SKILL, 'scripts', 'build.mjs'), scopeDir, '--scope-baseline', '--confirmed-at'], { stdio: 'pipe' }); return null; } catch (e) { return e; } })();
  ok(cliNoVal && cliNoVal.status === 2 && /缺少日期值/.test(String(cliNoVal.stderr)), '--confirmed-at 缺少日期值时命令行报错退出，不会静默忽略');
}

console.log('\n结果：' + pass + ' 通过，' + failN + ' 失败');
if (failN) console.log('失败项：\n  - ' + fails.join('\n  - '));
if (!KEEP && !failN) fs.rmSync(TMP, { recursive: true, force: true });
else console.log('临时目录保留：' + TMP);
process.exit(failN ? 1 : 0);
