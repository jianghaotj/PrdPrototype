/* 评审意见：评审者在功能点上留意见，存在本机浏览器（localStorage）里，可导出 JSON，再由 scripts/merge-comments.mjs 合并。
   target 格式：功能点 `页面ID/功能点ID`；公共组件 `S:端ID/功能点ID`；页面级 `页面ID`。
   每条意见记下提出时的版本（release）；1.2.3 之前存下的意见没有这个字段，导出时原样保留，合并时标“版本未知”，不补猜。 */
(function () {
  'use strict';
  var W = window.W;
  var C = (W.comments = {});
  var AUTHOR_KEY = 'prd-comments-author';

  function product() { return W.P || {}; }
  function release() { return W.doc && W.doc.cur ? W.doc.cur() : ''; }
  function storeKey() { return 'prd-comments:' + (product().id || product().name || ''); }
  function read() {
    try {
      var a = JSON.parse(localStorage.getItem(storeKey()) || '[]');
      return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
  }
  function write(list) { localStorage.setItem(storeKey(), JSON.stringify(list)); }
  function parseTarget(target) {
    var s = String(target || '');
    if (s.indexOf('S:') === 0) {
      var a = s.slice(2).split('/');
      return { pageId: null, fnId: a.slice(1).join('/') || null };
    }
    var i = s.indexOf('/');
    if (i < 0) return { pageId: s || null, fnId: null };
    return { pageId: s.slice(0, i), fnId: s.slice(i + 1) || null };
  }
  function localDate() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  C.author = function () {
    try { return localStorage.getItem(AUTHOR_KEY) || ''; } catch (e) { return ''; }
  };
  C.setAuthor = function (name) {
    localStorage.setItem(AUTHOR_KEY, String(name || '').trim());
  };

  C.list = function (target) {
    var all = read();
    if (target === undefined || target === null) return all;
    return all.filter(function (c) { return c.target === target; });
  };

  C.add = function (o) {
    o = o || {};
    var text = String(o.text == null ? '' : o.text).trim();
    if (!text) throw new Error('意见不能为空');
    var target = o.target || (o.pageId ? o.pageId + (o.fnId ? '/' + o.fnId : '') : '');
    var t = parseTarget(target);
    if (!t.pageId && !/^S:/.test(target)) throw new Error('意见缺少对象（target）');
    var item = {
      id: 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      target: target,
      pageId: t.pageId,
      fnId: t.fnId,
      release: release(),
      text: text,
      author: o.author !== undefined ? String(o.author).trim() : C.author(),
      at: new Date().toISOString(),
      resolved: false
    };
    var list = read();
    list.push(item);
    write(list);
    return item;
  };

  /* 只允许改正文和是否已处理，其余字段（对象、版本、时间、作者）保持不变 */
  C.update = function (id, patch) {
    var list = read(), item = null;
    list.some(function (c) { if (c.id === id) { item = c; return true; } return false; });
    if (!item) return null;
    patch = patch || {};
    if ('text' in patch) {
      var text = String(patch.text == null ? '' : patch.text).trim();
      if (!text) throw new Error('意见不能为空');
      item.text = text;
    }
    if ('resolved' in patch) item.resolved = !!patch.resolved;
    write(list);
    return item;
  };

  C.remove = function (id) {
    var list = read();
    var next = list.filter(function (c) { return c.id !== id; });
    if (next.length === list.length) return false;
    write(next);
    return true;
  };

  C.count = function (target) {
    var all = read();
    if (target === undefined || target === null) return all.length;
    return all.filter(function (c) { return c.target === target; }).length;
  };
  C.countByPage = function (pageId) {
    return read().filter(function (c) { return c.pageId === pageId; }).length;
  };

  C.exportJSON = function (author) {
    var p = product();
    var who = author !== undefined ? String(author).trim() : C.author();
    return {
      v: 1,
      productId: p.id || p.name || '',
      productName: p.name || '',
      release: release(),   /* 导出时的版本（本轮）；每条意见自己的 release 是提出时的版本 */
      exportedAt: new Date().toISOString(),
      author: who,
      /* 条目作者空时用本次导出作者兜底，便于流程 C 写 src */
      comments: read().map(function (c) {
        var a = String(c.author || '').trim();
        if (a) return c;
        var copy = {};
        for (var k in c) if (Object.prototype.hasOwnProperty.call(c, k)) copy[k] = c[k];
        copy.author = who;
        return copy;
      })
    };
  };

  C.download = function (author) {
    var obj = C.exportJSON(author);
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json;charset=utf-8' });
    var name = (obj.productName || '原型') + '-评审意见-' + (obj.release || 'V1.0') + '-' + localDate() + '.json';
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    return name;
  };
})();
