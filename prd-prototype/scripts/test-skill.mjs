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
import { build, auditSingleFile, inlineHost } from './build.mjs';
import { launch, fileUrl, sleep, waitHost } from './lib/browser.mjs';

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
ok(ex.ok && !/Mermaid \d[\d.]*（MIT）/.test(exHtml), '未使用流程图时不内嵌 Mermaid（体积 ' + Math.round((ex.size || 0) / 1024) + ' KB）');
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
ok(ex.ok && !/为必填项，为空时不能提交|提交前先校验必填项|提交中按钮禁用/.test(md), '请假审批没有 h.form / h.submit，不生成表单行为规则（不写“X为必填项”等）');

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

  /* 顶部模块切换下拉框：宽屏和 390 宽窄屏都能看到、能点开、能用键盘选 */
  const key = (k) => page.evaluate('document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: ' + JSON.stringify(k) + ', bubbles: true })); 1');
  const vsw = () => page.evaluate(`JSON.stringify((function () {
    var b = document.getElementById('vsw-btn'), m = document.getElementById('vsw-menu'), r = b.getBoundingClientRect(), mr = m.getBoundingClientRect();
    var top = document.getElementById('top');
    return { cur: document.getElementById('vsw-cur').textContent, exp: b.getAttribute('aria-expanded'), hidden: m.hidden, role: m.getAttribute('role'),
      opts: [].map.call(m.querySelectorAll('[role=option]'), function (o) { return o.dataset.tab + (o.getAttribute('aria-selected') === 'true' ? '*' : ''); }).join(','),
      focus: document.activeElement.dataset.tab || document.activeElement.id, btnW: Math.round(r.width), btnL: Math.round(r.left), btnR: Math.round(r.right),
      menuL: Math.round(mr.left), menuR: Math.round(mr.right), menuB: Math.round(mr.bottom), topOverflow: top.scrollWidth > top.clientWidth,
      toolsOut: [].filter.call(document.querySelectorAll('#top .vtools > *'), function (el) { var q = el.getBoundingClientRect(); return q.width && getComputedStyle(el).display !== 'none' && (q.right > innerWidth + 1 || q.bottom > top.getBoundingClientRect().bottom + 1); }).length,
      label: b.getAttribute('aria-label'), curCut: (function (c) { return c.scrollWidth > c.clientWidth || c.clientWidth === 0; })(document.getElementById('vsw-cur')),
      nOut: document.querySelector('#vsw-btn .vsw-n').getBoundingClientRect().right > r.right + 1 };
  })())`).then(JSON.parse);
  for (const [w, hgt] of [[1600, 1000], [1024, 768], [390, 844]]) {
    await page.setViewport(w, hgt);
    await go(ex.file, '#/doc');
    const v0 = await vsw();
    ok(v0.cur === '需求文档' && v0.exp === 'false' && v0.hidden && v0.role === 'listbox' && v0.opts === 'doc*,m,pc,flow' && v0.label === '切换查看内容，当前：需求文档' && !v0.topOverflow && v0.btnR <= w && !v0.curCut && !v0.nOut,
      w + ' 宽：顶部切换是收起的下拉框，完整显示当前“需求文档”，选项为需求文档、两个端和核心流程，顶栏不溢出', JSON.stringify(v0));
    if (w === 1024) ok(v0.toolsOut === 0 && v0.btnW >= 150, '1024 宽：顶栏分两行，下拉框不被工具按钮挤窄（宽 ' + v0.btnW + 'px），工具按钮都可见', JSON.stringify(v0));
    if (w === 390) ok(v0.btnW >= 280 && v0.toolsOut === 0, '390 宽：下拉框单独占第一行（宽 ' + v0.btnW + 'px），工具按钮都在第二行可见', JSON.stringify(v0));
    await page.evaluate('document.getElementById("vsw-btn").click(); 1');
    await sleep(150);
    const v1 = await vsw();
    ok(v1.exp === 'true' && !v1.hidden && v1.focus === 'doc' && v1.menuL >= 0 && v1.menuR <= w && v1.menuB <= hgt, w + ' 宽：点开后列表完整显示在窗口内，焦点在当前项', JSON.stringify(v1));
    await page.evaluate('document.querySelector("#vsw-menu [data-tab=pc]").click(); 1');
    await sleep(400);
    const v2 = await vsw();
    const d2 = await page.evaluate('W.viewerDiag()');
    ok(v2.hidden && v2.exp === 'false' && v2.cur === '审批台（PC）' && /pc\*/.test(v2.opts) && d2.view === 'page' && d2.page === 'P01', w + ' 宽：点选项后收起，切到该端首页，按钮显示新的当前项', JSON.stringify([v2, d2.page]));
  }
  await page.setViewport(1600, 1000);
  await go(ex.file, '#/doc');
  await page.evaluate('document.getElementById("vsw-btn").focus(); 1');
  await key('ArrowDown');
  const k1 = await vsw();
  await key('ArrowDown'); await key('ArrowDown');
  const k2 = await vsw();
  await key('End');
  const k3 = await vsw();
  await key('Escape');
  const k4 = await vsw();
  await key('Enter');
  await key('Home'); await key('ArrowDown');
  await key('Enter');
  await sleep(400);
  const k5 = await vsw();
  const kd = await page.evaluate('W.viewerDiag()');
  ok(!k1.hidden && k1.focus === 'doc' && k2.focus === 'pc' && k3.focus === 'flow' && k4.hidden && k4.focus === 'vsw-btn' && k5.hidden && k5.focus === 'vsw-btn' && kd.page === 'M01' && k5.cur === '员工手机端',
    '键盘：↓ 打开并聚焦当前项，↓ / End 移动，Esc 收起并回到按钮，Enter 选中后切换并收起', JSON.stringify({ k1: k1.focus, k2: k2.focus, k3: k3.focus, k4: [k4.hidden, k4.focus], k5: [k5.hidden, k5.focus, k5.cur], page: kd.page }));
  await page.evaluate('document.getElementById("vsw-btn").click(); 1');
  await key('h');
  const hk = await page.evaluate('document.body.classList.contains("hot")');
  await page.evaluate('document.body.click(); 1');
  await sleep(100);
  const outside = await vsw();
  ok(!hk && outside.hidden, '下拉框打开时按 H 不触发热区；点外面收起');
  /* 用鼠标选完后焦点回到按钮，H 等快捷键仍要生效（旧标签栏点完就能按 H） */
  await page.evaluate('document.getElementById("vsw-btn").click(); 1');
  await page.evaluate('document.querySelector("#vsw-menu [data-tab=pc]").click(); 1');
  await sleep(300);
  const hf = await page.evaluate('document.activeElement.id');
  await key('h');
  const hk2 = await page.evaluate('document.body.classList.contains("hot")');
  await key('h');
  ok(hf === 'vsw-btn' && hk2, '选完切换项后焦点在按钮上，按 H 仍能打开热区', JSON.stringify({ hf, hk2 }));
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

/* ---------- 9. 高保真（项目自带样式） ---------- */
console.log('\n9. 高保真（项目自带样式）');
const read = (f) => fs.readFileSync(f, 'utf8');
/* 课程管理样例的高保真样式（模型自拟，不对应任何公司规范），用来测“项目自带 theme.css + theme-kit.js”这条路径 */
const HIFI_PRD = path.join(SKILL, 'examples', 'course-mgmt', 'prd');
const HIFI_CSS = path.join(HIFI_PRD, 'theme.css');
const HIFI_KIT = path.join(HIFI_PRD, 'theme-kit.js');
/* allowed: 选择器必须以 allowedPrefix 开头。wire.css 限定到 .ab；样例的高保真样式只给 PC 画板，限定到 .ab[data-device="pc"] */
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
  const dir = path.join(TMP, 'hifi-scaffold');
  execFileSync(process.execPath, [path.join(here, 'new.mjs'), dir, '--name', '高保真测试', '--hifi', '--end', 'pc:管理后台', '--end', 'mobile:学员端'], { stdio: 'pipe' });
  const prodSrc = fs.readFileSync(path.join(dir, 'prd', 'product.js'), 'utf8');
  const css = fs.existsSync(path.join(dir, 'prd', 'theme.css')) ? read(path.join(dir, 'prd', 'theme.css')) : '';
  ok(css.includes('references/hifi.md') && !fs.existsSync(path.join(dir, 'prd', 'theme-kit.js')), '--hifi 生成 prd/theme.css 骨架（指向 references/hifi.md），不生成组件扩展');
  ok(/id: 'pc'[^\n]*width: 1440, height: 900/.test(prodSrc) && !/id: 'm'[^\n]*width: 1440/.test(prodSrc) && prodSrc.includes("fidelity: '高保真（视觉由 AI 自拟）'"), '--hifi 时 PC 端默认 1440×900、手机端不变，fidelity 写“高保真（视觉由 AI 自拟）”');
  ok(unscopedSelectors(css).length === 0, '--hifi 骨架里的选择器都限定在 .ab 内');
  const sk = await build(dir, {});
  ok(!sk.ok && !hasCode(sk, 'JS') && !hasCode(sk, 'SINGLE_FILE'), '--hifi 骨架项目能正常加载（只报需求内容未填）');
  let themeErr = '', themeRefused = false;
  try { execFileSync(process.execPath, [path.join(here, 'new.mjs'), path.join(TMP, 'theme-gone'), '--name', 'x', '--theme', 'gaodeng-pc'], { stdio: 'pipe' }); } catch (e) { themeRefused = true; themeErr = String(e.stderr || ''); }
  ok(themeRefused && /--theme 已移除/.test(themeErr) && /--hifi/.test(themeErr) && !fs.existsSync(path.join(TMP, 'theme-gone', 'prd', 'product.js')), '--theme 已移除：报错说明改用 --hifi，不生成项目', themeErr);
  let badHost = false;
  try { execFileSync(process.execPath, [path.join(here, 'new.mjs'), path.join(TMP, 'hifi-host'), '--name', 'x', '--hifi', '--host', path.join(HOSTFX, 'existing', 'crm.html')], { stdio: 'pipe' }); } catch (e) { badHost = true; }
  ok(badHost && !fs.existsSync(path.join(TMP, 'hifi-host', 'prd', 'product.js')), '托管模式不能与 --hifi 同用');
  ok(!fs.existsSync(path.join(SKILL, 'themes')) && !fs.existsSync(path.join(SKILL, 'scripts', 'lib', 'theme.mjs')), '技能里不再有设计规范包（themes/、scripts/lib/theme.mjs 已移除）');
  /* 技能文件里只允许兼容提示提到旧规范包名：new.mjs（--theme 报错）、build.mjs（旧项目提示）、本测试 */
  const mention = [];
  const walk = (d) => fs.readdirSync(d).forEach((n) => {
    const f = path.join(d, n);
    if (fs.statSync(f).isDirectory()) { if (n !== 'vendor' && n !== '.prd-build') walk(f); return; }
    if (!/\.(js|mjs|css|md|tpl|yaml|json)$/.test(n)) return;
    if (/gaodeng|高教|高等教育事业部/.test(read(f))) mention.push(path.relative(SKILL, f));
  });
  walk(SKILL);
  const allowed = ['scripts/new.mjs', 'scripts/build.mjs', 'scripts/test-skill.mjs'];
  ok(mention.every((f) => allowed.includes(f.split(path.sep).join('/'))), '技能文件里不再引用公司设计规范（只在兼容提示里提到旧名）', mention.join(', '));
}
/* 兼容：旧项目 prd/ 下自带从规范包复制来的 theme.css、theme-kit.js，构建照常纳入，命令行给一句提示 */
{
  const legacy = variant(EXAMPLE, []);
  fs.writeFileSync(path.join(legacy, 'prd', 'theme.css'), '/* gaodeng-pc · tokens.css（旧项目里的副本） */\n.ab[data-device="pc"] { --acc: #3264fa; }\n.ab[data-device="pc"] .btn.pri { background: var(--acc); }\n');
  fs.writeFileSync(path.join(legacy, 'prd', 'theme-kit.js'), '/* gaodeng-pc 组件扩展（旧项目里的副本） */\n(function () { W.h.legacyProbe = function () { return "kit-loaded"; }; })();\n');
  const lr = await build(legacy, {});
  const lhtml = lr.ok ? read(lr.file) : '';
  ok(lr.ok && lhtml.includes('.ab[data-device="pc"] .btn.pri { background: var(--acc); }') && lhtml.includes('W.h.legacyProbe') && JSON.stringify(lr.legacyTheme) === JSON.stringify(['theme.css', 'theme-kit.js']), '旧项目自带的 theme.css、theme-kit.js 照常内联，构建通过，并识别出来源于旧规范包', lr.ok ? JSON.stringify(lr.legacyTheme) : JSON.stringify(lr.report.errors.slice(0, 3)));
  const out = execFileSync(process.execPath, [path.join(here, 'build.mjs'), legacy], { encoding: 'utf8' });
  ok(/已移除的设计规范包 gaodeng-pc/.test(out) && /references\/hifi\.md/.test(out) && /检查通过/.test(out), '构建命令行对旧规范包副本给出提示（不阻止交付）', out.slice(-600));
  ok(ex.ok && ex.legacyTheme.length === 0, '没有旧规范包副本的项目不出这条提示');
}
const themed = variant(EXAMPLE, []);
fs.copyFileSync(HIFI_CSS, path.join(themed, 'prd', 'theme.css'));
fs.copyFileSync(HIFI_KIT, path.join(themed, 'prd', 'theme-kit.js'));
const tr = await build(themed, {});
ok(tr.ok && fs.readFileSync(tr.file, 'utf8').includes('.ab[data-device="pc"] .btn.pri'), '请假审批套上样例的高保真样式后构建通过，样式内联进交付文件', tr.ok ? '' : JSON.stringify(tr.report.errors.slice(0, 3)));
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
    ok(sz.pri === 'rgb(15, 110, 102)' && sz.priText === 'rgb(255, 255, 255)', '主按钮取项目 theme.css 的主色 #0f6e66，文字白色（' + sz.pri + '）', JSON.stringify(sz));
    ok(sz.sm === '30px' && parseFloat(sz.td) >= 52 && parseFloat(sz.td) <= 53 && sz.th === '44px' && sz.tag === '999px', '项目样式生效：小按钮 30 高、表格行约 52 高（含行线）、表头 44 高、标签胶囊形', JSON.stringify(sz));
    await open(tr.file, '#/p/P02/reject');
    const dlg = JSON.parse(await pg.evaluate(`JSON.stringify({
      w: getComputedStyle(document.querySelector('#ab .dlg')).width,
      head: getComputedStyle(document.querySelector('#ab .dlg h3')).height
    })`));
    ok(dlg.w === '480px' && dlg.head === '60px', '组件扩展生效：弹窗默认宽 480，头部 60（' + JSON.stringify(dlg) + '）');
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
    ok(kit.pager3.indexOf('共 3 条') >= 0 && kit.pager3.indexOf('pg-n') < 0, '分页：不足 10 行隐藏页码，保留“共 N 条”', kit.pager3);
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
    ok(plain === withTheme && plain.indexOf('none') < 0, '外壳关键元素的计算样式不受项目高保真样式影响', plain === withTheme ? '' : 'plain:\n' + plain + '\ntheme:\n' + withTheme);
  } finally { await sb.close(); }
}
/* 组件扩展守卫（不依赖样例页面）：样例 theme-kit.js 覆盖的 h.empty、h.table、h.modal 在手机端必须与不带扩展时输出完全一致；
   PC 端确实走扩展版（否则覆盖没生效）。请假审批的手机页没有调用这三个组件，所以单靠指纹测试覆盖不到。 */
{
  const RUNTIME_CORE = path.join(SKILL, 'assets', 'runtime', 'core.js');
  const KIT = HIFI_KIT;
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
  ok(mobileDiff.length === 0, '手机端调用 h.empty、h.table、h.modal，输出与不带组件扩展时完全一致（' + Object.keys(kitCases).length + ' 种调用）', mobileDiff.join(', '));
  const pcSame = Object.keys(kitCases).filter((k) => run(mkH(false, 'pc'), kitCases[k]) === run(mkH(true, 'pc'), kitCases[k]));
  ok(pcSame.length < Object.keys(kitCases).length, 'PC 端 h.empty、h.table、h.modal 使用扩展版（覆盖已生效）');
  ok(run(mkH(true, 'mobile'), (h) => h.pager(23)) === '', '手机端 h.pager 返回空串（手机端没有分页组件）');
}
/* 选择器作用域守卫：wire.css 限定在 .ab 内；样例的高保真样式只给 PC 画板，限定在 .ab[data-device="pc"] 内 */
{
  const wire = read(path.join(SKILL, 'assets', 'runtime', 'wire.css'));
  const bad = [...unscopedSelectors(wire), ...unscopedSelectors(read(HIFI_CSS), PC_SCOPE)];
  ok(bad.length === 0, 'wire.css 限定在 .ab 内，样例高保真样式限定在 .ab[data-device="pc"] 内', bad.slice(0, 10).join(' | '));
}

