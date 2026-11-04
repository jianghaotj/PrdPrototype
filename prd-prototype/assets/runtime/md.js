/* Markdown 渲染：Marked 解析 + DOMPurify 白名单 + 可选 Mermaid。所有需求文字都经过这里。 */
(function () {
  'use strict';
  var W = window.W;
  var SAFE_URI = /^(?:(?:https?|mailto|tel):|data:image\/(?:png|gif|jpe?g|webp);base64,|#|[^:]*$)/i;
  var OPT = {
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'link', 'meta', 'base', 'input', 'button', 'textarea', 'select'],
    FORBID_ATTR: ['style', 'srcset'],
    ALLOWED_URI_REGEXP: SAFE_URI
  };
  var BADGE = [
    [/\[待确认\]/g, '<span class="bdg pending">待确认</span>'],
    [/\[(?:AI\s*假设|AI)\]/g, '<span class="bdg assumed">AI 假设</span>']
  ];
  function badges(s) {
    BADGE.forEach(function (b) { s = s.replace(b[0], b[1]); });
    return s;
  }
  var hooked = false;
  function clean(html) {
    if (!window.DOMPurify) return String(html).replace(/[<>]/g, '');
    if (!hooked) {
      /* 交付文件必须离线可用：图片只接受内嵌的 data URI */
      window.DOMPurify.addHook('afterSanitizeAttributes', function (node) {
        if (node.tagName === 'IMG' && !/^data:image\//i.test(node.getAttribute('src') || '')) {
          node.removeAttribute('src');
          node.setAttribute('alt', '（图片未内嵌，已忽略）');
        }
      });
      hooked = true;
    }
    return window.DOMPurify.sanitize(html, OPT);
  }
  function parse(s, inline) {
    s = badges(String(s == null ? '' : s));
    if (!window.marked) return W.h.esc(s);
    return inline ? window.marked.parseInline(s, { gfm: true, breaks: true }) : window.marked.parse(s, { gfm: true, breaks: true });
  }
  var mid = 0, inited = false;
  function mermaidIn(root) {
    var blocks = root.querySelectorAll('pre > code.language-mermaid');
    if (!blocks.length) return;
    if (!window.mermaid) {
      blocks.forEach(function (c) { c.parentNode.insertAdjacentHTML('beforebegin', '<p class="doc-empty">（流程图需要 Mermaid，构建时未内嵌）</p>'); });
      return;
    }
    if (!inited) {
      window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral', fontFamily: 'inherit' });
      inited = true;
    }
    blocks.forEach(function (c) {
      var pre = c.parentNode, code = c.textContent, id = 'mmd-' + (++mid);
      var box = document.createElement('div');
      box.className = 'mermaid';
      pre.replaceWith(box);
      window.mermaid.render(id, code).then(function (r) {
        box.innerHTML = window.DOMPurify ? window.DOMPurify.sanitize(r.svg, { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ['script', 'foreignObject'] }) : '';
      }).catch(function (e) {
        box.innerHTML = '<p class="doc-empty">流程图语法错误：' + W.h.esc(e && e.message || e) + '</p>';
      });
    });
  }
  W.md = {
    inline: function (s) { return clean(parse(s, true)); },
    block: function (s) { return clean(parse(s, false)); },
    into: function (el, s) {
      el.innerHTML = clean(parse(s, false));
      el.querySelectorAll('a[href]').forEach(function (a) {
        if (/^https?:/i.test(a.getAttribute('href'))) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      });
      mermaidIn(el);
    },
    clean: clean,
    /* 纯文本（用于 Markdown 导出时去掉徽标 HTML） */
    plainBadges: function (s) {
      return String(s == null ? '' : s).replace(/\[待确认\]/g, '【待确认】').replace(/\[(?:AI\s*假设|AI)\]/g, '【AI 假设】');
    }
  };
})();
