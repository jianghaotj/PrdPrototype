W.page({
  id: 'M02', end: 'm', group: '请假', title: '发起请假',
  goal: '员工填写假期类型、起止时间和事由，系统自动计算时长并校验余额，提交后进入主管审批。',
  entry: '首页“发起请假”按钮或点击某种假期余额卡片',
  states: [
    { id: 'form', label: '填写中', when: '进入页面，默认选中年假，开始时间为下一个工作日上午' },
    { id: 'err', label: '校验未通过', when: '点击“提交申请”时有必填项为空、时间不合法或余额不足' },
    { id: 'confirm', label: '确认提交', when: '校验通过后弹出确认层', layer: 'sheet' }
  ],
  fns: [
    {
      id: 'form', name: '请假信息表单',
      desc: '依次选择假期类型、开始时间、结束时间，填写事由。开始和结束时间都选好后，系统**立即**按工作日计算时长并显示在“时长”一行。',
      fields: [
        { key: 'type', name: '假期类型', type: '枚举', required: true, options: ['年假', '事假', '病假'], def: '年假；从余额卡片进入时为对应类型', rule: '余额为 0 的类型仍可选，选中后在下方提示“余额不足”' },
        { key: 'start', name: '开始时间', type: '日期 + 上午/下午', required: true, def: '下一个工作日上午', rule: '可选过去 7 天内（补请假）到未来 90 天' },
        { key: 'end', name: '结束时间', type: '日期 + 上午/下午', required: true, rule: '不早于开始时间；跨度不超过 30 个自然日' },
        { key: 'days', name: '时长', type: '数字（天）', rule: '只读，自动计算；结果为 0（如整段都在周末）时提示“所选时间都不是工作日”' },
        { key: 'reason', name: '请假事由', type: '文本', required: true, rule: '5–200 字，实时显示字数' },
        { key: 'proof', name: '证明材料', type: '图片', required: false, rule: '病假超过 2 天时变为必填；最多 3 张，单张不超过 10 MB' }
      ],
      rules: ['切换假期类型时保留已填的时间和事由', '离开页面时若已填写内容，弹出“放弃本次填写？”确认 [AI 假设]'],
      src: '需求材料 · 澄清 Q2'
    },
    {
      id: 'submit', name: '提交申请',
      desc: '点击后先做前端校验：不通过时在对应字段下方显示红字原因，并滚动到第一个错误；通过后弹出确认层。',
      rules: ['余额不足时不允许提交：事假、病假不设余额上限 [待确认]'],
      errors: ['必填项为空：字段下方提示“请填写 xx”', '时长超过可用余额：时长一行下方提示“年假可用 5 天，本次 6 天”'],
      src: '需求材料'
    },
    {
      id: 'confirm', name: '确认提交',
      desc: '底部弹层复述类型、时间、时长，并展示余额变化“可用 5 天 → 3.5 天（1.5 天冻结至审批完成）”。点“确认提交”后创建单据并进入请假详情。',
      rules: ['提交成功后通过企业微信通知直属主管', '没有直属主管的员工（如总经理）提交后自动通过 [待确认]'],
      errors: ['重复点击只提交一次：按钮进入加载状态直到返回', '提交时余额已被其他单据占用：关闭弹层，回到表单并提示最新余额', '网络失败：弹层内提示“提交失败，请重试”，保留填写内容'],
      src: '澄清 Q3'
    }
  ],
  render: function (c) {
    var err = c.st === 'err';
    var form = '<div class="card"><div class="col g16">' +
      h.fld('假期类型', h.opts(['年假', '事假', '病假'], 0, { field: 'type' }), { req: 1 }) +
      h.fld('开始时间', '<div class="row g8">' + h.inp('2026-11-05', { date: 1, field: 'start' }) + h.sel('上午', ['上午', '下午'], { field: 'start', style: 'width:96px' }) + '</div>', { req: 1 }) +
      h.fld('结束时间', '<div class="row g8">' + h.inp(err ? '' : '2026-11-06', { date: 1, e: err, bad: err, field: 'end' }) + h.sel('下午', ['上午', '下午'], { field: 'end', style: 'width:96px' }) + '</div>', { req: 1, err: err ? '请选择结束时间' : '' }) +
      '<div class="row sb" data-field="days"><span class="lbl">时长</span><b>' + (err ? '—' : '1.5 天') + '</b></div>' +
      h.fld('请假事由', h.inp(err ? '' : '家中有事需回老家处理', { area: 1, rows: 3, e: err, bad: err, field: 'reason' }), { req: 1, hint: err ? '' : '10 / 200', err: err ? '请填写请假事由（至少 5 个字）' : '' }) +
      h.fld('证明材料', '<div class="row g8"><span class="ph" style="width:64px;height:64px" data-ctl data-field="proof" data-act="toast" data-msg="演示：选择图片"><span>+</span></span></div>', { hint: '病假超过 2 天时必填' }) +
      '</div></div>';
    var over = c.st === 'confirm' ? h.sheet(
      '<div class="col g12" data-fn="confirm">' + h.kv([['假期类型', '年假'], ['请假时间', '11/05 上午 – 11/06 下午'], ['时长', '<b>1.5 天</b>']]) +
      '<div class="box fill sm">年假可用 5 天 → <b>3.5 天</b><br><span class="mut2">1.5 天冻结至审批完成，驳回或撤回后退回</span></div>' +
      '<div class="row g8 mt8">' + h.btn('返回修改', { go: 'M02', st: 'form', cls: 'f1' }) + h.btn('确认提交', { k: 'pri', go: 'M03', st: 'pending', cls: 'f1' }) + '</div></div>',
      { title: '确认提交请假' }) : '';
    return h.m({
      title: '发起请假', back: ['M01', 'list'],
      body: (err ? h.bn('err', '有 2 项需要修改') + '<div class="mt12"></div>' : '') + h.fn('form', form) +
        '<div class="mt16">' + h.demo(h.a('查看校验失败状态', 'M02', 'err') + ' · ' + h.a('恢复填写', 'M02', 'form')) + '</div>',
      foot: h.btn('提交申请', { k: 'pri', go: 'M02', st: 'confirm', fn: 'submit' }),
      over: over
    });
  }
});
