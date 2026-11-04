W.page({
  id: 'P01', end: 'pc', group: '审批', title: '待我审批',
  goal: '主管集中查看并处理直属下属的请假单，优先处理开始时间最近的单据，避免漏批。',
  entry: '审批台默认首页；企业微信“有新的请假待审批”消息直接打开对应单据的审批详情',
  perm: '直属主管；HR 账号不显示此菜单',
  states: [
    { id: 'list', label: '有待审批', when: '直属下属至少有 1 条待审批单据' },
    { id: 'empty', label: '全部处理完', when: '筛选“待审批”且没有单据' }
  ],
  fns: [
    {
      id: 'filter', name: '状态筛选与搜索',
      desc: '按状态切换列表，默认“待审批”；搜索框按申请人姓名或单号模糊匹配，输入后 300 毫秒自动查询。',
      fields: [
        { key: 'status', name: '状态', type: '枚举', required: false, options: ['待审批', '已处理', '全部'], def: '待审批', rule: '“已处理”包含已通过和已驳回；已撤回的单据不出现在主管列表 [AI 假设]' },
        { key: 'kw', name: '搜索关键词', type: '文本', required: false, rule: '匹配申请人姓名或单号，不区分大小写，最多 30 字' }
      ],
      src: '需求材料 · 痛点 2'
    },
    {
      id: 'table', name: '请假单列表',
      desc: '每页 20 条，“待审批”按开始时间**升序**（最紧急在前），其他状态按提交时间倒序。点“审批”或整行打开审批详情抽屉。',
      fields: [
        { key: 'applicant', name: '申请人', type: '文本', rule: '姓名 + 部门' },
        { key: 'type', name: '类型', type: '枚举', options: ['年假', '事假', '病假'] },
        { key: 'range', name: '请假时间', type: '文本', rule: '开始时间距今 ≤ 1 天时标红“明天开始”' },
        { key: 'days', name: '时长', type: '数字（天）', rule: '按工作日计算' },
        { key: 'submitted', name: '提交时间', type: '时间', rule: '24 小时内显示“x 小时前”，否则显示日期' },
        { key: 'status', name: '状态', type: '枚举', options: ['待审批', '已通过', '已驳回'] }
      ],
      empty: '显示“没有待审批的请假”，并提供“查看已处理”链接',
      rules: ['只显示直属下属的单据；主管本人的请假不会出现在自己的列表中'],
      src: '需求材料'
    }
  ],
  render: function (c) {
    var empty = c.st === 'empty';
    var rows = [
      ['林晓 <span class="mut2 sm">教育产品部</span>', '年假', '<span style="color:var(--err)">11/05 上午 – 11/06 下午 · 明天开始</span>', '1.5', '2 小时前', h.tag('待审批', 'warn'), h.btn('审批', { sz: 'sm', k: 'pri', go: 'P02', st: 'detail' })],
      ['张一鸣 <span class="mut2 sm">教育产品部</span>', '事假', '11/10 全天', '1', '昨天', h.tag('待审批', 'warn'), h.btn('审批', { sz: 'sm', k: 'pri', go: 'P02', st: 'detail' })],
      ['陈思远 <span class="mut2 sm">教研部</span>', '病假', '11/12 – 11/14', '3', '11/01', h.tag('待审批', 'warn'), h.btn('审批', { sz: 'sm', k: 'pri', go: 'P02', st: 'detail' })]
    ];
    var body = '<div class="w"><div class="ph-h"><div><h1>待我审批</h1><p class="mut mt4">直属下属的请假申请，开始时间越近越靠前</p></div></div>' +
      '<div class="row g12" data-fn="filter">' + h.pills(['待审批 3', '已处理', '全部'], 0, { field: 'status' }) + '<span class="ml-a"></span>' + h.search('搜索申请人或单号', { field: 'kw', style: 'width:260px' }) + '</div>' +
      '<div class="mt16" data-fn="table">' + (empty
        ? h.table(['申请人', '类型', '请假时间', '时长（天）', '提交时间', '状态', ''], [], { empty: '没有待审批的请假 · ' + h.a('查看已处理', 'P01', 'list') })
        : h.table(['申请人', '类型', '请假时间', '时长（天）', '提交时间', '状态', ''], rows, { right: [6] }) + '<div class="pager">共 3 条</div>') + '</div>' +
      '<div class="mt24">' + h.demo(h.a('看“全部处理完”', 'P01', 'empty') + ' · ' + h.a('恢复列表', 'P01', 'list')) + '</div></div>';
    return W.ui.pc('todo', body);
  }
});
