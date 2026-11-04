W.page({
  id: 'P02', end: 'pc', group: '审批', title: '审批详情',
  goal: '主管在不离开列表的情况下查看单据和申请人本年度请假情况，做出通过或驳回。',
  entry: '待我审批列表的“审批”按钮；企业微信消息直达',
  perm: '该单据申请人的直属主管',
  states: [
    { id: 'detail', label: '查看详情', when: '打开一条待审批单据', layer: 'drawer' },
    { id: 'reject', label: '填写驳回原因', when: '点击“驳回”', layer: 'modal' }
  ],
  fns: [
    {
      id: 'summary', name: '申请信息',
      desc: '展示申请人、部门、假期类型、请假时间、时长、事由和证明材料。',
      fields: [
        { key: 'days', name: '时长', type: '数字（天）', rule: '同员工端，提交时固定' },
        { key: 'proof', name: '证明材料', type: '图片', rule: '点击放大预览；病假超过 2 天必有' }
      ],
      src: '需求材料'
    },
    {
      id: 'history', name: '申请人本年度请假',
      desc: '列出申请人本年度已通过的请假汇总（按类型合计天数）和年假剩余，帮助主管判断是否批准。',
      fields: [
        { key: 'sum', name: '已请天数', type: '数字（天）', rule: '本自然年内已通过的单据合计，按类型分别统计' },
        { key: 'left', name: '年假剩余', type: '数字（天）', rule: '扣除本单冻结后的可用天数' }
      ],
      status: 'assumed', statusNote: '需求材料没有提到主管需要看历史记录，这是 AI 为“辅助判断”补充的，评审确认是否保留'
    },
    {
      id: 'decide', name: '通过 / 驳回',
      desc: '“通过”直接生效并扣减余额；“驳回”弹出原因填写框。处理后抽屉关闭，列表中该单据移出“待审批”。',
      rules: ['单据开始时间已过仍可审批，通过后按原时间计入考勤', '主管不能修改单据内容，只能通过或驳回'],
      errors: ['员工已撤回：提示“申请人已撤回此单据”，刷新列表', '已被处理（如在手机端处理过）：提示“该单据已处理”，显示处理结果', '网络失败：提示“操作失败，请重试”，抽屉保持打开'],
      src: '需求材料 · 澄清 Q1'
    },
    {
      id: 'reject-form', name: '驳回原因',
      desc: '驳回必须填写原因，原因会随通知发给员工。',
      fields: [
        { key: 'reason', name: '驳回原因', type: '文本', required: true, rule: '2–100 字；提供 3 个常用原因快捷填入：“时间冲突，请调整”“请补充证明材料”“请先与我当面沟通”' }
      ],
      errors: ['原因为空时“确认驳回”按钮不可点', '提交失败时保留已填原因并提示重试'],
      src: '需求材料'
    }
  ],
  render: function (c) {
    var bg = W.pages.P01.render({ st: 'list', s: c.s, p: W.pages.P01 });
    var drawer = h.drawer('请假审批 · QJ202611030012',
      '<div data-fn="summary"><div class="row g12"><span class="ava l">林</span><div><b class="lg">林晓</b><div class="sm mut2">教育产品部 · 直属主管：王经理</div></div></div>' +
      '<div class="mt16">' + h.kv([['假期类型', '年假'], ['请假时间', '11/05 上午 – 11/06 下午'], ['时长', '<b>1.5 天</b>'], ['事由', '家中有事需回老家处理'], ['证明材料', '无']]) + '</div></div>' +
      '<div class="box fill mt16" data-fn="history"><div class="b md">本年度已请</div><div class="row g24 mt8 md"><span>年假 3 天</span><span>病假 1 天</span><span>事假 0.5 天</span></div><div class="sm mut2 mt8">年假剩余 3.5 天（已扣除本单）</div></div>',
      '<div class="row g10" data-fn="decide">' + h.btn('驳回', { k: 'red', go: 'P02', st: 'reject' }) + h.btn('通过', { k: 'pri', go: 'P01', st: 'list' }) + '</div>',
      { close: ['P01', 'list'] });
    var modal = c.st === 'reject' ? h.modal('驳回请假',
      '<div class="col g12 mt8">' + h.fld('驳回原因', h.inp('11/05 有项目评审，请改到下周', { area: 1, rows: 3, field: 'reason' }), { req: 1, hint: '员工会在通知中看到原因' }) +
      '<div class="row g8 wr">' + ['时间冲突，请调整', '请补充证明材料', '请先与我当面沟通'].map(function (t) { return '<span class="pill" data-act="toast" data-msg="演示：填入“' + t + '”">' + t + '</span>'; }).join('') + '</div></div>',
      h.btn('取消', { go: 'P02', st: 'detail' }) + h.btn('确认驳回', { k: 'pri red', go: 'P01', st: 'list' }), { fn: 'reject-form', w: 480 }) : '';
    return bg.replace(/<\/div>$/, drawer + modal + '</div>');
  }
});
