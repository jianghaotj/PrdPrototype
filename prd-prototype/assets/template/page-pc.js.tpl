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
    // {
    //   id: 'filter', name: '', desc: '用户怎么操作、系统怎么响应',
    //   fields: [{ key: 'kw', name: '', type: '文本', required: false, rule: '' }],
    //   rules: [], errors: [], src: '需求材料 §x'
    // }
  ],
  render: function (c) {
    var body = '<div class="w"><div class="ph-h"><h1>页面标题</h1></div></div>';
    return W.ui.{{end}}('{{pid}}', body);
  }
});