/* 请假审批：交付文件的指纹与仓库已提交的产物一致（改动前后渲染不变）。
   样例的高保真样式只作用于 PC 画板：套上后手机页的指纹与线框一致；PC 页则有变化。 */
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
    ok(mobileKeys.length > 0 && mobileDiff.length === 0, '套上 PC 高保真样式后，手机页的渲染与线框一致（' + mobileKeys.length + ' 个状态）', mobileDiff.slice(0, 5).join(', '));
    const pcDiff = pcKeys.filter((k) => themedFp.fp[k] !== cur.fp[k]);
    ok(pcKeys.length > 0 && pcDiff.length === pcKeys.length, '套上 PC 高保真样式后，PC 页全部按项目样式输出（' + pcDiff.length + '/' + pcKeys.length + ' 个状态有变化）');
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

/* ---------- 10. 组件内置行为：必填与长度、提交、筛选 ---------- */
console.log('\n10. 组件内置行为（必填与长度、提交、搜索筛选）');
const BEH = path.join(SKILL, 'tests', 'fixtures', 'behave');
{
  const fx = await build(variant(BEH, []), { md: true });
  ok(fx.ok, '组件行为夹具构建通过', fx.ok ? '' : JSON.stringify(fx.report.errors.slice(0, 5)));
  if (fx.ok) {
    const fxMd = fs.readFileSync(fx.mdFile, 'utf8');
    ok(['请假事由为必填项，为空时不能提交', '请假事由长度为 5–200 个字', '提交前先校验必填项和长度', '提交中按钮禁用，重复点击只提交一次', '没有匹配的结果'].every((t) => fxMd.includes(t)), '组件行为自动写入需求文档（必填、长度、提交、筛选）');
  }
  const rq1 = await build(variant(BEH, [['prd/pages/M02-apply.js', 'required: true, rule', 'required: false, rule']]), {});
  ok(!rq1.ok && codes(rq1).includes('FIELD_REQ'), 'fields 写 required: false 而界面是必填时构建报错（FIELD_REQ）', JSON.stringify(codes(rq1)));
  const rq2 = await build(variant(BEH, [['prd/pages/M02-apply.js', '{ req: 1, min: 5', '{ min: 5']]), {});
  ok(!rq2.ok && codes(rq2).includes('FIELD_REQ'), 'fields 写 required: true 而界面没有 req 时构建报错（FIELD_REQ）', JSON.stringify(codes(rq2)));
  const rq3 = await build(variant(BEH, [['prd/pages/M02-apply.js', "{ req: 1, min: 5, max: 200, fn: 'form', field: 'reason' }", "{ min: 5, max: 200, fn: 'form', field: 'reason' }"], ['prd/pages/M02-apply.js', "rows: 3, field: 'reason', fn: 'form' })", "rows: 3, fn: 'form' })"]]), {});
  ok(!rq3.ok && codes(rq3).includes('FIELD_REQ'), 'data-field 只写在 h.fld 上（控件没有）时也检查必填一致性（FIELD_REQ）', JSON.stringify(codes(rq3)));
  const noFail = await build(variant(BEH, [['prd/product.js', "{ id: 'submit-fail', label: '提交失败', set: 'submitFail=true' },", '']]), { md: true });
  const noFailMd = noFail.mdFile ? fs.readFileSync(noFail.mdFile, 'utf8') : '';
  ok(noFail.ok && noFailMd.includes('提交失败时保留已填内容并提示，可直接重试') && !noFailMd.includes('演示首次提交失败'), '没有提交失败的数据场景时，规则不提“可在数据场景中切换”', noFail.ok ? '' : JSON.stringify(noFail.report.errors.slice(0, 2)));

  const bb = await launch();
  try {
    const pg = await bb.newPage({ width: 1200, height: 900 });
    const open = async (hash) => { await pg.goto('about:blank'); await pg.goto(fileUrl(fx.file) + hash); await pg.waitFor('window.__PRD_READY === true'); await sleep(300); };
    const ev = (s) => pg.evaluate(s);
    const count = () => ev('W.get("list.items").length');
    const setReason = (v) => ev('(function(){var t=document.querySelector("#ab textarea");t.value=' + JSON.stringify(v) + ';t.dispatchEvent(new Event("input",{bubbles:true}));return 1})()');
    const clicks = (n) => ev('(function(){var b=document.querySelector("#ab button[data-form]");for(var i=0;i<' + n + ';i++)b.click();return 1})()');
    const errText = () => ev('(function(){var e=document.querySelector("#ab .ferr[data-auto]");return e?e.textContent:""})()');
    const formErr = () => ev('!!document.querySelector("#ab .wb-form-err")');

    /* 清空必填提交被拦 */
    await open('#/p/M02/form');
    const base0 = await count();
    await setReason('');
    await clicks(1);
    await sleep(900);
    ok((await errText()).indexOf('请填写请假事由') >= 0 && (await count()) === base0 && (await ev('location.hash')).indexOf('M02') >= 0, '清空必填后提交被拦：字段下方提示，不写入数据，仍停留在表单');
    /* 长度不足同样被拦 */
    await setReason('好');
    await clicks(1);
    await sleep(900);
    ok((await errText()).indexOf('至少 5 个字') >= 0 && (await count()) === base0, '事由不足 5 个字时提交被拦并提示长度');

    /* 连续点提交只算一次 */
    await setReason('家中有事需回老家处理');
    await clicks(3);
    await sleep(1100);
    ok((await count()) === base0 + 1 && (await ev('location.hash')).indexOf('M01') >= 0, '连续点击三次提交，只新增一条，并回到列表（' + (await count()) + ' 条）');
    ok((await ev('document.querySelector("#ab").textContent')).indexOf('家中有事需回老家处理') >= 0, '提交成功后列表中的演示数据已更新');

    /* 失败后重试成功：通过界面上的数据场景按钮打开“提交失败”，不直接改数据 */
    await open('#/p/M02/form');
    const base1 = await count();
    await ev('document.querySelector("#right [data-preset=submit-fail]").click(); 1');
    await sleep(400);
    ok(await ev('W.get("submitFail") === true && !!document.querySelector("#right .chip.on[data-preset=submit-fail]") && location.hash.indexOf("M02") >= 0'), '点数据场景“提交失败”：场景按钮选中，表单仍在 M02');
    await setReason('发烧三天，需要去医院复诊');
    await clicks(1);
    await sleep(1100);
    ok((await formErr()) && (await count()) === base1 && (await ev('document.querySelector("#ab textarea").value')).indexOf('发烧三天') >= 0, '提交失败：提示错误，保留已填内容，不写入数据');
    ok((await ev('document.querySelector("#ab button[data-form]").disabled')) === false, '失败后提交按钮恢复可点，可以重试');
    await clicks(1);
    await sleep(1100);
    ok((await count()) === base1 + 1 && (await ev('location.hash')).indexOf('M01') >= 0, '重试成功：列表新增一条并回到列表');
    ok((await ev('(function(){var r=W.get("list.items")[0];return r.no==="新申请"&&r.type==="事假"&&r.reason.indexOf("发烧三天")===0})()')) === true, '新增的请假单带有表单外字段的默认值（编号、类型），表单值为事由');

    /* 搜索筛选出无结果 */
    await open('#/p/M01/list');
    const visibleRows = () => ev('Array.prototype.filter.call(document.querySelectorAll("#ab [data-frow]"), function(r){return r.style.display!=="none"}).length');
    const noMatchShown = () => ev('(function(){var n=document.querySelector("#ab [data-fnomatch]");return !!n && n.style.display!=="none"})()');
    const typeKw = (v) => ev('(function(){var i=document.querySelector("#ab input[data-filter]");i.value=' + JSON.stringify(v) + ';i.dispatchEvent(new Event("input",{bubbles:true}));return 1})()');
    await typeKw('zzz不存在');
    ok((await visibleRows()) === 0 && (await noMatchShown()), '搜索无匹配时隐藏全部请假单，并显示“没有匹配的结果”');
    await typeKw('QJ001');
    ok((await visibleRows()) === 1 && !(await noMatchShown()), '按单号搜索只留下匹配的一条，无结果提示隐藏');
    await typeKw('');
    ok((await visibleRows()) === (await count()) && !(await noMatchShown()), '清空搜索后恢复全部请假单');
  } finally { await bb.close(); }
}

/* ---------- 11. 高保真样例：课程管理（视觉由 AI 自拟，只做 PC 端） ---------- */
console.log('\n11. 高保真样例（课程管理）');
{
  const COURSE = path.join(SKILL, 'examples', 'course-mgmt');
  const cm = await build(variant(COURSE, []), { md: true });
  ok(cm.ok, '课程管理高保真样例（PC 端）构建通过', cm.ok ? '' : JSON.stringify(cm.report.errors.slice(0, 3)));
  const cmMd = cm.mdFile ? fs.readFileSync(cm.mdFile, 'utf8') : '';
  ok(cm.ok && /【AI 假设】/.test(cmMd) && cm.report.stats.assumed > 0 && cm.report.stats.pending === 0, '课程管理需求文档标出 AI 假设且没有待确认项（AI 假设 ' + (cm.report.stats ? cm.report.stats.assumed : 0) + ' 条）');
  ok(cm.ok && cmMd.includes('课程名称为必填项，为空时不能提交') && cmMd.includes('课程代码长度为 6–12 个字，不在此范围内时不能提交'), '课程管理需求文档由 h.fld 的 req / min / max 生成必填与长度规则');
  /* 仓库里提交的需求文档与当前源码重新构建的结果一致（产物没有过期）；忽略“结构检查通过（日期）”这一天然随日历变化的戳 */
  const cmCommitted = fs.readFileSync(path.join(COURSE, '课程管理-需求文档.md'), 'utf8');
  const stripBuildDate = (s) => s.replace(/结构检查通过（\d{4}-\d{2}-\d{2}）/g, '结构检查通过（日期忽略）');
  ok(cm.ok && stripBuildDate(cmMd) === stripBuildDate(cmCommitted), '课程管理需求文档与仓库已提交的版本一致（产物未过期，已忽略构建日期戳）');
  /* 分页说明：每页 10 条，少于 10 条写“不足”；搜索计数是原型限制，单独成句 */
  ok(cm.ok && cmMd.includes('课程不足 10 条时只显示“共 N 条”') && !cmMd.includes('不超过 10 条') && cmMd.includes('原型只展示第 1 页，搜索时计数不变'), '课程管理分页说明写作“不足 10 条”，原型限制单独成句');
  /* 浏览器：列表按样例 theme.css 第 7 节取值渲染；超过 10 条时只渲染第 1 页的 10 行，与分页文字一致 */
  if (cm.ok) {
    const bc = await launch();
    try {
      const pg = await bc.newPage({ width: 1520, height: 1080 });
      const open = async (hash) => { await pg.goto('about:blank'); await pg.goto(fileUrl(cm.file) + hash); await pg.waitFor('window.__PRD_READY === true'); await sleep(300); };
      await open('#/p/P01/list');
      /* 用 offsetHeight 量高度：页面默认“适应窗口”缩放，getBoundingClientRect 会带上缩放比例 */
      const styleJs = `JSON.stringify((function(){
        var hd = document.querySelector('#ab [data-fscope]').previousElementSibling, row = document.querySelector('#ab [data-frow] > .row');
        var a = getComputedStyle(hd), b = getComputedStyle(row);
        return { hh: hd.offsetHeight, hbg: a.backgroundColor, hfs: a.fontSize, hfw: a.fontWeight, hc: a.color, hbb: a.borderBottomColor,
          rh: row.offsetHeight, rfs: b.fontSize, rc: b.color, rbb: b.borderBottomColor };
      })())`;
      const st = JSON.parse(await pg.evaluate(styleJs));
      ok(st.hh === 44 && st.hbg === 'rgb(244, 247, 248)' && st.hfs === '13px' && st.hfw === '600' && st.hc === 'rgb(74, 89, 97)' && st.hbb === 'rgb(219, 226, 230)' && st.rh === 52 && st.rfs === '14px' && st.rc === 'rgb(23, 32, 38)' && st.rbb === 'rgb(237, 241, 243)',
        '课程管理列表表头与行按样例 theme.css 取值（表头 44 高、浅灰底、13px 600；行 52 高、14px、浅分割线）', JSON.stringify(st));
      /* 连续新建两门课程（演示数据默认提交成功），列表应为 11 条，画面只渲染第 1 页 10 行 */
      const submitOnce = async (no, name) => {
        await open('#/p/P01/create');
        await pg.evaluate(`(function(){ function set(sel, v) { var el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
          set('#ab .wb-form input[data-field="no"]', ${JSON.stringify(no)}); set('#ab .wb-form input[data-field="name"]', ${JSON.stringify(name)});
          set('#ab .wb-form select[data-field="college"]', '计算机学院'); set('#ab .wb-form select[data-field="credit"]', '3');
          document.querySelector('#ab button[data-form="course"]').click(); return 1; })()`);
        await sleep(900);
      };
      await submitOnce('CS4101', '数据库系统原理');
      await submitOnce('CS4102', '编译原理');
      const cap = JSON.parse(await pg.evaluate(`JSON.stringify({ items: W.get('list.items').length, rows: document.querySelectorAll('#ab [data-frow]').length, pager: document.querySelector('#ab .pager').textContent.replace(/\\s+/g, ' ').trim() })`));
      ok(cap.items === 11 && cap.rows === 10 && cap.pager.indexOf('第 1~10 条 / 共 11 条') === 0, '课程管理 11 条时只渲染第 1 页 10 行，分页为“第 1~10 条 / 共 11 条”', JSON.stringify(cap));
    } finally { await bc.close(); }
  }
}

