#!/usr/bin/env node
// 截图与画面诊断：打开构建好的 HTML，逐个视图截图，并输出圆点、功能点和控制台错误。
// 用法：node scripts/snap.mjs <原型.html> [--view "#/p/P01/list"]... [--only] [--out 目录] [--width 1600] [--height 1000] [--click "选择器"]
//   默认截“需求文档”和每个端首页（原型阶段不截需求文档），--view 追加视图；加 --only 只截 --view 指定的视图。
//   --chg 打开“本版变化”视图后再截图（多版本时）。每次运行会先清掉输出目录里上次生成的截图。
import fs from 'node:fs';
import path from 'node:path';
import { launch, fileUrl, sleep } from './lib/browser.mjs';

const argv = process.argv.slice(2);
const o = { views: [], clicks: [], width: 1600, height: 1000 };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--view') o.views.push(argv[++i]);
  else if (a === '--out') o.out = argv[++i];
  else if (a === '--width') o.width = +argv[++i];
  else if (a === '--height') o.height = +argv[++i];
  else if (a === '--click') o.clicks.push(argv[++i]);
  else if (a === '--only') o.only = true;
  else if (a === '--chg') o.chg = true;
  else if (a === '--help' || a === '-h') o.help = true;
  else if (!o.file) o.file = a;
}
const USAGE = `用法：node scripts/snap.mjs <原型.html> [选项]
  默认截“需求文档”和每个端的首页（原型阶段只截各端首页，圆点默认隐藏时标注“已隐藏”）
  --view "#/p/P02/reject"  追加要截的视图（可重复）；页面状态用 #/p/<页面ID>/<状态ID>
  --only                   只截 --view 指定的视图
  --chg                    打开“本版变化”视图后再截
  --click "选择器"          每个视图打开后先点击该元素
  --out 目录               截图目录（默认 <项目>/.prd-build/snap）
  --width 1600 --height 1000  浏览器窗口尺寸`;
if (o.help) { console.log(USAGE); process.exit(0); }
if (!o.file || !fs.existsSync(o.file)) { console.error(USAGE); process.exit(2); }
const out = path.resolve(o.out || path.join(path.dirname(o.file), '.prd-build', 'snap'));
fs.mkdirSync(out, { recursive: true });
for (const n of fs.readdirSync(out)) if (/^\d{2}-.*\.png$/.test(n)) fs.unlinkSync(path.join(out, n));

const b = await launch();
let failed = false;
try {
  const page = await b.newPage({ width: o.width, height: o.height });
  await page.goto(fileUrl(o.file));
  await page.waitFor('window.__PRD_READY === true', 20000);
  if (o.chg) {
    const on = await page.evaluate('(function(){ if (!W.doc.multiRelease()) return "single"; if (!document.body.classList.contains("chg-on")) document.querySelector("[data-tool=chg]").click(); return "on"; })()');
    if (on === 'single') console.log('只有一个版本，没有“本版变化”视图');
  }
  /* 原型阶段没有需求文档，默认只截各端首页 */
  let views = o.only ? o.views : (await page.evaluate('(W.P.stage === "prototype" ? [] : ["#/doc"]).concat(W.P.ends.map(function(e){return "#/end/"+e.id}))')).concat(o.views);
  if (!views.length) { console.error('没有要截的视图'); process.exit(2); }
  for (let i = 0; i < views.length; i++) {
    const v = views[i];
    await page.evaluate('location.hash = ' + JSON.stringify(v) + ';1');
    await sleep(450);
    try { await page.waitFor('!document.querySelector("#hostf") || (document.querySelector("#hostf").contentDocument && document.querySelector("#hostf").contentDocument.readyState === "complete")', 8000); } catch (e) {}
    await sleep(v.indexOf('/p/') >= 0 || v.indexOf('/end/') >= 0 ? 700 : 200);
    for (const c of o.clicks) {
      await page.evaluate('(function(){var el=document.querySelector(' + JSON.stringify(c) + ');if(el)el.click();return !!el})()');
      await sleep(500);
    }
    const diag = await page.evaluate('W.viewerDiag()');
    const name = String(i + 1).padStart(2, '0') + '-' + v.replace(/^#\/?/, '').replace(/[^\w\u4e00-\u9fa5-]+/g, '_').slice(0, 60) + '.png';
    const file = path.join(out, name);
    await page.screenshot(file);
    console.log(v + ' → ' + file);
    /* 圆点数来自 DOM，圆点层被隐藏时仍会计数，所以这里单独标注“已隐藏” */
    const dotsHidden = await page.evaluate('(function(){var d=document.getElementById("dots");return !!d&&getComputedStyle(d).display==="none"})()');
    if (diag.view === 'page') console.log('  页面 ' + diag.page + ' / ' + diag.state + ' · 圆点 ' + diag.dots.length + (dotsHidden ? '（已隐藏）' : '') + ' · 当前可见功能点 ' + (diag.visibleFns.length - diag.sharedVisible) + (diag.sharedVisible ? '（另有公共组件 ' + diag.sharedVisible + ' 个，圆点默认隐藏）' : '') + (diag.ignoredMarks ? ' · 不纳入标记 ' + diag.ignoredMarks + (dotsHidden ? '（已隐藏）' : '') : '') + (diag.unknown ? ' · 当前画面未登记' : ''));
  }
  if (page.errors.length) { failed = true; console.log('\n控制台错误：'); page.errors.forEach((e) => console.log('  - ' + e)); }
} finally {
  await b.close();
}
process.exit(failed ? 1 : 0);
