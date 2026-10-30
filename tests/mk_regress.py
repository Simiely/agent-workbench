# -*- coding: utf-8 -*-
"""对修复后的页面跑同一套回归用例"""
# -*- coding: utf-8 -*-
import os as _os
_TD = _os.path.dirname(_os.path.abspath(__file__))
_ROOT = _os.path.dirname(_TD)
SRC = _os.path.join(_ROOT, 'public', 'index.html')
OUT = _os.path.join(_TD, '_out', 'mk_regress')

import io, json, os, re



TASK="tasks"; MACH="machines"; GH="github"

SCHEMAS = {
    TASK: [{"name":"状态","type":"select","config":{"options":[{"text":"进行中"},{"text":"已完成"}]}},
           {"name":"优先级","type":"select","config":{"options":[{"text":"P0"},{"text":"P1"},{"text":"P2"}]}}],
    MACH: [], GH: [],
}
TASKS = [
    {"_id":"t1","任务标题":"任务一","状态":"进行中","优先级":"P2","所在电脑":"台式机-家",
     "目录":"D:\\a","进度":"进度一","待办":"[ ] 甲\n[ ] 乙","交接内容":"","更新时间":"2026-10-29T01:00:00Z","排序":1},
    {"_id":"t2","任务标题":"任务二","状态":"进行中","优先级":"P0","所在电脑":"台式机-家",
     "目录":"D:\\b","进度":"进度二","待办":"","交接内容":"","更新时间":"2026-10-30T01:00:00Z","排序":2},
    {"_id":"t4","任务标题":"幽灵机上的任务","状态":"进行中","优先级":"P1","所在电脑":"幽灵机",
     "目录":"D:\\d","进度":"x","待办":"","交接内容":"","更新时间":"2026-10-27T01:00:00Z","排序":1},
    {"_id":"t5","任务标题":"已完成的任务","状态":"已完成","优先级":"P1","所在电脑":"台式机-家",
     "目录":"D:\\e","进度":"y","待办":"","交接内容":"","更新时间":"2026-10-26T01:00:00Z","排序":3},
]
MACHINES = [
    {"_id":"m1","机器名":"台式机-家","位置":"家","WorkBuddy账号":"WB-主号","排序":1},
    {"_id":"m2","机器名":"笔记本","位置":"随身","WorkBuddy账号":"WB-副号","排序":2},
]
GH_RECS = [
    {"_id":"g1","同步时间":"2026-10-30T00:20:00Z","电脑":"台式机-家","GitHub账号":"Simiely",
     "仓库":"Simiely/ae-tools","内容":"测试记录","同步版本":"v1.0.0","结果":"成功"},
]

MOCK = """window.__CALLS=[]; window.__ERRS=[];
window.addEventListener('error', function(e){ window.__ERRS.push('onerror: '+e.message); });
window.SCHEMAS=%(schemas)s; window.DATA=%(data)s; window.__nextId=1;
var db = {
  getSchema:function(o){return Promise.resolve({properties:(window.SCHEMAS[o.databaseId]||[])});},
  query:function(o){return Promise.resolve({results:(window.DATA[o.databaseId]||[]),hasMore:false,nextCursor:null});},
  addRecord:function(p){window.__CALLS.push({op:'addRecord',db:p.databaseId,props:JSON.parse(JSON.stringify(p.properties))});return Promise.resolve({id:'new'+(window.__nextId++)});},
  updateRecord:function(p){window.__CALLS.push({op:'updateRecord',db:p.databaseId,id:p.recordId,props:JSON.parse(JSON.stringify(p.properties))});return Promise.resolve({});},
  deleteRecord:function(p){window.__CALLS.push({op:'deleteRecord',db:p.databaseId,id:p.recordId});return Promise.resolve({});}
};
"""

