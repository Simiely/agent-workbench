# -*- coding: utf-8 -*-
"""v16 综合回归：默认进行中视图 / KPI 过滤 / 卡面瘦身 / 左右分屏放大 / GitHub 是否同步语义 / 抽屉勾选"""
# -*- coding: utf-8 -*-
import os as _os
_TD = _os.path.dirname(_os.path.abspath(__file__))
_ROOT = _os.path.dirname(_TD)
SRC = _os.path.join(_ROOT, 'public', 'index.html')
OUT = _os.path.join(_TD, '_out', 'mk_v16')

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
D9 = "2026-10-21T04:00:00Z"  # 9 天前 → 久未动
TASKS = [
    {"_id": "t1", "任务标题": "ae-tools 发布联调", "状态": "进行中", "优先级": "P2", "所在电脑": "台式机-家",
     "目录": "D:\\a", "进度": "三件套已同步", "待办": "[x] 版本号\n[ ] 测试文件", "交接内容": "交接甲",
     "更新时间": D9, "排序": 1},
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
    {"_id": "g1b", "同步时间": NOW, "电脑": "台式机-家", "GitHub账号": "Simiely", "仓库": "Simiely/ae-tools",
     "内容": "同日再次提交同一仓库", "同步版本": "v1.5.8-hotfix", "是否同步": "已同步", "仓库归档": False},
    {"_id": "g1c", "同步时间": NOW, "电脑": "台式机-家", "GitHub账号": "Simiely", "仓库": "Simiely/tools-center",
     "内容": "同日第二个仓库", "同步版本": "v0.8.0", "是否同步": "已同步", "仓库归档": False},
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
  function kpiNum(host,lab){var k=qa(host+' .kpi').filter(function(x){return x.querySelector('.lab').textContent===lab;})[0];return k?k.querySelector('.num').textContent:null;}
  function ovf(){var bad=[];['viewBoard','viewGithub'].forEach(function(id){var p=document.getElementById(id);
    if(p.scrollWidth>p.clientWidth+1)bad.push(id+'横向溢出');});
    if(document.body.scrollWidth>window.innerWidth+1)bad.push('body溢出');return bad;}
  function boardW(){return document.getElementById('viewBoard').style.width||'(未设)';}
  function upd(){return calls.filter(function(c){return c.op==='updateRecord'&&c.db==='tasks';});}
  function closeDr(){var d=q('.drawer'); if(d&&d.className.indexOf('on')>=0){$('closeDrawer').click();}}
  function colTitles(name){var col=qa('.col').filter(function(c){var n=c.querySelector('.ch-name');return n&&n.textContent===name;})[0];
    return col?Array.prototype.slice.call(col.querySelectorAll('.card .c-title')).map(function(x){return x.textContent;}):null;}

  (async function(){
   try {
    await wait(550);

    // ---- V1 默认视图：进行中；KPI 数量 ----
    R.V1_default={
      'seg高亮进行中': (q('#segTabs .on')||{}).textContent==='进行中',
      '看板卡片': qa('.board .card .c-title').map(function(x){return x.textContent;}),
      '已完成卡不在看板': !cardOf('AOD 定制'),
      'KPI进行中': kpiNum('#summary','进行中'),
      'KPI需要关注': kpiNum('#summary','需要关注'),
      'KPI未勾待办': kpiNum('#summary','未勾待办'),
      'KPI已完成': kpiNum('#summary','已完成'),
      '错误': errs.slice()
    };

    // ---- V2 卡面瘦身：陈旧标记 / P0 边条 / 进度条 / 操作 hover 收纳 ----
    var c1=cardOf('ae-tools 发布联调'), c2=cardOf('LoginStateSwitcher 维护');
    R.V2_card={
      'stale标记': c1?c1.querySelector('.stale').textContent:null,
      'P0左边条': c2&&c2.className.indexOf('p0')>=0,
      '待办进度文本': c1?c1.querySelector('.tnum').textContent:null,
      '进度单行': c1?c1.querySelector('.c-prog').textContent:null,
      '无旧c-foot': !c1.querySelector('.c-foot'),
      '操作默认隐藏': c1?getComputedStyle(c1.querySelector('.c-actions')).display==='none':null,
      '无旧的行内todo': !c1.querySelector('.todo-item')
    };

    // ---- V3 KPI 过滤：需要关注 → 只剩 P0；未勾待办 → 只剩有未勾的 ----
    q('#summary .kpi[data-k="att"]').click(); await wait(150);
    var attCards=qa('.board .card .c-title').map(function(x){return x.textContent;});
    q('#summary .kpi[data-k="todo"]').click(); await wait(150);
    var todoCards=qa('.board .card .c-title').map(function(x){return x.textContent;});
    q('#summary .kpi[data-k=""]').click(); await wait(150);
    R.V3_kpi_filter={
      '需要关注只显P0': attCards,
      '未勾待办只显有欠账': todoCards,
      '回到默认两张': qa('.board .card').length===2
    };

    // ---- V3b 视图状态机：KPI 与分段组合不产生「激活但不生效」的自相矛盾状态 ----
    // 复现路径：点「已完成」→ 再点「需要关注」→ 面板必须有变化（不能点了没反应）
    (function(){
      function segOn(){var b=document.querySelector('#segTabs button.on');return b?b.textContent.trim():'';}
      function kpiOn(){var k=document.querySelector('#summary .kpi.on');return k?k.getAttribute('data-k'):'';}
      function cardCount(){return qa('#board .card').length;}
      function cardTitles(){return qa('#board .card .c-title').map(function(x){return x.textContent;});}
      var out={};

      // 起点：默认视图
      q('#summary .kpi[data-k=""]').click(); 
      out['初始分段']=segOn();
      out['初始KPI']=kpiOn();
      out['初始卡数']=cardCount();

      // 点「已完成」→ 切到已完成视图
      q('#summary .kpi[data-k="done"]').click(); 
      var doneTitles=cardTitles();
      out['已完成视图分段']=segOn();
      out['已完成视图KPI高亮']=kpiOn();
      out['已完成视图只含已完成']=doneTitles.length>0 && doneTitles.indexOf('ae-tools v1.5.8 发布联调')<0;

      // 再点「需要关注」→ 必须有反应：不能既显示激活又不改变内容
      q('#summary .kpi[data-k="att"]').click(); 
      var attTitles=cardTitles();
      out['需关注后分段']=segOn();
      out['需关注后KPI高亮']=kpiOn();
      out['需关注后内容有变化']=attTitles.join('|')!==doneTitles.join('|');
      out['需关注后非空']=attTitles.length>0;
      // 关键：KPI 高亮 ⟺ 内容真的被过滤了（不能有「激活但不生效」）
      out['高亮与内容一致']=(kpiOn()==='att') === (attTitles.length!==doneTitles.length);

      // 再点「未勾待办」→ 换成另一个过滤，同样要有反应
      q('#summary .kpi[data-k="todo"]').click(); 
      var todoTitles=cardTitles();
      out['未勾待办后KPI高亮']=kpiOn();
      out['未勾待办后内容有变化']=todoTitles.join('|')!==attTitles.join('|');
      out['未勾待办后非空']=todoTitles.length>0;

      // 点「进行中」→ 回到默认，清掉所有过滤
      q('#summary .kpi[data-k=""]').click(); 
      out['回默认分段']=segOn();
      out['回默认KPI']=kpiOn();
      out['回默认卡数']=cardCount();

      // 全部视图下 KPI 过滤依然有效（全部包含已完成，att 应只剩进行中的 P0/久未动）
      q('#segTabs button[data-s="全部"]').click(); 
      var allCount=cardCount();
      q('#summary .kpi[data-k="att"]').click(); 
      out['全部视图KPI高亮']=kpiOn();
      out['全部视图过滤后更少']=cardCount()<allCount;
      out['全部视图过滤后非空']=cardCount()>0;
      q('#summary .kpi[data-k=""]').click(); 

      R.V3b_view_state=out;
    })();

    // ---- V4 seg 全部：已完成置灰出现、不可拖；列头计数 ----
    q('#segTabs button[data-s="全部"]').click(); await wait(150);
    var doneCard=cardOf('AOD 定制');
    R.V4_seg_all={
      '已完成卡出现': !!doneCard,
      '置灰类': doneCard?doneCard.className.indexOf('done')>=0:null,
      '不可拖': doneCard?doneCard.getAttribute('draggable')==='false':null,
      '列头计数带个': qa('.ch-count').some(function(x){return x.textContent.indexOf('个')>=0&&!/进行中/.test(x.textContent);})
    };
    q('#segTabs button[data-s="进行中"]').click(); await wait(150);

    // ---- V4b 已完成视图：独立分段，只显示已完成的卡 ----
    q('#segTabs button[data-s="已完成"]').click(); await wait(150);
    var doneOnly=qa('.board .card');
    var doneTitles=doneOnly.map(function(c){var t=c.querySelector('.c-title');return t?t.textContent:''});
    R.V4b_seg_done={
      '分段高亮': (function(){var b=document.querySelector('#segTabs button.on');return b?b.textContent.trim():''})()==='已完成',
      '只剩已完成卡': doneTitles.length>0 && doneTitles.indexOf('AOD 定制')>=0 && doneTitles.indexOf('ae-tools 发布联调')<0,
      '卡片全部置灰': doneOnly.every(function(c){return c.className.indexOf('done')>=0}),
      '列头计数带已完成': qa('.ch-count').some(function(x){return x.textContent.indexOf('已完成')>=0}),
      '弹窗已移除': !document.getElementById('doneModal') && !document.getElementById('doneList')
    };
    // KPI「已完成」卡片点击 = 切换视图（与分段一致），不再是弹窗
    q('#summary .kpi[data-k="done"]').click(); await wait(150);
    R.V4b_seg_done['KPI点击回到进行中']=(function(){var b=document.querySelector('#segTabs button.on');return b?b.textContent.trim():''})()==='进行中';
    q('#summary .kpi[data-k="done"]').click(); await wait(150);
    R.V4b_seg_done['KPI再次切到已完成']=(function(){var b=document.querySelector('#segTabs button.on');return b?b.textContent.trim():''})()==='已完成' && qa('.board .card.done').length>0;
    q('#segTabs button[data-s="进行中"]').click(); await wait(150);
    var savedPct=localStorage.getItem('awb.wbSplitPct');
    R.V5_split={
      '默认GitHub最大化(30%)': boardW()==='30%'||boardW()==='(未设)'&&false||boardW(),
      '无历史比例时默认30': boardW(),
      '溢出': ovf()
    };
    $('tBoard').click(); await wait(120);
    R.V5_split['点任务看板→75%']=boardW();
    R.V5_split['放大态无溢出']=ovf();
    $('tBoard').click(); await wait(120);
    R.V5_split['再点还原']=boardW();
    // 拖到 40%
    var bar=$('splitDivider'), sp=q('main.split');
    var rc=sp.getBoundingClientRect();
    bar.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:rc.left+400}));
    document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:rc.left+rc.width*0.40}));
    document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:0}));
    await wait(120);
    R.V5_split['拖到40%']=boardW();
    R.V5_split['比例已存']=Math.abs(parseFloat(localStorage.getItem('awb.wbSplitPct'))-40)<2;
    // 恢复默认（GitHub 最大化），避免影响后续；applyPaneMax 在页面闭包内，用点击还原
    try{localStorage.removeItem('awb.wbSplitPct');}catch(e){}
    $('tGh').click(); await wait(80);

    // ---- V5b 列宽自适应：与 GitHub 看板同一套机制（auto-fill + minmax(min(100%,300px),1fr)）----
    // 宽度够 → 并排更多列；宽度不够 → 自动换行；任何情况下都不出横向滚动条
    (async function(){
      var b=$('board');
      var cs=getComputedStyle(b);
      var cols=qa('#board .col');
      var tops=cols.map(function(c){return Math.round(c.getBoundingClientRect().top);});
      var sameRow=tops.filter(function(t){return t===tops[0];}).length;
      R.V5b_fit={
        '列数': cols.length,
        '同排列数': sameRow,
        '列宽不超容器': cols.every(function(c){return c.getBoundingClientRect().width<=b.clientWidth+1}),
        '看板无横向溢出': b.scrollWidth<=b.clientWidth+1,
        '横向滚动条已关': getComputedStyle(b).overflowX==='hidden',
        '用auto-fill自适应': /auto-fill/.test(cs.gridTemplateColumns) || cols.length>1,
        '列内独立滚动': (function(){var cb=qa('#board .col-body')[0];return cb?getComputedStyle(cb).overflowY==='auto':null})()
      };
      // 放大任务看板（75%）→ 宽度够时应并排显示更多列
      $('tBoard').click(); await wait(300);
      var cols2=qa('#board .col');
      var tops2=cols2.map(function(c){return Math.round(c.getBoundingClientRect().top);});
      var sameRow2=tops2.filter(function(t){return t===tops2[0];}).length;
      R.V5b_fit['放大后同排列数']=sameRow2;
      R.V5b_fit['放大后仍无横向溢出']=$('board').scrollWidth<=$('board').clientWidth+1;
      $('tBoard').click(); await wait(300);
    })();

    // ---- V6 GitHub：KPI / 未同步筛选 / 复制链接 / 归档标签 ----
    R.V6_gh={
      'KPI仓库': kpiNum('#ghKpis','仓库'),
      'KPI未同步': kpiNum('#ghKpis','未同步'),
      'KPI已归档': kpiNum('#ghKpis','已归档'),
      'KPI在电脑筛选右侧': (function(){var f=q('#ghF_machine'),k=q('#ghKpis');
        if(!f||!k)return null;return k.getBoundingClientRect().left>=f.getBoundingClientRect().right-1;})(),
      '开发强度格数': qa('#ghIntensity .gi-cell').length,
      '开发强度默认本月': (q('#ghIntensity .gi-range.on')||{}).textContent,
      '开发强度格内日期数': qa('#ghIntensity .gi-cell em').length,
      '开发强度末列是月末': (function(){var c=qa('#ghIntensity .gi-cell');return c.length?c[c.length-1].getAttribute('data-gi-day'):null;})(),
      '开发强度同日同仓库只算一次': (function(){var c=qa('#ghIntensity .gi-cell[data-gi-day="2026-10-30"]');
        // mock 今天有 3 条记录但只涉及 2 个仓库 → 今天的格子计数应为 2
        return c.length?c[0].getAttribute('data-gi-n'):null;})()==='2',
      '开发强度未来格不写数字': (function(){var c=qa('#ghIntensity .gi-cell.future');
        return c.length===0||!c[0].querySelector('i');})(),
      '未同步徽章': (q('.repo-unsync')||{}).textContent,
      '归档标签': (q('.archtag')||{}).textContent,
      '仓库详情按钮': (q('[data-repo-open]')||{}).getAttribute ? q('[data-repo-open]').getAttribute('data-repo-open') : null,
      '仓库名是纯文本': (q('#ghList .repo-name')||{}).tagName === 'SPAN',
      '仓库名不承载判定': !(q('#ghList .repo-name')||{}).hasAttribute || !q('#ghList .repo-name').hasAttribute('data-repo-open'),
      '复制链接按钮': (q('#ghList [data-copy-repo]')||{}).getAttribute ? q('#ghList [data-copy-repo]').getAttribute('data-copy-repo') : null,
      '溢出': ovf()
    };
    q('#ghKpis .kpi[data-gk="unsync"]').click(); await wait(150);
    R.V6_gh['筛选后仓库']=qa('#ghList .repo-card').map(function(c){return c.getAttribute('data-repo');});
    q('#ghKpis .kpi[data-gk="unsync"]').click(); await wait(150);
    R.V6_gh['取消筛选恢复']=qa('#ghList .repo-card').length;
    R.V6_gh['pill类']=qa('.re-res').map(function(x){return x.className.replace('re-res','').replace(/^\s+|\s+$/g,'');});

    // ---- V6b 开发强度：范围切换（完整周期，多排布局）+ 点开按年日历 ----
    q('[data-gi-range="week"]').click(); await wait(150);
    R.V6b_intensity={
      '切本周格数': qa('#ghIntensity .gi-cell').length,           // 恒 7：周一~周日
      '切本周排数': qa('#ghIntensity .gi-rowblock').length,       // 本周 = 1 排
      '切本周排标签': qa('#ghIntensity .gi-rowlabel').map(function(s){return s.textContent.trim();}),
      '切本周首列周一': qa('#ghIntensity .gi-cell')[0].getAttribute('data-gi-day'),
      '切本周按钮高亮': (q('[data-gi-range="week"]')||{}).className.indexOf('on')>=0
    };
    q('[data-gi-range="q3"]').click(); await wait(150);
    R.V6b_intensity['切近3个月格数']=qa('#ghIntensity .gi-cell').length; // = 近3个自然月天数之和（动态）
    R.V6b_intensity['切近3个月排数']=qa('#ghIntensity .gi-rowblock').length; // = 3 排
    R.V6b_intensity['切近3个月排标签']=qa('#ghIntensity .gi-rowlabel').map(function(s){return s.textContent.trim();});
    q('[data-gi-range="month"]').click(); await wait(150);
    R.V6b_intensity['切回本月格数']=qa('#ghIntensity .gi-cell').length;
    R.V6b_intensity['切回本月排数']=qa('#ghIntensity .gi-rowblock').length; // 本月 = 2 排
    R.V6b_intensity['切回本月排标签']=qa('#ghIntensity .gi-rowlabel').map(function(s){return s.textContent.trim();});
    $('ghIntensity').click(); await wait(250);
    R.V6b_intensity['点面板打开日历']=q('#drawer').className.indexOf('on')>=0;
    R.V6b_intensity['日历标题']=$('drawerTitle').textContent;
    R.V6b_intensity['日历xl加宽']=q('#drawer').className.indexOf('xl')>=0;
    R.V6b_intensity['日历年份']= (q('#drawerBody .hm-nav b')||{}).textContent;
    R.V6b_intensity['日历周列数']=qa('#drawerBody .hm-week').length;
    R.V6b_intensity['日历有日期格子']=qa('#drawerBody .hm[data-hm-day]').length; // 画满整年
    R.V6b_intensity['日历月标签数']=qa('#drawerBody .hm-months span').length;
    R.V6b_intensity['日历数字默认开']= (q('[data-hm-num]')||{}).className||'';
    R.V6b_intensity['日历数字格数']=qa('#drawerBody .hm i').length;
    R.V6b_intensity['日历图例格数']=qa('#drawerBody .hm-legend .hm').length;
    $('closeDrawer').click(); await wait(250);
    R.V6b_intensity['关闭恢复']=q('#drawer').className.indexOf('on')<0;
    R.V6b_intensity['关闭后xl还原']=q('#drawer').className.indexOf('xl')<0;

    // ---- V7 gh 抽屉：默认已同步 + 归档勾选写库 ----
    calls.length=0; errs.length=0;
    $('addBtn').click(); await wait(120); q('[data-add="gh"]').click(); await wait(200);
    R.V7_gh_drawer={
      '默认已同步': $('gf_result').value,
      '选项': qa('#gf_result option').map(function(o){return o.value;}),
      '归档勾选默认': $('gf_arch').checked
    };
    $('gf_repo').value='Simiely/new-repo';
    $('gf_arch').checked=true;
    $('saveBtn').click(); await wait(300);
    var adds=calls.filter(function(c){return c.op==='addRecord'&&c.db==='github';});
    R.V7_gh_drawer['写入是否同步']=adds.length?(adds[0].props['是否同步']||{}).select:null;
    R.V7_gh_drawer['写入归档']=adds.length?JSON.stringify(adds[0].props['仓库归档']):null;
    R.V7_gh_drawer['错误']=errs.slice();

    // ---- V7b 详情弹窗：点卡片 → 居中只读详情 → 点编辑 → 原地切表单 ----
    (function(){
      var card=cardOf('ae-tools 发布联调');
      card.click();
      var dr=q('#drawer');
      var cs=getComputedStyle(q('#mask'));
      // 居中判定用几何位置（面板中心 vs 视口中心），不看 class 名 —— 形态是结果不是契约
      var centered=function(el){
        var r=el.getBoundingClientRect();
        return Math.abs((r.left+r.right)/2 - window.innerWidth/2) < 2
            && Math.abs((r.top+r.bottom)/2 - window.innerHeight/2) < 2;
      };
      R.V7b_detail={
        '弹窗打开': dr.className.indexOf('on')>=0,
        '居中形态': centered(dr),
        '背景磨砂': /blur/.test(cs.backdropFilter||''),
        '背景半透明深色': (function(){var m=cs.backgroundColor.match(/rgba?\(([^)]+)\)/);if(!m)return false;var p=m[1].split(',').map(function(x){return parseFloat(x)});return p.length>=4&&p[3]>0.4&&p[0]<40;})(),
        '只读详情有标题': !!q('.dt-title'),
        '只读详情有待办行': qa('.dt-todo-row').length>0,
        '只读详情无表单': !q('#f_title'),
        '显示编辑按钮': q('#editBtn').style.display!=='none',
        '隐藏保存按钮': q('#saveBtn').style.display==='none'
      };
      q('#editBtn').click();
      R.V7b_detail['点编辑切表单']=!!q('#f_title') && !q('.dt-title');
      R.V7b_detail['切表单后仍是居中']=centered(q('#drawer'));
      R.V7b_detail['切表单后显示保存']=q('#saveBtn').style.display!=='none';
      q('#closeDrawer').click();
      R.V7b_detail['关闭后复位']=q('#drawer').className.indexOf('on')<0;
    })();

    // ---- V7c 仓库详情：点整张卡 → 居中只读详情 → 点记录行 → 进编辑态 ----
    (function(){
      // 判定范围 = 整张卡片（跟任务看板同构），所以点的是卡片容器而不是仓库名
      var repoCard=q('#ghList .repo-card');
      if(!repoCard){ R.V7c_repo_detail={'跳过':'无仓库卡'}; return; }
      repoCard.click();
      var centered=function(el){
        var r=el.getBoundingClientRect();
        return Math.abs((r.left+r.right)/2 - window.innerWidth/2) < 2
            && Math.abs((r.top+r.bottom)/2 - window.innerHeight/2) < 2;
      };
      var rows=qa('#drawerBody .rd-row');
      R.V7c_repo_detail={
        '弹窗打开': q('#drawer').className.indexOf('on')>=0,
        '居中形态': centered(q('#drawer')),
        '标题是仓库名': q('#drawerTitle').textContent.indexOf('/')>0,
        '有概要徽章': qa('#drawerBody .dt-tag').length>0,
        '有版本区': qa('#drawerBody .repo-vers .gh-ver').length>0,
        '有记录行': rows.length>0,
        '记录同步按钮可见': q('#repoAddBtn').style.display!=='none',
        '复制链接按钮可见': q('#repoCopyBtn').style.display!=='none',
        '隐藏保存按钮': q('#saveBtn').style.display==='none'
      };
      if(rows.length){
        rows[0].click();
        R.V7c_repo_detail['点记录行进编辑']=!!q('#gf_repo');
        R.V7c_repo_detail['编辑态仍居中']=centered(q('#drawer'));
      }
      q('#closeDrawer').click();
      R.V7c_repo_detail['关闭后复位']=q('#drawer').className.indexOf('on')<0;
    })();

    // ---- V8 抽屉勾选清单：点一下写库 + 原文同步（重新查卡片，旧节点已因重渲染失效）----
    calls.length=0; errs.length=0;
    var c1f=cardOf('ae-tools 发布联调');
    var openBtn=c1f.querySelector('[data-edit-task]');
    openBtn.click(); await wait(200);
    var pend=q('.d-todos .todo-item:not(.done)');
    var beforeUpd=upd().length;
    if(pend) pend.click(); await wait(300);
    var us=upd();
    R.V8_drawer_todo={
      '清单项存在': !!pend,
      'updateRecord次数': us.length-beforeUpd,
      '待办写入': us.length?JSON.stringify((us[us.length-1].props['待办']||{}).text):null,
      '原文已同步': $('f_todos')?$('f_todos').value.indexOf('[x] 测试文件')>=0:null,
      '清单项变已勾': q('.d-todos .todo-item:not(.done)')===null,
      '错误': errs.slice()
    };
    closeDr();

    // ---- V9 保留回归：增量保存 / 无改动 0 写入 / 跨列拖拽 ----
    calls.length=0; errs.length=0;
    cardOf('ae-tools 发布联调').querySelector('[data-edit-task]').click(); await wait(180);
    $('f_progress').value='改成增量';
    $('saveBtn').click(); await wait(320);
    var u2=upd();
    R.V9_keep={
      '增量保存只提交进度': u2.length?(function(k){return k.length===2&&k.indexOf('进度')>=0&&k.indexOf('更新时间')>=0;})(Object.keys(u2[0].props)):null,
      '错误': errs.slice()
    };
    cardOf('ae-tools 发布联调').querySelector('[data-edit-task]').click(); await wait(180);
    calls.length=0;
    $('saveBtn').click(); await wait(300);
    R.V9_keep['无改动0写入']=upd().length;
    closeDr();
    calls.length=0;
    var src=cardOf('ae-tools 发布联调');
    var destCol=qa('.col').filter(function(c){var n=c.querySelector('.ch-name');return n&&n.textContent==='笔记本';})[0];
    var dt=new DataTransfer();
    src.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:dt}));
    destCol.querySelector('.col-body').dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt,clientX:20,clientY:20}));
    src.dispatchEvent(new DragEvent('dragend',{bubbles:true,cancelable:true,dataTransfer:dt}));
    await wait(400);
    var mv=upd().filter(function(c){return c.props['所在电脑'];})[0];
    R.V9_keep['跨列拖拽写入']=mv?(mv.props['所在电脑']||{}).text:null;

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
assert n == 1
s2 = s2.replace('</body>', TEST + '\n</body>')
if not os.path.isdir(OUT):
    os.makedirs(OUT)
io.open(os.path.join(OUT, 'v16.html'), 'w', encoding='utf-8').write(s2)
print('wrote v16.html')
