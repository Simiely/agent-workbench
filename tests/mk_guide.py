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
          "目录": "D:\\task-one", "进度": "做了一半", "待办": "[x] 已完成的一条\n[ ] 未完成的一条",
          "交接内容": "", "更新时间": "2026-10-30T04:00:00Z", "排序": 1},
         {"_id": "t2", "任务标题": "任务二", "状态": "已完成", "优先级": "P2", "所在电脑": "台式机-家",
          "目录": "", "进度": "做完了", "待办": "[x] 收尾项一\n[x] 收尾项二",
          "交接内容": "", "更新时间": "2026-10-28T04:00:00Z", "排序": 2}]
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
  // 捕获「复制提示词」真正复制出去的文本：aiBody 只显示说明+骨架预览，
  // 卡片规范在复制文本里，断言必须对着复制文本判
  var __CAP='';
  (function(){
    if(!navigator.clipboard) Object.defineProperty(navigator,'clipboard',{value:{},configurable:true});
    navigator.clipboard.writeText=function(t){ __CAP=t||''; return Promise.resolve(); };
  })();
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
      '含格式示例': body.indexOf('## 任务（新建）')>=0 && body.indexOf('## 任务（更新）')>=0 && body.indexOf('## 同步（新建）')>=0,
      '含导入键名映射': body.indexOf('标题=任务标题')>=0 && body.indexOf('仓库')>=0,
      '不含JSONpayload': body.indexOf('"properties"')<0 && body.indexOf('databaseId')<0,
      '含现状骨架': body.indexOf('工作台现状')>=0 && body.indexOf('已有任务')>=0 && body.indexOf('电脑（')>=0,
      '含坑位提示': body.indexOf('未识别电脑')>=0,
      '表格数': qa('#aiBody .ai-table').length,
      '复制提示词按钮': !!$('aiCopy'),
      '复制格式示例按钮': !!$('aiCopyEx')
    };

    // ---- P5 Esc 关闭指南 ----
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); await wait(150);
    R.P5_esc={'指南已关闭': $('aiDrawer').className.indexOf('on')<0};


    // ---- P6 现状骨架：给 AI 看的框架数据 ----
    $('aiGuideBtn').click(); await wait(250);
    var pres=qa('#aiBody .ai-pre');
    var outline=pres.length?pres[0].textContent:'';
    R.P6_outline={
      '骨架块存在': outline.length>0,
      '含电脑数': /电脑（\d+ 台）/.test(outline),
      '含任务计数': /已有任务 \d+ 条/.test(outline),
      '含任务行': /\u00b7 .+ \uff5c /.test(outline),
      '含仓库行': outline.indexOf('GitHub 仓库')>=0,
      '含机器清单表头': (($('aiBody').textContent||'').indexOf('机器名（填这个）')>=0),
      '清单含账号列': (($('aiBody').textContent||'').indexOf('WB-')>=0),
      '含电脑登录态': /WB:.+\/ TRAE:/.test(outline),
      '含账号池': outline.indexOf('账号池')>=0,
      // 契约一致性：卡片规范只声明两种主线卡片（用户明确要求「只有两种卡片」）。
      // 注意 outline 只是「现状骨架」那一段，卡片规范在整份文本里，要用 aiBody 全文判。
      '卡片规范只声明两种主线卡片': (function(){
        __CAP='';
        var b=$('aiQuickCopy'); if(b) b.click();
        var c=__CAP;
        // 标题实际是「### 卡片：任务（新建） 或 任务（更新）」
        return /### 卡片：任务（新建）/.test(c) && /### 卡片：同步（新建）/.test(c)
          && !/### 卡片：账号/.test(c);
      })(),
      // 语义分离：WB/TRAE 是登录账号，同步记录的「账号」必须是 GitHub 账号，
      // 两者不能被同一份「账号池」文案混着说（会把 WB-主号 填进 GitHub 账号列）
      '登录账号与GitHub账号分开列': outline.indexOf('机器登录账号')>=0 && outline.indexOf('GitHub 账号')>=0,
      '含更新时间': /\d+ (分钟|小时|天|个月)前更新/.test(outline),
      '含目录': outline.indexOf('目录：')>=0,
      '含待办原文': /\[x\] /.test(outline) || /\[ \] /.test(outline),
      '含仓库级属性': outline.indexOf('已置顶')>=0 || outline.indexOf('已归档')>=0 || outline.indexOf('电脑：')>=0,
      '含任务编号': /· #\S+ /.test(outline),
      '编号是卡片id非序号': (function(){
        // 位置序号（纯数字）会因增删位移；必须是卡片 id
        var m=outline.match(/· #(\S+) /g)||[], i, allNum=true;
        if(!m.length) return false;
        for(i=0;i<m.length;i++){
          var idv=m[i].replace(/· #/,'').trim();
          if(!/^\d+$/.test(idv)) allNum=false;
        }
        return !allNum;
      })(),
      '已完成任务也有待办原文': (function(){
        // 只在「· #id 标题 ｜ 已完成」这种任务行之后找待办行；
        // 汇总行「已有任务 N 条（进行中 x / 已完成 y）」里也有「已完成」三字，会骗过判定
        var lines=outline.split('\n'), i, j, found=false, checked=false;
        for(i=0;i<lines.length;i++){
          if(!/^\s*· #\S+ /.test(lines[i])) continue;
          if(!/已完成/.test(lines[i])) continue;
          checked=true;
          for(j=i+1;j<Math.min(i+6,lines.length);j++){
            if(/^\s*· #\S+ /.test(lines[j])) break;
            if(/待办 \d+\/\d+：/.test(lines[j])) found=true;
          }
        }
        return checked && found;
      })()
    };

    // ---- P7 批量导入：粘贴 → 解析预览 ----
    var mname=(window.DATA&&DATA.machines&&DATA.machines[0])?DATA.machines[0]['机器名']:'台式机-家';
    $('impBtn').click(); await wait(250);
    var ta=$('impText');
    var hasTa=!!ta;
    if(ta){
      ta.value=[
        '## 任务（新建）','标题：导入解析测试','电脑：'+mname,'时间：2026-11-02 09:15','待办：','[ ] 第一步','',
        '## 同步（新建）','仓库：Simiely/x','电脑：'+mname,'版本：v1.0','置顶：是','归档：否','',
        '## 电脑（新建）','机器名：断言用测试机','位置：书房','',
        '## 账号（新建）','账号名：断言用测试号','平台：WorkBuddy','电脑：'+mname,'当前：否','',
        '## 任务（新建）','标题：坏电脑测试','电脑：不存在的机器','',
        '## 任务（新建）','标题：坏时间测试','电脑：'+mname,'时间：上个月某个时候'
      ].join('\n');
      ta.dispatchEvent(new Event('input',{bubbles:true}));
      $('impParse').click(); await wait(300);
    }
    var pitems=qa('.imp-item');
    R.P7_import={
      '弹窗打开': $('impDrawer').className.indexOf('on')>=0,
      '有输入框': hasTa,
      '预览条数': pitems.length,
      '首条新建': pitems.length?(pitems[0].querySelector('.imp-act')||{}).textContent:null,
      '首条标题': pitems.length?(pitems[0].querySelector('.imp-title')||{}).textContent:null,
      '有被拦下的坏块': pitems.length?(pitems[pitems.length-1].className.indexOf('bad')>=0):null,
      '有写入按钮': !!$('impApply'),
      '块数': pitems.length,
      '正常块类型': (function(){
        var kinds={};
        for(var i=0;i<pitems.length;i++){
          if(pitems[i].className.indexOf('bad')>=0) continue;
          var s=(pitems[i].querySelector('.imp-sub')||{}).textContent||'';
          kinds[s.split(' · ')[0]]=1;
        }
        return Object.keys(kinds).sort().join(',');
      })(),
      '坏块原因': (function(){
        var bad=[];
        for(var i=0;i<pitems.length;i++){
          if(pitems[i].className.indexOf('bad')>=0){
            bad.push((pitems[i].querySelector('.imp-sub')||{}).textContent||'');
          }
        }
        return bad.join(' | ');
      })()
    };

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
