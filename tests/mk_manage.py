# -*- coding: utf-8 -*-
"""管理模式回归：批量选择/完成/优先级/移动/删除 + GitHub 批量同步状态"""
# -*- coding: utf-8 -*-
import os as _os
_TD = _os.path.dirname(_os.path.abspath(__file__))
_ROOT = _os.path.dirname(_TD)
SRC = _os.path.join(_ROOT, 'public', 'index.html')
OUT = _os.path.join(_TD, '_out', 'mk_manage')

import io, json, os, re



TASK = "tasks"; MACH = "machines"; GH = "github"

SCHEMAS = {
    TASK: [{"name": "状态", "type": "select", "config": {"options": [{"text": "进行中"}, {"text": "已完成"}]}},
           {"name": "优先级", "type": "select", "config": {"options": [{"text": "P0"}, {"text": "P1"}, {"text": "P2"}]}}],
    MACH: [],
    GH: [{"name": "是否同步", "type": "select", "config": {"options": [{"text": "已同步"}, {"text": "未同步"}]}},
         {"name": "仓库归档", "type": "checkbox"}],
}
NOW = "2026-10-30T04:00:00Z"
D9 = "2026-10-21T04:00:00Z"
TASKS = [
    {"_id": "t1", "任务标题": "ae-tools 发布联调", "状态": "进行中", "优先级": "P2", "所在电脑": "台式机-家",
     "目录": "", "进度": "x", "待办": "", "交接内容": "", "更新时间": D9, "排序": 1},
    {"_id": "t2", "任务标题": "LoginStateSwitcher 维护", "状态": "进行中", "优先级": "P0", "所在电脑": "台式机-家",
     "目录": "", "进度": "", "待办": "", "交接内容": "", "更新时间": NOW, "排序": 2},
    {"_id": "t3", "任务标题": "AOD 定制", "状态": "已完成", "优先级": "P2", "所在电脑": "笔记本",
     "目录": "", "进度": "完成", "待办": "", "交接内容": "", "更新时间": NOW, "排序": 1},
]
MACHINES = [
    {"_id": "m1", "机器名": "台式机-家", "位置": "家", "排序": 1},
    {"_id": "m2", "机器名": "笔记本", "位置": "随身", "排序": 2},
]
GH_RECS = [
    {"_id": "g1", "同步时间": NOW, "电脑": "台式机-家", "GitHub账号": "Simiely", "仓库": "Simiely/ae-tools",
     "内容": "发布", "同步版本": "v1.5.8", "是否同步": "已同步", "仓库归档": False},
    {"_id": "g2", "同步时间": "2026-10-29T04:00:00Z", "电脑": "台式机-家", "GitHub账号": "Simiely", "仓库": "Simiely/ae-tools",
     "内容": "本地攒着", "同步版本": "v1.5.9", "是否同步": "未同步", "仓库归档": False},
    {"_id": "g3", "同步时间": "2026-10-28T04:00:00Z", "电脑": "笔记本", "GitHub账号": "Simiely", "仓库": "Simiely/knowledge-base",
     "内容": "定稿归档", "同步版本": "v1.0.0", "是否同步": "已同步", "仓库归档": True},
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
  var R={}, calls=window.__CALLS, errs=window.__ERRS;
  function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
  function $(id){return document.getElementById(id);}
  function q(s){return document.querySelector(s);}
  function qa(s){return Array.prototype.slice.call(document.querySelectorAll(s));}
  function cardOf(title){return qa('.card').filter(function(c){var t=c.querySelector('.c-title');return t&&t.textContent===title;})[0];}
  function entryOf(n){return qa('.repo-entry').filter(function(e){return e.querySelector('.re-ver').textContent===n;})[0];}
  function tCalls(){return calls.filter(function(c){return c.op==='updateRecord'&&c.db==='tasks';});}
  function gCalls(){return calls.filter(function(c){return c.op==='updateRecord'&&c.db==='github';});}

  (async function(){
   try {
    await wait(550);

    // ---- M1 进入管理模式 ----
    $('manageBtn').click(); await wait(200);
    R.M1_enter={
      'body类': document.body.className.indexOf('manage')>=0,
      '按钮高亮': $('manageBtn').className.indexOf('on')>=0,
      '选择框显示': qa('.sel-box').length?getComputedStyle(qa('.sel-box')[0]).display==='grid':false,
      '操作栏显示': $('manageBar').style.display!=='none',
      '计数初始': $('mCount').textContent
    };

    // ---- M2 选择两张卡 → 批量完成 ----
    calls.length=0; errs.length=0;
    cardOf('ae-tools 发布联调').click(); await wait(80);
    cardOf('LoginStateSwitcher 维护').click(); await wait(80);
    R.M2_select={
      '计数': $('mCount').textContent,
      '任务操作组显示': $('mTaskActs').style.display!=='none',
      '卡片高亮': cardOf('ae-tools 发布联调').className.indexOf('sel')>=0
    };
    q('[data-mb="done"]').click(); await wait(350);
    var ts=tCalls();
    R.M2_select['批量完成写入次数']=ts.length;
    R.M2_select['写入状态']=ts.length?ts.map(function(c){return (c.props['状态']||{}).select;}):null;
    R.M2_select['同时更新时间']=ts.length?ts.every(function(c){return c.props['更新时间'];}):null;
    R.M2_select['完成后离开默认看板']=!cardOf('ae-tools 发布联调')&&!cardOf('LoginStateSwitcher 维护');

    // ---- M3 单选 → 移动到（菜单）----
    calls.length=0;
    R._s='M3-seg'; q('#segTabs button[data-s="全部"]').click(); await wait(150);
    R._s='M3-card'; cardOf('AOD 定制').click(); await wait(80);
    R._s='M3-move'; q('[data-mb="move"]').click(); await wait(120);
    R._s='M3-menu'; var mvBtn=q('[data-sel-move]');
    R.M3_move={'菜单出现': !!mvBtn};
    R._s='M3-menuclick'; if(mvBtn){ mvBtn.click(); await wait(300);
      R.M3_move['写入所在电脑']=tCalls().length?tCalls()[0].props['所在电脑']:null;
      R.M3_move['选择已清空']=$('mCount').textContent;
    }

    // ---- M4 单选 → 优先级菜单 ----
    calls.length=0;
    R._s='M4-card'; cardOf('AOD 定制').click(); await wait(80);
    R._s='M4-prio'; q('[data-mb="prio"]').click(); await wait(120);
    var prBtn=q('[data-sel-prio]');
    R._s='M4-menuclick'; if(prBtn){ prBtn.click(); await wait(300); }
    R.M4_prio={'写入优先级': tCalls().length?tCalls()[0].props['优先级']:null};

    // ---- M5 批量删除（带确认）----
    calls.length=0;
    R._s='M5-card'; cardOf('AOD 定制').click(); await wait(80);
    R._s='M5-del'; q('[data-mb="del-tasks"]').click(); await wait(150);
    var confirmed=q('#cModal, #confirmModal, .modal.on');
    R._s='M5-ok'; var okBtn=q('#cOk');
    R.M5_del={'确认框出现': !!okBtn};
    R._s='M5-okclick'; if(okBtn){ okBtn.click(); await wait(350);
      var dels=calls.filter(function(c){return c.op==='deleteRecord';});
      R.M5_del['删除调用']=dels.length;
      R.M5_del['目标库']=dels.length?dels[0].db:null;
    }

    // ---- M6 GitHub 批量：标未同步 + 删除 ----
    calls.length=0;
    R._s='M6-e1'; entryOf('v1.5.8').click(); await wait(80);
    R._s='M6-e2'; entryOf('v1.0.0').click(); await wait(80);
    R.M6_gh={'计数': $('mCount').textContent, '记录组显示': $('mGhActs').style.display!=='none'};
    R._s='M6-unsync'; q('[data-mb="unsynced"]').click(); await wait(350);
    var gs=gCalls();
    R.M6_gh['标未同步次数']=gs.length;
    R.M6_gh['写入值']=gs.length?gs.map(function(c){return (c.props['是否同步']||{}).select;}):null;
    calls.length=0;
    R._s='M6-resel'; entryOf('v1.5.8').click(); entryOf('v1.0.0').click(); await wait(100);
    R._s='M6-delgh'; q('[data-mb="del-gh"]').click(); await wait(150);
    R._s='M6-ok'; var ok2=q('#cOk');
    R._s='M6-okclick'; if(ok2){ ok2.click(); await wait(350); }
    R.M6_gh['gh删除调用']=calls.filter(function(c){return c.op==='deleteRecord'&&c.db==='github';}).length;

    // ---- M7 退出管理：清空选择、操作栏隐藏；再进入计数归零 ----
    R._s='M7-exit'; q('[data-mb="exit"]').click(); await wait(150);
    var exitState={
      'body类移除': document.body.className.indexOf('manage')<0,
      '操作栏隐藏': $('manageBar').style.display==='none'
    };
    R._s='M7-reenter'; $('manageBtn').click(); await wait(150);
    exitState['重新进入计数归零']=$('mCount').textContent;
    R._s='M7-exit2'; $('manageBtn').click(); await wait(100); // 退出，保持干净
    R.M7_exit=exitState;


    // ---- M8 删除电脑（该电脑下有任务）→ 任务移到「未识别电脑」，电脑真删掉 ----
    calls.length=0; errs.length=0;
    var mdots=qa('.col [data-machine-menu]')[0];
    if(mdots) mdots.click(); await wait(150);
    var delM=q('[data-mact="delete"]');
    R.M8_del_machine={'机器菜单出现':!!delM};
    if(delM){
      delM.click(); await wait(200);
      var okM=q('#cOk');
      R.M8_del_machine['确认框出现']=!!okM;
      R.M8_del_machine['确认文案']=q('#cText')?q('#cText').textContent.slice(0,60):null;
      if(okM){
        okM.click(); await wait(400);
        R.M8_del_machine['机器删除调用']=calls.filter(function(c){return c.op==='deleteRecord'&&c.db==='machines';}).length;
        R.M8_del_machine['剩余机器列']=qa('.col:not(.col-orphan)').length;
        R.M8_del_machine['孤儿列存在']=!!q('.col-orphan');
        R.M8_del_machine['孤儿列任务数']=qa('.col-orphan .card').length;
      }
    }

    // ---- M9 管理模式删整个仓库 ----
    calls.length=0; errs.length=0;
    $('manageBtn').click(); await wait(200);
    var repoBtn=q('[data-mb="del-repo"]');
    R.M9_del_repo={'整仓按钮出现':!!repoBtn};
    if(repoBtn){
      repoBtn.click(); await wait(200);
      var okR=q('#cOk');
      R.M9_del_repo['确认框出现']=!!okR;
      R.M9_del_repo['确认文案']=q('#cText')?q('#cText').textContent.slice(0,60):null;
      if(okR){
        okR.click(); await wait(450);
        R.M9_del_repo['删除记录数']=calls.filter(function(c){return c.op==='deleteRecord'&&c.db==='github';}).length;
        R.M9_del_repo['剩余仓库卡']=qa('#ghList .repo-card').length;
      }
    }
    $('manageBtn').click(); await wait(120);

    R.M_errs=errs.slice();
    document.title='RESULT::'+JSON.stringify(R);
   } catch(e) {
     document.title='RESULT::'+JSON.stringify({FATAL:String(e&&e.message),STEP:R._s||'?',DONE:R});
   }
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
io.open(os.path.join(OUT, 'm.html'), 'w', encoding='utf-8').write(s2)
print('wrote m.html')
