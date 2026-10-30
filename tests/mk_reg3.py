# -*- coding: utf-8 -*-
"""第 3 批（清理）的验证用例：结果列上线 + 死状态清理后回归"""
# -*- coding: utf-8 -*-
import os as _os
_TD = _os.path.dirname(_os.path.abspath(__file__))
_ROOT = _os.path.dirname(_TD)
SRC = _os.path.join(_ROOT, 'public', 'index.html')
OUT = _os.path.join(_TD, '_out', 'mk_reg3')

import io, json, os, re



TASK = "tasks"; MACH = "machines"; GH = "github"

SCHEMAS = {
    TASK: [{"name": "状态", "type": "select", "config": {"options": [{"text": "进行中"}, {"text": "已完成"}]}},
           {"name": "优先级", "type": "select", "config": {"options": [{"text": "P0"}, {"text": "P1"}, {"text": "P2"}]}}],
    MACH: [],
    GH: [{"name": "结果", "type": "select", "config": {"options": [{"text": "成功"}, {"text": "失败"}, {"text": "部分"}]}}],
}
TASKS = [
    {"_id": "t1", "任务标题": "任务一", "状态": "进行中", "优先级": "P2", "所在电脑": "台式机-家",
     "目录": "D:\\a", "进度": "进度一", "待办": "", "交接内容": "", "更新时间": "2026-10-29T01:00:00Z", "排序": 1},
]
MACHINES = [
    {"_id": "m1", "机器名": "台式机-家", "位置": "家", "排序": 1},
    {"_id": "m2", "机器名": "笔记本", "位置": "随身", "排序": 2},
]
GH_RECS = [
    {"_id": "g1", "同步时间": "2026-10-30T03:00:00Z", "电脑": "台式机-家", "GitHub账号": "Simiely",
     "仓库": "Simiely/ae-tools", "内容": "发版成功", "同步版本": "v1.5.8", "结果": "成功"},
    {"_id": "g2", "同步时间": "2026-10-29T03:00:00Z", "电脑": "台式机-家", "GitHub账号": "Simiely",
     "仓库": "Simiely/ae-tools", "内容": "推送被拒", "同步版本": "v1.5.9", "结果": "失败"},
    {"_id": "g3", "同步时间": "2026-10-28T03:00:00Z", "电脑": "笔记本", "GitHub账号": "Simiely",
     "仓库": "Simiely/ae-tools", "内容": "只推了一半", "同步版本": "v1.6.0", "结果": "部分"},
    {"_id": "g4", "同步时间": "2026-10-27T03:00:00Z", "电脑": "笔记本", "GitHub账号": "Simiely",
     "仓库": "Simiely/old-repo", "内容": "老记录没填结果", "同步版本": "v1.0.0", "结果": ""},
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
  function repoSel(name){return qa('.repo-card').filter(function(c){return c.getAttribute('data-repo')===name;})[0];}
  function closeDrawer(){var d=q('.drawer'); if(d&&d.className.indexOf('on')>=0){var c=$('closeDrawer'); if(c)c.click();}}
  function ghUpd(){return calls.filter(function(c){return c.op==='updateRecord'&&c.db==='github';});}
  function ghAdd(){return calls.filter(function(c){return c.op==='addRecord'&&c.db==='github';});}

  (async function(){
   try {
    await wait(600);

    // ---- U1 每条同步记录都带结果徽章，样式按值区分 ----
    var card=repoSel('Simiely/ae-tools');
    var rows=Array.prototype.slice.call(card.querySelectorAll('.repo-entry'));
    var res=rows.map(function(r){
      var b=r.querySelector('.re-res');
      var c=r.querySelector('.re-content');
      return {内容:c?c.textContent:'', 徽章:b?b.textContent:'(无)', 样式:b?b.className.replace('re-res','').replace(/^\s+|\s+$/g,''):''};
    });
    R.U1_result_badge={
      '记录条数': rows.length,
      '明细': res,
      '成功→ok': res.filter(function(x){return x.徽章==='成功'&&x.样式==='ok';}).length===1,
      '失败→bad': res.filter(function(x){return x.徽章==='失败'&&x.样式==='bad';}).length===1,
      '部分→part': res.filter(function(x){return x.徽章==='部分'&&x.样式==='part';}).length===1,
      '错误': errs.slice()
    };

    // ---- U2 卡片头统计失败次数；无结果的仓库不显示 ----
    var failEl=card.querySelector('.repo-fail');
    var oldCard=repoSel('Simiely/old-repo');
    var oldRow=oldCard?oldCard.querySelector('.repo-entry'):null;
    R.U2_fail_count={
      'ae-tools 失败徽章': failEl?failEl.textContent:'(无)',
      'old-repo 无失败徽章': oldCard?!oldCard.querySelector('.repo-fail'):null,
      '无结果记录不显示徽章': oldRow?(!oldRow.querySelector('.re-res')):null
    };

    // ---- U4 编辑已有记录：「部分」原值不被下拉默认值改掉（先做，避免 U3 新增把这条挤出前三）----
    calls.length=0; errs.length=0;
    var c4=repoSel('Simiely/ae-tools');
    var rows4=Array.prototype.slice.call(c4.querySelectorAll('.repo-entry'));
    var targetEntry=rows4.filter(function(r){var c=r.querySelector('.re-content');return c&&c.textContent==='只推了一半';})[0];
    var dots=targetEntry?targetEntry.querySelector('[data-gh-menu]'):null;
    if(dots) dots.click(); await wait(150);
    var editBtn=q('[data-gact="edit"]');
    if(editBtn){ editBtn.click(); await wait(250); }
    var sel2=$('gf_result');
    var showed=sel2?sel2.value:null;
    var opts2=sel2?Array.prototype.slice.call(sel2.options).map(function(o){return o.value;}):[];
    $('saveBtn').click(); await wait(350);
    var u=ghUpd();
    R.U4_edit_keeps_result={
      '找到目标记录': !!targetEntry,
      '菜单按钮存在': !!dots,
      '编辑菜单出现': !!editBtn,
      '下拉显示': showed,
      '选项': opts2,
      'updateRecord次数': u.length,
      '回写结果': u.length?JSON.stringify(u[0].props['结果']):null,
      '没被改成成功': u.length?(u[0].props['结果']||{}).select==='部分':null,
      '错误': errs.slice()
    };

    // ---- U3 新建同步记录：结果下拉存在、默认成功、能改并写入 ----
    calls.length=0; errs.length=0;
    var c3=repoSel('Simiely/ae-tools');
    var addBtn=c3.querySelector('[data-repo-add]');
    addBtn.click(); await wait(180);
    var sel=$('gf_result');
    var optTexts=sel?Array.prototype.slice.call(sel.options).map(function(o){return o.value;}):[];
    var defVal=sel?sel.value:null;
    if(sel) sel.value='失败';
    $('gf_repo').value='Simiely/ae-tools';
    $('gf_content').value='这次故意失败';
    $('saveBtn').click(); await wait(350);
    var a=ghAdd();
    R.U3_new_record_result={
      '结果下拉存在': !!sel,
      '选项来自schema': optTexts,
      '默认值': defVal,
      'addRecord次数': a.length,
      '写入结果': a.length?JSON.stringify(a[0].props['结果']):null,
      '写入的是失败': a.length?(a[0].props['结果']||{}).select==='失败':null,
      '抽屉已关': q('.drawer').className.indexOf('on')<0,
      '错误': errs.slice()
    };

    // ---- U5 清理死状态后，筛选仍然正常（按台式机-家筛：只剩 ae-tools）----
    var filter=$('ghF_machine');
    var beforeCards=qa('.repo-card').length;
    if(filter){ filter.value='台式机-家'; filter.dispatchEvent(new Event('change',{bubbles:true})); }
    await wait(250);
    var afterNames=qa('.repo-card').map(function(c){return c.getAttribute('data-repo');});
    R.U5_filter_ok={
      '筛选前仓库数': beforeCards,
      '筛选后剩下': afterNames,
      '只剩 ae-tools': afterNames.length===1&&afterNames[0]==='Simiely/ae-tools',
      '筛选值已生效': filter?filter.value:'(无筛选控件)',
      '错误': errs.slice()
    };

    // ---- U6 任务表单的状态/优先级选项仍在（readOpts 未因删除 machine 而受影响）----
    calls.length=0; errs.length=0;
    var firstCard=q('.card');
    var openBtn=firstCard?firstCard.querySelector('[data-edit-task]'):null;
    if(openBtn) openBtn.click();
    await wait(200);
    var st=$('f_status'), pr=$('f_priority');
    R.U6_task_opts={
      '状态选项': st?Array.prototype.slice.call(st.options).map(function(o){return o.value;}):null,
      '优先级选项': pr?Array.prototype.slice.call(pr.options).map(function(o){return o.value;}):null,
      '状态2项': st?st.options.length===2:null,
      '优先级3项': pr?pr.options.length===3:null,
      '错误': errs.slice()
    };
    closeDrawer();

    document.title='RESULT::'+JSON.stringify(R);
   } catch(e) {
     document.title='RESULT::'+JSON.stringify({FATAL:String(e&&e.message),DONE:R});
   }
  })();
})();
</script>"""

s = io.open(SRC, encoding='utf-8').read()
mock = MOCK % {'schemas': json.dumps(SCHEMAS, ensure_ascii=False),
               'data': json.dumps({TASK: TASKS, MACH: MACHINES, GH: GH_RECS}, ensure_ascii=False)}
s2, n = re.subn(r'var db = localDb\(\);', lambda m: mock, s, count=1)
assert n == 1, 'inject.js script tag not found'
s2 = s2.replace('</body>', TEST + '\n</body>')
if not os.path.isdir(OUT):
    os.makedirs(OUT)
io.open(os.path.join(OUT, 'b3.html'), 'w', encoding='utf-8').write(s2)
print('wrote b3.html')
