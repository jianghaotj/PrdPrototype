/* 项目公共组件：教务管理台顶部导航登记为公共功能点，页面调用 W.ui.pc(当前页面ID, 内容, { over })。 */
(function () {
  var h = W.h;

  W.shared({
    id: 'pc-shell', end: 'pc', title: '教务管理台 顶部导航',
    fns: [
      {
        id: 'pc-nav', name: '顶部导航与账号菜单',
        desc: '顶部只有“课程管理”一项，点击回到课程列表。右侧账号菜单可退出登录；样例中点击只弹出演示提示，不真正退出。',
        rules: ['本样例只有“课程管理”一个菜单，其他教务模块不在范围内 [AI 假设]'],
        status: 'assumed', statusNote: '导航结构与账号菜单是 AI 补充的，需求材料没有写明教务台的菜单'
      }
    ]
  });

  W.ui = {
    pc: function (active, body, o) {
      o = o || {};
      return h.app({
        brand: '教务管理台', fn: 'pc-nav', home: ['P01', 'list'], active: active,
        nav: [{ key: 'P01', label: '课程管理', go: 'P01', st: 'list' }],
        right: h.menu('<span class="row g8"><span class="ava">王</span>王老师</span>', [{ label: '退出登录', act: 'toast', msg: '演示：退出登录' }]),
        body: body, over: o.over
      });
    }
  };
})();
