/* 托管页面：原型画面来自已有 HTML，这里只写需求，并用选择器把功能点绑定到原有元素。
   先运行 node scripts/probe-host.mjs <原型.html> 查看全局函数、容器和可交互元素的选择器。 */
W.page({
  id: '{{pid}}', end: '{{end}}', group: '', title: '',
  goal: '',
  /* 这个页面在原型里可见时成立的条件（可见元素选择器），用于点击原型时自动切换右侧需求 */
  match: '',
  /* 从原型初始画面到达本页的步骤：{ js: "showPage('x')" } / { click: '#btn' } / { hash: '#/x' } */
  enter: [],
  states: [
    { id: 'default', label: '默认', when: '' }
    // 弹窗：{ id: 'new', label: '新建', when: '点击“新建”', layer: 'modal', enter: [{ click: '#btn-new' }], match: '#modal-new' }
  ],
  fns: [
    // { id: 'filter', name: '', sel: '#kw, #status', desc: '', fields: [], src: '' }
  ]
});