/* ---------- 12. 原型阶段（product.stage: 'prototype'） ---------- */
console.log('\n12. 原型阶段');
{
  const PROTO_EDIT = [PROD, 'W.product({', "W.product({\n  stage: 'prototype',"];
  const deliverable = (dir, name) => fs.existsSync(path.join(dir, name));
  const hasDeliverable = (dir) => fs.readdirSync(dir).some((n) => /原型\.html$|原型需求\.html$|需求文档\.md$/.test(n));
  /* 迷你项目：一个 PC 端、一个页面、两个状态（list 与一个 modal 弹层）。功能点只写 id 和 name。 */
  const PRODUCT_SRC = `W.product({
  id: 'mini-proto',
  name: '迷你原型',
  releases: [{ id: 'V1.0', date: '2026-11-05', summary: '首版' }],
  ends: [{ id: 'pc', name: 'PC 端', device: 'pc', home: 'P01' }],
  stage: 'prototype'
});
`;
  const PAGE_SRC = `W.page({
  id: 'P01', end: 'pc', title: '列表页',
  states: [
    { id: 'list', label: '列表' },
    { id: 'add', label: '新建弹层', layer: 'modal' }
  ],
  fns: [
    { id: 'filter', name: '筛选' },
    { id: 'table', name: '列表' },
    { id: 'del', name: '删除' },
    { id: 'add', name: '新建' }
  ],
  render: function (c) {
    if (c.st === 'add') {
      return '<div data-layer="modal" style="padding:24px"><div data-fn="add"><button class="btn" data-go="P01" data-st="list">关闭</button></div></div>';
    }
    return '<div style="padding:24px"><h1>列表页</h1>' +
      '<div data-fn="filter"><input class="inp" placeholder="搜索名称"></div>' +
      '<div data-fn="table" data-list><div>示例条目 A</div><div>示例条目 B</div></div>' +
      '<div data-fn="del"><button class="btn">删除</button></div>' +
      '<div data-fn="add"><button class="btn pri" data-go="P01" data-st="add">新建</button></div>' +
      '<!--EXTRA-->' +
      '</div>';
  }
});
`;
  const MINI = path.join(TMP, 'mini-base');
  fs.mkdirSync(path.join(MINI, 'prd', 'pages'), { recursive: true });
  fs.writeFileSync(path.join(MINI, 'prd', 'product.js'), PRODUCT_SRC);
  fs.writeFileSync(path.join(MINI, 'prd', 'pages', 'P01-list.js'), PAGE_SRC);
  const PAGE = 'prd/pages/P01-list.js';
  const SOFT_NEED = ['FN_DESC', 'FN_SRC', 'STATE_WHEN', 'PAGE', 'PRODUCT', 'FIELD_MISSING', 'LIST_FIELDS', 'LIST_EMPTY', 'ERRORS'];

  /* T1：stage 登记为合法字段；写错值报 PRODUCT */
  const t1a = await build(variant(EXAMPLE, [PROTO_EDIT]), {});
  ok(t1a.ok && !t1a.report.warns.some((w) => w.code === 'UNKNOWN_KEY' && /stage/.test(w.msg)), 'T1 product.stage: "prototype" 不报 UNKNOWN_KEY，请假审批加上后检查通过', t1a.ok ? '' : JSON.stringify(t1a.report.errors.slice(0, 3)));
  const t1b = await build(variant(MINI, [[PROD, "stage: 'prototype'", "stage: 'proto'"]]), {});
  ok(!t1b.ok && t1b.report.errors.some((e) => e.code === 'PRODUCT' && /stage/.test(e.msg)), 'T1 product.stage 写成 "proto" 报 PRODUCT 并阻止交付');

  /* T2、T3：只写编号和名称的迷你项目通过；缺的需求说明以 soft 提醒输出 */
  const t2 = await build(variant(MINI, []), {});
  ok(t2.ok, 'T2 功能点只有 id 和 name 的迷你项目，原型阶段检查通过', t2.ok ? '' : JSON.stringify(t2.report.errors.slice(0, 4)));
  const t2soft = new Set((t2.report.warns || []).filter((w) => w.soft).map((w) => w.code));
  ok(SOFT_NEED.every((c) => t2soft.has(c)), 'T3 缺失的需求说明以 soft 提醒输出，覆盖 ' + SOFT_NEED.join(' '), [...t2soft].join(','));

  /* T4：同一项目去掉 stage，上述缺项变回错误 */
  const t4 = await build(variant(MINI, [[PROD, "stage: 'prototype'", '/* 无 stage */']]), {});
  ok(!t4.ok && SOFT_NEED.every((c) => codes(t4).includes(c)), 'T4 去掉 stage 后构建失败，上述缺项全部变回错误', JSON.stringify(codes(t4)));

  /* T5：原型里有没登记的可点元素，仍报错且不出交付文件 */
  const t5dir = variant(MINI, [[PAGE, '<!--EXTRA-->', '<button class="btn">导出</button>']]);
  const t5 = await build(t5dir, {});
  ok(!t5.ok && hasCode(t5, 'UNREGISTERED') && !deliverable(t5dir, '迷你原型-原型.html'), 'T5 原型多出没登记的按钮：报 UNREGISTERED，不出交付文件');

  /* T6：登记了但原型里没画的功能点，仍报错 */
  const t6 = await build(variant(MINI, [[PAGE, "{ id: 'add', name: '新建' }", "{ id: 'add', name: '新建' },\n    { id: 'ghost', name: '幽灵功能' }"]]), {});
  ok(!t6.ok && t6.report.errors.some((e) => e.code === 'FN_UNUSED' && /幽灵功能/.test(e.msg)), 'T6 登记了没画的功能点：报 FN_UNUSED');

  /* T7：写错的值仍报错（status 非法、required 非布尔、跳转目标不存在） */
  const t7 = await build(variant(MINI, [
    [PAGE, "{ id: 'filter', name: '筛选' }", "{ id: 'filter', name: '筛选', status: 'foo', fields: [{ key: 'kw', name: '关键词', type: '文本', rule: '模糊匹配', required: 'yes' }] }"],
    [PAGE, 'data-go="P01" data-st="add">新建', 'data-go="P99" data-st="add">新建']
  ]), {});
  ok(!t7.ok && hasCode(t7, 'FN_SRC') && hasCode(t7, 'FIELD') && hasCode(t7, 'GO_TARGET'), 'T7 写错仍报错：status 非法报 FN_SRC，required 非布尔报 FIELD，跳到不存在的页面报 GO_TARGET', JSON.stringify(codes(t7)));

  /* T8：交付文件名、标题、标记 */
  const t8dir = variant(MINI, []);
  const t8 = await build(t8dir, {});
  const t8html = t8.ok && deliverable(t8dir, '迷你原型-原型.html') ? fs.readFileSync(path.join(t8dir, '迷你原型-原型.html'), 'utf8') : '';
  ok(t8.ok && deliverable(t8dir, '迷你原型-原型.html') && outputs(t8dir).length === 0 && /<title>[^<]*· 原型<\/title>/.test(t8html) && t8html.includes('<meta name="prd-stage" content="prototype">'), 'T8 输出 迷你原型-原型.html，不生成 -原型需求.html；标题以“· 原型”结尾；带 prd-stage 标记');

  /* T9：原型阶段不导出 Markdown，直接报错且不写任何文件 */
  const t9dir = variant(MINI, []);
  let t9err = null;
  try { await build(t9dir, { md: true }); } catch (e) { t9err = e; }
  ok(t9err && /--md/.test(t9err.message) && !hasDeliverable(t9dir), 'T9 原型阶段带 --md：构建抛错，目录中没有新的 HTML 或需求文档 Markdown', t9err ? t9err.message : '没有抛错');

  /* T10：托管端也能出原型阶段交付：构建通过，输出 客户管理-原型.html，不生成需求交付文件，带 prd-stage 标记 */
  const t10dir = variant(HOSTFX, [PROTO_EDIT]);
  const t10 = await build(t10dir, {});
  const t10html = t10.ok && deliverable(t10dir, '客户管理-原型.html') ? fs.readFileSync(path.join(t10dir, '客户管理-原型.html'), 'utf8') : '';
  ok(t10.ok && deliverable(t10dir, '客户管理-原型.html') && !deliverable(t10dir, '客户管理-原型需求.html') && t10html.includes('<meta name="prd-stage" content="prototype">'), 'T10 原型阶段托管端：构建通过，输出 客户管理-原型.html，没有 客户管理-原型需求.html，带 prd-stage 标记', t10.ok ? '' : JSON.stringify(t10.report.errors.slice(0, 3)));

  /* T21、T22：托管原型阶段的绑定仍然严格，不因原型阶段放宽 */
  const t21dir = variant(HOSTFX, [PROTO_EDIT, ['prd/pages/C01-customers.js', "sel: '#btn-new',", '']]);
  const t21 = await build(t21dir, {});
  ok(!t21.ok && hasCode(t21, 'HOST_SEL') && !deliverable(t21dir, '客户管理-原型.html'), 'T21 原型阶段：功能点去掉 sel 后报 HOST_SEL，不出交付文件', JSON.stringify(codes(t21)));
  const t22dir = variant(HOSTFX, [PROTO_EDIT, ['prd/product.js', "{ sel: '#btn-export', why: '原型多出的“导出 Excel”，本期不做' },\n        { sel: '.ai-fab', why: '原型多出的 AI 助手入口，本期不做' }", "{ sel: '#btn-export', why: '原型多出的“导出 Excel”，本期不做' }"]]);
  const t22 = await build(t22dir, {});
  ok(!t22.ok && hasCode(t22, 'UNREGISTERED') && !deliverable(t22dir, '客户管理-原型.html'), 'T22 原型阶段：ignore 里去掉 .ai-fab 后报 UNREGISTERED，不出交付文件', JSON.stringify(codes(t22)));

  /* T16：版本升级时归档上一版；已有的完整需求交付文件保持不变 */
  const vdir = variant(EXAMPLE, [PROTO_EDIT], { withOutput: true });
  const vb1 = await build(vdir, {});
  const keepBefore = crypto.createHash('sha1').update(fs.readFileSync(path.join(vdir, '请假审批-原型需求.html'))).digest('hex');
  const vProd = path.join(vdir, PROD);
  fs.writeFileSync(vProd, fs.readFileSync(vProd, 'utf8').replace("summary: '首版：员工手机端发起与查看请假，主管 PC 端审批，HR 查看月度统计' }", "summary: '首版：员工手机端发起与查看请假，主管 PC 端审批，HR 查看月度统计' },\n    { id: 'V1.1', date: '2026-11-05', summary: '原型迭代' }"));
  const vb2 = await build(vdir, {});
  const keepAfter = crypto.createHash('sha1').update(fs.readFileSync(path.join(vdir, '请假审批-原型需求.html'))).digest('hex');
  ok(vb1.ok && vb2.ok && deliverable(vdir, path.join('归档', '请假审批-原型-V1.0.html')) && keepBefore === keepAfter, 'T16 原型阶段升到 V1.1：上一版归档为 归档/请假审批-原型-V1.0.html；已有的 请假审批-原型需求.html 原样保留', JSON.stringify({ vb1: vb1.ok, vb2: vb2.ok }));

  /* T17：范围基线在原型阶段写入；去掉 stage 后范围对比不出现增删。
     注意：这里只去掉 stage，没有补其他需求，构建会因需求缺项失败；这里只检查范围对比结果。 */
  const sdir = variant(MINI, []);
  const sb = await build(sdir, { scopeBaseline: true, confirmedAt: '2026-11-05' });
  ok(sb.ok && deliverable(sdir, path.join('prd', 'scope.json')), 'T17 前置：原型阶段 --scope-baseline 写入 prd/scope.json');
  const sProd = path.join(sdir, PROD);
  fs.writeFileSync(sProd, fs.readFileSync(sProd, 'utf8').replace("stage: 'prototype'", '/* 无 stage */'));
  const sb2 = await build(sdir, {});
  const scopeMoves = (sb2.report.warns || []).filter((w) => w.code === 'SCOPE_ADDED' || w.code === 'SCOPE_REMOVED').length;
  ok(!!sb2.report.scope && scopeMoves === 0, 'T17 去掉 stage 后：SCOPE_ADDED / SCOPE_REMOVED 都为 0（构建仍因需求缺项失败，此处只看范围对比）', JSON.stringify(sb2.report.scope));

  /* T28a：原型阶段托管引用 CDN 脚本但未写 online → HOST_NET，不出交付 */
  {
    const CDN_JS_NEG = '<script src="https://cdn.example.com/lib.js"></script>\n</head>';
    const noOnDirP = variant(HOSTFX, [['existing/crm.html', '</head>', CDN_JS_NEG], PROTO_EDIT]);
    const noOnP = await build(noOnDirP, {});
    ok(!noOnP.ok && hasCode(noOnP, 'HOST_NET') && !deliverable(noOnDirP, '客户管理-原型.html'), 'T28a 原型阶段托管引用 CDN 未写 online：报 HOST_NET，不出交付', noOnP.ok ? '构建竟然通过了' : JSON.stringify(codes(noOnP).slice(0, 3)));
  }

  /* T28：托管原型阶段放行网络（与 2b 节 dirOn 相同的两处替换）：构建通过，标记需联网 */
  const CDN_JS_P = '<script src="https://cdn.example.com/lib.js"></script>\n</head>';
  const CDN_CSS_P = '<link rel="stylesheet" href="https://cdn.example.com/x.css">\n</head>';
  const onDirP = variant(HOSTFX, [
    ['existing/crm.html', '</head>', CDN_JS_P.replace('</head>', CDN_CSS_P)],
    ['prd/product.js', "host: '../existing/crm.html', width", "host: '../existing/crm.html', online: true, width"],
    PROTO_EDIT
  ]);
  const onP = await build(onDirP, {});
  ok(onP.ok && onP.report.needOnline === true && deliverable(onDirP, '客户管理-原型.html') && onP.report.warns.some((w) => w.code === 'ONLINE' && /lib\.js/.test(w.msg)), 'T28 原型阶段托管端写 online: true：构建通过，标记需联网，并列出网络脚本', onP.ok ? '' : JSON.stringify(onP.report.errors.slice(0, 2)));
  const onFileP = onP.ok ? onP.file : null;
  const hostPf = t10.ok ? t10.file : null;   /* 托管原型阶段的交付文件（没有网络放行） */

  /* T18、T11–T15、T19、T20：需要浏览器的部分。测前清空 localStorage，避免偏好互相污染 */
  const pf = t1a.ok ? t1a.file : null;     /* 请假审批加 stage 后的交付文件 */
  const exFile = ex.file;                  /* 默认模式的请假审批 */
  const snapDir = path.join(TMP, 'snap-proto');
  let snapOut = '', snapCode = 0;
  if (pf) {
    try { snapOut = execFileSync(process.execPath, [path.join(SKILL, 'scripts', 'snap.mjs'), pf, '--out', snapDir], { encoding: 'utf8', timeout: 240000 }); }
    catch (e) { snapOut = String(e.stdout || ''); snapCode = e.status; }
  }
  const shotLines = snapOut.split('\n').filter((l) => / → /.test(l));
  ok(!!pf && snapCode === 0 && !/#\/doc/.test(snapOut) && shotLines.length === 2 && /圆点 \d+（已隐藏）/.test(snapOut), 'T18 原型阶段 snap.mjs：默认只截各端首页（不含 #/doc），圆点标注“已隐藏”', 'exit=' + snapCode + ' ' + snapOut.slice(0, 300));

  const bc = await launch();
  try {
    const pg = await bc.newPage({ width: 1520, height: 1000 });
    const open = async (file, hash) => { await pg.goto('about:blank'); await pg.goto(fileUrl(file) + (hash || '')); await pg.waitFor('window.__PRD_READY === true', 20000); await sleep(400); };
    const fresh = async (file, hash) => { await open(file, ''); await pg.evaluate('localStorage.clear()'); await open(file, hash); };
    const diag = async () => JSON.parse(await pg.evaluate('JSON.stringify(W.viewerDiag())'));
    const pressN = async () => { await pg.evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "n" }))'); await sleep(250); };
    if (pf) {
      await fresh(pf, '');
      const homeId = await pg.evaluate('W.P.ends[0].home');
      /* T11 */
      const d1 = await diag();
      await open(pf, '#/doc');
      const d2 = await diag();
      ok(d1.view === 'page' && d1.page === homeId && d2.view === 'page' && d2.page === homeId, 'T11 原型阶段：无 hash 或 #/doc 都进入第一个端的首页（' + homeId + '）', JSON.stringify([d1.view, d1.page, d2.view, d2.page]));
      /* T12 */
      await fresh(pf, '');
      const d12 = JSON.parse(await pg.evaluate(`JSON.stringify({ docTab: document.querySelectorAll('#top .vsw-menu [data-tab="doc"]').length, needBtn: document.querySelectorAll('[data-tool="right"]').length, rightHTML: document.getElementById('right').innerHTML.length, noR: document.body.classList.contains('no-r') })`));
      ok(d12.docTab === 0 && d12.needBtn === 0 && d12.rightHTML === 0 && d12.noR, 'T12 顶栏无“需求文档”标签和“需求”按钮；右栏为空；body 带 no-r', JSON.stringify(d12));
      /* T13 */
      const badge = await pg.evaluate(`(document.querySelector('.audit-badge') || {}).textContent || ''`);
      ok(badge === '原型阶段 · 结构检查通过' && !/待确认|AI 假设/.test(badge), 'T13 检查标识为“原型阶段 · 结构检查通过”，不含待确认和 AI 假设（构建统计：AI 假设 ' + (t1a.report.stats.assumed || 0) + '，待确认 ' + (t1a.report.stats.pending || 0) + '）', badge);
      /* T14 */
      await fresh(pf, '');
      const hid1 = await pg.evaluate(`document.body.classList.contains('no-dots')`);
      await pressN();
      const shown = !(await pg.evaluate(`document.body.classList.contains('no-dots')`));
      await open(pf, '#/p/' + homeId);
      const hid2 = await pg.evaluate(`document.body.classList.contains('no-dots')`);
      const stored = await pg.evaluate(`localStorage.getItem('prd-viewer:leave-approval') || ''`);
      ok(hid1 && shown && hid2 && !/noDots/.test(stored), 'T14 原型阶段圆点默认隐藏；按 N 显示；重新加载后又隐藏；localStorage 没有写入 noDots', JSON.stringify({ hid1, shown, hid2, stored }));
      /* T15 */
      await fresh(pf, '');
      await pressN();
      const dotN = await pg.evaluate(`document.querySelectorAll('#dots .fdot').length`);
      if (dotN) await pg.evaluate(`document.querySelector('#dots .fdot').click()`);
      await sleep(400);
      const afterDot = JSON.parse(await pg.evaluate(`JSON.stringify({ noR: document.body.classList.contains('no-r'), right: document.getElementById('right').innerHTML.length })`));
      const fnMeta = JSON.parse(await pg.evaluate(`JSON.stringify({ st: W.pages[W.P.ends[0].home].states[0].id, fn: W.pages[W.P.ends[0].home].fns[0].id })`));
      await open(pf, '#/p/' + homeId + '/' + fnMeta.st + '?fn=' + encodeURIComponent(fnMeta.fn));
      const afterQ = JSON.parse(await pg.evaluate(`JSON.stringify({ noR: document.body.classList.contains('no-r'), right: document.getElementById('right').innerHTML.length })`));
      ok(dotN > 0 && afterDot.noR && afterDot.right === 0 && afterQ.noR && afterQ.right === 0, 'T15 点圆点、带 ?fn= 打开：需求面板不展开（no-r 保留，#right 为空）', JSON.stringify({ dotN, afterDot, afterQ }));
      /* T20 */
      await fresh(pf, '');
      const flowTabs = await pg.evaluate(`document.querySelectorAll('#top .vsw-menu [data-tab="flow"]').length`);
      await pg.evaluate(`document.querySelector('#top .vsw-menu [data-tab="flow"]').click()`);
      await sleep(400);
      await pg.evaluate(`document.querySelector('[data-step="f1|0"]').click()`);
      await sleep(500);
      const t20 = JSON.parse(await pg.evaluate(`JSON.stringify({ flowOn: document.body.classList.contains('flow-on'), page: W.viewerDiag().page, first: W.P.flows[0].steps[0].p })`));
      ok(flowTabs === 1 && t20.flowOn && t20.page === t20.first, 'T20 原型阶段：“核心流程”标签保留，流程演示能进入第一步（' + t20.first + '）', JSON.stringify({ flowTabs, t20 }));
    }
    /* T19：默认模式回归（不写 stage）：圆点偏好照旧记住，无 hash 仍进需求文档 */
    await fresh(exFile, '');
    const g1 = JSON.parse(await pg.evaluate(`JSON.stringify({ view: W.viewerDiag().view, hidden: document.body.classList.contains('no-dots'), docTab: document.querySelectorAll('#top .vsw-menu [data-tab="doc"]').length })`));
    await pressN();
    await open(exFile, '');
    const g2 = JSON.parse(await pg.evaluate(`JSON.stringify({ view: W.viewerDiag().view, hidden: document.body.classList.contains('no-dots') })`));
    ok(g1.view === 'doc' && !g1.hidden && g1.docTab === 1 && g2.view === 'doc' && g2.hidden, 'T19 默认模式不变：无 hash 进需求文档、圆点默认显示；按 N 隐藏后重新加载仍隐藏（偏好照旧记住）', JSON.stringify({ g1, g2 }));

    /* T23–T27：托管原型阶段的浏览器表现。虚线框随圆点一起隐藏，按 N 显示，重新打开又隐藏且不记住 */
    if (hostPf) {
      await fresh(hostPf, '');
      await pg.waitFor('document.querySelectorAll("#dots .xbox").length > 0', 8000).catch(() => {});
      const h23 = JSON.parse(await pg.evaluate(`JSON.stringify({ view: W.viewerDiag().view, page: W.viewerDiag().page, home: W.P.ends[0].home, noDots: document.body.classList.contains('no-dots'), noR: document.body.classList.contains('no-r'), rightLen: document.getElementById('right').innerHTML.length, docTab: document.querySelectorAll('#top .vsw-menu [data-tab="doc"]').length })`));
      ok(h23.view === 'page' && h23.page === h23.home && h23.noDots && h23.noR && h23.rightLen === 0 && h23.docTab === 0, 'T23 托管原型阶段：打开即第一个端的首页（' + h23.home + '），圆点和虚线框隐藏，没有需求栏和需求文档标签', JSON.stringify(h23));
      const badge24 = await pg.evaluate(`(document.querySelector('.audit-badge') || {}).textContent || ''`);
      ok(badge24 === '原型阶段 · 结构检查通过', 'T24 托管原型阶段未放行网络：检查标识为“原型阶段 · 结构检查通过”，不带需联网', badge24);
      const h25 = JSON.parse(await pg.evaluate(`JSON.stringify({ ignored: W.viewerDiag().ignoredMarks, hidden: getComputedStyle(document.getElementById('dots')).display === 'none' })`));
      ok(h25.ignored >= 1 && h25.hidden, 'T25 托管原型阶段：“本期不做”虚线框已在 DOM 中（' + h25.ignored + ' 个），#dots 的 display 为 none', JSON.stringify(h25));
      await pressN();
      const h26 = JSON.parse(await pg.evaluate(`JSON.stringify({ disp: getComputedStyle(document.getElementById('dots')).display, visible: Array.from(document.querySelectorAll('#dots .xbox')).filter(function (x) { return x.offsetWidth > 0; }).length })`));
      ok(h26.disp === 'block' && h26.visible >= 1, 'T26 托管原型阶段：按 N 后 #dots 显示为 block，至少 1 个虚线框可见（' + h26.visible + ' 个）', JSON.stringify(h26));
      await open(hostPf, '');
      const h27 = JSON.parse(await pg.evaluate(`JSON.stringify({ noDots: document.body.classList.contains('no-dots'), stored: Object.keys(localStorage).some(function (k) { return /noDots/.test(k + localStorage.getItem(k)); }) })`));
      ok(h27.noDots && !h27.stored, 'T27 托管原型阶段：按 N 后重新加载又隐藏，localStorage 没有 noDots 偏好', JSON.stringify(h27));
      if (onFileP) {
        await fresh(onFileP, '');
        const badge29 = await pg.evaluate(`(document.querySelector('.audit-badge') || {}).textContent || ''`);
        ok(badge29 === '原型阶段 · 结构检查通过 · 需联网', 'T29 托管原型阶段放行网络：检查标识为“原型阶段 · 结构检查通过 · 需联网”', badge29);
      } else ok(false, 'T29 托管原型阶段放行网络：构建失败，无法检查徽标');
    } else {
      ok(false, 'T23 托管原型阶段：构建失败，无法测打开首页与隐藏圆点');
      ok(false, 'T24 托管原型阶段未放行网络：构建失败，无法检查徽标');
      ok(false, 'T25 托管原型阶段：构建失败，无法测虚线框');
      ok(false, 'T26 托管原型阶段：构建失败，无法测按 N 显示虚线框');
      ok(false, 'T27 托管原型阶段：构建失败，无法测重新加载不记住偏好');
    }
  } finally {
    await bc.close();
  }
}