TEST = r"""<script>
(function(){
  var out=[], calls=window.__CALLS, errs=window.__ERRS;
  function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
  function $(id){return document.getElementById(id);}
  function q(s){return document.querySelector(s);}
  function qa(s){return Array.prototype.slice.call(document.querySelectorAll(s));}
  function fire(el,t){el.dispatchEvent(new Event(t,{bubbles:true}));}
  function close(){var d=q('.drawer'); if(d&&d.className.indexOf('on')>=0){var c=$('closeDrawer'); if(c)c.click();}}
  function cards(){return qa('.card .c-title').map(function(x){return x.textContent;});}
  function colOf(name){
    var col=qa('.col').filter(function(c){var n=c.querySelector('.ch-name');return n&&n.textContent===name;})[0];
    return col?Array.prototype.slice.call(col.querySelectorAll('.card .c-title')).map(function(x){return x.textContent;}):null;
  }
  var R={};

  (async function(){
    try {
    await wait(500);

    // A. 新建同步记录能否保存
    calls.length=0; errs.length=0;
    $('addBtn').click(); await wait(100); q('[data-add=\"gh\"]').click(); await wait(80);
    var hasFTitle = !!$('f_title');
    $('gf_repo').value='Test/new-repo'; $('gf_account').value='Simiely';
    $('gf_versions').value='v9.9.9'; $('gf_content').value='新建记录测试';
    $('saveBtn').click(); await wait(250);
    var add=calls.filter(function(c){return c.op==='addRecord';});
    R.A_gh_new_save={
      '抽屉不含f_title': !hasFTitle,
      'addRecord次数': add.length,
      '写入目标库正确': add.length ? (add[0].db==='github') : false,
      '写入仓库': add.length ? (add[0].props['仓库']||{}).text : null,
      '抽屉已关闭': q('.drawer').className.indexOf('on')<0,
      '错误': errs.slice()
    };
    close(); await wait(60);

    // B. 同步记录抽屉 Ctrl+Enter
    calls.length=0; errs.length=0;
    q('[data-gh-menu]').click(); await wait(80);
    var eb=q('[data-gact="edit"]'); if(eb) eb.click(); await wait(100);
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true}));
    await wait(250);
    var upd=calls.filter(function(c){return c.op==='updateRecord';});
    R.B_gh_ctrl_enter={
      'updateRecord次数': upd.length,
      '目标库正确': upd.length ? (upd[0].db==='github') : false,
      '误走任务库': upd.length ? (upd[0].db==='tasks') : null,
      '错误': errs.slice()
    };
    close(); await wait(60);

    // G. 草稿不被同步表单冲掉
    try{localStorage.removeItem('awb.taskdraft');}catch(e){}
    $('addBtn').click(); await wait(100); q('[data-add="task"]').click(); await wait(160);
    $('f_title').value='我的新任务草稿'; fire($('f_title'),'input'); await wait(450);
    close(); await wait(60);
    $('addBtn').click(); await wait(100); q('[data-add=\"gh\"]').click(); await wait(80);
    $('gf_content').value='随便打点字'; fire($('gf_content'),'input'); await wait(450);
    close(); await wait(60);
    var raw=null; try{raw=localStorage.getItem('awb.taskdraft');}catch(e){}
    $('addBtn').click(); await wait(100); q('[data-add="task"]').click(); await wait(160);
    var restored=$('f_title')?$('f_title').value:null;
    close(); await wait(60);
    R.G_draft={
      '草稿内容': raw,
      '重开后的标题': restored,
      '草稿保住了': restored==='我的新任务草稿'
    };

    // D. 保存任务后排序是否保持
    calls.length=0; errs.length=0;
    var before=colOf('台式机-家');
    var card=qa('.card').filter(function(c){var t=c.querySelector('.c-title');return t&&t.textContent==='任务一';})[0];
    card.querySelector('[data-edit-task]').click(); await wait(120);
    $('saveBtn').click(); await wait(350);
    var after=colOf('台式机-家');
    R.D_order={
      '保存前': before, '保存后': after,
      '顺序保持': JSON.stringify(before)===JSON.stringify(after)
    };

    // E. 幽灵机任务是否出现在兜底列
    var orphanCol = colOf('未识别电脑');
    var ghostCard = qa('.card').filter(function(c){var t=c.querySelector('.c-title');return t&&t.textContent==='幽灵机上的任务';})[0];
    R.E_orphan={
      '兜底列内容': orphanCol,
      '任务可见': !!ghostCard
    };

    // F. 打开幽灵机任务后保存，是否被静默改电脑
    calls.length=0; errs.length=0;
    if (ghostCard) {
      ghostCard.querySelector('[data-edit-task]').click(); await wait(120);
      var opts=qa('#f_machine option').map(function(o){return o.value+':'+o.textContent;});
      var shown=$('f_machine').value;
      $('f_progress').value='只改进度';          // 触发一次真实提交
      $('saveBtn').click(); await wait(350);
      var u=calls.filter(function(c){return c.op==='updateRecord'&&c.db==='tasks';});
      var keys=u.length?Object.keys(u[0].props):[];
      R.F_ghost={
        '下拉选项': opts,
        '显示值': shown,
        '提交字段': keys,
        '所在电脑未被改动': keys.indexOf('所在电脑')<0,
        '提交了进度': keys.indexOf('进度')>=0,
        '错误': errs.slice()
      };
    }

    // H. 已完成视图：KPI 卡片点击 = 切换分段（不再是弹窗）；搜索空态
    var qq=$('q'); qq.value='zzz不可能匹配zzz'; fire(qq,'input'); await wait(150);
    q('#summary .kpi[data-k="done"]').click(); await wait(150);
    R.H_done_empty={
      '分段切到已完成': (function(){var b=document.querySelector('#segTabs button.on');return b?b.textContent.trim():''})()==='已完成',
      '分段按钮高亮': (function(){var b=document.querySelector('#segTabs button.on');return b?b.textContent.trim():''})()==='已完成',
      '无弹窗元素': !document.getElementById('doneModal') && !document.getElementById('doneList'),
      '看板空态': /无匹配|暂无任务/.test($('board').textContent),
      '错误': errs.slice()
    };
    qq.value=''; fire(qq,'input'); await wait(120);
    // 回到进行中视图，别影响后续断言
    q('#segTabs button[data-s="进行中"]').click(); await wait(150);
    R.H_back_doing={'分段':(function(){var b=document.querySelector('#segTabs button.on');return b?b.textContent.trim():''})(),'已完成卡不在看板': qa('#board .card.done').length===0};

    // C. 重命名电脑后任务是否还在
    calls.length=0; errs.length=0;
    var b2=cards().length;
    var el=q('[data-edit="machineName"][data-id="m1"]');
    el.click(); await wait(80);
    var inp=q('.inline-input'); inp.value='台式机-家-改名后';
    inp.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    await wait(600);
    var a2=cards().length;
    R.C_rename={
      '改名后列名': qa('.col .ch-name').map(function(x){return x.textContent;}),
      '卡片数 前': b2, '卡片数 后': a2,
      '卡片未丢失': b2===a2,
      '错误': errs.slice()
    };

    // I. 同步记录「结果」字段是否仍然不提交（已知死字段）
    R.I_note = '见报告：结果列仍为死字段（第 3 批处理）';

    document.title='RESULT::'+JSON.stringify(R);
    } catch(e) {
      document.title='RESULT::'+JSON.stringify({FATAL: String(e && e.message), STACK: String(e && e.stack).slice(0,400), DONE: R});
    }
  })();
})();
</script>"""

