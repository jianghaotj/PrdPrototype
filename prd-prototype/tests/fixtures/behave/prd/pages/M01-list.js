W.page({
  id: 'M01', end: 'm', group: '请假', title: '请假列表',
  goal: '员工查看自己已提交的请假单，并可按单号或事由搜索。',
  entry: '应用首页',
  states: [
    { id: 'list', label: '列表', when: '进入页面时，演示数据中已有请假单' }
  ],
  fns: [
    {
      id: 'search', name: '搜索请假单',
      desc: '在搜索框输入文字，列表即时筛选；没有匹配的请假单时显示“没有匹配的结果”。',
      fields: [{ key: 'kw', name: '关键词', type: '文本', required: false, rule: '按单号或事由做包含匹配，不区分大小写' }],
      src: '夹具'
    },
    {
      id: 'create', name: '新建请假',
      desc: '点击“新建请假”进入发起页面。',
      src: '夹具'
    }
  ],
  render: function (c) {
    var rows = (c.s.list.items || []).map(function (x) {
      return '<div class="li"><b>' + h.esc(x.no) + '</b><span class="mut2"> ' + h.esc(x.type) + ' · ' + h.esc(x.reason) + '</span></div>';
    });
    return h.m({
      title: '请假列表',
      body: '<div class="col g12">' +
        h.fn('search', h.search('搜索单号或事由', { fn: 'search', field: 'kw', filter: 'list' })) +
        h.rows('list', rows, { fn: 'search', nomatch: '换个单号或事由试试', empty: h.empty('暂无请假单', '点击下方按钮发起请假') }) +
        '</div>',
      foot: h.btn('新建请假', { k: 'pri', go: 'M02', st: 'form', fn: 'create' })
    });
  }
});
