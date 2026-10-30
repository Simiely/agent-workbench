// GitHub 看板头部体检：KPI 内联 + 开发强度（方块格子热力 + 本周/本月/近3个月 + 按年日历弹窗）
// 关键点：
//   1. 4 个 KPI 内联在「选择电脑」右侧，样式低调；「未同步」仍可点筛选
//   2. 开发强度头部 = 方块格子热力（横轴日期、格内写数字），本周/本月/近3个月切换
//   3. 点面板打开按年日历热力弹窗（xl 加宽、画满全年、数字默认开、悬停 tooltip）
//   4. 开发强度面板高度与任务看板 KPI 四方块对齐
//   5. Esc 一律走 CDP 原生按键注入 —— 合成 dispatchEvent 在 headless 里到不了主 world 监听器
const { launch } = require('./cdp.cjs');
const { spawn } = require('child_process');
const { seedFixture } = require('./fixture_db.cjs');
const path = require('path');

const PORT = parseInt(process.argv[2] || '8280', 10);
const ROOT = path.dirname(__dirname);

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail !== undefined && detail !== '' ? '  → ' + detail : ''));
}

async function escKey(cdp) {
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
}

(async () => {
  // 测试专用存储：临时目录 + 相对日期种子夹具，不碰真实数据目录
  const storage = seedFixture(path.join(ROOT, 'tests', '_out', 'storage-' + PORT));
  const server = spawn(process.execPath, [path.join(ROOT, 'server.mjs'), String(PORT)], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CAP_STORAGE_DIR: storage }
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  await new Promise(r => setTimeout(r, 1200));

  let browser = null;
  try {
    browser = await launch();
    const { cdp } = browser;
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1600, height: 900, deviceScaleFactor: 1, mobile: false
    });
    await browser.goto('http://127.0.0.1:' + PORT + '/');
    await cdp.waitFor('(function(){return document.querySelectorAll("#ghIntensity .gi-cell").length>0})()', 15000);
    await new Promise(r => setTimeout(r, 700));

    const ev = expr => cdp.evalJson(expr);
    const wait = ms => new Promise(r => setTimeout(r, ms));

    // ---------- 1. KPI 迁移：位置 + 数量 + 低调样式 ----------
    const kpiPos = await ev(`(function(){
      var sel=document.querySelector('#ghF_machine');
      var box=document.querySelector('#ghKpis');
      var kpis=document.querySelectorAll('#ghKpis .kpi');
      var first=kpis[0];
      var num=first?first.querySelector('.num'):null;
      return {
        新容器存在: !!box,
        kpi数量: kpis.length,
        在下拉框右侧: !!(sel&&box)&&box.getBoundingClientRect().left>=sel.getBoundingClientRect().right-1,
        同一行: !!(sel&&box)&&Math.abs(box.getBoundingClientRect().top-sel.getBoundingClientRect().top)<20,
        字号: num?Math.round(parseFloat(getComputedStyle(num).fontSize)):null,
        边框透明: !!(first&&getComputedStyle(first).borderTopColor==='rgba(0, 0, 0, 0)'),
        无卡片底色: !!(first&&(getComputedStyle(first).backgroundColor==='rgba(0, 0, 0, 0)'||getComputedStyle(first).backgroundColor==='transparent')),
        文案: Array.prototype.map.call(kpis,function(k){return k.textContent.trim();}),
        hint已删: !document.querySelector('.gh-toolbar .hint')
      };
    })()`);
    check('KPI：4 个数字内联在下拉框右侧同一行', kpiPos.kpi数量 === 4 && kpiPos.在下拉框右侧 && kpiPos.同一行, kpiPos.文案.join(' | '));
    check('KPI：样式低调（字号 ≤ 15px、无底色与实线边框）', kpiPos.字号 <= 15 && kpiPos.边框透明 && kpiPos.无卡片底色, kpiPos.字号 + 'px');
    check('工具栏：ui 说明文字已删除', kpiPos.hint已删);

    // ---------- 2. 「未同步」KPI 仍然可点筛选 ----------
    const before = await ev('(function(){return document.querySelectorAll("#ghList .repo-card").length})()');
    await ev('(function(){document.querySelector(\'#ghKpis .kpi[data-gk="unsync"]\').click();return 1})()');
    await wait(500);
    const filtered = await ev(`(function(){
      var k=document.querySelector('#ghKpis .kpi[data-gk="unsync"]');
      return {
        高亮: k.classList.contains('on'),
        仓库数: document.querySelectorAll('#ghList .repo-card').length,
        全是未同步: Array.prototype.every.call(document.querySelectorAll('#ghList .repo-card'),function(c){
          return !!c.querySelector('.repo-unsync');
        })
      };
    })()`);
    check('筛选：点「未同步」KPI 生效', filtered.高亮 && filtered.仓库数 < before, before + ' → ' + filtered.仓库数 + ' 个仓库');
    check('筛选：结果全是含未同步记录的仓库', filtered.仓库数 === 0 || filtered.全是未同步);
    await ev('(function(){document.querySelector(\'#ghKpis .kpi[data-gk="unsync"]\').click();return 1})()');
    await wait(500);
    const restored = await ev('(function(){return document.querySelectorAll("#ghList .repo-card").length})()');
    check('筛选：再点一次恢复全部', restored === before);

    // ---------- 3. 开发强度头部：方块格子 + 写数字 ----------
    const head = await ev(`(function(){
      var cells=Array.prototype.slice.call(document.querySelectorAll('#ghIntensity .gi-cell'));
      var days=cells.map(function(c){return {day:c.getAttribute('data-gi-day'), n:parseInt(c.getAttribute('data-gi-n'),10)};});
      var todayKey=(function(){var t=new Date();return t.getFullYear()+'-'+('0'+(t.getMonth()+1)).slice(-2)+'-'+('0'+t.getDate()).slice(-2);})();
      return {
        格子数: cells.length,
        默认范围: (document.querySelector('#ghIntensity .gi-range.on')||{}).textContent,
        格内日期数: document.querySelectorAll('#ghIntensity .gi-cell em').length,
        格内日期正确: cells.every(function(c){
          var em=c.querySelector('em');
          return em && em.textContent === String(parseInt(c.getAttribute('data-gi-day').slice(8),10));
        }),
        旧日期轴已删: !document.querySelector('#ghIntensity .gi-x'),
        时间升序: days.every(function(d,i){return i===0||days[i-1].day<d.day;}),
        末列月末: (function(){var d=new Date();var last=new Date(d.getFullYear(),d.getMonth()+1,0);var k=last.getFullYear()+'-'+('0'+(last.getMonth()+1)).slice(-2)+'-'+('0'+last.getDate()).slice(-2);return days.length?days[days.length-1].day===k:null;})(),
        零格无数字: (function(){var z=cells.filter(function(c){return c.getAttribute('data-gi-n')==='0'&&c.className.indexOf('future')<0;});return z.length===0||!z[0].querySelector('i');})(),
        未来格无数字: (function(){var f=cells.filter(function(c){return c.className.indexOf('future')>=0;});return f.length===0||!f[0].querySelector('i');})(),
        有数字格: document.querySelectorAll('#ghIntensity .gi-cell i').length,
        零格不写: (function(){var z=cells.filter(function(c){return c.getAttribute('data-gi-n')==='0'&&c.className.indexOf('future')<0;});return z.length===0||!z[0].querySelector('i');})(),
        排数: document.querySelectorAll('#ghIntensity .gi-rowblock').length,
        排标签: Array.prototype.map.call(document.querySelectorAll('#ghIntensity .gi-rowlabel'),function(s){return s.textContent.trim();}),
        数字字号: (function(){var i=document.querySelector('#ghIntensity .gi-cell i');return i?Math.round(parseFloat(getComputedStyle(i).fontSize)):null;})(),
        格子高: Math.round(cells[0].getBoundingClientRect().height),
        面板高: Math.round(document.getElementById('ghIntensity').getBoundingClientRect().height),
        kpi占位: (function(){var k=document.querySelector('#summary .kpis');return k.offsetHeight+12;})()
      };
    })()`);
    check('开发强度：默认本月、画满整月（含未来几天灰格）', head.格子数 === new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate() && head.默认范围 === '本月' && head.末列月末, head.默认范围 + ' / ' + head.格子数 + ' 格 / 末列=' + head.末列月末);
    check('开发强度：本月 → 2 排（上半月/下半月）', head.排数 === 2 && head.排标签.join(',') === '上半月,下半月', head.排标签.join(' | '));
    check('开发强度：横轴日期旧→新升序', head.时间升序);
    check('开发强度：日期写在方块内（每格一个小日期、旧日期轴已删）', head.格内日期数 === head.格子数 && head.格内日期正确 && head.旧日期轴已删, head.格内日期数 + '/' + head.格子数 + ' 格带日期');
    check('开发强度：有更新的格子写数字、零格与未来格不写', head.有数字格 > 0 && head.零格无数字 && head.未来格无数字, head.有数字格 + ' 格带数字');
    check('开发强度：格子撑满面板、数字字号自适应（格高 ≥ 30px 且字号 ≥ 12px）', head.格子高 >= 30 && head.数字字号 >= 12, '格高 ' + head.格子高 + 'px / 字号 ' + head.数字字号 + 'px');

    // ---------- 4. 范围切换：本周（1 排 7 个大方块）/ 近3个月（3 排自然月）----------
    await ev('(function(){document.querySelector(\'[data-gi-range="week"]\').click();return 1})()');
    await wait(400);
    const rw = await ev(`(function(){
      var cs=document.querySelectorAll('#ghIntensity .gi-cell');
      var first=cs[0].getAttribute('data-gi-day');
      var last=cs[cs.length-1].getAttribute('data-gi-day');
      // 本周 = 本周一 ~ 本周日（完整 7 天）
      var t=new Date(); var wd=(t.getDay()+6)%7;
      var mon=new Date(t.getFullYear(),t.getMonth(),t.getDate()-wd);
      var sun=new Date(t.getFullYear(),t.getMonth(),t.getDate()+(6-wd));
      function k(d){return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);}
      return { 格子: cs.length, 排数: document.querySelectorAll('#ghIntensity .gi-rowblock').length,
               排标签: Array.prototype.map.call(document.querySelectorAll('#ghIntensity .gi-rowlabel'),function(s){return s.textContent.trim();}),
               首列: first, 末列: last,
               周一起: first===k(mon), 周日止: last===k(sun),
               首格宽: Math.round(cs[0].getBoundingClientRect().width),
               数字字号: (function(){var i=document.querySelector('#ghIntensity .gi-cell i');return i?Math.round(parseFloat(getComputedStyle(i).fontSize)):null;})() };
    })()`);
    check('范围切换：本周 → 1 排恒 7 格（周一~周日完整周）、大方块大数字', rw.格子 === 7 && rw.排数 === 1 && rw.周一起 && rw.周日止 && rw.首格宽 >= 60 && rw.数字字号 >= 16, rw.格子 + ' 格 ' + rw.首列 + '~' + rw.末列 + ' / 首格 ' + rw.首格宽 + 'px / 字号 ' + rw.数字字号 + 'px');
    await ev('(function(){document.querySelector(\'[data-gi-range="q3"]\').click();return 1})()');
    await wait(400);
    const rq = await ev(`(function(){
      var cs=document.querySelectorAll('#ghIntensity .gi-cell');
      // 近3个月 = 最近 3 个自然月各一排（含本月），格子总数 = 3 个月天数之和（动态）
      var t=new Date(); var total=0; var labels=[];
      for(var i=2;i>=0;i--){
        var d=new Date(t.getFullYear(), t.getMonth()-i, 1);
        var last=new Date(t.getFullYear(), t.getMonth()-i+1, 0);
        total += last.getDate();
        labels.push((d.getMonth()+1)+'月');
      }
      return { 格子: cs.length, 排数: document.querySelectorAll('#ghIntensity .gi-rowblock').length,
               排标签: Array.prototype.map.call(document.querySelectorAll('#ghIntensity .gi-rowlabel'),function(s){return s.textContent.trim();}),
               高亮: (document.querySelector('[data-gi-range="q3"]')||{}).className.indexOf('on')>=0,
               数字格: document.querySelectorAll('#ghIntensity .gi-cell i').length,
               期望格数: total, 期望标签: labels };
    })()`);
    check('范围切换：近3个月 → 3 排自然月（格子数=3 个月天数和）、按钮高亮、有数字',
      rq.排数 === 3 && rq.格子 === rq.期望格数 && rq.高亮 && rq.数字格 > 0 && JSON.stringify(rq.排标签) === JSON.stringify(rq.期望标签),
      rq.排标签.join('/') + ' / ' + rq.格子 + ' 格（期望 ' + rq.期望格数 + '）');
    await ev('(function(){document.querySelector(\'[data-gi-range="month"]\').click();return 1})()');
    await wait(400);

    // ---------- 5. 高度与任务看板 KPI 对齐 ----------
    check('开发强度：面板高度与 KPI 四方块对齐', Math.abs(head.面板高 - head.kpi占位) <= 2, '强度 ' + head.面板高 + 'px vs KPI 占位 ' + head.kpi占位 + 'px');

    // ---------- 6. 点面板 → 按年日历弹窗 ----------
    await ev('(function(){document.querySelector("#ghIntensity .gi-label").click();return 1})()');
    await wait(600);
    const sheet = await ev(`(function(){
      var nowY=new Date().getFullYear();
      return {
        打开: document.getElementById('drawer').classList.contains('on'),
        标题: document.getElementById('drawerTitle').textContent,
        xl加宽: document.getElementById('drawer').className.indexOf('xl')>=0,
        年份: document.querySelector('.hm-nav b').textContent,
        next当年禁用: document.querySelector('[data-hm-year=next]').disabled,
        汇总: document.querySelector('.hm-summary').textContent,
        周列数: document.querySelectorAll('#drawerBody .hm-week').length,
        格子数: document.querySelectorAll('#drawerBody .hm[data-hm-day]').length,
        月标签数: document.querySelectorAll('#drawerBody .hm-months span').length,
        星期标签: document.querySelectorAll('#drawerBody .hm-wds span').length,
        图例格数: document.querySelectorAll('#drawerBody .hm-legend .hm').length,
        数字默认开: document.querySelector('[data-hm-num]').className.indexOf('on')>=0,
        数字格数: document.querySelectorAll('#drawerBody .hm i').length,
        数字与档位一致: Array.prototype.every.call(document.querySelectorAll('#drawerBody .hm[data-hm-n]'),function(c){
          return (parseInt(c.getAttribute('data-hm-n'),10)>0) === !!c.querySelector('i');
        }),
        无横向滚动: (function(){var s=document.querySelector('#drawerBody .hm-scroll');return s? s.scrollWidth<=s.clientWidth+1 : null;})(),
        年份正确: document.querySelector('.hm-nav b').textContent === String(nowY)
      };
    })()`);
    check('日历：点面板打开弹窗，当年展示', sheet.打开 && sheet.标题 === '开发强度 · 日历' && sheet.年份正确, sheet.年份 + ' 年');
    check('日历：画满全年 365 格、12 个月标签', sheet.格子数 === 365 && sheet.月标签数 === 12, sheet.周列数 + ' 周 / ' + sheet.格子数 + ' 格 / ' + sheet.月标签数 + ' 月标');
    check('日历：弹窗 xl 加宽且无横向滚动', sheet.xl加宽 && sheet.无横向滚动);
    check('日历：月/星期标签、图例齐全', sheet.星期标签 === 7 && sheet.图例格数 === 5);
    check('日历：数字默认开，且数字只出现在有更新的格子', sheet.数字默认开 && sheet.数字格数 > 0 && sheet.数字与档位一致, sheet.数字格数 + ' 格带数字');
    check('日历：下一年按钮在当年禁用', sheet.next当年禁用);
    check('日历：汇总行带年份与数据', (sheet.汇总 || '').indexOf(sheet.年份) === 0, sheet.汇总);

    // ---------- 7. 年份切换 ----------
    await ev('(function(){document.querySelector("[data-hm-year=prev]").click();return 1})()');
    await wait(400);
    const prevY = await ev(`(function(){
      var y=parseInt(document.querySelector('.hm-nav b').textContent,10);
      return { 年份: y, 格子: document.querySelectorAll('#drawerBody .hm[data-hm-day]').length,
               next可用: !document.querySelector('[data-hm-year=next]').disabled };
    })()`);
    check('日历：上一年按钮 → 年份-1，格子仍画满一年', prevY.年份 === new Date().getFullYear() - 1 && prevY.格子 === 365 && prevY.next可用, prevY.年份 + ' 年 / ' + prevY.格子 + ' 格');
    await ev('(function(){document.querySelector("[data-hm-year=next]").click();return 1})()');
    await wait(400);

    // ---------- 8. tooltip ----------
    await ev(`(function(){
      var c=document.querySelector('#drawerBody .hm[data-hm-n]:not([data-hm-n="0"])')||document.querySelector('#drawerBody .hm[data-hm-day]');
      c.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));return 1;
    })()`);
    await wait(300);
    const tip = await ev(`(function(){
      var t=document.querySelector('.hm-tip');
      return t?{可见: t.style.display!=='none', 文本: t.textContent.trim()}:null;
    })()`);
    check('日历：悬停格子显示 tooltip', tip && tip.可见, tip ? tip.文本 : '');

    // ---------- 9. Esc（原生按键）关闭 + 宽度还原 ----------
    await escKey(cdp);
    await wait(500);
    const closed = await ev('(function(){return { 关: !document.getElementById("drawer").classList.contains("on"), xl还原: document.getElementById("drawer").className.indexOf("xl")<0 };})()');
    check('日历：Esc 关闭且恢复标准宽', closed.关 && closed.xl还原);

    // ---------- 10. 换电脑筛选后仍正常 ----------
    await ev(`(function(){
      var s=document.getElementById('ghF_machine');
      var opts=Array.prototype.slice.call(s.options).filter(function(o){return o.value;});
      if(opts.length){ s.value=opts[0].value; s.dispatchEvent(new Event('change')); }
      return 1;
    })()`);
    await wait(500);
    const afterFilter = await ev(`(function(){
      return {
        kpi仍有值: document.querySelectorAll('#ghKpis .kpi').length===4,
        格子仍在: document.querySelectorAll('#ghIntensity .gi-cell').length === new Date(new Date().getFullYear(), new Date().getMonth()+1, 0).getDate(),
        面板高度仍对齐: (function(){
          var k=document.querySelector('#summary .kpis'), g=document.getElementById('ghIntensity');
          return Math.abs(g.getBoundingClientRect().height-(k.offsetHeight+12))<=2;
        })()
      };
    })()`);
    check('筛选电脑后：KPI、格子、高度对齐都保持', afterFilter.kpi仍有值 && afterFilter.格子仍在 && afterFilter.面板高度仍对齐);

    // ---------- 11. 布局无横向溢出 ----------
    const ovf = await ev(`(function(){
      var bad=[];
      ['viewBoard','viewGithub'].forEach(function(id){
        var p=document.getElementById(id);
        if(p.scrollWidth>p.clientWidth+1) bad.push(id+'横向溢出');
      });
      if(document.body.scrollWidth>window.innerWidth+1) bad.push('body溢出');
      return bad;
    })()`);
    check('布局：两套看板都无横向溢出', ovf.length === 0, ovf.join('、') || '无溢出');

  } catch (e) {
    check('体检执行异常', false, e.message);
  } finally {
    if (browser) await browser.close();
    server.kill();
  }

  const failed = results.filter(r => !r.ok);
  console.log('='.repeat(58));
  if (failed.length) {
    console.log('FAILED: ' + failed.map(r => r.name).join(', '));
    process.exit(1);
  }
  console.log('GitHub 看板头部体检 ALL PASS  (' + results.length + ' 项)');
})();