NOMACH = r"""<script>
(function(){
  function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
  function $(id){return document.getElementById(id);}
  function q(s){return document.querySelector(s);}
  function qa(s){return Array.prototype.slice.call(document.querySelectorAll(s));}
  (async function(){
    await wait(500);
    var callsBefore=window.__CALLS.length;
    $('addBtn').click(); await wait(100); q('[data-add="task"]').click(); await wait(220);
    var drawerOpen=document.querySelector('.drawer').className.indexOf('on')>=0;
    var toastEl=$('toast');
    var toastTxt=toastEl?toastEl.textContent:'';
    var add=window.__CALLS.filter(function(c){return c.op==='addRecord';});
    document.title='RESULT::'+JSON.stringify({
      '无电脑时点击新任务-抽屉是否打开': drawerOpen,
      '提示文案': toastTxt,
      'addRecord调用次数': add.length,
      '结论': (!drawerOpen && add.length===0) ? '已拦截' : '未拦截'
    });
  })();
})();
</script>"""

def build(name, tasks, machines, gh, tail):
    s = io.open(SRC, encoding='utf-8').read()
    mock = MOCK % {'schemas': json.dumps(SCHEMAS, ensure_ascii=False),
                   'data': json.dumps({TASK:tasks,MACH:machines,GH:gh}, ensure_ascii=False)}
    s2, n = re.subn(r'var db = localDb\(\);', lambda m: mock, s, count=1)
    assert n == 1
    s2 = s2.replace('</body>', tail + '\n</body>')
    if not os.path.isdir(OUT): os.makedirs(OUT)
    io.open(os.path.join(OUT,name),'w',encoding='utf-8').write(s2)
    print('wrote', name)

build('r_main.html', TASKS, MACHINES, GH_RECS, TEST)
build('r_nomach.html', [], [], [], NOMACH)
