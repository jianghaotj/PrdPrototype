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

/* ---------- 11. 高教 PC 样例：课程管理（gaodeng-pc，只做 PC 端） ---------- */
console.log('\n11. 高教 PC 样例（课程管理）');
{
  const COURSE = path.join(SKILL, 'examples', 'course-mgmt');
  const cm = await build(variant(COURSE, []), { md: true });
  ok(cm.ok, '课程管理样例（gaodeng-pc，PC 端）构建通过', cm.ok ? '' : JSON.stringify(cm.report.errors.slice(0, 3)));
  const cmMd = cm.mdFile ? fs.readFileSync(cm.mdFile, 'utf8') : '';
  ok(cm.ok && /【AI 假设】/.test(cmMd) && cm.report.stats.assumed > 0 && cm.report.stats.pending === 0, '课程管理需求文档标出 AI 假设且没有待确认项（AI 假设 ' + (cm.report.stats ? cm.report.stats.assumed : 0) + ' 条）');
  ok(cm.ok && cmMd.includes('课程名称为必填项，为空时不能提交') && cmMd.includes('课程代码长度为 6–12 个字，不在此范围内时不能提交'), '课程管理需求文档由 h.fld 的 req / min / max 生成必填与长度规则');
  /* 仓库里提交的需求文档与当前源码重新构建的结果一致（产物没有过期）；忽略“构建检查通过（日期）”这一天然随日历变化的戳 */
  const cmCommitted = fs.readFileSync(path.join(COURSE, '课程管理-需求文档.md'), 'utf8');
  const stripBuildDate = (s) => s.replace(/构建检查通过（\d{4}-\d{2}-\d{2}）/g, '构建检查通过（日期忽略）');
  ok(cm.ok && stripBuildDate(cmMd) === stripBuildDate(cmCommitted), '课程管理需求文档与仓库已提交的版本一致（产物未过期，已忽略构建日期戳）');
  /* 分页说明：每页 10 条，少于 10 条写“不足”；搜索计数是原型限制，单独成句 */
  ok(cm.ok && cmMd.includes('课程不足 10 条时只显示“共 N 条”') && !cmMd.includes('不超过 10 条') && cmMd.includes('原型只展示第 1 页，搜索时计数不变'), '课程管理分页说明写作“不足 10 条”，原型限制单独成句');
  /* 浏览器：列表按 gaodeng-pc 表格取值渲染；超过 10 条时只渲染第 1 页的 10 行，与分页文字一致 */
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
      ok(st.hh === 54 && st.hbg === 'rgb(245, 247, 250)' && st.hfs === '14px' && st.hfw === '500' && st.hc === 'rgb(26, 34, 51)' && st.hbb === 'rgb(225, 230, 240)' && st.rh === 54 && st.rfs === '14px' && st.rc === 'rgb(87, 92, 102)' && st.rbb === 'rgb(245, 247, 250)',
        '课程管理列表表头与行按 gaodeng-pc 表格取值（表头 54 高、LV6 底、14px Medium、LV1 字、底边 LV5；行 54 高、LV2 字、行线 LV6）', JSON.stringify(st));
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
      const d12 = JSON.parse(await pg.evaluate(`JSON.stringify({ docTab: document.querySelectorAll('#top .vtabs a[data-tab="doc"]').length, needBtn: document.querySelectorAll('[data-tool="right"]').length, rightHTML: document.getElementById('right').innerHTML.length, noR: document.body.classList.contains('no-r') })`));
      ok(d12.docTab === 0 && d12.needBtn === 0 && d12.rightHTML === 0 && d12.noR, 'T12 顶栏无“需求文档”标签和“需求”按钮；右栏为空；body 带 no-r', JSON.stringify(d12));
      /* T13 */
      const badge = await pg.evaluate(`(document.querySelector('.audit-badge') || {}).textContent || ''`);
      ok(badge === '原型阶段 · 检查通过' && !/待确认|AI 假设/.test(badge), 'T13 检查标识为“原型阶段 · 检查通过”，不含待确认和 AI 假设（构建统计：AI 假设 ' + (t1a.report.stats.assumed || 0) + '，待确认 ' + (t1a.report.stats.pending || 0) + '）', badge);
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
      const flowTabs = await pg.evaluate(`document.querySelectorAll('#top .vtabs a[data-tab="flow"]').length`);
      await pg.evaluate(`document.querySelector('#top .vtabs a[data-tab="flow"]').click()`);
      await sleep(400);
      await pg.evaluate(`document.querySelector('[data-step="f1|0"]').click()`);
      await sleep(500);
      const t20 = JSON.parse(await pg.evaluate(`JSON.stringify({ flowOn: document.body.classList.contains('flow-on'), page: W.viewerDiag().page, first: W.P.flows[0].steps[0].p })`));
      ok(flowTabs === 1 && t20.flowOn && t20.page === t20.first, 'T20 原型阶段：“核心流程”标签保留，流程演示能进入第一步（' + t20.first + '）', JSON.stringify({ flowTabs, t20 }));
    }
    /* T19：默认模式回归（不写 stage）：圆点偏好照旧记住，无 hash 仍进需求文档 */
    await fresh(exFile, '');
    const g1 = JSON.parse(await pg.evaluate(`JSON.stringify({ view: W.viewerDiag().view, hidden: document.body.classList.contains('no-dots'), docTab: document.querySelectorAll('#top .vtabs a[data-tab="doc"]').length })`));
    await pressN();
    await open(exFile, '');
    const g2 = JSON.parse(await pg.evaluate(`JSON.stringify({ view: W.viewerDiag().view, hidden: document.body.classList.contains('no-dots') })`));
    ok(g1.view === 'doc' && !g1.hidden && g1.docTab === 1 && g2.view === 'doc' && g2.hidden, 'T19 默认模式不变：无 hash 进需求文档、圆点默认显示；按 N 隐藏后重新加载仍隐藏（偏好照旧记住）', JSON.stringify({ g1, g2 }));

    /* T23–T27：托管原型阶段的浏览器表现。虚线框随圆点一起隐藏，按 N 显示，重新打开又隐藏且不记住 */
    if (hostPf) {
      await fresh(hostPf, '');
      await pg.waitFor('document.querySelectorAll("#dots .xbox").length > 0', 8000).catch(() => {});
      const h23 = JSON.parse(await pg.evaluate(`JSON.stringify({ view: W.viewerDiag().view, page: W.viewerDiag().page, home: W.P.ends[0].home, noDots: document.body.classList.contains('no-dots'), noR: document.body.classList.contains('no-r'), rightLen: document.getElementById('right').innerHTML.length, docTab: document.querySelectorAll('#top .vtabs a[data-tab="doc"]').length })`));
      ok(h23.view === 'page' && h23.page === h23.home && h23.noDots && h23.noR && h23.rightLen === 0 && h23.docTab === 0, 'T23 托管原型阶段：打开即第一个端的首页（' + h23.home + '），圆点和虚线框隐藏，没有需求栏和需求文档标签', JSON.stringify(h23));
      const badge24 = await pg.evaluate(`(document.querySelector('.audit-badge') || {}).textContent || ''`);
      ok(badge24 === '原型阶段 · 检查通过', 'T24 托管原型阶段未放行网络：检查标识为“原型阶段 · 检查通过”，不带需联网', badge24);
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
        ok(badge29 === '原型阶段 · 检查通过 · 需联网', 'T29 托管原型阶段放行网络：检查标识为“原型阶段 · 检查通过 · 需联网”', badge29);
      } else ok(false, 'T29 托管原型阶段放行网络：构建失败，无法检查徽标');
    }
  } finally {
    await bc.close();
  }
}

console.log('\n结果：' + pass + ' 通过，' + failN + ' 失败');
if (failN) console.log('失败项：\n  - ' + fails.join('\n  - '));
if (!KEEP && !failN) fs.rmSync(TMP, { recursive: true, force: true });
else console.log('临时目录保留：' + TMP);
process.exit(failN ? 1 : 0);
