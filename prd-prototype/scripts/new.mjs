#!/usr/bin/env node
// 新建原型需求项目骨架。
// 用法：node scripts/new.mjs <项目目录> --name "产品名" [--id 英文短名] [--end pc:管理后台] [--end mobile:员工手机端] [--host 已有原型.html] [--force]
//   --end 可重复，格式“设备:端名称”，设备为 pc 或 mobile；默认一个 PC 端。
//   --host 为已有 HTML 原型补需求（托管模式）：原文件不会被修改，构建时内联。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installTheme, resolveTheme, listThemes } from './lib/theme.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const TPL = path.join(here, '..', 'assets', 'template');
const argv = process.argv.slice(2);
const o = { ends: [] };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--name') o.name = argv[++i];
  else if (a === '--id') o.id = argv[++i];
  else if (a === '--end') o.ends.push(argv[++i]);
  else if (a === '--host') o.host = argv[++i];
  else if (a === '--theme') {
    o.theme = argv[++i];
    if (!o.theme || o.theme.startsWith('--')) { console.error('--theme 需要规范包名，如 --theme gaodeng-pc'); process.exit(2); }
  }
  else if (a === '--force') o.force = true;
  else if (a === '--help' || a === '-h') o.help = true;
  else if (a.startsWith('--')) { console.error('未知参数：' + a); process.exit(2); }
  else o.dir = a;
}
const USAGE = `用法：node scripts/new.mjs <项目目录> --name "产品名" [选项]
  --id 英文短名         浏览器保存演示数据用的 ID（默认取目录名或路径哈希）
  --end pc:管理后台     端，可重复；设备为 pc 或 mobile。生成的端 ID：第一个 PC 端为 pc、第一个手机端为 m，同类再加时为 pc2、m2
  --theme 规范包名      选用设计规范包（如 gaodeng-pc），出高保真画面；PC 端默认 1440×900。不选则为线框
  --host 已有原型.html  为已有 HTML 补需求（托管模式），原文件不会被修改；与 --theme 不能同用
  --force               覆盖已有项目的模板文件`;
if (o.help) { console.log(USAGE); process.exit(0); }
if (!o.dir || !o.name) { console.error(USAGE); process.exit(2); }
const project = path.resolve(o.dir);
const prd = path.join(project, 'prd');
if (fs.existsSync(path.join(prd, 'product.js')) && !o.force) { console.error('已存在 ' + path.join(prd, 'product.js') + '，不覆盖。确需重建请加 --force（会覆盖模板文件）。'); process.exit(2); }
if (o.host && !fs.existsSync(o.host)) { console.error('已有原型不存在：' + o.host); process.exit(2); }
if (o.theme && o.host) { console.error('--theme 只用于原生线框项目。托管模式沿用已有 HTML 的样式，不能同时使用 --theme。'); process.exit(2); }
if (o.theme) {
  try { resolveTheme(o.theme); } catch (e) { console.error(e.message); console.error('可用的规范包：' + (listThemes().join('、') || '无')); process.exit(2); }
}

