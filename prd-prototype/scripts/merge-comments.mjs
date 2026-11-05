#!/usr/bin/env node
// 合并评审意见：把交付 HTML 里导出的意见 JSON（v:1）合并成按功能点分组的 Markdown，供流程 C 作为修改依据。
// 用法：node scripts/merge-comments.mjs 意见A.json [意见B.json ...] [-o 评审意见合并.md] [--prd <项目目录>]
//   --prd 可选：读取项目的 prd/pages/*.js，在标题里补上功能点名称；读不到时只写 target。
//   序号按输出顺序编号（全文连续），便于流程 C 写 src: '评审意见 #3（张三）'。
//   不同产品或不同版本的意见不能混合合并，遇到会报错退出。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const USAGE = `用法：node scripts/merge-comments.mjs <意见1.json> [意见2.json ...] [-o 输出.md] [--prd <项目目录>]
  -o 输出文件（省略时输出到标准输出）
  --prd 项目目录（含 prd/product.js），用来显示功能点名称`;

function die(msg, code = 2) { console.error('✗ ' + msg); process.exit(code); }

const argv = process.argv.slice(2);
const o = { files: [] };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--help' || a === '-h') { console.log(USAGE); process.exit(0); }
  else if (a === '-o' || a === '--prd') {
    const v = argv[++i];
    if (!v || v.startsWith('-')) die(a + ' 后面要跟路径');
    if (a === '-o') o.out = v; else o.prd = v;
  }
  else o.files.push(a);
}
if (!o.files.length) { console.error(USAGE); process.exit(2); }

/* 读取并校验意见文件 */
const docs = o.files.map((f) => {
  let obj;
  try { obj = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { die(f + ' 不是合法 JSON：' + e.message); }
  if (!obj || obj.v !== 1 || !Array.isArray(obj.comments)) die(f + ' 不是评审意见 JSON（需要 v:1 和 comments 数组）');
  return { file: f, obj };
});
const first = docs[0].obj;
for (const { file, obj } of docs) {
  if (obj.productId !== first.productId) die('产品不一致，不能合并：' + docs[0].file + '（' + first.productId + '）与 ' + file + '（' + obj.productId + '）');
  if (obj.release !== first.release) die('版本不一致，不能合并：' + docs[0].file + '（' + first.release + '）与 ' + file + '（' + obj.release + '）');
}

/* 同一条意见可能出现在多份文件里（例如同一份文件传了两次），按 id 去重 */
const seen = new Set();
const groups = new Map();
let total = 0;
for (const { obj } of docs) {
  for (const c of obj.comments) {
    if (!c || typeof c.target !== 'string' || typeof c.text !== 'string') continue;
    if (c.id && seen.has(c.id)) continue;
    if (c.id) seen.add(c.id);
    if (!groups.has(c.target)) groups.set(c.target, []);
    groups.get(c.target).push({
      text: c.text.trim(),
      author: String(c.author || obj.author || '').trim() || '未署名',
      date: String(c.at || '').slice(0, 10)
    });
    total++;
  }
}

/* --prd：按 build.mjs 同样顺序读源文件，失败不影响合并，只用 target 作标题 */
function walkJs(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const f = path.join(dir, name);
    const st = fs.statSync(f);
    if (st.isDirectory()) out.push(...walkJs(f));
    else if (/\.js$/i.test(name)) out.push(f);
  }
  return out;
}
function loadNames(dir) {
  const prd = fs.existsSync(path.join(dir, 'prd', 'product.js')) ? path.join(dir, 'prd') : dir;
  const pages = {}, shared = [];
  const hp = new Proxy({}, { get: () => () => '' });
  const noop = () => {};
  const W = {
    product: noop,
    page: (p) => { if (p && p.id) pages[p.id] = p; },
    reg: (p) => { if (p && p.id) pages[p.id] = p; },
    shared: (s) => { if (s) shared.push(s); },
    h: hp,
    acts: {}
  };
  /* 顺序与 build.mjs 一致：product → kit → prd/ 根目录其他 JS → pages/** */
  const files = [path.join(prd, 'product.js')];
  if (fs.existsSync(path.join(prd, 'kit.js'))) files.push(path.join(prd, 'kit.js'));
  const rootJs = fs.readdirSync(prd).filter((n) => /\.js$/i.test(n) && n !== 'product.js' && n !== 'kit.js').sort().map((n) => path.join(prd, n));
  files.push(...rootJs, ...walkJs(path.join(prd, 'pages')));
  const sandbox = { window: { W }, W, h: hp, console: { log: noop, warn: noop, error: noop }, Date, JSON, Math };
  vm.createContext(sandbox);
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    vm.runInContext(fs.readFileSync(f, 'utf8'), sandbox, { filename: f, timeout: 2000 });
  }
  const names = new Map();
  Object.keys(pages).forEach((pid) => {
    names.set(pid, pages[pid].title || '');
    (pages[pid].fns || []).forEach((fn) => names.set(pid + '/' + fn.id, fn.name || ''));
  });
  shared.forEach((s) => (s.fns || []).forEach((fn) => names.set('S:' + s.end + '/' + fn.id, fn.name || '')));
  return names;
}
let names = null;
if (o.prd) {
  try { names = loadNames(path.resolve(o.prd)); }
  catch (e) { console.error('⚠ 读取 --prd 失败，只按意见内容输出：' + e.message); }
}
function heading(target) {
  const label = names && names.get(target);
  if (!names) return target;
  if (label) return target + ' · ' + label;
  if (/^S:/.test(target)) {
    const fid = target.split('/').slice(1).join('/');
    const alt = names.get('S:*/' + fid);
    if (alt) return target + ' · ' + alt;
  }
  return target;
}

/* 输出 Markdown：标题 → 按 target 分组 → 全文连续编号 */
let n = 0;
const lines = [];
lines.push('# 评审意见合并 · ' + (first.productName || first.productId || '') + ' · ' + (first.release || ''));
lines.push('');
lines.push('共 ' + total + ' 条意见，来自 ' + docs.length + ' 份文件。序号按本文件顺序编号。');
for (const [target, items] of groups) {
  lines.push('');
  lines.push('## ' + heading(target));
  for (const it of items) {
    n++;
    const meta = it.date ? it.author + '，' + it.date : it.author;
    lines.push('- #' + n + '（' + meta + '）：' + it.text.replace(/\n/g, '\n  '));
  }
}
const md = lines.join('\n') + '\n';

if (o.out) {
  fs.writeFileSync(o.out, md, 'utf8');
  console.error('✓ 已写入 ' + o.out + '：' + total + ' 条意见，' + groups.size + ' 个对象');
} else {
  process.stdout.write(md);
}
