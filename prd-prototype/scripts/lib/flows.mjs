// 按核心流程（product.flows）在浏览器里真点一遍：构建时检查跨页状态，snap.mjs --flows 时逐步截图。
// 每条流程走两遍，都从默认演示数据开始：
//   1. 演示：像评审按“下一步”那样逐步跳过去，记下每一步的画面；
//   2. 真点：从第 1 步开始，每一步在画板上点 tip 里写的按钮（或去下一步的按钮），看到了哪里、画面是什么。
// 结果分两级：
//   FLOW_SEE（错误）：步骤写了 see，真点过来没看到这些文字；或者这一步没真点到（上一步 tip 点名的按钮找不到、点了没跳转，
//     或者要跨页时 tip 没点名按钮、画面上也没有直接去那里的按钮），see 没法核对。例外：起点、托管页面、要先填表的 h.submit、只切数据场景。
//   FLOW_WALK（提醒）：没写 see 也能发现的不一致——按钮去的状态和流程写的不一样，或者状态对了、画面和“下一步”看到的不一样。
// 没有按钮能到下一步时（演示切换、自动跳转、要先填表），按流程直接跳过去，只计数不报。
import path from 'node:path';
import fs from 'node:fs';

/* 注入到页面里的走查函数（只用 viewer 暴露的 W.nav / W.goStep / W.viewerDiag，不改运行时） */
function helper() {
  if (window.__flowWalk) return;
  var W = window.W;
  var LAYERS = ['drawer', 'sheet', 'modal', 'popover', 'alert'];
  var norm = function (s) { return String(s == null ? '' : s).replace(/\s+/g, ''); };
  function flow(fid) { return (W.P.flows || []).find(function (f) { return f.id === fid; }); }
  function stOf(id, st) {
    var p = W.pages[id];
    if (!p) return st || '';
    if (st && p.states.some(function (s) { return s.id === st; })) return st;
    return p.states[0] ? p.states[0].id : '';
  }
  function hosted(id) { var p = W.pages[id]; return !!(p && W.host.isHosted(p)); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  /* 等托管原型进入完成（不是托管页面时立即返回） */
  function hostReady() {
    var t0 = Date.now();
    return new Promise(function (res) {
      (function poll() {
        if (!document.querySelector('#hostf') || (window.__PRD_HOST && !window.__PRD_HOST.busy) || Date.now() - t0 > 30000) return setTimeout(res, 50);
        setTimeout(poll, 60);
      })();
    });
  }
  /* 执行一个会改 hash 的动作，等 viewer 重绘完。hash 没变（同一状态重绘，或点了不跳转的按钮）时等到 maxMs */
  function settle(fn, maxMs) {
    return new Promise(function (res) {
      var done = false, h0 = location.hash;
      function fin() { if (done) return; done = true; window.removeEventListener('hashchange', onH); setTimeout(function () { hostReady().then(res); }, 0); }
      function onH() { setTimeout(fin, 0); }
      window.addEventListener('hashchange', onH);
      try { fn(); } catch (e) { console.error(e); }
      setTimeout(function () { if (location.hash === h0) fin(); }, maxMs);
      setTimeout(fin, maxMs + 2000);
    });
  }
  function here() {
    var d = W.viewerDiag(), text = '';
    var frame = document.querySelector('#hostf');
    if (frame) { try { text = frame.contentDocument.body.innerText; } catch (e) {} }
    else { var ab = document.querySelector('#ab'); text = ab ? ab.innerText : ''; }
    return { p: d.page || '', st: d.state || '', text: text, view: d.view };
  }
  function visible(el) {
    if (!el.getClientRects().length) return false;
    var cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  }
  function label(el) { return (el.innerText || el.textContent || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim(); }
  /* 当前画面能点的东西：最上层弹层里的按钮，加上画板里任何位置的演示切换（h.demo） */
  function cands() {
    var ab = document.querySelector('#ab');
    if (!ab) return [];
    var ls = Array.prototype.slice.call(ab.querySelectorAll('[data-layer]'));
    ls.sort(function (a, b) { return LAYERS.indexOf(a.dataset.layer) - LAYERS.indexOf(b.dataset.layer); });
    var top = ls.length ? ls[ls.length - 1] : ab;
    var els = Array.prototype.slice.call(top.querySelectorAll('[data-go],[data-act]'));
    Array.prototype.forEach.call(ab.querySelectorAll('[data-demo] [data-go],[data-demo] [data-act],[data-demo][data-go]'), function (el) { if (els.indexOf(el) < 0) els.push(el); });
    return els.filter(function (el) {
      return visible(el) && !el.hasAttribute('disabled') && !el.classList.contains('dis') && el.dataset.go !== 'back';
    }).map(function (el) {
      var go = el.dataset.go || el.getAttribute('data-ok-go') || '';
      var st = el.dataset.go ? el.dataset.st || '' : el.getAttribute('data-ok-st') || '';
      return { el: el, go: go, st: go && W.pages[go] ? stOf(go, st) : '', act: el.dataset.act || '', text: label(el) };
    });
  }
  /* tip 里要点的按钮文字：最后一个“点”字后面引号括起来的文字（如 点“确认提交”）；tip 里没有“点”时取全部引号，从后往前。
     named：tip 用“点“X””点名了按钮（有“点”字，后面有引号） */
  function quotes(tip) {
    var s = String(tip || ''), k = s.lastIndexOf('点');
    var out = [], re = /[“"「『]([^”"」』\n]{1,40})[”"」』]/g, m;
    while ((m = re.exec(k >= 0 ? s.slice(k) : s))) out.push(m[1].trim());
    out = (k >= 0 ? out : out.reverse()).filter(Boolean);
    out.named = k >= 0 && out.length > 0;
    return out;
  }
  /* set 里只有 preset=…（切换数据场景，评审在右侧面板也是这么切的） */
  function presetOnly(set) {
    if (!set) return false;
    if (typeof set === 'string' && /^\s*\{/.test(set)) { try { set = JSON.parse(set); } catch (e) { return false; } }
    if (typeof set === 'object') { var ks = Object.keys(set); return ks.length > 0 && ks.every(function (k) { return k === 'preset'; }); }
    var ps = String(set).split(';').map(function (x) { return x.trim(); }).filter(Boolean);
    return ps.length > 0 && ps.every(function (x) { return /^preset\s*=/.test(x); });
  }
  /* 从当前步去第 j 步要点哪个元素。点：返回 { c, why }；不点：返回 { miss: tip 点名但找不到的按钮文字 } 或 { skip: 原因 }。
     strict：这一步写了 see、又要跨到别的页面状态。这时必须真点过来，只留“只切数据场景”这一种演示切换 */
  function pick(prev, step, strict) {
    var want = { p: step.p, st: stOf(step.p, step.st) };
    var cs = cands();
    var rank = function (c) { return c.go === want.p && c.st === want.st ? 0 : c.go === want.p ? 1 : 2; };
    var qs = quotes(prev.tip), i, q, hit;
    for (i = 0; i < qs.length; i++) {
      q = norm(qs[i]);
      /* 文字相同 → 以它开头（按钮上还有小字，如“审批 待处理 2 条”）→ 包含它（只认短按钮，不认整行列表） */
      hit = cs.filter(function (c) { return norm(c.text) === q; });
      if (!hit.length && q.length >= 2) hit = cs.filter(function (c) { return norm(c.text).indexOf(q) === 0; });
      if (!hit.length && q.length >= 2) hit = cs.filter(function (c) { var t = norm(c.text); return t.length <= q.length + 8 && t.indexOf(q) >= 0; });
      if (hit.length) { hit.sort(function (a, b) { return rank(a) - rank(b); }); return { c: hit[0], why: 'tip' }; }
    }
    /* 点名的是一张大卡片（前面有图标字、后面一长串说明）：文字里包含点名文字、去向正好是下一步状态的，也算点名的那个 */
    if (qs.named) {
      for (i = 0; i < qs.length; i++) {
        q = norm(qs[i]);
        hit = q.length >= 2 ? cs.filter(function (c) { return c.go === want.p && c.st === want.st && norm(c.text).indexOf(q) >= 0; }) : [];
        if (hit.length) return { c: hit[0], why: 'tip' };
      }
      /* tip 点名了按钮、画面上找不到：多半是按钮改了名 tip 没跟着改，或者按钮没了。不去猜别的按钮，记下来 */
      return { miss: qs[0] };
    }
    var exact = cs.filter(function (c) { return c.go === want.p && c.st === want.st && !c.act; });
    if (!strict) {
      /* tip 里没点名按钮、这一步又写了 set 的，多半是演示切换（如切换数据场景）：按流程直接到达，不去点碰巧同去向的按钮 */
      if (step.set) return { skip: 'demo' };
      if (exact.length) return { c: exact[0], why: 'go' };
      return { skip: 'none' };
    }
    /* 写了 see 的跨页步骤：上一步 tip 没写“点”、这一步只切数据场景，才算演示切换 */
    if (presetOnly(step.set) && String(prev.tip || '').indexOf('点') < 0) return { skip: 'preset' };
    if (exact.length) return { c: exact[0], why: 'go' };
    /* 画面上只有一个去这一页的按钮：点它，到错了地方照实报 */
    var page = cs.filter(function (c) { return c.go === want.p && !c.act; });
    if (page.length === 1) return { c: page[0], why: 'page' };
    return { skip: 'nopick' };
  }
  window.__flowWalk = {
    list: function () {
      return (W.P.flows || []).map(function (f) {
        return { id: f.id, name: f.name || f.id, steps: (f.steps || []).map(function (s) {
          var see = s.see == null ? [] : Array.isArray(s.see) ? s.see : [s.see];
          return { p: s.p, st: W.pages[s.p] ? stOf(s.p, s.st) : s.st || '', label: s.label || (W.pages[s.p] ? W.pages[s.p].title : ''), see: see.filter(function (x) { return typeof x === 'string' && x.trim(); }), hosted: hosted(s.p) };
        }) };
      }).filter(function (f) { return f.steps.length; });
    },
    /* 每条流程都从默认演示数据开始，和评审“重置演示数据”后再演示一样 */
    reset: function () {
      W.reset();
      (W.P.ends || []).forEach(function (en) { (en.resetKeys || []).forEach(function (pre) { try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf(pre) === 0) localStorage.removeItem(k); }); } catch (x) {} }); });
      return 1;
    },
    /* 演示：按“下一步”跳到第 j 步 */
    demo: function (fid, j) { return settle(function () { W.goStep(fid, j); }, 150).then(here); },
    /* 真点：从当前画面去第 j 步 */
    next: function (fid, j) {
      var f = flow(fid), step = f.steps[j], prev = f.steps[j - 1];
      var want = { p: step.p, st: stOf(step.p, step.st) };
      var now = here();
      var jump = function (via, extra) {
        return settle(function () { W.nav(step.p, step.st || '', step.set || ''); }, 150).then(function () { var r = here(); r.via = via; Object.keys(extra || {}).forEach(function (k) { r[k] = extra[k]; }); return r; });
      };
      if (hosted(now.p) || hosted(step.p)) return jump('host');
      var hasSee = step.see != null && (Array.isArray(step.see) ? step.see.length > 0 : String(step.see).trim() !== '');
      var pk = pick(prev, step, hasSee && !(now.p === want.p && now.st === want.st));
      if (!pk.c) {
        var ex0 = pk.miss ? { miss: pk.miss } : { skip: pk.skip };
        if (now.p === want.p && now.st === want.st) return jump('stay', ex0);
        return jump('jump', ex0);
      }
      var c = pk.c;
      return settle(function () { c.el.click(); }, c.act ? 1200 : 150).then(function () {
        var r = here();
        r.via = 'click';
        r.why = pk.why;
        r.btn = c.text.slice(0, 30);
        /* 点了没跳转（页面动作只改了画面、表单没填被拦）：下一步还在本状态就按流程刷新，否则跳过去。
           form：点的是 h.submit（要先填表，走查不代填）；其余的记为“点了没跳转” */
        if (r.p === now.p && r.st === now.st && !(c.go && c.go === now.p && c.st === now.st)) {
          return jump(now.p === want.p && now.st === want.st ? 'stay' : 'jump', { btn: r.btn, noop: true, form: c.act === 'form-submit' });
        }
        return r;
      });
    },
    /* 到错的地方以后，按流程回到第 j 步，后面的步骤接着走 */
    resync: function (fid, j) {
      var step = flow(fid).steps[j];
      return settle(function () { W.nav(step.p, step.st || '', step.set || ''); }, 150).then(here);
    },
    start: function (fid) { return settle(function () { W.goStep(fid, 0); }, 150).then(function () { var r = here(); r.via = 'start'; return r; }); }
  };
}

