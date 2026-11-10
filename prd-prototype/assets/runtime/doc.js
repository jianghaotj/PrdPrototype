/* 需求文档模型：全文需求（文档栏目与 Markdown 导出同源）、功能点卡片、统计与待确认清单。 */
(function () {
  'use strict';
  var W = window.W, h = W.h;
  var D = (W.doc = {});
  var CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
  var TYPE_CN = { added: '新增', modified: '修改', removed: '移除' };
  var TYPE_CLS = { added: 'add', modified: 'mod', removed: 'del' };

  /* ---------- 基础判断 ---------- */
  D.cur = function () { return W.P.current || (W.P.releases && W.P.releases.length ? W.P.releases[W.P.releases.length - 1].id : W.P.version || 'V1.0'); };
  D.multiRelease = function () { return (W.P.releases || []).length > 1; };
  D.status = function (x) {
    if (x == null) return 'confirmed';
    if (typeof x === 'string') {
      if (/\[待确认\]/.test(x)) return 'pending';
      if (/\[(?:AI\s*假设|AI)\]/.test(x)) return 'assumed';
      return 'confirmed';
    }
    var s = x.status;
    if (s === 'pending') return 'pending';
    if (s === 'assumed' || s === 'ai' || s === 'ai-draft') return 'assumed';
    var t = x.text || x.desc || x.rule || '';
    if (/\[待确认\]/.test(t)) return 'pending';
    if (/\[(?:AI\s*假设|AI)\]/.test(t)) return 'assumed';
    return 'confirmed';
  };
  D.items = function (list) {
    return (list || []).map(function (x) { return typeof x === 'string' ? { text: x } : x; });
  };
  D.chg = function (x, ver) {
    ver = ver || D.cur();
    return x && x.changes ? x.changes.find(function (c) { return c.ver === ver; }) || null : null;
  };
  /* 新增页面里的功能点自动视为本版新增（不进变更明细，避免重复） */
  D.inheritChanges = function () {
    Object.keys(W.pages).forEach(function (id) {
      var p = W.pages[id];
      (p.changes || []).forEach(function (c) {
        if (c.type !== 'added') return;
        (p.fns || []).forEach(function (f) {
          f.changes = f.changes || [];
          if (!f.changes.some(function (x) { return x.ver === c.ver; })) f.changes.push({ ver: c.ver, type: 'added', inherited: true });
        });
      });
    });
  };
  D.removed = function (x) { return !!(x && x.changes && x.changes.some(function (c) { return c.type === 'removed'; })); };
  /* 功能点自身或它的字段、规则、异常在本版有变化 */
  D.fnChanged = function (f, ver) {
    if (D.chg(f, ver)) return true;
    return [f.fields, D.items(f.rules), D.items(f.errors)].some(function (l) { return (l || []).some(function (x) { return D.chg(x, ver); }); });
  };
  D.pageChanged = function (p, ver) {
    if (D.chg(p, ver)) return true;
    if ((p.states || []).some(function (s) { return D.chg(s, ver); })) return true;
    if ((p.fns || []).some(function (f) { return D.fnChanged(f, ver); })) return true;
    return D.items(p.rules).some(function (r) { return D.chg(r, ver); });
  };
  D.localTime = function (iso) {
    var d = new Date(iso);
    if (isNaN(d)) return String(iso || '');
    function z(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()) + ' ' + z(d.getHours()) + ':' + z(d.getMinutes());
  };
  D.num = function (i) { return i < 20 ? CIRCLED[i] : '(' + (i + 1) + ')'; };
  D.fnIndex = function (p, id) { return (p.fns || []).findIndex(function (f) { return f.id === id; }); };
  D.letter = function (i) { return String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : ''); };
  D.stateLabel = function (p, sid) {
    var s = (p.states || []).find(function (x) { return x.id === sid; });
    return s ? s.label : sid;
  };

  /* 功能点出现在哪些状态：优先读构建检查结果；原生页面可现场计算 */
  var stateCache = {};
  D.fnStates = function (p) {
    if (W.audit && W.audit.fnStates && W.audit.fnStates[p.id]) return W.audit.fnStates[p.id];
    if (stateCache[p.id]) return stateCache[p.id];
    if (typeof p.render !== 'function') return null;
    var out = {};
    var saved = JSON.stringify(W.store);
    var sets = [null].concat(W.presets().map(function (x) { return x.id; }));
    W.device = ((W.end(p.end) || {}).device === 'mobile') ? 'mobile' : 'pc';
    (p.states.length ? p.states : [{ id: '' }]).forEach(function (s) {
      sets.forEach(function (ps) {
        try {
          if (ps) W.applySet('preset=' + ps);
          var html = p.render({ st: s.id, s: W.store, p: p });
          var re = /data-fn="([^"]+)"/g, m;
          while ((m = re.exec(html))) {
            out[m[1]] = out[m[1]] || [];
            if (out[m[1]].indexOf(s.id) < 0) out[m[1]].push(s.id);
          }
        } catch (e) {}
        W.store = JSON.parse(saved);
      });
    });
    stateCache[p.id] = out;
    return out;
  };

  /* ---------- 片段渲染（HTML 与 Markdown 共用的取数逻辑） ---------- */
  /* 文字里已经写了 [待确认] / [AI 假设] 时不再重复加徽标 */
  function ownStatus(x) {
    if (!x || typeof x !== 'object') return 'confirmed';
    var t = String(x.text || x.rule || x.desc || '');
    if (/\[待确认\]|\[(?:AI\s*假设|AI)\]/.test(t) && !/^(?:pending|assumed|ai|ai-draft)$/.test(x.status || '')) return 'confirmed';
    var st = D.status(x);
    if (st === 'pending' && /\[待确认\]/.test(t)) return 'confirmed';
    if (st === 'assumed' && /\[(?:AI\s*假设|AI)\]/.test(t)) return 'confirmed';
    return st;
  }
  function badgeHTML(x, ver) {
    var s = '';
    var st = ownStatus(x);
    if (st === 'pending') s += '<span class="bdg pending">待确认</span>';
    if (st === 'assumed') s += '<span class="bdg assumed">AI 假设</span>';
    if (x && x.changes) x.changes.forEach(function (c) {
      if (!ver || c.ver === ver) s += '<span class="bdg ' + TYPE_CLS[c.type] + '">' + h.esc(c.ver) + ' ' + TYPE_CN[c.type] + '</span>';
    });
    return s;
  }
  function badgeText(x, ver) {
    var s = '';
    var st = ownStatus(x);
    if (st === 'pending') s += '【待确认】';
    if (st === 'assumed') s += '【AI 假设】';
    if (x && x.changes) x.changes.forEach(function (c) { if (!ver || c.ver === ver) s += '【' + c.ver + ' ' + TYPE_CN[c.type] + '】'; });
    return s;
  }
  D.badgeHTML = badgeHTML;
  D.badgeText = badgeText;

  /* 功能点卡片正文（右侧面板用） */
  D.fnBodyHTML = function (f, p, o) {
    o = o || {};
    var md = W.md, s = '';
    var c = o.ver === '__none__' ? null : D.chg(f);
    if (c && c.note) s += '<p><span class="bdg ' + TYPE_CLS[c.type] + '">本版' + TYPE_CN[c.type] + '</span>' + md.inline(c.note) + '</p>';
    if (f.gap) s += '<p><span class="bdg del">原型未体现</span>' + md.inline(f.gap) + '</p>';
    if (f.desc) s += '<div>' + md.block(f.desc) + '</div>';
    var fields = (f.fields || []).filter(function (x) { return o.showRemoved || !D.removed(x); });
    if (fields.length) {
      s += '<div class="k">字段</div>' + fields.map(function (x) {
        return '<div class="fd"><b>' + md.inline(x.name || x.key) + '</b>' + (x.key && x.name ? ' <code>' + h.esc(x.key) + '</code>' : '') + '<span class="ty">' + h.esc(x.type || '') + '</span>' + (x.required ? '<span class="rq">必填</span>' : '') + badgeHTML(x, o.ver) +
          (x.def != null && x.def !== '' ? '<div>默认：' + md.inline(String(x.def)) + '</div>' : '') +
          (x.options ? '<div>可选值：' + md.inline(Array.isArray(x.options) ? x.options.join('、') : x.options) + '</div>' : '') +
          (x.rule ? '<div>' + md.inline(x.rule) + '</div>' : '') + '</div>';
      }).join('');
    }
    function list(title, arr) {
      var it = D.items(arr).filter(function (x) { return o.showRemoved || !D.removed(x); });
      if (!it.length) return '';
      return '<div class="k">' + title + '</div><ul>' + it.map(function (x) { return '<li>' + md.inline(x.text) + badgeHTML(x, o.ver) + '</li>'; }).join('') + '</ul>';
    }
    s += list('规则', D.items(f.rules).concat(D.items(f.auto)));
    s += list('异常与边界', f.errors);
    if (f.empty) s += '<div class="k">空数据</div><div>' + md.inline(f.empty) + '</div>';
    if (f.perm) s += '<div class="k">权限</div><div>' + md.inline(f.perm) + '</div>';
    if (f.src) s += '<div class="src">来源：' + md.inline(Array.isArray(f.src) ? f.src.join('；') : f.src) + '</div>';
    if (o.states && o.states.length && p) {
      s += '<div class="vis">出现在：' + o.states.map(function (sid) {
        return '<a class="chip sm" data-nav="' + h.esc(p.id + '|' + sid) + '" data-fnsel="' + h.esc(f.id) + '">' + h.esc(D.stateLabel(p, sid) || '默认') + '</a>';
      }).join('') + '</div>';
    }
    return s;
  };

  /* ---------- Markdown 生成 ---------- */
  function cell(s) { return String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>'); }
  function table(head, rows) {
    if (!rows.length) return '';
    return '| ' + head.join(' | ') + ' |\n|' + head.map(function () { return ' --- '; }).join('|') + '|\n' + rows.map(function (r) { return '| ' + r.map(cell).join(' | ') + ' |'; }).join('\n') + '\n\n';
  }
  function joinSrc(src) { return Array.isArray(src) ? src.join('；') : src; }

  /* opts: { html: true 文档栏目 / false 导出, changesOnly: 只看本版变化 } */
  D.markdown = function (opts) {
    opts = opts || {};
    var HTML = !!opts.html, only = !!opts.changesOnly, ver = D.cur(), P = W.P;
    var out = [], ch = 0, toc = [];
    function T(s) { return HTML ? s : W.md.plainBadges(s); }
    function B(x, v) { return HTML ? badgeHTML(x, v) : badgeText(x, v); }
    function anchor(id) { return HTML ? '<a id="' + id + '"></a>\n\n' : ''; }
    function link(text, href) { return HTML ? '[' + text + '](' + href + ')' : ''; }
    function chapter(title) {
      ch++;
      var id = 'd-ch-' + ch;
      toc.push({ id: id, title: ch + ' ' + title, level: 1 });
      out.push(anchor(id) + '## ' + ch + ' ' + title + '\n\n');
      return ch;
    }
    function keep(x) { return only ? !!D.chg(x, ver) : !D.removed(x); }
    /* 功能点下的字段、规则、异常：平时不列已移除的；只看本版变化时，本版移除的也列出（带“移除”标记） */
    function sub_keep(x) { return !D.removed(x) || (only && !!D.chg(x, ver)); }
    function bullets(arr) {
      var it = D.items(arr).filter(keep);
      return it.length ? it.map(function (x) { return '- ' + T(x.text) + B(x, ver) + (x.src ? '（来源：' + T(joinSrc(x.src)) + '）' : ''); }).join('\n') + '\n\n' : '';
    }

    out.push('# ' + (P.name || '未命名产品') + ' · 需求文档\n\n');
    out.push('> ' + [ver, P.date, P.fidelity || '低保真线框'].filter(Boolean).join(' · ') + '。本文档与交互原型由同一份需求数据生成' + (HTML ? '，页面章节可直接打开对应原型' : '') + '。\n\n');
    if (only) out.push('> **当前只显示 ' + ver + ' 本版变化。**\n\n');
    if (HTML && opts.stats) out.push(opts.stats + '\n\n');
    if (!HTML) {
      var sx = D.stats();
      out.push('页面 ' + sx.pages + ' · 状态 ' + sx.states + ' · 功能点 ' + sx.fns + ' · 字段 ' + sx.fields + ' · 待确认 ' + sx.pending + ' · AI 假设 ' + sx.assumed + (W.audit ? ' · 结构检查' + (W.audit.ok ? '通过' : '未通过') + (W.audit.needOnline ? ' · 需联网' : '') + '（' + D.localTime(W.audit.at).slice(0, 10) + '）' : '') + '\n\n');
    }

    var allPages = [];
    (P.ends || []).forEach(function (e) { (W.order[e.id] || []).forEach(function (id) { allPages.push(W.pages[id]); }); });

    if (!only) {
      chapter('概述');
      if (P.background) out.push('### 业务背景\n\n' + T(P.background) + '\n\n');
      if (P.goals && P.goals.length) out.push('### 建设目标\n\n' + bullets(P.goals));
      out.push('### 本期范围\n\n');
      out.push(table(['端', '模块', '页面'], (P.ends || []).reduce(function (acc, e) {
        (P.groups && P.groups[e.id] || []).forEach(function (g) {
          acc.push([e.name, g[0], g[1].filter(function (id) { return W.pages[id]; }).map(function (id) { return id + ' ' + W.pages[id].title; }).join('、')]);
        });
        return acc;
      }, [])));
      var outScope = P.scope && P.scope.out || P.outOfScope || [];
      if (outScope.length) out.push('**明确不做**\n\n' + bullets(outScope));
      if (P.roles && P.roles.length) {
        out.push('### 角色与权限\n\n' + table(['角色', '说明', '权限'], P.roles.map(function (r) {
          return [r.name, T(r.desc || ''), T(Array.isArray(r.perms) ? r.perms.join('；') : r.perms || '')];
        })));
      }
      (P.sections || []).filter(function (s) { return s.at !== 'end'; }).forEach(function (s) {
        out.push('### ' + s.title + '\n\n' + T(s.md || '') + '\n\n');
      });

      chapter('信息架构');
      (P.ends || []).forEach(function (e) {
        out.push('### ' + e.name + '\n\n' + (e.desc ? T(e.desc) + '\n\n' : ''));
        out.push(table(['模块', '页面', '页面目标', '状态', '功能点'], (P.groups && P.groups[e.id] || []).reduce(function (acc, g) {
          g[1].forEach(function (id) {
            var p = W.pages[id];
            if (!p) return;
            acc.push([g[0], (HTML ? '[' + id + ' ' + p.title + '](#/doc/d-pg-' + id + ')' : id + ' ' + p.title), T(p.goal || ''), p.states.length, p.fns.filter(function (f) { return !D.removed(f); }).length]);
          });
          return acc;
        }, [])));
      });

      if (P.flows && P.flows.length) {
        chapter('核心流程');
        P.flows.forEach(function (f, fi) {
          out.push('### ' + (fi + 1) + '. ' + f.name + '\n\n' + (f.desc ? T(f.desc) + '\n\n' : ''));
          out.push(table(['步骤', '页面 · 状态', '说明'], f.steps.map(function (s, i) {
            var p = W.pages[s.p];
            var where = p ? s.p + ' ' + p.title + ' · ' + D.stateLabel(p, s.st || (p.states[0] && p.states[0].id)) : s.p;
            return [i + 1, HTML ? '[' + where + '](#/p/' + s.p + '/' + (s.st || '') + '?f=' + f.id + '&i=' + i + ')' : where, T(s.tip || s.label || '')];
          })));
          if (HTML) out.push(link('▶ 在原型中演示此流程', '#/p/' + f.steps[0].p + '/' + (f.steps[0].st || '') + '?f=' + f.id + '&i=0') + '\n\n');
        });
      }

      var gr = D.items(P.rules).filter(keep);
      if (gr.length || (P.nfr && P.nfr.length)) {
        chapter('全局规则');
        if (gr.length) out.push(bullets(P.rules));
        if (P.nfr && P.nfr.length) out.push('### 非功能要求\n\n' + bullets(P.nfr));
      }
    }

    /* 只看本版变化：先列产品级变化（目标、范围、角色、全局规则、数据字典、流程、待确认） */
    if (only) {
      var glog = D.changelog().filter(function (x) { return x.ver === ver && !/^#\/p\//.test(x.href || '') && !x.shared; });
      chapter(ver + ' 本版变化 · 产品级');
      if (glog.length) {
        var gr2 = D.items(P.rules).filter(function (r) { return D.chg(r, ver); });
        out.push(table(['类型', '位置', '内容', '说明'], glog.map(function (x) { return [TYPE_CN[x.type], x.where, T(x.name), T(x.note || '')]; })));
        if (gr2.length) out.push('**本版涉及的全局规则（全文）**\n\n' + gr2.map(function (x) { return '- ' + T(x.text) + B(x, ver); }).join('\n') + '\n\n');
      } else out.push('本版没有产品级变化。\n\n');
    }

    /* 页面需求 */
    chapter(only ? ver + ' 本版变化 · 页面需求' : '页面需求');
    var anyPage = false;
    (P.ends || []).forEach(function (e) {
      var pages = (W.order[e.id] || []).map(function (id) { return W.pages[id]; }).filter(function (p) { return !only || D.pageChanged(p, ver); });
      if (!pages.length) return;
      out.push('### ' + e.name + '\n\n');
      pages.forEach(function (p) {
        anyPage = true;
        toc.push({ id: 'd-pg-' + p.id, title: p.id + ' ' + p.title, level: 2, page: p.id });
        out.push(anchor('d-pg-' + p.id) + '#### ' + (HTML ? '<span class="fid">' + p.id + '</span>' : p.id + ' ') + p.title + ' ' + B(p, ver) + (HTML ? ' <a class="open-in" href="#/p/' + p.id + '">在原型中打开 →</a>' : '') + '\n\n');
        var pc = D.chg(p, ver);
        if (only && pc && pc.note) out.push('> 本版' + TYPE_CN[pc.type] + '：' + T(pc.note) + '\n\n');
        var meta = [];
        if (p.goal) meta.push('- **页面目标**：' + T(p.goal));
        if (p.entry) meta.push('- **入口与前置**：' + T(p.entry));
        if (p.perm) meta.push('- **角色权限**：' + T(p.perm));
        if (meta.length) out.push(meta.join('\n') + '\n\n');
        var sts = only ? p.states.filter(function (s) { return D.chg(s, ver); }) : p.states;
        if (sts.length) {
          out.push('**页面状态**\n\n' + table(['状态', '出现条件'], sts.map(function (s) {
            return [(HTML ? '[' + s.label + '](#/p/' + p.id + '/' + s.id + ')' : s.label) + (only ? B(s, ver) : ''), T(s.when || '')];
          })));
        }
        var fs = D.fnStates(p) || {};
        var fns = p.fns.filter(function (f) { return only ? D.fnChanged(f, ver) : !D.removed(f); });
        if (fns.length) {
          out.push('**功能点**\n\n');
          fns.forEach(function (f) {
            var i = D.fnIndex(p, f.id);
            out.push(anchor('d-fn-' + p.id + '-' + f.id) + '##### ' + D.num(i) + ' ' + f.name + ' ' + (HTML ? '<span class="fid">' + f.id + '</span>' : '`' + f.id + '`') + B(f, ver) + '\n\n');
            var fc = D.chg(f, ver);
            if (fc && fc.note && (only || D.multiRelease())) out.push('> 本版' + TYPE_CN[fc.type] + '：' + T(fc.note) + '\n\n');
            if (D.removed(f)) return;
            if (f.gap) out.push('> ' + (HTML ? '<span class="bdg del">原型未体现</span>' : '【原型未体现】') + T(f.gap) + '\n\n');
            if (f.desc) out.push(T(f.desc) + '\n\n');
            var flds = (f.fields || []).filter(keep);
            if (only) flds = (f.fields || []).filter(function (x) { return D.chg(x, ver); }).concat(fc ? (f.fields || []).filter(function (x) { return !D.chg(x, ver) && !D.removed(x); }) : []);
            if (flds.length) {
              out.push(table(['字段', '类型', '必填', '默认值', '可选值', '规则与口径'], flds.map(function (x) {
                return [T((x.name || x.key) + (x.key && x.name ? ' `' + x.key + '`' : '')) + B(x, ver), x.type || '', x.required ? '是' : '否', x.def == null ? '' : T(String(x.def)), T(Array.isArray(x.options) ? x.options.join('、') : x.options || ''), T(x.rule || '')];
              })));
            }
            var sub = [];
            var rl = D.items(f.rules).concat(D.items(f.auto)).filter(sub_keep);
            if (rl.length) sub.push('**规则**\n\n' + rl.map(function (x) { return '- ' + T(x.text) + B(x, ver); }).join('\n'));
            var er = D.items(f.errors).filter(sub_keep);
            if (er.length) sub.push('**异常与边界**\n\n' + er.map(function (x) { return '- ' + T(x.text) + B(x, ver); }).join('\n'));
            if (f.empty) sub.push('**空数据**：' + T(f.empty));
            if (f.perm) sub.push('**权限**：' + T(f.perm));
            var tail = [];
            if (fs[f.id] && fs[f.id].length && p.states.length > 1) tail.push('出现在：' + fs[f.id].map(function (sid) { return HTML ? '[' + D.stateLabel(p, sid) + '](#/p/' + p.id + '/' + sid + '?fn=' + f.id + ')' : D.stateLabel(p, sid); }).join('、'));
            if (f.src) tail.push('来源：' + T(joinSrc(f.src)));
            if (tail.length) sub.push('<small>' + tail.join(' · ') + '</small>');
            if (sub.length) out.push(sub.join('\n\n') + '\n\n');
          });
        }
        var pr = D.items(p.rules).filter(keep);
        if (pr.length) out.push('**页面规则**\n\n' + bullets(p.rules));
        if (p.todo && p.todo.length && !only) out.push('**待确认**\n\n' + p.todo.map(function (t) { return '- ' + T(D.strip(typeof t === 'string' ? t : t.text)) + (HTML ? ' <span class="bdg pending">待确认</span>' : ' 【待确认】'); }).join('\n') + '\n\n');
      });
    });
    if (!anyPage) out.push(only ? '本版没有页面级变化。\n\n' : '尚未登记页面。\n\n');

    /* 公共组件 */
    var groups = W.sharedGroups.filter(function (g) { return g.fns.some(function (f) { return only ? D.fnChanged(f, ver) : !D.removed(f); }); });
    if (groups.length) {
      chapter('公共组件');
      groups.forEach(function (g) {
        var e = W.end(g.end);
        out.push(anchor('d-sh-' + g.id) + '### ' + g.title + (e ? '（' + e.name + '）' : '') + '\n\n' + (g.desc ? T(g.desc) + '\n\n' : ''));
        g.fns.filter(function (f) { return only ? D.fnChanged(f, ver) : !D.removed(f); }).forEach(function (f, i) {
          out.push('##### ' + D.letter(i) + ' ' + f.name + ' ' + (HTML ? '<span class="fid">' + f.id + '</span>' : '`' + f.id + '`') + B(f, ver) + '\n\n');
          if (f.desc) out.push(T(f.desc) + '\n\n');
          var sfl = (f.fields || []).filter(sub_keep);
          if (sfl.length) out.push(table(['字段', '类型', '必填', '规则与口径'], sfl.map(function (x) { return [T(x.name || x.key) + B(x, ver), x.type || '', x.required ? '是' : '否', T(x.rule || '')]; })));
          var rl = D.items(f.rules).concat(D.items(f.auto)).filter(sub_keep);
          if (rl.length) out.push(rl.map(function (x) { return '- ' + T(x.text) + B(x, ver); }).join('\n') + '\n\n');
          var er = D.items(f.errors).filter(sub_keep);
          if (er.length) out.push('**异常与边界**\n\n' + er.map(function (x) { return '- ' + T(x.text) + B(x, ver); }).join('\n') + '\n\n');
          if (f.src) out.push('<small>来源：' + T(joinSrc(f.src)) + '</small>\n\n');
        });
      });
    }

    if (!only) {
      /* 验收条件（功能点的 ac，可选）：集中成一章，测试可直接据此写用例 */
      var acRows = [];
      function acRow(where, f) { return [T(where), T(f.name), T(f.ac.pre || '—'), T(f.ac.act), T(f.ac.expect)]; }
      allPages.forEach(function (p) {
        if (!p) return;
        p.fns.forEach(function (f) { if (f.ac && !D.removed(f)) acRows.push(acRow(p.id + ' ' + p.title, f)); });
      });
      W.sharedGroups.forEach(function (g) {
        g.fns.forEach(function (f) { if (f.ac && !D.removed(f)) acRows.push(acRow('公共组件「' + g.title + '」', f)); });
      });
      if (acRows.length) {
        chapter('验收条件');
        out.push('功能点写了验收条件（前置条件、用户操作、预期结果）的集中列在这里。未列出的功能点没有单独写验收条件，以功能点说明和规则为准。\n\n');
        out.push(table(['位置', '功能点', '前置条件', '用户操作', '预期结果'], acRows));
      }
      if (P.dict && P.dict.length) {
        chapter('数据字典');
        P.dict.forEach(function (d) {
          out.push('### ' + d.name + '\n\n' + (d.desc ? T(d.desc) + '\n\n' : ''));
          if (d.fields && d.fields.length) out.push(table(['字段', '类型', '说明'], d.fields.map(function (x) { return [T(x.name + (x.key ? ' `' + x.key + '`' : '')), x.type || '', T(x.desc || x.rule || '')]; })));
          if (d.states) out.push('**状态**：' + T(Array.isArray(d.states) ? d.states.join(' → ') : d.states) + '\n\n');
        });
      }
      (P.sections || []).filter(function (s) { return s.at === 'end'; }).forEach(function (s) {
        chapter(s.title);
        out.push(T(s.md || '') + '\n\n');
      });
      var ign = [], gaps = [];
      (P.ends || []).forEach(function (e) { (e.ignore || []).forEach(function (ig) { if (typeof ig === 'object') ign.push({ e: e, ig: ig }); }); });
      Object.keys(W.pages).forEach(function (id) { var p = W.pages[id]; p.fns.forEach(function (f) { if (f.gap && !D.removed(f)) gaps.push([HTML ? '[' + id + ' ' + p.title + '](#/p/' + id + ')' : id + ' ' + p.title, f.name, T(f.gap)]); }); });
      W.sharedGroups.forEach(function (g) { g.fns.forEach(function (f) { if (f.gap && !D.removed(f)) gaps.push([g.title, f.name, T(f.gap)]); }); });
      if (ign.length || gaps.length) {
        chapter('需求与原型的差异');
        out.push('原型画面与本需求不一致的地方，以本需求为准。\n\n');
        var labels = [];
        ign.forEach(function (x) { var lb = x.ig.label || '本期不做'; if (labels.indexOf(lb) < 0) labels.push(lb); });
        labels.forEach(function (lb) {
          out.push('### 原型中有、' + lb + '\n\n' + (lb === '本期不做' ? '原型上以红色虚线框和“本期不做”标出，研发和测试不实现、不验收。' : '原型上以红色虚线框和“' + lb + '”标出，不在本次评审和验收范围内。') + '\n\n');
          out.push(table(['端', '原型元素', '原因'], ign.filter(function (x) { return (x.ig.label || '本期不做') === lb; }).map(function (x) {
            return [x.e.name, T(x.ig.name || '') + (x.ig.name ? ' ' : '') + '`' + x.ig.sel + '`' + (x.ig.text ? '（文字含“' + x.ig.text + '”）' : ''), T(x.ig.why || '')];
          })));
        });
        if (gaps.length) out.push('### 需求中有、原型未体现\n\n研发按需求实现，测试按需求验收；原型后续补画。\n\n' + table(['页面', '功能点', '说明'], gaps));
      }
      /* 范围确认后新增 / 移除：和 prd/scope.json 基线对比。没有基线时不列 */
      var sd = W.scopeDiff();
      if (sd) {
        chapter('范围确认后新增');
        var when = (sd.confirmedAt ? '于 ' + sd.confirmedAt : '') + (sd.release ? '（' + sd.release + '）' : '');
        out.push('范围清单' + (when ? when + ' ' : '') + '确认之后，原型里又多出下列页面、状态或功能点。它们没有经过范围确认，评审时请决定是否纳入本期。\n\n');
        if (sd.added.length) out.push(table(['类别', '位置'], sd.added.map(function (x) { return [x.kind, T(x.label)]; })));
        else out.push('确认之后没有新增的页面、状态或功能点。\n\n');
        if (sd.removed.length) out.push('**确认之后已从原型中移除**\n\n' + table(['类别', '位置'], sd.removed.map(function (x) { return [x.kind, T(x.key)]; })));
      }
      var pend = D.pendingList();
      chapter('待确认与 AI 假设');
      if (pend.length) {
        out.push('以下内容尚未由需求方确认。**待确认**需要拍板；**AI 假设**是 AI 按常见做法补的默认方案，评审时请逐条确认或修改。\n\n');
        out.push(table(['#', '类型', '位置', '内容'], pend.map(function (x, i) {
          return [i + 1, x.type === 'pending' ? '待确认' : 'AI 假设', HTML && x.href ? '[' + x.where + '](' + x.href + ')' : x.where, T(D.strip(x.text))];
        })));
      } else out.push('没有待确认项。\n\n');
      if (P.clarify && P.clarify.length) {
        chapter('需求澄清记录');
        out.push(table(['编号', '问题', '结论', '方式'], P.clarify.map(function (c) { return [c.no || '', T(c.q || ''), T(c.a || ''), c.by || '']; })));
      }
    }
    var log = D.changelog();
    if ((P.releases && P.releases.length) || log.length) {
      chapter('变更记录');
      if (P.releases && P.releases.length) out.push(table(['版本', '日期', '说明'], P.releases.map(function (r) { return [r.id, r.date || '', T(r.summary || '')]; })));
      var vers = (P.releases || []).map(function (r) { return r.id; });
      vers.slice().reverse().forEach(function (v) {
        var rows = log.filter(function (x) { return x.ver === v; });
        if (!rows.length) return;
        out.push('### ' + v + ' 变化明细\n\n' + table(['类型', '位置', '内容', '说明'], rows.map(function (x) {
          return [TYPE_CN[x.type], HTML && x.href ? '[' + x.where + '](' + x.href + ')' : x.where, T(x.name), T(x.note || '')];
        })));
      });
    }
    D.lastToc = toc;
    return out.join('');
  };

  /* ---------- CSV：研发与测试导出（功能点、字段、验收条件）。与 Markdown 各自独立，不改 D.markdown ---------- */
  var FN_COLS = ['pageId', 'pageTitle', 'endId', 'fnId', 'fnName', 'desc', 'perm', 'src', 'status'];
  var FIELD_COLS = ['pageId', 'fnId', 'fnName', 'key', 'name', 'type', 'required', 'def', 'options', 'rule'];
  var AC_COLS = ['pageId', 'fnId', 'fnName', 'pre', 'act', 'expect'];
  /* 合并文本的表头：三张表列的并集，sheet 列标明行属于哪张表；不适用的单元格留空 */
  var ALL_COLS = ['sheet', 'pageId', 'pageTitle', 'endId', 'fnId', 'fnName', 'desc', 'perm', 'src', 'status', 'key', 'name', 'type', 'required', 'def', 'options', 'rule', 'pre', 'act', 'expect'];
  function csvCell(v) {
    var s = v == null ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csvLine(cols, row) {
    return cols.map(function (c) { return csvCell(row[c]); }).join(',');
  }
  function csvSheet(cols, rows) {
    return [cols.join(',')].concat(rows.map(function (r) { return csvLine(cols, r); })).join('\r\n') + '\r\n';
  }
  /* 待确认 / AI 假设 标记写进状态列；已确认留空。按语义判断（文字里的 [待确认] 也算），不用徽标去重的 ownStatus */
  function csvStatus(x) {
    var s = D.status(x);
    return s === 'pending' ? '待确认' : s === 'assumed' ? 'AI 假设' : '';
  }
  /* 行对象：fns / fields / ac 三组，已删除（removed）的功能点和字段不导出 */
  D.csvRows = function () {
    var out = { fns: [], fields: [], ac: [] };
    function collect(pageId, pageTitle, endId, fns) {
      fns.forEach(function (f) {
        if (D.removed(f)) return;
        out.fns.push({ sheet: 'fns', pageId: pageId, pageTitle: pageTitle, endId: endId, fnId: f.id, fnName: f.name || '', desc: f.desc || '', perm: f.perm || '', src: joinSrc(f.src) || '', status: csvStatus(f) });
        (f.fields || []).forEach(function (x) {
          if (D.removed(x)) return;
          out.fields.push({ sheet: 'fields', pageId: pageId, fnId: f.id, fnName: f.name || '', key: x.key || '', name: x.name || '', type: x.type || '', required: x.required ? '是' : '否', def: x.def == null ? '' : String(x.def), options: Array.isArray(x.options) ? x.options.join('、') : (x.options || ''), rule: x.rule || '' });
        });
        if (f.ac) out.ac.push({ sheet: 'ac', pageId: pageId, fnId: f.id, fnName: f.name || '', pre: f.ac.pre || '', act: f.ac.act || '', expect: f.ac.expect || '' });
      });
    }
    (W.P.ends || []).forEach(function (e) {
      (W.order[e.id] || []).forEach(function (id) {
        var p = W.pages[id];
        if (p) collect(id, p.title || '', e.id, p.fns || []);
      });
    });
    /* 公共组件的 pageId 写作 S:端ID，与评审意见的 target 写法一致 */
    W.sharedGroups.forEach(function (g) { collect('S:' + g.end, g.title || '', g.end, g.fns || []); });
    return out;
  };
  /* 合并 CSV 文本（不含 BOM；下载时由 viewer 在前面加 \uFEFF） */
  D.csvText = function () {
    var r = D.csvRows();
    return csvSheet(ALL_COLS, r.fns.concat(r.fields, r.ac));
  };
  /* 三份独立 CSV 文本（各带表头，不含 sheet 列） */
  D.csvSheets = function () {
    var r = D.csvRows();
    return {
      fns: csvSheet(FN_COLS, r.fns),
      fields: csvSheet(FIELD_COLS, r.fields),
      ac: csvSheet(AC_COLS, r.ac)
    };
  };

  /* ---------- 统计、待确认、变更 ---------- */
  /* 待确认与 AI 假设清单：收集所有需求文字里的 [待确认] / [AI 假设] 标记，以及标了 status 的条目 */
  var MARK = /\[待确认\]|\[(?:AI\s*假设|AI)\]/g;
  D.strip = function (t) { return String(t == null ? '' : t).replace(/\s*(?:\[待确认\]|\[(?:AI\s*假设|AI)\])/g, '').trim(); };
  function markOf(t) {
    t = String(t || '');
    if (/\[待确认\]/.test(t)) return 'pending';
    if (/\[(?:AI\s*假设|AI)\]/.test(t)) return 'assumed';
    return null;
  }
  D.pendingList = function () {
    var out = [], seen = {};
    function add(type, where, text, href) {
      var k = type + '|' + where + '|' + text;
      if (seen[k] || !text) return;
      seen[k] = 1;
      out.push({ type: type, where: where, text: text, href: href });
    }
    /* 文字里带标记 */
    function txt(t, where, href, label) {
      if (typeof t !== 'string') return;
      var m = markOf(t);
      if (m) add(m, where, (label ? label + '：' : '') + D.strip(t), href);
    }
    /* 条目（字符串或 { text, status }） */
    function item(x, where, href, label) {
      if (x == null || D.removed(x)) return;
      if (typeof x === 'string') return txt(x, where, href, label);
      var st = x.status === 'pending' ? 'pending' : (x.status === 'assumed' || x.status === 'ai' || x.status === 'ai-draft') ? 'assumed' : markOf(x.text);
      if (st) add(st, where, (label ? label + '：' : '') + D.strip(x.text) + (x.statusNote ? '（' + D.strip(x.statusNote) + '）' : ''), href);
    }
    function fnEntries(f, where, href) {
      if (D.removed(f)) return;
      var st = f.status === 'pending' ? 'pending' : (f.status === 'assumed' || f.status === 'ai' || f.status === 'ai-draft') ? 'assumed' : null;
      if (st) add(st, where, '整个功能点：' + D.strip(f.desc || f.name) + (f.statusNote ? '（' + D.strip(f.statusNote) + '）' : ''), href);
      txt(f.desc, where, href, '交互');
      txt(f.empty, where, href, '空数据');
      txt(f.perm, where, href, '权限');
      txt(f.gap, where, href, '原型差异');
      (f.fields || []).forEach(function (x) {
        if (D.removed(x)) return;
        var nm = '字段「' + (x.name || x.key) + '」';
        var fst = x.status === 'pending' ? 'pending' : (x.status === 'assumed' || x.status === 'ai' || x.status === 'ai-draft') ? 'assumed' : null;
        var body = [x.rule, x.def != null && x.def !== '' ? '默认 ' + x.def : '', Array.isArray(x.options) ? '' : x.options].filter(function (v) { return v && typeof v === 'string'; });
        if (fst) add(fst, where, nm + '：' + D.strip(body.join('；') || x.type || '') + (x.statusNote ? '（' + D.strip(x.statusNote) + '）' : ''), href);
        else body.forEach(function (b) { txt(b, where, href, nm); });
      });
      D.items(f.rules).forEach(function (r) { item(r, where, href); });
      D.items(f.errors).forEach(function (r) { item(r, where, href, '异常'); });
    }
    var P = W.P;
    txt(P.background, '业务背景');
    D.items(P.goals).forEach(function (r) { item(r, '建设目标'); });
    D.items(P.scope && P.scope.out).forEach(function (r) { item(r, '本期不做'); });
    (P.roles || []).forEach(function (r) { txt(r.desc, '角色「' + r.name + '」'); (r.perms || []).forEach(function (x) { txt(x, '角色「' + r.name + '」', null, '权限'); }); });
    D.items(P.rules).forEach(function (r) { item(r, '全局规则'); });
    D.items(P.nfr).forEach(function (r) { item(r, '非功能要求'); });
    (P.dict || []).forEach(function (d) { txt(d.desc, '数据字典 · ' + d.name); (d.fields || []).forEach(function (x) { txt(x.desc || x.rule, '数据字典 · ' + d.name, null, '「' + x.name + '」'); }); });
    (P.sections || []).forEach(function (sc) {
      String(sc.md || '').split(/\n/).forEach(function (line) { txt(line.replace(/^[\s>*\-|#\d.]+/, ''), sc.title); });
    });
    (P.todo || []).forEach(function (t) { add('pending', '全局', D.strip(typeof t === 'string' ? t : t.text)); });
    Object.keys(W.pages).forEach(function (id) {
      var p = W.pages[id], where = id + ' ' + p.title, href = '#/p/' + id;
      txt(p.goal, where, href, '页面目标');
      txt(p.entry, where, href, '入口');
      txt(p.perm, where, href, '权限');
      (p.states || []).forEach(function (st) { txt(st.when, where, '#/p/' + id + '/' + st.id, '状态「' + st.label + '」'); });
      (p.todo || []).forEach(function (t) { add('pending', where, D.strip(typeof t === 'string' ? t : t.text), href); });
      D.items(p.rules).forEach(function (r) { item(r, where, href); });
      (p.fns || []).forEach(function (f) { fnEntries(f, where + ' · ' + f.name, '#/p/' + id + '?fn=' + f.id); });
    });
    W.sharedGroups.forEach(function (g) {
      g.fns.forEach(function (f) { fnEntries(f, g.title + ' · ' + f.name, '#/doc/d-sh-' + g.id); });
    });
    return out;
  };
  D.changelog = function () {
    var out = [];
    function push(x, where, name, href, sh) {
      (x && x.changes || []).forEach(function (c) { if (!c.inherited) out.push({ ver: c.ver, type: c.type, where: where, name: name, note: c.note || '', href: href, shared: !!sh }); });
    }
    function short(t) { t = D.strip(t); return t.length > 60 ? t.slice(0, 60) + '…' : t; }
    var P = W.P;
    D.items(P.goals).forEach(function (r) { push(r, '建设目标', short(r.text)); });
    D.items(P.scope && P.scope.out).forEach(function (r) { push(r, '本期不做', short(r.text)); });
    D.items(P.nfr).forEach(function (r) { push(r, '非功能要求', short(r.text)); });
    (P.roles || []).forEach(function (r) { push(r, '角色与权限', '角色「' + r.name + '」'); });
    (P.dict || []).forEach(function (d) { push(d, '数据字典', '「' + d.name + '」'); (d.fields || []).forEach(function (x) { push(x, '数据字典 · ' + d.name, '字段「' + x.name + '」'); }); });
    (P.todo || []).forEach(function (t) { if (typeof t === 'object') push(t, '待确认', short(t.text)); });
    (P.flows || []).forEach(function (f) { push(f, '核心流程', '流程「' + f.name + '」'); });
    Object.keys(W.pages).forEach(function (id) {
      var p = W.pages[id];
      push(p, id + ' ' + p.title, '页面', '#/p/' + id);
      (p.fns || []).forEach(function (f) {
        push(f, id + ' ' + p.title, '功能点「' + f.name + '」', '#/p/' + id + '?fn=' + f.id);
        D.items(f.rules).forEach(function (r) { push(r, id + ' · ' + f.name + ' · 规则', short(r.text), '#/p/' + id + '?fn=' + f.id); });
        D.items(f.errors).forEach(function (r) { push(r, id + ' · ' + f.name + ' · 异常', short(r.text), '#/p/' + id + '?fn=' + f.id); });
        (f.fields || []).forEach(function (x) { push(x, id + ' · ' + f.name, '字段「' + (x.name || x.key) + '」', '#/p/' + id + '?fn=' + f.id); });
      });
      D.items(p.rules).forEach(function (r) { push(r, id + ' ' + p.title + ' · 页面规则', short(r.text), '#/p/' + id); });
      (p.states || []).forEach(function (s) { push(s, id + ' ' + p.title, '状态「' + s.label + '」', '#/p/' + id + '/' + s.id); });
    });
    W.sharedGroups.forEach(function (g) {
      g.fns.forEach(function (f) {
        push(f, g.title, '公共组件「' + f.name + '」', null, 1);
        D.items(f.rules).forEach(function (r) { push(r, g.title + ' · ' + f.name + ' · 规则', short(r.text), null, 1); });
        D.items(f.errors).forEach(function (r) { push(r, g.title + ' · ' + f.name + ' · 异常', short(r.text), null, 1); });
        (f.fields || []).forEach(function (x) { push(x, g.title + ' · ' + f.name, '字段「' + (x.name || x.key) + '」', null, 1); });
      });
    });
    D.items(W.P.rules).forEach(function (r) { push(r, '全局规则', short(r.text)); });
    return out;
  };
  D.stats = function () {
    var pages = Object.keys(W.pages).map(function (k) { return W.pages[k]; });
    var fns = 0, fields = 0, states = 0;
    pages.forEach(function (p) {
      states += p.states.length;
      p.fns.forEach(function (f) { if (!D.removed(f)) { fns++; fields += (f.fields || []).filter(function (x) { return !D.removed(x); }).length; } });
    });
    W.sharedGroups.forEach(function (g) { fns += g.fns.filter(function (f) { return !D.removed(f); }).length; });
    var pend = D.pendingList();
    var ver = D.cur();
    return {
      pages: pages.length, states: states, fns: fns, fields: fields,
      pending: pend.filter(function (x) { return x.type === 'pending'; }).length,
      assumed: pend.filter(function (x) { return x.type === 'assumed'; }).length,
      changes: D.changelog().filter(function (x) { return x.ver === ver; }).length,
      gaps: pages.reduce(function (n, p) { return n + p.fns.filter(function (f) { return f.gap && !D.removed(f); }).length; }, 0),
      release: ver
    };
  };
})();