/* ---------- 13. 评审意见回收 ---------- */
console.log('\n13. 评审意见回收');
{
  const MERGE = path.join(SKILL, 'scripts', 'merge-comments.mjs');
  const LS = 'prd-comments:leave-approval';
  const PROTO_13 = [PROD, 'W.product({', "W.product({\n  stage: 'prototype',"];
  const protoFile = variant(EXAMPLE, [PROTO_13]);
  const pr = await build(protoFile, {});
  const hostProto = await build(variant(HOSTFX, [PROTO_13]), {});
  const bc = await launch();
  try {
    const pg = await bc.newPage({ width: 1600, height: 1000 });
    const open = async (file, hash) => { await pg.goto('about:blank'); await pg.goto(fileUrl(file) + (hash || '')); await pg.waitFor('window.__PRD_READY === true', 20000); await sleep(400); };
    const ev = (js) => pg.evaluate(js);
    const jev = async (js) => JSON.parse(await pg.evaluate('JSON.stringify(' + js + ')'));
    const submitPop = async (text) => ev(`(function () { var t = document.getElementById('cmt-pop-text'); t.value = ${JSON.stringify(text)}; t.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('[data-cmt-act=popsubmit]').click(); return 1; })()`);

    /* 1. 默认模式：对功能点留意见，刷新后仍在 */
    await open(ex.file, '#/p/P02/detail');
    await ev('localStorage.clear(); 1');
    await open(ex.file, '#/p/P02/detail');
    await ev('W.comments.setAuthor("测试员"); 1');
    await ev('document.querySelector(".cmt-btn[data-cmt=decide]").click(); 1');
    await sleep(150);
    await submitPop('驳回时请写明原因');
    await sleep(150);
    const s1 = await jev(`{ ls: localStorage.getItem('${LS}') || '', btn: document.querySelector('.cmt-btn[data-cmt=decide]').textContent.replace(/\\s+/g, '') }`);
    await open(ex.file, '#/p/P02/detail');
    const s1b = await jev(`{ btn: document.querySelector('.cmt-btn[data-cmt=decide]').textContent.replace(/\\s+/g, ''), n: W.comments.count('P02/decide') }`);
    ok(s1.ls.indexOf('驳回时请写明原因') > 0 && s1.btn === '意见(1)' && s1b.n === 1 && s1b.btn === '意见(1)', '默认模式请假审批：对功能点“通过 / 驳回”添加意见，写入 ' + LS + '；刷新后仍在', JSON.stringify({ s1, s1b }));

    /* 2. 导出 JSON：结构与文件名 */
    const exp = await jev(`W.comments.exportJSON('测试员')`);
    ok(exp.v === 1 && exp.productId === 'leave-approval' && exp.release === 'V1.0' && exp.author === '测试员' && Array.isArray(exp.comments) && exp.comments.length === 1 && exp.comments[0].target === 'P02/decide' && exp.comments[0].resolved === false, '导出对象含 v、productId、comments（每条有 target、text、author、at、resolved）', JSON.stringify(exp).slice(0, 300));
    const names = await jev(`(function () { var got = []; var orig = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { got.push(this.download); }; try { W.comments.download('测试员'); } finally { HTMLAnchorElement.prototype.click = orig; } return got; })()`);
    ok(names.length === 1 && /^请假审批-评审意见-V1\.0-\d{4}-\d{2}-\d{2}\.json$/.test(names[0]), '下载文件名为 (产品名)-评审意见-(release)-(日期).json', JSON.stringify(names));
    const expFile = path.join(TMP, 'cmt-a.json');
    fs.writeFileSync(expFile, JSON.stringify(exp, null, 2));

    /* 3. 原型阶段：顶栏有“意见”，打开面板后 #right 仍空、no-r 仍在；点圆点自动选中功能点 */
    await open(pr.file, '#/p/P02/detail');
    await ev('localStorage.clear(); 1');
    await open(pr.file, '#/p/P02/detail');
    const t3a = await jev(`{ btn: !!document.querySelector('#top [data-tool="comments"]'), docTab: document.querySelectorAll('#top .vsw-menu [data-tab="doc"]').length, right: document.getElementById('right').innerHTML.length, noR: document.body.classList.contains('no-r') }`);
    await ev('document.querySelector("[data-tool=comments]").click(); 1');
    await sleep(200);
    const t3b = await jev(`{ open: W.viewerDiag().commentsOpen, right: document.getElementById('right').innerHTML.length, noR: document.body.classList.contains('no-r'), noDots: document.body.classList.contains('no-dots') }`);
    ok(t3a.btn && t3a.docTab === 0 && t3a.right === 0 && t3a.noR && t3b.open && t3b.right === 0 && t3b.noR, '原型阶段：顶栏有“意见”按钮；打开面板后 #right 仍为空，no-r 仍在（不破坏 T12/T15）', JSON.stringify({ t3a, t3b }));
    await ev('document.dispatchEvent(new KeyboardEvent("keydown", { key: "n" })); 1'); await sleep(200);
    await ev('document.querySelector("#dots .fdot[data-fdot=decide]").click(); 1'); await sleep(200);
    const t3c = await ev('document.querySelector("#cmt-panel .cmt-to").textContent');
    ok(/通过 \/ 驳回/.test(t3c), '原型阶段：面板开着时点圆点，意见自动挂到该功能点（' + t3c + '）');
    await ev('document.querySelector("#cmt-text").value = "原型阶段的意见"; document.querySelector("#cmt-text").dispatchEvent(new Event("input", { bubbles: true })); document.querySelector("[data-cmt-act=submit]").click(); 1'); await sleep(200);
    const t3d = await jev(`{ n: W.comments.count('P02/decide'), open: W.viewerDiag().commentsOpen, right: document.getElementById('right').innerHTML.length }`);
    ok(t3d.n === 1 && t3d.open && t3d.right === 0, '原型阶段：面板里对选中的功能点提交意见（写入 P02/decide），#right 仍为空', JSON.stringify(t3d));

    /* 4. 托管原型阶段：面板可开、可添加、可导出 */
    await open(hostProto.file, '#/p/C01/list');
    await ev('localStorage.clear(); 1');
    await open(hostProto.file, '#/p/C01/list');
    await ev('document.querySelector("[data-tool=comments]").click(); 1'); await sleep(200);
    const pageNow = await ev('W.viewerDiag().page');
    await ev('document.querySelector("#cmt-text").value = "托管原型的意见"; document.querySelector("#cmt-text").dispatchEvent(new Event("input", { bubbles: true })); document.querySelector("[data-cmt-act=submit]").click(); 1'); await sleep(200);
    const t4 = await jev(`{ open: W.viewerDiag().commentsOpen, n: W.comments.count(), exp: W.comments.exportJSON('').comments.length, page: W.comments.list().map(function (c) { return c.pageId; })[0] }`);
    ok(t4.open && t4.n === 1 && t4.exp === 1 && t4.page === pageNow, '托管原型阶段：面板可开，可添加页面级意见，并可导出（页面 ' + pageNow + '）', JSON.stringify(t4));
    const hostExp = await jev(`W.comments.exportJSON('测试员')`);
    fs.writeFileSync(path.join(TMP, 'cmt-host.json'), JSON.stringify(hostExp, null, 2));

    /* 5. 合并脚本：两份 JSON 合并，按 target 分组，全文连续编号 */
    const fileB = { v: 1, productId: 'leave-approval', productName: '请假审批', release: 'V1.0', exportedAt: '2026-11-05T02:00:00.000Z', author: '李四', comments: [{ id: 'c_b1', target: 'P01', pageId: 'P01', fnId: null, text: '列表默认按提交时间排序？', author: '李四', at: '2026-11-05T02:00:00.000Z', resolved: false }] };
    const fileBPath = path.join(TMP, 'cmt-b.json');
    fs.writeFileSync(fileBPath, JSON.stringify(fileB, null, 2));
    const outMd = path.join(TMP, '评审意见合并.md');
    let mergeErr = '';
    try { execFileSync(process.execPath, [MERGE, expFile, fileBPath, '-o', outMd], { stdio: 'pipe' }); } catch (e) { mergeErr = String(e.stderr || e.message); }
    const mdText = fs.existsSync(outMd) ? fs.readFileSync(outMd, 'utf8') : '';
    ok(!mergeErr && /# 评审意见合并 · 请假审批 · V1\.0/.test(mdText) && mdText.indexOf('### P02/decide') >= 0 && mdText.indexOf('### P01') >= 0 && mdText.indexOf('- #1（测试员，') >= 0 && mdText.indexOf('- #2（李四，2026-11-05）：列表默认按提交时间排序？') >= 0 && mdText.indexOf('驳回时请写明原因') > 0, 'merge-comments.mjs：两份 JSON 合并输出含两条、按 target 分组、带序号', mergeErr || mdText.slice(0, 400));
    ok(/^### P02\/decide$/m.test(mdText) && /^### P01$/m.test(mdText), 'merge-comments.mjs：无 --prd 时标题只写 target');
    const withPrd = path.join(TMP, 'merged-prd.md');
    execFileSync(process.execPath, [MERGE, expFile, fileBPath, '-o', withPrd, '--prd', EXAMPLE], { stdio: 'pipe' });
    const prdText = fs.readFileSync(withPrd, 'utf8');
    ok(/### P02\/decide · .+/.test(prdText) && /### P01 · 待我审批/.test(prdText), 'merge-comments.mjs --prd：页面功能点标题补上名称');
    /* 公共组件在 kit.js：--prd 应读到 S:pc/pc-nav 名称；条目作者空时用文件级 author 兜底 */
    const fileS = { v: 1, productId: 'leave-approval', productName: '请假审批', release: 'V1.0', exportedAt: '2026-11-05T03:00:00.000Z', author: '王五', comments: [{ id: 'c_s1', target: 'S:pc/pc-nav', pageId: null, fnId: 'pc-nav', text: '菜单数字超过 99 要测一下', author: '', at: '2026-11-05T03:00:00.000Z', resolved: false }] };
    const fileSPath = path.join(TMP, 'cmt-s.json');
    fs.writeFileSync(fileSPath, JSON.stringify(fileS, null, 2));
    const withS = path.join(TMP, 'merged-s.md');
    execFileSync(process.execPath, [MERGE, fileSPath, '-o', withS, '--prd', EXAMPLE], { stdio: 'pipe' });
    const sText = fs.readFileSync(withS, 'utf8');
    ok(/### S:pc\/pc-nav · 顶部导航与账号菜单/.test(sText) && /- #1（王五，2026-11-05）：菜单数字超过 99 要测一下/.test(sText), 'merge-comments.mjs --prd：公共组件读 kit.js 补名称；条目作者空时用文件级 author', sText.slice(0, 400));
    let badErr = 0;
    try { execFileSync(process.execPath, [MERGE, path.join(TMP, 'cmt-bad.json')], { stdio: 'pipe' }); } catch (e) { badErr = e.status; }
    fs.writeFileSync(path.join(TMP, 'cmt-bad.json'), '{"v":2}');
    let badV = 0;
    try { execFileSync(process.execPath, [MERGE, path.join(TMP, 'cmt-bad.json')], { stdio: 'pipe' }); } catch (e) { badV = e.status; }
    ok(badErr !== 0 && badV !== 0, 'merge-comments.mjs：文件不存在或不是 v:1 意见 JSON 时报错退出');
  } finally {
    await bc.close();
  }
}

/* ---------- 14. 导出给开发测试 ---------- */
console.log('\n14. 导出给开发测试');
{
  const BUILD = path.join(SKILL, 'scripts', 'build.mjs');
  const COURSE = path.join(SKILL, 'examples', 'course-mgmt');
  const PROTO_EDIT14 = [PROD, 'W.product({', "W.product({\n  stage: 'prototype',"];
  /* 最小 RFC 4180 解析，只用于测试：支持引号、双引号转义、单元格内换行 */
  const parseCsv = (text) => {
    const rows = [];
    let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\r') { /* 行尾 CRLF 的 CR */ }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows;
  };
  const toObjs = (rows) => { const [head, ...body] = rows; return body.map((r) => Object.fromEntries(head.map((k, i) => [k, r[i] == null ? '' : r[i]]))); };
  const bomOf = (f) => { const b = fs.readFileSync(f); return b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf; };
  const runBuild = (args) => { try { execFileSync(process.execPath, [BUILD, ...args], { stdio: 'pipe' }); return { status: 0, out: '' }; } catch (e) { return { status: e.status, out: String(e.stderr || '') + String(e.stdout || '') }; } };
  /* 在页面里点击导出按钮，截获下载的文件名与字节（不经过真实下载） */
  const downloadFrom = async (pg, selector) => JSON.parse(await pg.evaluate(`(function () {
    var got = null, names = [], orig = URL.createObjectURL, oc = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = function (b) { got = b; return orig.call(URL, b); };
    HTMLAnchorElement.prototype.click = function () { names.push(this.download); };
    try { var el = document.querySelector(${JSON.stringify(selector)}); if (el) el.click(); }
    finally { HTMLAnchorElement.prototype.click = oc; URL.createObjectURL = orig; }
    if (!got) return JSON.stringify({ names: names, bytes: [], text: null });
    return got.arrayBuffer().then(function (buf) {
      return JSON.stringify({ names: names, bytes: Array.from(new Uint8Array(buf.slice(0, 3))), text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(buf) });
    });
  })()`));

  /* A. 默认模式（课程管理）：需求文档栏只剩「导出 Markdown」（无打印、无导出 CSV），点击仍能导出；CSV 三张表内容、RFC 转义、removed 不导出（数据供原型阶段「清单」与 build.mjs --csv） */
  const cmDir = variant(COURSE, []);
  const cmRes = await build(cmDir, {});
  ok(cmRes.ok, '课程管理样例构建通过（需求文档栏与导出检查的前置）', cmRes.ok ? '' : JSON.stringify(cmRes.report.errors.slice(0, 3)));
  if (cmRes.ok) {
    const bA = await launch();
    try {
      const pg = await bA.newPage({ width: 1600, height: 1000 });
      await pg.goto(fileUrl(cmRes.file));
      await pg.waitFor('window.__PRD_READY === true', 20000);
      await pg.evaluate('location.hash = "#/doc"; 1');
      await sleep(500);
      const bar = JSON.parse(await pg.evaluate(`(function () {
        var bar = document.querySelector('.doc-bar');
        var acts = Array.from(document.querySelectorAll('[data-act-doc]')).map(function (b) { return b.dataset.actDoc + ':' + b.textContent.trim(); });
        var tips = (document.querySelector('#right') || {}).textContent || '';
        return JSON.stringify({ acts: acts, bar: bar ? bar.textContent : '', csvTool: !!document.querySelector('[data-tool=csv]'), tips: tips });
      })()`));
      ok(bar.acts.length === 1 && bar.acts[0] === 'md:导出 Markdown', '默认模式：需求文档栏只有「导出 Markdown」一个导出按钮', JSON.stringify(bar.acts));
      ok(!/打印|PDF|CSV/i.test(bar.bar) && !bar.csvTool, '默认模式：需求文档栏没有「打印 / 存为 PDF」和「导出 CSV」，顶栏也没有「清单」', bar.bar);
      ok(!/打印|PDF/.test(bar.tips) && bar.tips.includes('本文档可导出 Markdown'), '默认模式：浏览方式提示只写“可导出 Markdown”，不再提打印为 PDF');
      const dm = await downloadFrom(pg, '[data-act-doc=md]');
      ok(dm.names.length === 1 && dm.names[0] === '课程管理-需求文档-V1.0.md' && (dm.text || '').indexOf('# 课程管理 · 需求文档') === 0 && /#### P01 /.test(dm.text || '') && (dm.text || '').length > 3000,
        '默认模式：点「导出 Markdown」仍下载 (产品名)-需求文档-(release).md，含标题和页面章节（' + (dm.text || '').length + ' 字）', JSON.stringify(dm.names));
      const rows = parseCsv(await pg.evaluate('W.doc.csvText()'));
      const objs = toObjs(rows);
      ok(rows[0][0] === 'sheet' && objs.some((r) => r.sheet === 'fns' && r.pageId === 'P01' && r.fnId === 'table'), 'CSV 含 sheet=fns 的功能点行，能找到已知功能点 P01 / table');
      ok(objs.some((r) => r.sheet === 'fields' && r.fnId === 'table' && r.key === 'no') && objs.some((r) => r.sheet === 'fields'), 'CSV 含字段行（sheet=fields）');
      ok(objs.some((r) => r.sheet === 'fields' && r.key === 'college' && r.options && r.options.indexOf('、') > 0 && !r.rule), '字段 CSV 含 options（开课学院枚举），无 rule 时仍保留可选值');
      ok(objs.some((r) => r.sheet === 'ac' && r.fnId === 'filter' && r.expect.indexOf('列表只留下名称含') === 0), 'CSV 含验收条件行（sheet=ac），预期结果原文写入');
      ok(objs.some((r) => r.sheet === 'fns' && r.pageId === 'S:pc' && r.fnId === 'pc-nav'), '公共组件的 pageId 写作 S:端ID（S:pc）');
      /* RFC 4180：逗号、双引号、换行写进单元格后，导出再解析要原样读回 */
      const esc = await pg.evaluate(`(function () {
        W.pages.P01.fns.forEach(function (f) { if (f.id === 'filter') f.desc = 'a,"b"\\n三'; });
        return W.doc.csvText();
      })()`);
      const escRow = toObjs(parseCsv(esc)).find((r) => r.sheet === 'fns' && r.fnId === 'filter');
      ok(escRow && escRow.desc === 'a,"b"\n三', 'CSV 单元格转义：逗号、双引号、换行原样往返（RFC 4180）', escRow ? JSON.stringify(escRow.desc) : '无行');
      const remv = await pg.evaluate(`(function () {
        W.pages.P01.fns.forEach(function (f) { if (f.id === 'pager') f.changes = [{ ver: 'V1.0', type: 'removed' }]; });
        return W.doc.csvRows().fns.some(function (r) { return r.fnId === 'pager'; });
      })()`);
      ok(remv === false, '标记为移除（removed）的功能点不导出');
    } finally { await bA.close(); }
  }

  /* B. build.mjs --csv（请假审批，默认模式）：三份 CSV 写到交付文件旁，无 ac 时验收条件文件只有表头 */
  const lvDir = variant(EXAMPLE, []);
  const lvCsv = runBuild([lvDir, '--csv']);
  const lvNames = ['请假审批-功能点-V1.0.csv', '请假审批-字段-V1.0.csv', '请假审批-验收条件-V1.0.csv'];
  ok(lvCsv.status === 0 && lvNames.every((n) => fs.existsSync(path.join(lvDir, n))), 'build.mjs --csv：输出目录出现三份 CSV（功能点、字段、验收条件）', lvCsv.out.slice(0, 300));
  if (lvCsv.status === 0) {
    const fnsCsv = fs.readFileSync(path.join(lvDir, lvNames[0]), 'utf8').replace(/^\uFEFF/, '');
    const fnsObjs = toObjs(parseCsv(fnsCsv));
    ok(lvNames.slice(0).every((n) => bomOf(path.join(lvDir, n))) && fnsObjs.some((r) => r.pageId === 'M02' && r.fnId === 'submit'), 'build.mjs --csv：功能点文件带 BOM，含已知功能点 M02 / submit');
    const acLines = fs.readFileSync(path.join(lvDir, lvNames[2]), 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
    ok(acLines.length === 1 && acLines[0] === 'pageId,fnId,fnName,pre,act,expect', '样例没写 ac 时，验收条件文件只有表头，其余留空不报错');
  }

  /* C. 原型阶段：--csv 成功，--md 仍拒绝；原型里有“清单”按钮（不在文档栏），点击下载同一 CSV */
  const pvDir = variant(EXAMPLE, [PROTO_EDIT14]);
  const pvCsv = runBuild([pvDir, '--csv']);
  ok(pvCsv.status === 0 && fs.existsSync(path.join(pvDir, '请假审批-功能点-V1.0.csv')) && fs.readFileSync(path.join(pvDir, '请假审批-功能点-V1.0.csv'), 'utf8').indexOf('M02,') >= 0, '原型阶段 build.mjs --csv 成功，功能点文件含 M02 行', pvCsv.out.slice(0, 300));
  const pvMd = runBuild([pvDir, '--md']);
  ok(pvMd.status !== 0 && /--md/.test(pvMd.out), '原型阶段 build.mjs --md 仍然失败（只放开 CSV）', 'exit=' + pvMd.status);
  const pvHtml = path.join(pvDir, '请假审批-原型.html');
  if (fs.existsSync(pvHtml)) {
    const bC = await launch();
    try {
      const pg = await bC.newPage({ width: 1600, height: 1000 });
      await pg.goto(fileUrl(pvHtml));
      await pg.waitFor('window.__PRD_READY === true', 20000);
      const btn = await pg.evaluate('(function(){ var b = document.querySelector("[data-tool=csv]"); return !!b && b.textContent.trim() === "清单" && !document.querySelector("[data-act-doc=csv]"); })()');
      ok(btn === true, '原型阶段：顶栏有「清单」按钮，文档栏没有重复的导出按钮');
      const d = await downloadFrom(pg, '[data-tool=csv]');
      const rows = d.text ? toObjs(parseCsv(d.text.replace(/^\uFEFF/, ''))) : [];
      ok(d.names[0] === '请假审批-研发测试清单-V1.0.csv' && rows.some((r) => r.sheet === 'fns' && r.fnId === 'submit'), '原型阶段点「清单」：下载同一份 CSV，含功能点行', JSON.stringify(d.names));
      ok(d.bytes[0] === 0xef && d.bytes[1] === 0xbb && d.bytes[2] === 0xbf, '原型阶段「清单」导出的 CSV 以 UTF-8 BOM 开头（Excel 可直接打开）');
    } finally { await bC.close(); }
  }

  /* D/E. 托管模式：默认和原型都能 build --csv；默认模式文档栏只剩「导出 Markdown」且能导出，原型阶段「清单」导出 CSV 有功能点行 */
  const hostD = await build(variant(HOSTFX, []), { csv: true });
  ok(hostD.ok && hostD.csvFiles && hostD.csvFiles.length === 3, '托管模式（默认）build --csv 检查通过，写出三份 CSV', hostD.ok ? '' : JSON.stringify(hostD.report.errors.slice(0, 2)));
  const hostP = await build(variant(HOSTFX, [PROTO_EDIT14]), { csv: true });
  ok(hostP.ok && hostP.csvFiles && hostP.csvFiles.length === 3, '托管模式（原型阶段）build --csv 检查通过，写出三份 CSV', hostP.ok ? '' : JSON.stringify(hostP.report.errors.slice(0, 2)));
  for (const [r, sel, label] of [[hostD, '[data-act-doc=md]', '托管默认'], [hostP, '[data-tool=csv]', '托管原型']]) {
    if (!r.ok) continue;
    const b = await launch();
    try {
      const pg = await b.newPage({ width: 1600, height: 1000 });
      await pg.goto(fileUrl(r.file));
      await pg.waitFor('window.__PRD_READY === true', 20000);
      if (sel === '[data-act-doc=md]') {
        await pg.evaluate('location.hash = "#/doc"; 1'); await sleep(500);
        const acts = await pg.evaluate('Array.from(document.querySelectorAll("[data-act-doc]")).map(function (b) { return b.dataset.actDoc; }).join(",")');
        const dm = await downloadFrom(pg, sel);
        ok(acts === 'md' && /需求文档-V1\.0\.md$/.test(dm.names[0] || '') && /^# .+ · 需求文档/.test(dm.text || ''), label + '：需求文档栏只有「导出 Markdown」，点击得到 Markdown', acts + ' ' + JSON.stringify(dm.names));
        continue;
      }
      const d = await downloadFrom(pg, sel);
      const rows = d.text ? toObjs(parseCsv(d.text.replace(/^\uFEFF/, ''))) : [];
      ok(rows.filter((x) => x.sheet === 'fns').length > 0, label + '：点击导出得到 CSV，含功能点行（' + rows.filter((x) => x.sheet === 'fns').length + ' 行）', JSON.stringify(d.names));
    } finally { await b.close(); }
  }

  /* F. --export-pack：研发包目录含三份 CSV、页面截图和清单.md（图片引用指向 pages/） */
  const pkDir = variant(EXAMPLE, []);
  const pk = await build(pkDir, { exportPack: true });
  ok(pk.ok && pk.pack, '--export-pack：检查通过并生成研发包', pk.ok ? '' : JSON.stringify(pk.report.errors.slice(0, 2)));
  if (pk.ok && pk.pack) {
    const dir = pk.pack.dir;
    ok(dir === path.join(pkDir, 'export', '请假审批-研发包-V1.0') && lvNames.every((n) => fs.existsSync(path.join(dir, n))), '研发包在 export/<产品名>-研发包-<版本>/ 下，含三份 CSV', dir);
    const pngs = fs.existsSync(path.join(dir, 'pages')) ? fs.readdirSync(path.join(dir, 'pages')).filter((n) => /\.png$/.test(n)) : [];
    const pngHead = pngs.length ? fs.readFileSync(path.join(dir, 'pages', pngs[0])).subarray(0, 8).toString('hex') : '';
    ok(pngs.length >= 1 && pngHead === '89504e470d0a1a0a', '研发包含页面截图（PNG，' + pngs.length + ' 张）');
    const list = fs.readFileSync(path.join(dir, '清单.md'), 'utf8');
    ok(/!\[[^\]]*\]\(pages\/M01\.png\)/.test(list) && list.includes('| M02 发起请假 | submit |'), '清单.md 含页面截图引用，并列出功能点表');
  }

  /* G. 检查未通过时不写研发包和 CSV；--draft 与 --csv 同用时报错 */
  const bad = variant(HOSTFX, [['existing/crm.html', '</head>', '<script src="https://cdn.example.com/lib.js"></script>\n</head>']]);
  const badR = await build(bad, { exportPack: true, csv: true });
  ok(!badR.ok && !fs.existsSync(path.join(bad, 'export')) && !fs.readdirSync(bad).some((n) => /功能点-|研发测试/.test(n)), '检查未通过：不写研发包，也不写 CSV');
  let draftErr = null;
  try { await build(variant(EXAMPLE, []), { draft: true, csv: true }); } catch (e) { draftErr = e; }
  ok(draftErr && /--draft/.test(draftErr.message), '--draft 与 --csv 同用时报错，不静默忽略');
}

/* ---------- 15. 按角色看原型 ---------- */
console.log('\n15. 按角色看原型');
{
  const COURSE = path.join(SKILL, 'examples', 'course-mgmt');
  const PROTO_15 = [PROD, 'W.product({', "W.product({\n  stage: 'prototype',"];
  ok(/roles:\s*\[\s*'admin'\s*\]/.test(fs.readFileSync(path.join(COURSE, 'prd', 'pages', 'P01-courses.js'), 'utf8')),
    '15-1 课程管理 create-entry 功能点有 roles: ["admin"]');

  const roleDir = path.join(TMP, 'role-test');
  fs.mkdirSync(path.join(roleDir, 'prd', 'pages'), { recursive: true });
  const roleProd = path.join(roleDir, 'prd', 'product.js');
  const rolePage = path.join(roleDir, 'prd', 'pages', 'P01.js');
  const writeRole = (prodBody, rolesLiteral) => {
    fs.writeFileSync(roleProd, prodBody);
    fs.writeFileSync(rolePage, `W.page({
  id: 'P01', end: 'pc', title: '测试', goal: '验证功能点按角色过滤',
  states: [{ id: 's1', label: '默认', when: '打开本页时显示列表区域' }],
  fns: [
    { id: 'f1', name: '功能点 1', desc: '仅管理员可见：点击后打开管理操作区，系统按管理员权限展示入口。', src: '测试', roles: ${rolesLiteral} },
    { id: 'f2', name: '功能点 2', desc: '所有人可见：点击后查看公开信息，系统展示不限角色的内容。', src: '测试' }
  ],
  render: function (c) {
    return '<div style="padding:24px"><div data-fn="f1"><button class="btn">管理员</button></div><div data-fn="f2"><button class="btn">所有人</button></div></div>';
  }
});
`);
  };

  writeRole(`W.product({
  id: 'test-role', name: '角色测试', date: '2026-11-05',
  releases: [{ id: 'V1.0', date: '2026-11-05', summary: '首版' }],
  background: '用来验证功能点 roles 引用必须落在 product.roles 里，否则构建失败。',
  scope: { out: ['不做其他端'] },
  roles: [{ id: 'admin', name: '管理员' }],
  ends: [{ id: 'pc', name: 'PC', device: 'pc', home: 'P01' }]
});
`, "['non-existent-role']");
  const badBuild = await build(roleDir, {});
  ok(!badBuild.ok && hasCode(badBuild, 'ROLE_ID'), '15-2 功能点 roles 引用不存在的角色：构建报 ROLE_ID 错误',
    badBuild.ok ? '构建意外成功' : JSON.stringify(codes(badBuild).slice(0, 3)));

  writeRole(`W.product({
  id: 'test-role', name: '角色测试', date: '2026-11-05',
  releases: [{ id: 'V1.0', date: '2026-11-05', summary: '首版' }],
  background: '用来验证 product.roles 为空时功能点不能写 roles。',
  scope: { out: ['不做其他端'] },
  roles: [],
  ends: [{ id: 'pc', name: 'PC', device: 'pc', home: 'P01' }]
});
`, "['admin']");
  const noRolesRes = await build(roleDir, {});
  ok(!noRolesRes.ok && hasCode(noRolesRes, 'ROLE_ID'), '15-3 product.roles 为空时功能点写 roles：报 ROLE_ID',
    noRolesRes.ok ? '构建意外成功' : JSON.stringify(codes(noRolesRes).slice(0, 3)));

  writeRole(`W.product({
  id: 'test-role', name: '角色测试', date: '2026-11-05',
  releases: [{ id: 'V1.0', date: '2026-11-05', summary: '首版' }],
  background: '用来验证合法的功能点 roles 能通过构建检查。',
  scope: { out: ['不做其他端'] },
  roles: [{ id: 'admin', name: '管理员' }, { id: 'secretary', name: '秘书' }],
  ends: [{ id: 'pc', name: 'PC', device: 'pc', home: 'P01' }]
});
`, "['admin']");
  const goodBuild = await build(roleDir, {});
  ok(goodBuild.ok, '15-4 合法的 roles（包含在 product.roles 中）：构建通过',
    goodBuild.ok ? '' : JSON.stringify(goodBuild.report.errors.slice(0, 3)));

  const cmDir = variant(COURSE, []);
  const courseBuild = await build(cmDir, {});
  ok(courseBuild.ok, '课程管理构建通过（角色交互前置）', courseBuild.ok ? '' : JSON.stringify((courseBuild.report.errors || []).slice(0, 2)));

  if (courseBuild.ok && courseBuild.file) {
    const bc = await launch();
    try {
      const pg = await bc.newPage({ width: 1600, height: 1000 });
      const open = async (file, hash) => {
        await pg.goto('about:blank');
        await pg.goto(fileUrl(file) + (hash || ''));
        await pg.waitFor('window.__PRD_READY === true', 20000);
        await sleep(400);
      };
      const visibleCreate = `Array.from(document.querySelectorAll('[data-fn="create-entry"]')).some(function (el) { var st = window.getComputedStyle(el); return st.display !== 'none' && el.offsetHeight > 0; })`;
      const hiddenCreate = `Array.from(document.querySelectorAll('[data-fn="create-entry"]')).every(function (el) { return window.getComputedStyle(el).display === 'none' || el.offsetHeight === 0; })`;

      await open(courseBuild.file, '#/p/P01/list');
      ok(await pg.evaluate(`document.getElementById('role-sel') !== null`), '15-5 顶栏有角色下拉');
      ok(await pg.evaluate(visibleCreate), '15-5 默认（全部角色）create-entry 可见');

      await pg.evaluate(`W.setRole('secretary')`);
      await sleep(400);
      ok(await pg.evaluate(`(document.getElementById('role-sel') || {}).value === 'secretary'`), '15-5 秘书角色下角色下拉显示秘书');
      ok(await pg.evaluate(hiddenCreate), '15-5 秘书角色下 create-entry 隐藏');
      ok(await pg.evaluate(`(function () { var c = document.querySelector('#right .fc[data-fn="create-entry"]'); return !c || window.getComputedStyle(c).display === 'none'; })()`),
        '15-5 秘书角色下 create-entry 需求卡片隐藏');
      ok(await pg.evaluate(`!Array.from(document.querySelectorAll('#dots .fdot')).some(function (d) { return d.title === '新建课程入口'; })`),
        '15-5 秘书角色下 create-entry 圆点不显示');

      await pg.evaluate(`W.setRole('all')`);
      await sleep(400);
      ok(await pg.evaluate(visibleCreate), '15-5 切回全部角色 create-entry 恢复可见');
      await pg.evaluate(`W.setRole('admin')`);
      await sleep(400);
      ok(await pg.evaluate(visibleCreate), '15-5 管理员角色下 create-entry 可见');

      /* 真实下拉：只派发 change，不点 click */
      await pg.evaluate(`W.setRole('all')`);
      await sleep(200);
      await pg.evaluate(`(function () {
        var sel = document.getElementById('role-sel');
        sel.value = 'secretary';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      await sleep(400);
      ok(await pg.evaluate(`(document.getElementById('role-sel') || {}).value === 'secretary'`), '15-5b change 后下拉显示秘书');
      ok(await pg.evaluate(hiddenCreate), '15-5b change 后 create-entry 隐藏');
      ok(await pg.evaluate(`(function () { var c = document.querySelector('#right .fc[data-fn="create-entry"]'); return !c || window.getComputedStyle(c).display === 'none'; })()`),
        '15-5b change 后 create-entry 需求卡片隐藏');

      const protoBuild = await build(variant(COURSE, [PROTO_15]), {});
      if (protoBuild.ok && protoBuild.file) {
        await open(protoBuild.file, '#/p/P01/list');
        ok(await pg.evaluate(`document.getElementById('role-sel') !== null`), '15-6 原型阶段也有角色下拉');
        await pg.evaluate(`W.setRole('secretary')`);
        await sleep(400);
        ok(await pg.evaluate(hiddenCreate), '15-6 原型阶段秘书角色下 create-entry 隐藏');
        ok(await pg.evaluate(`!Array.from(document.querySelectorAll('#dots .fdot')).some(function (d) { return d.title === '新建课程入口'; })`),
          '15-6 原型阶段秘书角色下 create-entry 圆点不显示');
        await pg.evaluate(`W.setRole('all')`);
        await sleep(400);
        ok(await pg.evaluate(visibleCreate), '15-6 原型阶段切回全部角色 create-entry 恢复可见');
      } else {
        ok(false, '15-6 原型阶段版本构建失败', JSON.stringify((protoBuild.report && protoBuild.report.errors || []).slice(0, 2)));
        ok(false, '15-6 原型阶段秘书角色下 create-entry 圆点不显示');
        ok(false, '15-6 原型阶段切回全部角色 create-entry 恢复可见');
      }

      await open(courseBuild.file, '#/p/P01/list');
      await pg.evaluate(`W.setRole('secretary')`);
      await sleep(200);
      await open(courseBuild.file, '#/p/P01/list');
      const selectedRoleAfterReload = await pg.evaluate(`(document.getElementById('role-sel') || {}).value || ''`);
      ok(selectedRoleAfterReload === 'secretary', '15-7 刷新后选中的角色记住（localStorage）',
        selectedRoleAfterReload === 'secretary' ? '' : '期望 secretary，实际 ' + selectedRoleAfterReload);
      ok(await pg.evaluate(hiddenCreate), '15-7 刷新后 create-entry 仍然隐藏');
      ok(await pg.evaluate(`(function () { var c = document.querySelector('#right .fc[data-fn="create-entry"]'); return !c || window.getComputedStyle(c).display === 'none'; })()`),
        '15-7 刷新后 create-entry 需求卡片仍然隐藏');

      /* 托管：create 仅 leader 可见；切到 sales 后按 sel 隐藏 #btn-new */
      const hostDir = variant(HOSTFX, [
        ['prd/pages/C01-customers.js', "id: 'create', name: '新建客户入口', sel: '#btn-new',", "id: 'create', name: '新建客户入口', sel: '#btn-new', roles: ['leader'],"]
      ]);
      const hostBuild = await build(hostDir, {});
      if (hostBuild.ok && hostBuild.file) {
        await open(hostBuild.file, '#/p/C01/list');
        ok(await pg.evaluate(`document.getElementById('role-sel') !== null`), '15-8 托管模式顶栏有角色下拉');
        await pg.evaluate(`W.setRole('all')`);
        await sleep(300);
        const hostVisible = await pg.evaluate(`(function () { var f = document.getElementById('hostf'); var d = f && f.contentDocument; var el = d && d.querySelector('#btn-new'); if (!el) return false; var st = d.defaultView.getComputedStyle(el); return st.display !== 'none' && el.offsetHeight > 0; })()`);
        ok(hostVisible, '15-8 托管全部角色下 #btn-new 可见');
        await pg.evaluate(`W.setRole('sales')`);
        await sleep(400);
        const hostHidden = await pg.evaluate(`(function () { var f = document.getElementById('hostf'); var d = f && f.contentDocument; var el = d && d.querySelector('#btn-new'); if (!el) return false; var st = d.defaultView.getComputedStyle(el); return st.display === 'none' || el.offsetHeight === 0; })()`);
        ok(hostHidden, '15-8 托管销售角色下 #btn-new（sel）隐藏');
      } else {
        ok(false, '15-8 托管模式构建失败', JSON.stringify((hostBuild.report && hostBuild.report.errors || []).slice(0, 2)));
        ok(false, '15-8 托管全部角色下 #btn-new 可见');
        ok(false, '15-8 托管销售角色下 #btn-new（sel）隐藏');
      }

      /* 15-9：全部角色下不得清掉作者写的内联 display（托管弹窗 / 原生 data-fn） */
      const hostInlineDir = variant(HOSTFX, [
        ['prd/pages/C01-customers.js', "id: 'create', name: '新建客户入口', sel: '#btn-new',", "id: 'create', name: '新建客户入口', sel: '#btn-new', roles: ['leader'],"],
        ['prd/pages/C01-customers.js', "sel: '#modal-new .modal',", "sel: '#modal-new',"],
        ['existing/app.js',
          "function openModal() { document.getElementById('modal-new').classList.add('show'); }",
          "function openModal() { document.getElementById('modal-new').style.display = 'flex'; }"],
        ['existing/app.js',
          "function closeModal() { document.getElementById('modal-new').classList.remove('show'); }",
          "function closeModal() { document.getElementById('modal-new').style.display = ''; }"]
      ]);
      const hostInlineBuild = await build(hostInlineDir, {});
      if (hostInlineBuild.ok && hostInlineBuild.file) {
        await open(hostInlineBuild.file, '#/p/C01/list');
        await pg.evaluate(`W.setRole('all')`);
        await sleep(300);
        await pg.evaluate(`document.getElementById('hostf').contentDocument.getElementById('btn-new').click()`);
        await sleep(1000);
        const modalDisp = await pg.evaluate(`(function () {
          var d = document.getElementById('hostf').contentDocument;
          var e = d.getElementById('modal-new');
          return { inline: e.style.display, computed: d.defaultView.getComputedStyle(e).display, hash: location.hash };
        })()`);
        ok(modalDisp.inline === 'flex' && modalDisp.computed === 'flex',
          '15-9 托管全部角色下内联 display:flex 弹窗保持打开', JSON.stringify(modalDisp));
      } else {
        ok(false, '15-9 托管内联 display 夹具构建失败', JSON.stringify((hostInlineBuild.report && hostInlineBuild.report.errors || []).slice(0, 2)));
      }

      /* 原生探针：带内联 display:flex 的 data-fn，验证全部角色不清除、隐藏时备份 */
      const probeDir = path.join(TMP, 'role-inline-probe');
      fs.mkdirSync(path.join(probeDir, 'prd', 'pages'), { recursive: true });
      fs.writeFileSync(path.join(probeDir, 'prd', 'product.js'), `W.product({
  id: 'role-inline', name: '内联显示探针', date: '2026-11-05',
  releases: [{ id: 'V1.0', date: '2026-11-05', summary: '首版' }],
  background: '验证全部角色下 applyRoleFilter 不清除作者写的内联 display。',
  scope: { out: ['不做其他端'] },
  roles: [{ id: 'admin', name: '管理员' }, { id: 'secretary', name: '秘书' }],
  ends: [{ id: 'pc', name: 'PC', device: 'pc', home: 'P01' }]
});
`);
      fs.writeFileSync(path.join(probeDir, 'prd', 'pages', 'P01.js'), `W.page({
  id: 'P01', end: 'pc', title: '探针', goal: '内联 display 不被清空',
  states: [{ id: 's1', label: '默认', when: '打开本页时显示探针区域' }],
  fns: [
    { id: 'box', name: '探针块', desc: '作者写了 display:flex 的区域，全部角色下应保持 flex。', src: '测试', roles: ['admin'] }
  ],
  render: function (c) {
    return '<div style="padding:24px"><div data-fn="box" style="display:flex;gap:8px"><button class="btn">管理员区</button></div></div>';
  }
});
`);
      const probeBuild = await build(probeDir, {});
      if (probeBuild.ok && probeBuild.file) {
        await open(probeBuild.file, '#/p/P01/s1');
        await pg.evaluate(`W.setRole('all')`);
        await sleep(400);
        const probeAll = await pg.evaluate(`(function () {
          var el = document.querySelector('#ab [data-fn="box"]');
          if (!el) return { ok: false };
          return { ok: true, inline: el.style.display, computed: getComputedStyle(el).display };
        })()`);
        ok(probeAll.ok && probeAll.inline === 'flex' && probeAll.computed === 'flex',
          '15-9 原生全部角色下内联 display:flex 保持原样', JSON.stringify(probeAll));
        await pg.evaluate(`W.setRole('secretary')`);
        await sleep(400);
        const probeSec = await pg.evaluate(`(function () {
          var el = document.querySelector('#ab [data-fn="box"]');
          if (!el) return { ok: false };
          return { ok: true, inline: el.style.display, computed: getComputedStyle(el).display, backup: el.getAttribute('data-display-backup') };
        })()`);
        ok(probeSec.ok && probeSec.computed === 'none' && probeSec.backup === 'flex',
          '15-9 原生秘书角色下隐藏并备份原 display', JSON.stringify(probeSec));
        await pg.evaluate(`W.setRole('all')`);
        await sleep(400);
        const probeBack = await pg.evaluate(`(function () {
          var el = document.querySelector('#ab [data-fn="box"]');
          if (!el) return { ok: false };
          return { ok: true, inline: el.style.display, computed: getComputedStyle(el).display, backup: el.getAttribute('data-display-backup') };
        })()`);
        ok(probeBack.ok && probeBack.inline === 'flex' && probeBack.computed === 'flex' && !probeBack.backup,
          '15-9 原生切回全部角色后恢复备份的 flex', JSON.stringify(probeBack));
      } else {
        ok(false, '15-9 原生内联 display 探针构建失败', JSON.stringify((probeBuild.report && probeBuild.report.errors || []).slice(0, 2)));
        ok(false, '15-9 原生秘书角色下隐藏并备份原 display');
        ok(false, '15-9 原生切回全部角色后恢复备份的 flex');
      }
    } finally {
      await bc.close();
    }
  } else {
    ok(false, '15-5~15-9 课程管理构建失败，无法测试浏览器交互', JSON.stringify((courseBuild.report && courseBuild.report.errors || []).slice(0, 2)));
  }
}


/* ---------- 16. 1.2.2 复核反例（每条对应一个已修的问题） ---------- */
console.log('\n16. 1.2.2 复核反例');
{
  const BM01 = 'prd/pages/M01-list.js', BM02 = 'prd/pages/M02-apply.js', BPROD = 'prd/product.js';
  /* 01 原生页面里自定义的可点元素（role=button + onclick）也要登记 */
  const r01 = await build(variant(BEH, [[BM01, "body: '<div class=\"col g12\">' +", "body: '<div class=\"col g12\"><div role=\"button\" onclick=\"void 0\">额外操作</div>' +"]]), {});
  ok(!r01.ok && r01.report.errors.some((e) => e.code === 'UNREGISTERED' && /额外操作/.test(e.msg)), '16-01 原生页面的 role=button / onclick 元素未登记 → UNREGISTERED', JSON.stringify(codes(r01)));
  /* 02 h.submit 配不上表单、成功跳转目标不存在、搜索框配不上列表，都要拦住 */
  const r02a = await build(variant(BEH, [[BM02, "h.submit('提交申请', { form: 'leave'", "h.submit('提交申请', { form: 'missing'"]]), { md: true });
  ok(!r02a.ok && hasCode(r02a, 'BEHAVE'), '16-02 h.submit 的 form 找不到 h.form → BEHAVE', JSON.stringify(codes(r02a)));
  const r02b = await build(variant(BEH, [[BM02, "ok: { go: 'M01', st: 'list' }", "ok: { go: 'P404' }"]]), {});
  ok(!r02b.ok && r02b.report.errors.some((e) => e.code === 'GO_TARGET' && /P404/.test(e.msg)), '16-02 h.submit 成功后跳到不存在的页面 → GO_TARGET', JSON.stringify(codes(r02b)));
  const r02c = await build(variant(BEH, [[BM01, "filter: 'list' })", "filter: 'nolist' })"]]), {});
  ok(!r02c.ok && hasCode(r02c, 'BEHAVE'), '16-02 h.search 的 filter 找不到 h.rows → BEHAVE', JSON.stringify(codes(r02c)));
  /* 03 h.rows 是列表：有数据时要求 empty；没有数据时功能点仍算出现 */
  const r03a = await build(variant(BEH, [[BM01, "      empty: '还没有请假单时显示“暂无请假单”，提示点击下方按钮发起请假',\n", '']]), {});
  ok(!r03a.ok && hasCode(r03a, 'LIST_EMPTY'), '16-03 h.rows 所属功能点没写 empty → LIST_EMPTY', JSON.stringify(codes(r03a)));
  const r03b = await build(variant(BEH, [[BPROD, 'list: { items: [', 'list: { items: [] }, unused: { items: ['], [BM01, "h.rows('list', rows, { fn: 'search'", "h.rows('list', rows, { fn: 'rows'"], [BM01, "    {\n      id: 'create', name: '新建请假',", "    {\n      id: 'rows', name: '请假单列表', desc: '按提交时间倒序列出本人的请假单，每行显示单号、类型和事由。',\n      fields: [{ key: 'no', name: '单号', type: '文本', rule: '系统生成' }], empty: '没有请假单时显示“暂无请假单”', src: '夹具'\n    },\n    {\n      id: 'create', name: '新建请假',"]]), {});
  ok(r03b.ok && !hasCode(r03b, 'FN_UNUSED'), '16-03 h.rows 没有数据时功能点仍绑定在列表上（不误报 FN_UNUSED）', JSON.stringify(codes(r03b)));
  /* 04 同类端脚手架：页面不互相覆盖，每个手机端用自己的底部导航 */
  const sc2 = path.join(TMP, 'scaffold-pc2');
  execFileSync(process.execPath, [path.join(here, 'new.mjs'), sc2, '--name', '两个后台', '--end', 'pc:甲', '--end', 'pc:乙'], { stdio: 'pipe' });
  ok(fs.readdirSync(path.join(sc2, 'prd', 'pages')).length === 2, '16-04 两个 PC 端生成两个首页模板，不互相覆盖', fs.readdirSync(path.join(sc2, 'prd', 'pages')).join(','));
  const sc3 = path.join(TMP, 'scaffold-m2');
  execFileSync(process.execPath, [path.join(here, 'new.mjs'), sc3, '--name', '两个手机端', '--end', 'pc:后台', '--end', 'mobile:甲', '--end', 'mobile:乙'], { stdio: 'pipe' });
  const r04 = await build(sc3, {});
  ok(fs.readdirSync(path.join(sc3, 'prd', 'pages')).length === 3 && !r04.report.errors.some((e) => /FN_UNKNOWN|FN_UNUSED/.test(e.code) && /tab|底部导航/.test(e.msg)), '16-04 两个手机端各用自己的底部导航（不报 FN_UNKNOWN / FN_UNUSED）', JSON.stringify(r04.report.errors.filter((e) => /FN_U/.test(e.code)).slice(0, 3)));

  /* 05 复选框、开关参与必填校验；08 CSV 状态按文字里的 [待确认] 判断 */
  const fx05 = await build(variant(BEH, [
    [BM02, "fields: [{ key: 'reason', name: '请假事由', type: '文本', required: true, rule: '5–200 字' }],", "fields: [{ key: 'reason', name: '请假事由', type: '文本', required: true, rule: '5–200 字' }, { key: 'agree', name: '承诺', type: '布尔', required: true, rule: '勾选后才能提交' }, { key: 'notify', name: '通知主管', type: '布尔', required: true, rule: '开启后才能提交' }],"],
    [BM02, "{ req: 1, min: 5, max: 200, fn: 'form', field: 'reason' }),", "{ req: 1, min: 5, max: 200, fn: 'form', field: 'reason' }) + h.fld('承诺', h.ck('信息属实', true, { field: 'agree', fn: 'form' }), { req: 1, fn: 'form', field: 'agree' }) + h.fld('通知主管', h.sw(true, { field: 'notify', fn: 'form' }), { req: 1, fn: 'form', field: 'notify' }),"],
    [BM01, "desc: '点击“新建请假”进入发起页面。',", "desc: '点击“新建请假”进入发起页面。[待确认]',"]
  ]), { csv: true });
  ok(fx05.ok, '16-05 复选框、开关必填夹具构建通过', fx05.ok ? '' : JSON.stringify(fx05.report.errors.slice(0, 3)));
  const fnCsv = fx05.ok ? fs.readFileSync(fx05.csvFiles[0], 'utf8') : '';
  ok(/M01,[^\n]*,create,新建请假,[^\n]*,待确认\r?\n/.test(fnCsv), '16-08 desc 里写了 [待确认] 的功能点，CSV 状态列为“待确认”', fnCsv.split('\n').filter((l) => /create/.test(l)).join(' | '));
  /* 08 命令行 Markdown 用最终报告：端写 online: true 时标“需联网” */
  const onMd = await build(variant(HOSTFX, [['existing/crm.html', '</head>', '<script src="https://cdn.example.com/lib.js"></script>\n</head>'], [PROD, "host: '../existing/crm.html', width", "host: '../existing/crm.html', online: true, width"]]), { md: true });
  ok(onMd.ok && /需联网/.test(fs.readFileSync(onMd.mdFile, 'utf8')), '16-08 命令行导出的 Markdown 也标“需联网”，与交付 HTML 一致');

  /* 07 只改了状态或功能点里的规则，也算本版变化 */
  const r07 = await build(variant(BEH, [
    [BPROD, "releases: [{ id: 'V1.0', date: '2026-11-04', summary: '回归夹具' }],", "releases: [{ id: 'V1.0', date: '2026-11-04', summary: '回归夹具' }, { id: 'V1.1', date: '2026-11-11', summary: '调整' }],"],
    [BM01, "{ id: 'list', label: '列表', when: '进入页面时，演示数据中已有请假单' }", "{ id: 'list', label: '列表', when: '进入页面时，演示数据中已有请假单，按提交时间倒序', changes: [{ ver: 'V1.1', type: 'modified', note: '补充排序' }] }"],
    [BM02, "errors: ['必填或长度不通过：不发出请求，字段下方提示原因', '提交失败：保留已填内容，提示后可重试'],", "errors: ['必填或长度不通过：不发出请求，字段下方提示原因', { text: '提交失败：保留已填内容，提示后可重试，最多重试 3 次', changes: [{ ver: 'V1.1', type: 'modified', note: '限制重试次数' }] }],"]
  ]), {});

  /* 06 角色过滤：公共组件的画板元素、托管页面同选择器按 text 区分 */
  const shDir = path.join(TMP, 'role-shared');
  fs.mkdirSync(path.join(shDir, 'prd', 'pages'), { recursive: true });
  fs.writeFileSync(path.join(shDir, 'prd', 'product.js'), `W.product({
  id: 'role-shared', name: '公共组件角色', date: '2026-11-11',
  releases: [{ id: 'V1.0', date: '2026-11-11', summary: '首版' }],
  background: '验证公共组件的功能点按角色过滤时，画板上的元素同样隐藏。',
  scope: { out: ['不做其他端'] },
  roles: [{ id: 'admin', name: '管理员' }, { id: 'secretary', name: '秘书' }],
  ends: [{ id: 'pc', name: 'PC', device: 'pc', home: 'P01' }]
});
`);
  fs.writeFileSync(path.join(shDir, 'prd', 'kit.js'), `W.shared({ id: 'nav', end: 'pc', title: '导航', fns: [
  { id: 'nav-admin', name: '管理入口', desc: '仅管理员可见：点击后提示进入管理后台。', src: '测试', roles: ['admin'] }
] });
`);
  fs.writeFileSync(path.join(shDir, 'prd', 'pages', 'P01.js'), `W.page({
  id: 'P01', end: 'pc', title: '首页', goal: '验证公共导航按角色隐藏',
  states: [{ id: 's1', label: '默认', when: '打开本页时显示导航' }],
  fns: [],
  render: function (c) { return '<div style="padding:24px"><div data-fn="nav-admin"><a class="lnk" data-act="toast" data-msg="演示">管理</a></div></div>'; }
});
`);
  const shB = await build(shDir, {});
  const hostTxt = await build(variant(HOSTFX, [['prd/pages/C01-customers.js', "id: 'create', name: '新建客户入口', sel: '#btn-new',", "id: 'create', name: '新建客户入口', sel: 'button.btn', text: '新建客户', roles: ['leader'],"]]), {});
  /* 12 截图等托管状态真正进入完成；进入失败时 snap 非零退出 */
  const slow = await build(variant(HOSTFX, [['prd/pages/C01-customers.js', "enter: [{ click: '#btn-new' }]", "enter: [{ wait: 2500 }, { click: '#btn-new' }]"]]), {});
  const badEnter = await build(variant(HOSTFX, [['prd/pages/C01-customers.js', "enter: [{ click: '#btn-new' }]", "enter: [{ click: '#nope' }]"]]), {});
  const bq = await launch();
  try {
    const pg = await bq.newPage({ width: 1600, height: 1000 });
    const open = async (file, hash) => { await pg.goto('about:blank'); await pg.goto(fileUrl(file) + (hash || '')); await pg.waitFor('window.__PRD_READY === true', 20000); await sleep(400); };
    if (fx05.ok) {
      await open(fx05.file, '#/p/M02/form');
      const base = await pg.evaluate('W.get("list.items").length');
      const fill = '(function(){var t=document.querySelector("#ab textarea");t.value="家中有事需回老家处理";t.dispatchEvent(new Event("input",{bubbles:true}));document.querySelector("#ab button[data-form]").click();return 1})()';
      await pg.evaluate(fill);
      await sleep(1100);
      ok((await pg.evaluate('W.get("list.items").length')) === base + 1 && (await pg.evaluate('W.get("list.items")[0].agree')) === '信息属实', '16-05 已勾选的必填复选框、已开启的开关通过校验，提交写入勾选的值');
      await open(fx05.file, '#/p/M02/form');
      await pg.evaluate('document.querySelector("#ab .ck").click(); 1');
      await pg.evaluate(fill);
      await sleep(900);
      ok(/请填写承诺/.test(await pg.evaluate('document.querySelector("#ab").textContent')) && (await pg.evaluate('W.get("list.items").length')) === base + 1, '16-05 取消勾选必填复选框后提交被拦，提示“请填写承诺”');
    }
    if (r07.ok) {
      await open(r07.file, '#/doc');
      const v = JSON.parse(await pg.evaluate('JSON.stringify({ m01: W.doc.pageChanged(W.pages.M01), m02: W.doc.pageChanged(W.pages.M02), md: W.doc.markdown({ html: false, changesOnly: true }) })'));
      ok(v.m01 && v.m02 && /已有请假单，按提交时间倒序/.test(v.md) && /最多重试 3 次/.test(v.md) && !/本版没有页面级变化/.test(v.md), '16-07 只改了状态或功能点的异常，也算页面变化，“只看本版变化”列出改后的正文', JSON.stringify({ m01: v.m01, m02: v.m02 }));
    } else ok(false, '16-07 版本变化夹具构建失败', JSON.stringify(r07.report.errors.slice(0, 3)));
    if (shB.ok) {
      await open(shB.file, '#/p/P01/s1');
      await pg.evaluate("W.setRole('secretary')");
      await sleep(400);
      ok(await pg.evaluate('getComputedStyle(document.querySelector(\'#ab [data-fn="nav-admin"]\')).display === "none"'), '16-06 公共组件的功能点按角色过滤时，画板元素也隐藏');
    } else ok(false, '16-06 公共组件角色夹具构建失败', JSON.stringify(shB.report.errors.slice(0, 3)));
    if (hostTxt.ok) {
      await open(hostTxt.file, '#/p/C01/list');
      await pg.evaluate("W.setRole('sales')");
      await sleep(600);
      const vis = JSON.parse(await pg.evaluate('(function(){var d=document.getElementById("hostf").contentDocument;var s=function(id){return d.defaultView.getComputedStyle(d.getElementById(id)).display};return JSON.stringify({ add: s("btn-new"), exp: s("btn-export") })})()'));
      ok(vis.add === 'none' && vis.exp !== 'none', '16-06 托管页面 sel 相同、用 text 区分时，只隐藏文字匹配的元素', JSON.stringify(vis));
    } else ok(false, '16-06 托管 text 夹具构建失败', JSON.stringify(hostTxt.report.errors.slice(0, 3)));
    if (slow.ok) {
      await open(slow.file, '');
      await pg.evaluate('location.hash = "#/p/C01/new"; 1');
      await sleep(450);
      const err = await waitHost(pg);
      ok(!err && await pg.evaluate('(function(){var d=document.getElementById("hostf").contentDocument;var m=d.getElementById("modal-new");return d.defaultView.getComputedStyle(m).display !== "none"})()'), '16-12 waitHost 等到进入步骤（含 2.5 秒等待）执行完，再截图', err);
    } else ok(false, '16-12 慢进入夹具构建失败', JSON.stringify(slow.report.errors.slice(0, 3)));
  } finally { await bq.close(); }
  let snapCode = 0, snapOut = '';
  try { snapOut = execFileSync(process.execPath, [path.join(here, 'snap.mjs'), badEnter.failed, '--only', '--view', '#/p/C01/new', '--out', path.join(TMP, 'snap-bad')], { encoding: 'utf8', timeout: 120000 }); }
  catch (e) { snapCode = e.status; snapOut = String(e.stdout || ''); }
  ok(!badEnter.ok && snapCode === 1 && /进入状态失败/.test(snapOut), '16-12 托管状态进入失败时 snap.mjs 报出原因并非零退出', 'exit=' + snapCode + ' ' + snapOut.slice(0, 200));

  /* 10 托管 CSS 内联保留 media 条件；带 layer() 的导入无法保持，明确报错 */
  const cssDir = path.join(TMP, 'host-css');
  fs.mkdirSync(cssDir, { recursive: true });
  fs.writeFileSync(path.join(cssDir, 'p.css'), 'body{color:red}');
  fs.writeFileSync(path.join(cssDir, 'wide.css'), '.w{width:1px}');
  fs.writeFileSync(path.join(cssDir, 'a.html'), '<html><head><link rel="stylesheet" href="p.css" media="print"><style>@import "wide.css" screen and (min-width:1800px);</style></head><body><div>x</div></body></html>');
  fs.writeFileSync(path.join(cssDir, 'b.html'), '<html><head><style>@import "wide.css" layer(base);</style></head><body><div>x</div></body></html>');
  const ca = inlineHost(path.join(cssDir, 'a.html')), cb = inlineHost(path.join(cssDir, 'b.html'));
  ok(/<style media="print">\s*body\{color:red\}/.test(ca.html) && /@media screen and \(min-width:1800px\) \{\s*\.w\{width:1px\}\s*\}/.test(ca.html) && !(ca.bad || []).length, '16-10 内联本地样式时保留 link 的 media 和 @import 的媒体条件');
  ok((cb.bad || []).length === 1 && /layer\(base\)/.test(cb.bad[0]), '16-10 带 layer() 的 @import 无法原样内联，给出错误');

  /* 11 刷新范围基线时第二次构建抛异常：恢复原来的 scope.json（这里原来没有，应删除） */
  const d11 = variant(BEH, [[BPROD, 'W.product({', "var __n = (Math.__kv11 = (Math.__kv11 || 0) + 1);\nW.product({\n  out: __n > 1 && typeof document === 'undefined' ? 123 : undefined,"]]);
  let threw = null;
  try { await build(d11, { scopeBaseline: true }); } catch (e) { threw = e; }
  ok(!!threw && !fs.existsSync(path.join(d11, 'prd', 'scope.json')), '16-11 --scope-baseline 第二次构建抛异常时恢复原基线（不留下新写的 scope.json）', threw ? String(threw.message).slice(0, 120) : '没有抛异常');
}

/* ---------- 17. 复审 r1 反例 ---------- */
console.log('\n17. 复审 r1 反例');
{
  const BM01 = 'prd/pages/M01-list.js', BM02 = 'prd/pages/M02-apply.js', BPROD = 'prd/product.js';
  /* r1-1 一个字段里有日期和时段：日期为空、时段已选，必填仍要拦住 */
  const fx1 = await build(variant(BEH, [
    [BM02, "fields: [{ key: 'reason', name: '请假事由', type: '文本', required: true, rule: '5–200 字' }],", "fields: [{ key: 'reason', name: '请假事由', type: '文本', required: true, rule: '5–200 字' }, { key: 'start', name: '开始时间', type: '日期', required: true, rule: '日期加上午或下午' }],"],
    [BM02, "{ req: 1, min: 5, max: 200, fn: 'form', field: 'reason' }),", "{ req: 1, min: 5, max: 200, fn: 'form', field: 'reason' }) + h.fld('开始时间', h.inp('', { date: 1, e: 1, field: 'start', fn: 'form' }) + h.sel('上午', ['上午', '下午'], { field: 'start', fn: 'form' }), { req: 1, fn: 'form', field: 'start' }),"]
  ]), {});
  ok(fx1.ok, 'r1-1 日期加时段的复合字段夹具构建通过', fx1.ok ? '' : JSON.stringify(fx1.report.errors.slice(0, 3)));

  /* r1-2 托管页面：页面功能点（仅 leader）和公共功能点（所有人）的选择器重叠，元素按归属过滤 */
  const ovDir = variant(HOSTFX, [['prd/pages/C01-customers.js', "id: 'create', name: '新建客户入口', sel: '#btn-new',", "id: 'create', name: '新建客户入口', sel: '#btn-new', roles: ['leader'],"]]);
  fs.writeFileSync(path.join(ovDir, 'prd', 'shared.js'), "W.shared({ id: 'tb', end: 'web', title: '工具栏', fns: [\n  { id: 'toolbar', name: '列表工具栏按钮', sel: '.toolbar button', desc: '列表上方的工具栏按钮，所有角色都能看到工具栏。', src: '测试' }\n] });\n");
  const ov = await build(ovDir, {});

  /* r1-3 只看本版变化：本版移除的规则要列出正文；公共组件的字段、异常变化要有标记并进入变更记录 */
  const r3 = await build(variant(BEH, [
    [BPROD, "releases: [{ id: 'V1.0', date: '2026-11-04', summary: '回归夹具' }],", "releases: [{ id: 'V1.0', date: '2026-11-04', summary: '回归夹具' }, { id: 'V1.1', date: '2026-11-11', summary: '调整' }],"],
    [BPROD, "W.product({", "W.shared({ id: 'tip', end: 'm', title: '顶部提示', fns: [{ id: 'tip', name: '顶部提示条', desc: '页面顶部显示一条固定提示，说明请假规则。', src: '夹具',\n  fields: [{ key: 'msg', name: '提示文字', type: '文本', rule: '最多 30 字，超出截断', changes: [{ ver: 'V1.1', type: 'modified', note: '上限改为 30 字' }] }],\n  errors: [{ text: '提示文字取不到时整条隐藏', changes: [{ ver: 'V1.1', type: 'added' }] }] }] });\nW.product({"],
    [BM01, "body: '<div class=\"col g12\">' +", "body: '<div class=\"col g12\"><div data-fn=\"tip\">请假需提前一天提交</div>' +"],
    [BM01, "      empty: '还没有请假单时显示“暂无请假单”，提示点击下方按钮发起请假',", "      empty: '还没有请假单时显示“暂无请假单”，提示点击下方按钮发起请假',\n      rules: [{ text: '搜索结果按单号排序展示', changes: [{ ver: 'V1.1', type: 'removed', note: '改为按提交时间' }] }],"]
  ]), {});

  const bq = await launch();
  try {
    const pg = await bq.newPage({ width: 1600, height: 1000 });
    const open = async (file, hash) => { await pg.goto('about:blank'); await pg.goto(fileUrl(file) + (hash || '')); await pg.waitFor('window.__PRD_READY === true', 20000); await sleep(400); };
    if (fx1.ok) {
      await open(fx1.file, '#/p/M02/form');
      const base = await pg.evaluate('W.get("list.items").length');
      await pg.evaluate('(function(){var t=document.querySelector("#ab textarea");t.value="家中有事需回老家处理";t.dispatchEvent(new Event("input",{bubbles:true}));document.querySelector("#ab button[data-form]").click();return 1})()');
      await sleep(1100);
      ok(/请填写开始时间/.test(await pg.evaluate('document.querySelector("#ab").textContent')) && (await pg.evaluate('W.get("list.items").length')) === base, 'r1-1 日期为空、时段已选时提交被拦，提示“请填写开始时间”，不写入数据');
      await open(fx1.file, '#/p/M02/form');
      const base2 = await pg.evaluate('W.get("list.items").length');
      await pg.evaluate('(function(){var t=document.querySelector("#ab textarea");t.value="家中有事需回老家处理";var d=document.querySelector("#ab input[type=date]");d.value="2026-11-20";d.dispatchEvent(new Event("input",{bubbles:true}));document.querySelector("#ab button[data-form]").click();return 1})()');
      await sleep(1100);
      ok((await pg.evaluate('W.get("list.items").length')) === base2 + 1 && (await pg.evaluate('W.get("list.items")[0].start')) === '2026-11-20、上午', 'r1-1 补上日期后提交成功，字段值包含日期和时段');
    }
    if (ov.ok) {
      const btn = '(function(){var d=document.getElementById("hostf").contentDocument;return d.defaultView.getComputedStyle(d.getElementById("btn-new")).display})()';
      await open(ov.file, '#/p/C01/list');
      await pg.evaluate("W.setRole('sales')");
      await sleep(600);
      const hid = await pg.evaluate(btn);
      await pg.evaluate("W.setRole('all')");
      await sleep(600);
      const back = await pg.evaluate(btn);
      ok(hid === 'none' && back !== 'none', 'r1-2 选择器重叠时按归属过滤：销售角色下“新建客户”隐藏，不被公共功能点恢复；切回全部角色后恢复', JSON.stringify({ hid, back }));
    } else ok(false, 'r1-2 选择器重叠夹具构建失败', JSON.stringify(ov.report.errors.slice(0, 3)));
    if (r3.ok) {
      await open(r3.file, '#/doc');
      const v = JSON.parse(await pg.evaluate('JSON.stringify({ only: W.doc.markdown({ html: false, changesOnly: true }), full: W.doc.markdown({ html: false }) })'));
      ok(/搜索结果按单号排序展示【V1\.1 移除】/.test(v.only), 'r1-3 只看本版变化时列出本版移除的规则正文和“移除”标记');
      ok(/提示文字[^\n]*【V1\.1 修改】/.test(v.only) && /提示文字取不到时整条隐藏【V1\.1 新增】/.test(v.only), 'r1-3 公共组件的字段、异常变化在本版变化里带标记');
      ok(/### V1\.1 变化明细[\s\S]*顶部提示 · 顶部提示条[\s\S]*字段「提示文字」/.test(v.full) && !/本版变化 · 产品级[\s\S]{0,200}字段「提示文字」/.test(v.only), 'r1-3 公共组件的字段变化进入变更记录，且不算作产品级变化');
      await open(r3.file, '#/p/M01/list');
      await pg.evaluate('document.querySelector("[data-tool=chg]").click(); 1');
      await sleep(500);
      ok(await pg.evaluate('(function(){var c=document.querySelector(\'#right .fc[data-fid="S:tip"]\');return !!c && !c.classList.contains("fold")})()'), 'r1-3 本版变化视图里，有变化的公共组件卡片默认展开');
    } else ok(false, 'r1-3 本版变化夹具构建失败', JSON.stringify(r3.report.errors.slice(0, 3)));
  } finally { await bq.close(); }

  /* r1-4 snap --click 切到慢进入的托管状态：等进入完成后再截；match 不成立时算失败 */
  const slow = await build(variant(HOSTFX, [['prd/pages/C01-customers.js', "enter: [{ click: '#btn-new' }]", "enter: [{ wait: 2500 }, { click: '#btn-new' }]"]]), {});
  const runSnap = (file, args, out) => { try { return { code: 0, out: execFileSync(process.execPath, [path.join(here, 'snap.mjs'), file, '--only', ...args, '--out', path.join(TMP, out)], { encoding: 'utf8', timeout: 120000 }) }; } catch (e) { return { code: e.status, out: String(e.stdout || '') }; } };
  const sc = slow.ok ? runSnap(slow.file, ['--view', '#/p/C01/list', '--click', '#right .chip[data-nav="C01|new"]'], 'snap-click') : { code: -1, out: '' };
  ok(sc.code === 0 && /C01 \/ new · 圆点 \d+ · 当前可见功能点 1(?!\d)(?!（另有)/.test(sc.out), 'r1-4 --click 切到需要 2.5 秒进入的弹窗状态：截图时弹窗已打开（只剩弹窗里的功能点）', sc.out.slice(0, 300));
  const noMatch = await build(variant(HOSTFX, [['prd/pages/C01-customers.js', "match: '#modal-new' }", "match: '#modal-nope' }"]]), {});
  const sm = runSnap(noMatch.failed, ['--view', '#/p/C01/new'], 'snap-nomatch');
  ok(!noMatch.ok && sm.code === 1 && /进入状态失败[^\n]*match/.test(sm.out), 'r1-4 进入步骤执行完但 match 不成立：snap.mjs 报出原因并非零退出', 'exit=' + sm.code + ' ' + sm.out.slice(0, 200));
}

/* ---------- 18. 1.2.3：评审意见记录版本、“结构检查通过”文案 ---------- */
console.log('\n18. 评审意见按版本分组、结构检查文案');
{
  const MERGE = path.join(SKILL, 'scripts', 'merge-comments.mjs');
  const LS = 'prd-comments:leave-approval';
  const v11 = await build(variant(EXAMPLE, [[PROD, "HR 查看月度统计' }", "HR 查看月度统计' },\n    { id: 'V1.1', date: '2026-12-01', summary: '测试用升版' }"]]), {});
  ok(v11.ok && v11.release === 'V1.1', '18 升到 V1.1 的夹具构建通过', v11.ok ? '' : JSON.stringify(v11.report.errors.slice(0, 3)));
  const runMerge = (files, out) => { try { execFileSync(process.execPath, [MERGE, ...files, '-o', out], { stdio: 'pipe' }); return { code: 0, md: fs.readFileSync(out, 'utf8'), err: '' }; } catch (e) { return { code: e.status, md: '', err: String(e.stderr || '') }; } };
  const bv = await launch();
  try {
    const pg = await bv.newPage({ width: 1600, height: 1000 });
    const open = async (file, hash) => { await pg.goto('about:blank'); await pg.goto(fileUrl(file) + (hash || '')); await pg.waitFor('window.__PRD_READY === true', 20000); await sleep(400); };
    const jev = async (js) => JSON.parse(await pg.evaluate('JSON.stringify(' + js + ')'));

    /* V1.0 里留一条意见，再塞一条 1.2.3 之前格式的旧意见（没有 release） */
    await open(ex.file, '#/p/P02/detail');
    await pg.evaluate('localStorage.clear(); 1');
    const a = await jev(`W.comments.add({ target: 'P02/decide', text: 'V1.0 的意见', author: '甲' })`);
    ok(a.release === 'V1.0', '18 新意见记下提出时的版本（release: V1.0）', JSON.stringify(a));
    const OLD = { id: 'c_old1', target: 'P01', pageId: 'P01', fnId: null, text: '旧数据意见', author: '乙', at: '2026-11-01T00:00:00.000Z', resolved: false };
    const stored = await pg.evaluate(`(function () { var l = JSON.parse(localStorage.getItem('${LS}')); l.push(${JSON.stringify(OLD)}); localStorage.setItem('${LS}', JSON.stringify(l)); return localStorage.getItem('${LS}'); })()`);

    /* 升到 V1.1 后打开（带上同一份本机数据），再留一条 */
    await open(v11.file, '#/p/P02/detail');
    await pg.evaluate(`localStorage.setItem('${LS}', ${JSON.stringify(stored)}); 1`);
    await open(v11.file, '#/p/P02/detail');
    const b = await jev(`W.comments.add({ target: 'P02/decide', text: 'V1.1 的意见', author: '丙' })`);
    await jev(`W.comments.update(${JSON.stringify(a.id)}, { text: 'V1.0 的意见（改过）' })`);
    const exp = await jev(`W.comments.exportJSON('丙')`);
    const rel = (id) => (exp.comments.find((c) => c.id === id) || {});
    ok(b.release === 'V1.1' && exp.release === 'V1.1' && exp.comments.length === 3 && rel(a.id).release === 'V1.0' && rel(a.id).text === 'V1.0 的意见（改过）' && !('release' in rel('c_old1')), '18 升版后导出全部 3 条：各带提出时的版本，改正文不改版本；旧意见不补版本', JSON.stringify(exp.comments.map((c) => [c.text, c.release])));
    await pg.evaluate('document.querySelector("[data-tool=comments]").click(); 1'); await sleep(200);
    await pg.evaluate('document.querySelector("[data-cmt-act=scope][data-v=all]").click(); 1'); await sleep(200);
    const tags = await jev(`Array.from(document.querySelectorAll('#cmt-panel .cmt-v')).map(function (x) { return x.textContent; })`);
    ok(tags.length === 2 && tags.includes('V1.0') && tags.includes('版本未知'), '18 意见抽屉：非本版的意见标原版本，旧数据标“版本未知”，本版意见不标', JSON.stringify(tags));

    /* 合并稿：本轮在前，历史版本其次，版本未知最后；全文连续编号 */
    const expFile = path.join(TMP, 'cmt18-v11.json');
    fs.writeFileSync(expFile, JSON.stringify(exp, null, 2));
    const m = runMerge([expFile, expFile], path.join(TMP, 'cmt18.md'));
    const iCur = m.md.indexOf('## V1.1（本轮）'), iOld = m.md.indexOf('## V1.0（历史意见）'), iUnk = m.md.indexOf('## 版本未知（提出时没有记录版本，导出时为 V1.1）');
    ok(m.code === 0 && iCur > 0 && iOld > iCur && iUnk > iOld && /共 3 条意见/.test(m.md) && /不直接当作本版要求/.test(m.md), '18 merge-comments：按版本分组（本轮 → 历史 → 版本未知），重复传同一份文件仍按 id 去重', m.err || m.md.slice(0, 500));
    ok(/## V1\.1（本轮）\n\n### P02\/decide\n- #1（丙，[^）]+）：V1\.1 的意见/.test(m.md) && /## V1\.0（历史意见）\n\n### P02\/decide\n- #2（甲，/.test(m.md) && /### P01\n- #3（乙，2026-11-01）：旧数据意见/.test(m.md), '18 merge-comments：组内再按对象分组，序号跨组连续', m.md.slice(0, 600));
  } finally { await bv.close(); }

  /* 旧导出文件（条目没有 release）：仍能合并，全部归入“版本未知”，不按文件版本补猜 */
  const oldFile = path.join(TMP, 'cmt18-old.json');
  fs.writeFileSync(oldFile, JSON.stringify({ v: 1, productId: 'leave-approval', productName: '请假审批', release: 'V1.0', exportedAt: '2026-11-05T02:00:00.000Z', author: '李四', comments: [{ id: 'c_o1', target: 'P01', pageId: 'P01', fnId: null, text: '旧文件里的意见', author: '李四', at: '2026-11-05T02:00:00.000Z', resolved: false }] }));
  const mo = runMerge([oldFile], path.join(TMP, 'cmt18-old.md'));
  ok(mo.code === 0 && /# 评审意见合并 · 请假审批 · V1\.0/.test(mo.md) && /## 版本未知（提出时没有记录版本，导出时为 V1\.0）\n\n### P01\n- #1（李四，2026-11-05）：旧文件里的意见/.test(mo.md) && !/（本轮）|（历史意见）/.test(mo.md), '18 merge-comments：1.2.2 及更早的导出文件照常合并，意见标“版本未知”', mo.err || mo.md);
  const mx = runMerge([path.join(TMP, 'cmt18-v11.json'), oldFile], path.join(TMP, 'cmt18-mix.md'));
  ok(mx.code !== 0 && /导出时的版本不一致/.test(mx.err), '18 merge-comments：导出时版本不同的文件仍拒绝合并', mx.err);

  /* Q3 文案：范围提醒和 --scope-baseline 帮助不再要求“先列给用户确认”，只确认超出已确认范围的部分 */
  const sd = variant(EXAMPLE, []);
  await build(sd, { scopeBaseline: true });
  const sf = path.join(sd, 'prd', 'scope.json');
  const sj = JSON.parse(fs.readFileSync(sf, 'utf8'));
  sj.fns = sj.fns.filter((k) => k !== 'M02/submit');
  fs.writeFileSync(sf, JSON.stringify(sj));
  const sr = await build(sd, {});
  const sw = sr.ok ? sr.report.warns.filter((w) => w.code === 'SCOPE_ADDED') : [];
  ok(sw.length === 1 && /在已确认范围内的直接用 --scope-baseline 刷新基线，超出的才列给用户确认/.test(sw[0].msg) && !/先列给用户确认/.test(sw[0].msg), '18 SCOPE_ADDED 提示：已确认的直接刷新，超出的才列给用户', JSON.stringify(sw.map((w) => w.msg)));
  const help = execFileSync(process.execPath, [path.join(here, 'build.mjs'), '--help'], { encoding: 'utf8' });
  ok(/先普通构建核对 SCOPE_ADDED \/ SCOPE_REMOVED/.test(help) && !/用户确认后再加此参数/.test(help), '18 --scope-baseline 帮助：先普通构建核对，再刷新', help.slice(0, 200));

  /* Q2 文案：命令行 ✓ 行、顶部徽标、需求文档统计行都写“结构检查通过” */
  let cli = '';
  try { cli = execFileSync(process.execPath, [path.join(here, 'build.mjs'), variant(EXAMPLE, [])], { encoding: 'utf8' }); } catch (e) { cli = String(e.stdout || ''); }
  ok(/\n✓ 结构检查通过，已生成：/.test(cli) && !/✓ 检查通过/.test(cli), '18 构建命令行的成功行为“✓ 结构检查通过，已生成：…”', cli.slice(-300));
  const bq = await launch();
  try {
    const pg = await bq.newPage({ width: 1600, height: 1000 });
    await pg.goto(fileUrl(ex.file) + '#/doc'); await pg.waitFor('window.__PRD_READY === true', 20000); await sleep(400);
    const t = JSON.parse(await pg.evaluate('JSON.stringify({ badge: (document.querySelector(".audit-badge") || {}).textContent || "", sec: Array.from(document.querySelectorAll("#right .np-sec h3")).map(function (x) { return x.firstChild.textContent; }), md: W.doc.markdown({ html: false }).slice(0, 600) })'));
    ok(/^结构检查通过/.test(t.badge) && t.sec.includes('结构检查') && /· 结构检查通过（\d{4}-\d{2}-\d{2}）/.test(t.md), '18 顶部徽标、需求文档右栏和 Markdown 统计行都写“结构检查通过”', JSON.stringify(t).slice(0, 400));
  } finally { await bq.close(); }
}

console.log('\n结果：' + pass + ' 通过，' + failN + ' 失败');
if (failN) console.log('失败项：\n  - ' + fails.join('\n  - '));
if (!KEEP && !failN) fs.rmSync(TMP, { recursive: true, force: true });
else console.log('临时目录保留：' + TMP);
process.exit(failN ? 1 : 0);
