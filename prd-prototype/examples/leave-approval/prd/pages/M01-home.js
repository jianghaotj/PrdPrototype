W.page({
  id: 'M01', end: 'm', group: '请假', title: '请假首页',
  goal: '员工打开即可看到各类假期的剩余天数和最近的请假记录，并从这里发起新的请假。',
  entry: '企业微信工作台“请假”入口；首次进入自动用企业微信身份登录，无需输入账号',
  perm: '所有在职员工',
  scenarios: true,
  states: [
    { id: 'list', label: '有请假记录', when: '本人至少有 1 条请假单（任意状态）', set: 'preset=normal' },
    { id: 'empty', label: '无请假记录', when: '新员工或本年度从未请过假', set: 'preset=newbie' }
  ],
  fns: [
    {
      id: 'balance', name: '假期余额',
      desc: '展示年假、病假、事假三种假期的**可用天数**。点击某一种假期，带着该类型进入发起请假。',
      fields: [
        { key: 'left', name: '可用天数', type: '数字（天）', rule: '额度 − 已用 − 冻结中，保留 1 位小数' },
        { key: 'frozen', name: '冻结中', type: '数字（天）', rule: '大于 0 时在可用天数下方显示“另有 X 天审批中”' }
      ],
      rules: ['可用天数为 0 时数字显示为灰色，仍可点击，进入后该类型提示“余额不足”'],
      src: '需求材料 · 痛点 1'
    },
    {
      id: 'create', name: '发起请假',
      desc: '主按钮，进入发起请假页，假期类型默认选中年假。',
      src: '需求材料'
    },
    {
      id: 'records', name: '最近请假记录',
      desc: '按提交时间倒序显示本人最近 5 条请假单，点击进入请假详情。超过 5 条时底部显示“查看全部”。',
      fields: [
        { key: 'type', name: '假期类型', type: '枚举', options: ['年假', '事假', '病假'] },
        { key: 'range', name: '请假时间', type: '文本', rule: '“11/05 上午 – 11/06 下午”格式，跨年时显示年份' },
        { key: 'days', name: '时长', type: '数字（天）', rule: '按工作日计算' },
        { key: 'status', name: '状态', type: '枚举', options: ['待审批', '已通过', '已驳回', '已撤回'], rule: '待审批橙色、已通过绿色、已驳回红色、已撤回灰色' }
      ],
      empty: '显示“还没有请假记录”和“发起请假”按钮',
      rules: ['“查看全部”进入完整列表，列表页本期复用首页样式，不单独设计 [AI 假设]'],
      status: 'assumed', statusNote: '“最近 5 条 + 查看全部”是 AI 按常见做法补充的，需求材料未说明首页展示数量'
    }
  ],
  render: function (c) {
    var b = c.s.balance || {};
    var empty = c.st === 'empty' || !c.s.hasRecords;
    var cards = [['年假', b.annual, 'annual'], ['病假', b.sick, 'sick'], ['事假', b.personal, 'personal']].map(function (x) {
      return '<div class="card ctr" style="padding:12px 6px"' + h.go('M02', 'form') + '><div class="sm mut2">' + x[0] + '</div><div class="xl b mt4 ' + (x[1] ? '' : 'mut2') + '">' + x[1] + '<span class="sm mut2"> 天</span></div>' + (x[2] === 'annual' && x[1] ? '<div class="sm mut2 mt4">另有 1.5 天审批中</div>' : '') + '</div>';
    }).join('');
    var rows = [
      ['年假', '11/05 上午 – 11/06 下午', '1.5 天', h.tag('待审批', 'warn')],
      ['病假', '10/21 全天', '1 天', h.tag('已通过', 'ok')],
      ['事假', '09/30 下午', '0.5 天', h.tag('已驳回', 'err')]
    ];
    var list = empty
      ? h.list([], { fn: 'records', empty: '还没有请假记录' })
      : h.list(rows.map(function (r, i) {
        return h.li('<div class="f1"><div class="row g8"><b>' + r[0] + '</b>' + r[3] + '</div><div class="sm mut2 mt4">' + r[1] + ' · ' + r[2] + '</div></div>' + h.i('cr', 18), { go: 'M03', st: ['pending', 'approved', 'rejected'][i] });
      }), { fn: 'records' }) + '<div class="ctr mt12">' + h.a('查看全部', 'M01', 'list', '', { fn: 'records' }) + '</div>';
    return h.m({
      title: '请假', tab: 'home',
      body: h.fn('balance', '<div class="grid c3" style="gap:8px">' + cards + '</div>') +
        '<div class="mt16">' + h.btn(h.i('plus', 16) + '发起请假', { k: 'pri blk lg', go: 'M02', st: 'form', fn: 'create' }) + '</div>' +
        '<div class="card mt16" data-fn="records"><div class="card-h" style="margin-bottom:4px"><h3>最近请假</h3></div>' + list + (empty ? '<div class="mt12">' + h.btn('发起请假', { k: 'blk', go: 'M02', st: 'form', fn: 'create' }) + '</div>' : '') + '</div>'
    });
  }
});