const today = new Date();
const date = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
/* id 用于浏览器本地存储演示数据；默认取项目目录名（英文时）或目录路径的稳定短哈希 */
const folder = path.basename(project);
let hash = 0;
for (const ch of project) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
const id = o.id || (/^[A-Za-z][\w-]{1,40}$/.test(folder) ? folder.toLowerCase() : 'prd-' + hash.toString(36));
if (!o.ends.length) o.ends.push(o.host ? 'pc:' + o.name : 'pc:PC 端');
const used = {};
const ends = o.ends.map((s) => {
  const i = s.indexOf(':');
  const device = (i > 0 ? s.slice(0, i) : s).trim().toLowerCase();
  const name = (i > 0 ? s.slice(i + 1) : (device === 'mobile' ? '手机端' : 'PC 端')).trim();
  if (device !== 'pc' && device !== 'mobile') { console.error('--end 的设备只能是 pc 或 mobile：' + s); process.exit(2); }
  let eid = device === 'mobile' ? 'm' : 'pc';
  let n = 2;
  while (used[eid]) eid = (device === 'mobile' ? 'm' : 'pc') + n++;
  used[eid] = 1;
  const prefix = device === 'mobile' ? 'M' : 'P';
  return { id: eid, device, name, pid: (Object.keys(used).length > 2 ? eid.toUpperCase() : prefix) + '01' };
});
const fill = (s, v) => s.replace(/\{\{(\w+)\}\}/g, (m, k) => (v[k] != null ? v[k] : m));
const read = (f) => fs.readFileSync(path.join(TPL, f), 'utf8');
const q = (s) => JSON.stringify(s).slice(1, -1).replace(/'/g, "\\'");

fs.mkdirSync(path.join(prd, 'pages'), { recursive: true });
const endLines = ends.map((e) => {
  let line = "    { id: '" + e.id + "', name: '" + q(e.name) + "', device: '" + e.device + "', home: '" + e.pid + "'";
  if (o.host) {
    const rel = path.relative(prd, path.resolve(o.host)).split(path.sep).join('/');
    line += ", host: '" + q(rel) + "', width: " + (e.device === 'mobile' ? 375 : 1440) + ', height: ' + (e.device === 'mobile' ? 812 : 900) + ',\n      /* 原型里有、本期不做的元素：{ sel, why } */\n      ignore: []';
  } else if (o.theme && e.device === 'pc') {
    line += ', width: 1440, height: 900';
  }
  return line + ' }';
}).join(',\n');
fs.writeFileSync(path.join(prd, 'product.js'), fill(read('product.js.tpl'), { id, name: q(o.name), date, ends: endLines }));

const created = [path.join(prd, 'product.js')];
if (o.theme) installTheme(prd, o.theme).forEach((f) => created.push(path.join(prd, f)));
if (!o.host) {
  const kit = ['/* 项目公共组件：各端外壳（导航）登记为公共功能点，页面调用 W.ui.<端>(当前页面ID, 内容)。',
    '   某个端不需要这里的外壳（如 App 内嵌页没有底部导航）时，删掉对应的 W.shared 和 W.MTABS，否则会报 FN_UNUSED。 */', '(function () {', '  W.ui = W.ui || {};'];
  ends.forEach((e) => {
    if (e.device === 'pc') {
      kit.push(
        "  W.shared({ id: '" + e.id + "-shell', end: '" + e.id + "', title: '" + q(e.name) + " 顶部导航', fns: [",
        "    { id: '" + e.id + "-nav', name: '顶部导航', desc: '', src: '' }",
        '  ] });',
        '  W.ui.' + e.id + ' = function (active, body, o) {',
        '    o = o || {};',
        "    return h.app({ brand: '" + q(o.name) + "', fn: '" + e.id + "-nav', home: ['" + e.pid + "'], active: active,",
        "      nav: [{ key: '" + e.pid + "', label: '首页', go: '" + e.pid + "' }],",
        "      right: '<span class=\"ava\">用</span>', body: body, over: o.over });",
        '  };'
      );
    } else {
      kit.push(
        "  W.shared({ id: '" + e.id + "-shell', end: '" + e.id + "', title: '" + q(e.name) + " 底部导航', fns: [",
        "    { id: '" + e.id + "-tab', name: '底部导航', desc: '', src: '' }",
        '  ] });',
        "  W.MTABS = { fn: '" + e.id + "-tab', items: [{ key: 'home', label: '首页', ic: 'home', go: '" + e.pid + "' }] };"
      );
    }
  });
  kit.push('})();', '');
  fs.writeFileSync(path.join(prd, 'kit.js'), kit.join('\n'));
  created.push(path.join(prd, 'kit.js'));
}
ends.forEach((e) => {
  const tpl = o.host ? 'page-host.js.tpl' : e.device === 'mobile' ? 'page-mobile.js.tpl' : 'page-pc.js.tpl';
  const f = path.join(prd, 'pages', e.pid + '-page.js');
  fs.writeFileSync(f, fill(read(tpl), { pid: e.pid, end: e.id }));
  created.push(f);
});
const gi = path.join(project, '.gitignore');
if (!fs.existsSync(gi)) fs.writeFileSync(gi, '.prd-build/\n');
else if (!/\.prd-build/.test(fs.readFileSync(gi, 'utf8'))) fs.appendFileSync(gi, '\n.prd-build/\n');

console.log('已创建原型需求项目：' + project);
created.forEach((f) => console.log('  ' + path.relative(project, f)));
if (o.theme) console.log('已选用规范包：' + o.theme + '（颜色、字号、组件按规范包输出；PC 端 1440×900）');
console.log('\n下一步：');
if (o.host) console.log('  1. node scripts/probe-host.mjs "' + path.resolve(o.host) + '" 查看原型结构');
console.log('  ' + (o.host ? '2' : '1') + '. 填写 prd/product.js；pages/ 下的 *-page.js 是模板：改名为“编号-名称.js”后填写，其余页面照它新建（页面 ID 不能重复）');
console.log('  ' + (o.host ? '3' : '2') + '. node scripts/build.mjs "' + project + '"');
