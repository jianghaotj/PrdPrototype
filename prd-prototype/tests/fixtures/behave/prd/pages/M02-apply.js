W.page({
  id: 'M02', end: 'm', group: '请假', title: '发起请假', scenarios: true,
  goal: '员工填写请假事由并提交申请。事由必填且 5–200 字，不通过时不能提交。',
  entry: '请假列表的“新建请假”',
  states: [
    { id: 'form', label: '填写中', when: '进入页面，事由为空' }
  ],
  fns: [
    {
      id: 'form', name: '请假表单',
      desc: '填写请假事由。事由为必填，长度 5–200 字。',
      fields: [{ key: 'reason', name: '请假事由', type: '文本', required: true, rule: '5–200 字' }],
      src: '夹具'
    },
    {
      id: 'submit', name: '提交申请',
      desc: '点击后先校验，通过则提交并回到列表；成功时列表新增一条，失败时保留已填内容，可重试。',
      errors: ['必填或长度不通过：不发出请求，字段下方提示原因', '提交失败：保留已填内容，提示后可重试'],
      src: '夹具'
    }
  ],
  render: function (c) {
    return h.m({
      title: '发起请假', back: ['M01', 'list'],
      body: h.form(
        h.fld('请假事由', h.inp('', { area: 1, rows: 3, field: 'reason', fn: 'form' }), { req: 1, min: 5, max: 200, fn: 'form', field: 'reason' }),
        { id: 'leave', fn: 'form' }
      ),
      foot: h.submit('提交申请', { form: 'leave', fn: 'submit', ok: { go: 'M01', st: 'list' }, append: 'list.items', appendName: '请假列表', appendDefaults: { no: '新申请', type: '事假' } })
    });
  }
});
