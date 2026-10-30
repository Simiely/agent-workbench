# -*- coding: utf-8 -*-
"""v21 回归：新增按钮合并 + AI 写入指南"""
# -*- coding: utf-8 -*-
import os as _os
_TD = _os.path.dirname(_os.path.abspath(__file__))
_ROOT = _os.path.dirname(_TD)
SRC = _os.path.join(_ROOT, 'public', 'index.html')
OUT = _os.path.join(_TD, '_out', 'mk_guide')

import io, json, os, re



TASK = "tasks"; MACH = "machines"; GH = "github"

SCHEMAS = {
    TASK: [{"name": "状态", "type": "select", "config": {"options": [{"text": "进行中"}, {"text": "已完成"}]}},
           {"name": "优先级", "type": "select", "config": {"options": [{"text": "P0"}, {"text": "P1"}, {"text": "P2"}]}}],
    MACH: [],
    GH: [{"name": "是否同步", "type": "select", "config": {"options": [{"text": "已同步"}, {"text": "未同步"}]}},
         {"name": "仓库归档", "type": "checkbox"}],
}
TASKS = [{"_id": "t1", "任务标题": "任务一", "状态": "进行中", "优先级": "P1", "所在电脑": "台式机-家",
          "目录": "", "进度": "", "待办": "", "交接内容": "", "更新时间": "2026-10-30T04:00:00Z", "排序": 1}]
MACHINES = [{"_id": "m1", "机器名": "台式机-家", "位置": "家", "WorkBuddy账号": "WB-主号", "TRAE账号": "TRAE-主号", "排序": 1},
            {"_id": "m2", "机器名": "笔记本", "位置": "随身", "WorkBuddy账号": "WB-副号", "排序": 2}]
GH_RECS = [{"_id": "g1", "同步时间": "2026-10-30T04:00:00Z", "电脑": "台式机-家", "GitHub账号": "Simiely",
            "仓库": "Simiely/ae-tools", "内容": "发布", "同步版本": "v1.5.8", "是否同步": "已同步", "仓库归档": False}]

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
  var R={},calls=window.__CALLS,errs=window.__ERRS;
  function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
  function $(id){return document.getElementById(id);}
  function q(s){return document.querySelector(s);}
  function qa(s){return Array.prototype.slice.call(document.querySelectorAll(s));}
  (async function(){
   try{
    await wait(600);

    // ---- P1 顶栏只剩一个新增按钮 ----
    R.P1_buttons={
      '新增按钮存在': !!$('addBtn'),
      '指南按钮存在': !!$('aiGuideBtn'),
      '旧新任务按钮已移除': !$('newBtn'),
      '旧记录同步按钮已移除': !$('ghAddBtn'),
      '旧加电脑按钮已移除': !$('addMachineBtn')
    };

    // ---- P2 点新增 → 菜单四项 ----
    $('addBtn').click(); await wait(150);
    var items=qa('.menu [data-add]').map(function(b){return b.getAttribute('data-add')+':'+b.textContent.trim();});
    R.P2_menu={'菜单项':items,'项数':items.length};

    // ---- P3 菜单各项动作 ----
    q('[data-add="task"]').click(); await wait(200);
    R.P3_task={'任务抽屉打开': q('.drawer').className.indexOf('on')>=0 && !!$('f_title')};
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); await wait(120);

    $('addBtn').click(); await wait(120);
    q('[data-add="gh"]').click(); await wait(200);
    R.P3_gh={'同步抽屉打开': !!$('gf_repo'),'是否同步下拉存在': !!$('gf_result')};
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); await wait(120);

    $('addBtn').click(); await wait(120);
    q('[data-add="machine"]').click(); await wait(200);
    R.P3_machine={'机器弹窗打开': !!$('m2Mask') && $('m2Mask').className.indexOf('on')>=0};
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); await wait(120);

    // ---- P4 AI 指南内容 ----
    $('aiGuideBtn').click(); await wait(250);
    var body=$('aiBody')?$('aiBody').textContent:'';
    R.P4_guide={
      '抽屉打开': $('aiDrawer').className.indexOf('on')>=0,
      '含三张表标题': body.indexOf('任务台账')>=0 && body.indexOf('机器登录态')>=0 && body.indexOf('GitHub 同步记录')>=0,
      '含关键字段': body.indexOf('任务标题')>=0 && body.indexOf('所在电脑')>=0 && body.indexOf('是否同步')>=0 && body.indexOf('仓库归档')>=0,
      '含枚举取值': body.indexOf('P0,P1,P2')>=0 && body.indexOf('进行中,已完成')>=0 && body.indexOf('已同步,未同步')>=0,
      '含必填标记': qa('#aiBody .ai-table td.req').length>0,
      '含写入约定': body.indexOf('写入约定')>=0,
      '含示例payload': body.indexOf('databaseId')>=0 && body.indexOf('任务标题')>=0,
      '含坑位提示': body.indexOf('未识别电脑')>=0,
      '表格数': qa('#aiBody .ai-table').length,
      '复制契约按钮': !!$('aiCopy'),
      '复制示例按钮': !!$('aiCopyEx')
    };

    // ---- P5 Esc 关闭指南 ----
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); await wait(150);
    R.P5_esc={'指南已关闭': $('aiDrawer').className.indexOf('on')<0};


    // ---- P6 指南里的电脑选择器 ----
    $('aiGuideBtn').click(); await wait(250);
    var sel=$('aiMachine');
    var opts=sel?Array.prototype.slice.call(sel.options).map(function(o){return o.value;}):[];
    var pre=q('#aiBody .ai-pre');
    var ex=pre?JSON.parse(pre.textContent):null;
    R.P6_picker={
      '下拉存在': !!sel,
      '选项是已登记机器': opts,
      '默认选中': sel?sel.value:null,
      '示例payload机器': ex?ex.properties['所在电脑'].text:null,
      '含机器清单表头': (($('aiBody').textContent||'').indexOf('机器名（填这个）')>=0),
      '清单含账号列': (($('aiBody').textContent||'').indexOf('WB-主号')>=0)
    };

    // ---- P7 切换机器 → 示例 payload 跟着变 ----
    if(sel && sel.options.length>1){
      sel.value=opts[1];
      sel.dispatchEvent(new Event('change',{bubbles:true}));
      await wait(250);
      var pre2=q('#aiBody .ai-pre');
      var ex2=pre2?JSON.parse(pre2.textContent):null;
      R.P7_switch={'切换后示例机器': ex2?ex2.properties['所在电脑'].text:null,'与所选一致': ex2?ex2.properties['所在电脑'].text===opts[1]:null};
    } else { R.P7_switch={'跳过':'只有一台机器'}; }

    R.P_errs=errs.slice();
    document.title='RESULT::'+JSON.stringify(R);
   }catch(e){document.title='RESULT::'+JSON.stringify({FATAL:String(e&&e.message),DONE:R});}
  })();
})();
</script>"""

s = io.open(SRC, encoding='utf-8').read()
mock = MOCK % {'schemas': json.dumps(SCHEMAS, ensure_ascii=False),
               'data': json.dumps({TASK: TASKS, MACH: MACHINES, GH: GH_RECS}, ensure_ascii=False)}
s2, n = re.subn(r'var db = localDb\(\);', lambda m: mock, s, count=1)
assert n == 1
s2 = s2.replace('</body>', TEST + '\n</body>')
if not os.path.isdir(OUT):
    os.makedirs(OUT)
io.open(os.path.join(OUT, 'p.html'), 'w', encoding='utf-8').write(s2)
print('wrote p.html')
