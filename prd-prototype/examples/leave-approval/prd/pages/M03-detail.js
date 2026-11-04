W.page({
  id: 'M03', end: 'm', group: '请假', title: '请假详情',
  goal: '员工查看单据当前状态和审批进度；待审批时可以撤回。',
  entry: '首页请假记录、提交成功后自动进入、企业微信审批结果通知',
  states: [
    { id: 'pending', label: '待审批', when: '提交后、主管处理前' },
    { id: 'approved', label: '已通过', when: '主管点击“通过”后' },
    { id: 'rejected', label: '已驳回', when: '主管填写原因并驳回后' },
    { id: 'withdraw', label: '撤回确认', when: '待审批状态下点击“撤回申请”', layer: 'alert' }
  ],
  fns: [
    {
      id: 'info', name: '单据信息',
      desc: '展示单号、假期类型、请假时间、时长、事由和证明材料。证明材料点击可全屏预览。',
      fields: [
        { key: 'no', name: '单号', type: '文本', rule: '见数据字典“请假单.单号”' },
        { key: 'days', name: '时长', type: '数字（天）', rule: '提交时计算并固定，之后节假日表变化不重算 [AI 假设]', status: 'assumed' }
      ],
      src: '需求材料'
    },
    {
      id: 'progress', name: '审批进度',
      desc: '时间线展示“提交 → 主管审批”两个节点，每个节点显示处理人和时间；驳回时显示驳回原因。',
      fields: [
        { key: 'approver', name: '审批人', type: '文本', rule: '提交时的直属主管；主管变更后，待审批单据**不**自动转给新主管 [待确认]', status: 'pending' },
        { key: 'reason', name: '驳回原因', type: '文本', rule: '仅已驳回时显示，原文展示主管填写内容' }
      ],
      src: '需求材料'
    },
    {
      id: 'withdraw', name: '撤回申请',
      desc: '仅**待审批**状态显示。点击后弹出确认框，确认后单据变为“已撤回”，冻结的余额立即退回。',
      rules: ['已通过的单据不能撤回，需要销假时线下找 HR 处理（本期不做销假）'],
      errors: ['主管已在此期间处理：提示“单据已被审批，无法撤回”，并刷新为最新状态', '网络失败：提示“撤回失败，请重试”，单据状态不变'],
      src: '澄清 Q3'
    },
    {
      id: 'again', name: '重新发起',
      desc: '已驳回时显示，进入发起请假并**带入原单据的类型、时间和事由**，员工修改后作为新单据提交。',
      status: 'assumed', statusNote: '需求材料只写了“驳回后员工可以重新申请”，是否带入原内容是 AI 的建议'
    }
  ],
  render: function (c) {
    var st = c.st === 'withdraw' ? 'pending' : c.st;
    var tag = { pending: h.tag('待审批', 'warn'), approved: h.tag('已通过', 'ok'), rejected: h.tag('已驳回', 'err') }[st];
    var info = '<div class="card" data-fn="info"><div class="row sb"><b class="lg">年假 1.5 天</b>' + tag + '</div><div class="mt12">' + h.kv([['单号', 'QJ202611030012'], ['请假时间', '11/05 上午 – 11/06 下午'], ['事由', '家中有事需回老家处理'], ['证明材料', '无']]) + '</div></div>';
    var node2 = st === 'pending' ? '<div class="li top"><span class="dot warn" style="margin-top:7px"></span><div class="f1"><b>王经理 审批中</b><div class="sm mut2">已等待 2 小时</div></div></div>'
      : st === 'approved' ? '<div class="li top"><span class="dot ok" style="margin-top:7px"></span><div class="f1"><b>王经理 已通过</b><div class="sm mut2">11/03 15:20</div></div></div>'
        : '<div class="li top"><span class="dot err" style="margin-top:7px"></span><div class="f1"><b>王经理 已驳回</b><div class="sm mut2">11/03 15:20</div><div class="box fill sm mt8">驳回原因：11/05 有项目评审，请改到下周</div></div></div>';
    var prog = '<div class="card mt12" data-fn="progress"><h3>审批进度</h3><div class="list mt8"><div class="li top"><span class="dot ok" style="margin-top:7px"></span><div class="f1"><b>林晓 提交申请</b><div class="sm mut2">11/03 13:05</div></div></div>' + node2 + '</div></div>';
    var foot = st === 'pending' ? h.btn('撤回申请', { k: 'red', go: 'M03', st: 'withdraw', fn: 'withdraw' })
      : st === 'rejected' ? h.btn('重新发起', { k: 'pri', go: 'M02', st: 'form', fn: 'again' }) : '';
    var over = c.st === 'withdraw' ? h.alert('撤回后单据作废，冻结的 1.5 天年假将退回。确定撤回？', '<a' + h.go('M03', 'pending') + '>取消</a><a' + h.go('M01', 'list') + '>撤回</a>', { fn: 'withdraw' }) : '';
    return h.m({ title: '请假详情', back: ['M01', 'list'], body: info + prog, foot: foot, over: over });
  }
});