const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, '');
const flat = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
/* 两段画面文字第一处不同的地方，各取一小段给人看 */
export function diffSnippet(a, b, n = 28) {
  const x = flat(a), y = flat(b);
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  let k = 0;
  while (k < x.length - i && k < y.length - i && x[x.length - 1 - k] === y[y.length - 1 - k]) k++;
  const from = Math.max(0, i - 8);
  const cut = (s) => { const mid = s.slice(from, Math.max(i + 1, s.length - k)); return (from > 0 ? '…' : '') + (mid.length > n ? mid.slice(0, n) + '…' : mid); };
  return [cut(x), cut(y)];
}
const where = (r) => r.p + (r.st ? '/' + r.st : '');
const num = (i) => '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'[i] || '(' + (i + 1) + ')';
/* 命令行里 see 的一句话小结（构建和截图共用） */
export function seeLine(fw) {
  if (!fw.see) return '没写 see';
  const bad = [fw.seeFailed ? '没看到 ' + fw.seeFailed + ' 条' : '', fw.seeUnchecked ? '没真点到、没法核对 ' + fw.seeUnchecked + ' 条' : ''].filter(Boolean);
  return 'see ' + fw.see + ' 条，' + (bad.length ? bad.join('，') : '全部看到');
}

/* 走查全部流程。opts.shots：截图目录（不传不截）；opts.log：逐步打印 */
export async function walkFlows(page, opts = {}) {
  await page.evaluate('(' + helper.toString() + ')(); 1');
  const flows = JSON.parse(await page.evaluate('JSON.stringify(__flowWalk.list())'));
  const res = { flows: [], errors: [], warns: [], stats: { flows: flows.length, steps: 0, clicked: 0, jumped: 0, see: 0, seeFailed: 0, seeUnchecked: 0, shots: 0 } };
  const log = opts.log || (() => {});
  if (opts.shots) {
    fs.mkdirSync(opts.shots, { recursive: true });
    for (const n of fs.readdirSync(opts.shots)) if (/^f\d+-\d+.*\.png$/.test(n)) fs.unlinkSync(path.join(opts.shots, n));
  }
  for (let fi = 0; fi < flows.length; fi++) {
    const f = flows[fi];
    const tag = num(fi) + ' ' + f.name;
    const fid = JSON.stringify(f.id);
    log('\n' + tag + '（' + f.steps.length + ' 步）');
    /* 第 1 遍：按“下一步”演示 */
    await page.evaluate('__flowWalk.reset()');
    const demo = [];
    for (let j = 0; j < f.steps.length; j++) demo.push(await page.evaluate('__flowWalk.demo(' + fid + ', ' + j + ')'));
    /* 第 2 遍：真点 */
    await page.evaluate('__flowWalk.reset()');
    const out = { id: f.id, name: f.name, steps: [] };
    for (let j = 0; j < f.steps.length; j++) {
      const s = f.steps[j];
      const r = await page.evaluate(j === 0 ? '__flowWalk.start(' + fid + ')' : '__flowWalk.next(' + fid + ', ' + j + ')');
      res.stats.steps++;
      if (r.via === 'click') res.stats.clicked++;
      else if (r.via !== 'start') res.stats.jumped++;
      const at = '流程「' + tag + '」第 ' + (j + 1) + ' 步（' + where(s) + (s.label ? ' ' + s.label : '') + '）';
      const arrived = r.p === s.p && r.st === s.st;
      const how = r.via === 'click' ? '在第 ' + j + ' 步点“' + r.btn + '”' : '';
      /* 这一步没真点到，是按流程直接跳过来的：上一步 tip 点名的按钮画面上找不到；点了没跳转（要先填表的提交除外）；
         或者这一步写了 see 要跨到别的页面状态，上一步 tip 没点名按钮、画面上也没有直接去那里的按钮。
         这时画面用的是流程 set 里的演示数据，see 核对不了真点的结果 */
      const dead = r.via === 'jump' && r.noop && !r.form;
      const nopick = r.via === 'jump' && r.skip === 'nopick';
      const unreached = r.miss ? '上一步 tip 写的“' + r.miss + '”在画面上找不到' : dead ? '在第 ' + j + ' 步点“' + r.btn + '”没有跳转' : nopick ? '上一步 tip 没写要点哪个按钮（点“按钮上的字”），画面上也没有直接去 ' + where(s) + ' 的按钮' : '';
      const item = { i: j, p: s.p, st: s.st, via: r.via, btn: r.btn || '', got: where(r), ok: true, notes: [] };
      if (!arrived) {
        item.ok = false;
        item.notes.push('到的是 ' + where(r));
        res.warns.push({ code: 'FLOW_WALK', msg: at + '：' + (how || '按流程跳过来') + '，到的是 ' + where(r) + '，流程写的是 ' + where(s) + '。可能是上一页做完的状态没传过去，也可能是流程跳过了中间一步' });
      }
      if (unreached) item.unreached = unreached;
      /* see：真点过来的画面里要有这些文字（忽略空格和换行）。只有它是错误：作者写了期望，就按期望把关。
         没真点到的步骤不拿演示数据充数，直接报 see 没法核对 */
      if (s.see.length && unreached) {
        item.ok = false;
        res.stats.see += s.see.length;
        res.stats.seeUnchecked += s.see.length;
        item.notes.push('see 没法核对');
        res.errors.push({ code: 'FLOW_SEE', msg: at + '：' + unreached + '，这一步是按流程直接跳过来的，see（' + s.see.map((t) => '“' + t + '”').join('、') + '）没法核对。' + (r.miss ? '按钮改了名就改 tip；按钮没了是原型的问题' : nopick ? '在上一步 tip 里用 点“按钮上的字” 写清点哪个按钮；画面上没有这个按钮是原型的问题' : '用户点它会停在原地，多半是按钮没写跳转') });
      } else if (s.see.length) {
        res.stats.see += s.see.length;
        const miss = s.see.filter((t) => !norm(r.text).includes(norm(t)));
        if (miss.length) {
          item.ok = false;
          res.stats.seeFailed += miss.length;
          item.notes.push('没看到 ' + miss.map((t) => '“' + t + '”').join(' '));
          res.errors.push({ code: 'FLOW_SEE', msg: at + '：' + (how ? how + '过来，' : r.noop && r.form ? '上一步的“' + r.btn + '”要先填表，按流程直接到达，' : '') + '画面上没有 ' + miss.map((t) => '“' + t + '”').join('、') + (arrived ? '' : '（实际到的是 ' + where(r) + '）') });
        }
      }
      /* 状态对了，再和“下一步”演示的画面比：不一样说明演示靠流程里的 set 撑着，真点时数据没跟上 */
      const d = demo[j];
      if (arrived && d && d.p === r.p && d.st === r.st && norm(d.text) !== norm(r.text) && r.via !== 'start') {
        const [a, b] = diffSnippet(r.text, d.text);
        item.notes.push('画面和“下一步”不同');
        res.warns.push({ code: 'FLOW_WALK', msg: at + '：' + (how ? how + '过来' : '按流程走到这里') + '，画面和按“下一步”看到的不一样。真点：“' + a + '”；下一步：“' + b + '”。两边的演示数据没对上：要么按钮没带上流程 set 里的数据、页面没读上一页留下的状态，要么流程 set 少写了真点时会变的数据' });
      }
      if (opts.shots) {
        const name = 'f' + (fi + 1) + '-' + String(j + 1).padStart(2, '0') + '-' + where(s).replace(/[^\w\u4e00-\u9fa5-]+/g, '_').slice(0, 40) + '.png';
        await page.screenshot(path.join(opts.shots, name));
        item.shot = name;
        res.stats.shots++;
      }
      const to = where(s);
      const skipText = { demo: 'tip 没点名按钮、这一步写了 set，当作演示切换，按流程直接到达', preset: '切换数据场景，按流程直接到达', nopick: 'tip 没点名按钮、画面上也没有直接去 ' + to + ' 的按钮，按流程直接到达', none: '画面上没有去 ' + to + ' 的按钮，按流程直接到达' };
      const viaText = { start: '起点', click: '点“' + item.btn + '”' + (r.why === 'page' ? '（tip 没点名按钮，画面上只有它去 ' + s.p + '）' : ''), stay: r.miss ? 'tip 写的“' + r.miss + '”画面上找不到，按流程刷新本状态' : r.noop ? '点“' + r.btn + '”后留在本状态（按流程刷新）' : '原地（按流程刷新）', jump: r.miss ? 'tip 写的“' + r.miss + '”画面上找不到，按流程直接到达' : r.noop && r.form ? '点“' + r.btn + '”要先填表，按流程直接到达' : r.noop ? '点“' + r.btn + '”没跳转，按流程直接到达' : skipText[r.skip] || '按流程直接到达', host: '托管页面，按流程直接到达' }[r.via] || r.via;
      /* ✓ 没发现问题（含按流程直接到达的步骤，看这一行后面的说明）；! 有提醒，或者没真点到（截图是按流程跳过来的画面）；✗ 有错误或到错了地方 */
      log('  ' + String(j + 1).padStart(2) + ' ' + where(s).padEnd(22) + ' ' + (!item.ok ? '✗' : item.notes.length || item.unreached ? '!' : '✓') + ' ' + viaText + (item.notes.length ? ' · ' + item.notes.join(' · ') : '') + (item.shot ? '  ' + item.shot : ''));
      out.steps.push(item);
      if (!arrived) await page.evaluate('__flowWalk.resync(' + fid + ', ' + j + ')');
    }
    res.flows.push(out);
  }
  return res;
}
