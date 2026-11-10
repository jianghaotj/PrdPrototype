/* 页面需求与原型放在一起：先写 states 和 fns，再按 fns 画 render。
   render 里每个可交互元素都要落在某个 data-fn 里；没登记的按钮会让构建失败。 */
W.page({
  id: '{{pid}}', end: '{{end}}', group: '', title: '',
  goal: '',
  entry: '',
  states: [
    { id: 'default', label: '默认', when: '' }
  ],
  fns: [
    // { id: 'list', name: '', desc: '', fields: [], empty: '', src: '' }
  ],
  render: function (c) {
    return h.m({ title: '页面标题', tab: 'home'{{tabs}}, body: '' });
  }
});
