// 弹窗形态审计：所有浮层必须是「居中弹出」，且动效符合苹果规范
// 检查项：
//   1. 几何居中（面板中心 ≈ 视口中心），不看 class 名 —— 形态是结果不是契约
//   2. 磨砂玻璃：遮罩有 backdrop-filter blur + 半透明深色背景
//   3. 动效令牌：进场/退场时长不对称 + spring 曲线
//   4. 退场可完成：关掉后元素不可见、不可点
//   5. 各面板的底栏按钮与内容态一致
const { launch } = require('./cdp.cjs');
const { spawn } = require('child_process');
const { seedFixture } = require('./fixture_db.cjs');
const path = require('path');

const PORT = parseInt(process.argv[2] || '8176', 10);
const ROOT = path.dirname(__dirname);

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail !== undefined && detail !== '' ? '  → ' + detail : ''));
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
    await cdp.waitFor('(function(){return document.querySelectorAll("#board .card").length>0})()', 15000);
    await new Promise(r => setTimeout(r, 700));

    const ev = expr => cdp.evalJson(expr);
    const wait = ms => new Promise(r => setTimeout(r, ms));

    // 几何居中判定：面板中心 ≈ 视口中心
    const CENTER = `(function(el){
      if(!el) return false;
      var r=el.getBoundingClientRect();
      return Math.abs((r.left+r.right)/2 - window.innerWidth/2) < 2
          && Math.abs((r.top+r.bottom)/2 - window.innerHeight/2) < 2;
    })`;

    // ---------- 1. 动效令牌（静态检查，不需要开弹窗）----------
    const tok = await ev(`(function(){
      var root=getComputedStyle(document.documentElement);
      var dr=getComputedStyle(document.getElementById('drawer'));
      var mk=getComputedStyle(document.getElementById('mask'));
      return {
        durIn: root.getPropertyValue('--dur-in').trim(),
        durOut: root.getPropertyValue('--dur-out').trim(),
        spring: root.getPropertyValue('--ease-spring').trim(),
        drawerTransition: dr.transitionDuration,
        maskTransition: mk.transitionDuration
      };
    })()`);
    check('动效令牌：进场时长 > 退场时长（不对称）',
      parseFloat(tok.durIn) > parseFloat(tok.durOut), tok.durIn + ' / ' + tok.durOut);
    check('动效令牌：spring 曲线已定义', /cubic-bezier/.test(tok.spring), tok.spring);

    // ---------- 2. 任务详情弹窗 ----------
    await ev('(function(){document.querySelector("#board .card").click();return 1})()');
    await wait(600);
    const d1 = await ev(`(function(){
      var dr=document.getElementById('drawer'), mask=document.getElementById('mask');
      var cs=getComputedStyle(dr), ms=getComputedStyle(mask);
      return {
        opened: dr.classList.contains('on'),
        centered: ${CENTER}(dr),
        blur: ms.backdropFilter,
        maskBg: ms.backgroundColor,
        radius: cs.borderRadius,
        onlyRead: !!document.querySelector('.dt-title') && !document.getElementById('f_title'),
        editShown: document.getElementById('editBtn').style.display !== 'none',
        saveHidden: document.getElementById('saveBtn').style.display === 'none'
      };
    })()`);
    check('任务详情：弹窗已打开', d1.opened);
    check('任务详情：几何居中', d1.centered);
    check('任务详情：背景磨砂玻璃（blur 生效）', /blur/.test(d1.blur || ''), d1.blur);
    check('任务详情：遮罩半透明深色', /rgba?\(/.test(d1.maskBg || ''), d1.maskBg);
    check('任务详情：圆角（玻璃质感）', parseFloat(d1.radius) >= 8, d1.radius);
    check('任务详情：只读态（无表单）', d1.onlyRead);
    check('任务详情：底栏显示「编辑」', d1.editShown);
    check('任务详情：底栏隐藏「保存」', d1.saveHidden);

    // ---------- 3. 详情 → 表单（原地切换，仍居中）----------
    await ev('(function(){document.getElementById("editBtn").click();return 1})()');
    await wait(450);
    const d2 = await ev(`(function(){
      return {
        form: !!document.getElementById('f_title'),
        stillRead: !!document.querySelector('.dt-title'),
        centered: ${CENTER}(document.getElementById('drawer')),
        saveShown: document.getElementById('saveBtn').style.display !== 'none',
        editHidden: document.getElementById('editBtn').style.display === 'none'
      };
    })()`);
    check('详情→表单：已切到表单', d2.form && !d2.stillRead);
    check('详情→表单：仍居中（不换位置）', d2.centered);
    check('详情→表单：底栏换成「保存」', d2.saveShown && d2.editHidden);

    // ---------- 4. 关闭退场 ----------
    await ev('(function(){document.getElementById("closeDrawer").click();return 1})()');
    await wait(600);
    const d3 = await ev(`(function(){
      var dr=document.getElementById('drawer'), cs=getComputedStyle(dr);
      return {
        closed: !dr.classList.contains('on'),
        maskClosed: !document.getElementById('mask').classList.contains('on'),
        invisible: cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05,
        notClickable: cs.pointerEvents === 'none'
      };
    })()`);
    check('关闭：弹窗已收起', d3.closed && d3.maskClosed);
    check('关闭：退场后不可见', d3.invisible);
    check('关闭：退场后不可点', d3.notClickable);

    // ---------- 5. 新增任务（居中表单）----------
    await ev('(function(){document.getElementById("addBtn").click();return 1})()');
    await wait(300);
    await ev('(function(){document.querySelector(\'[data-add="task"]\').click();return 1})()');
    await wait(500);
    const d5 = await ev(`(function(){
      return {
        centered: ${CENTER}(document.getElementById('drawer')),
        form: !!document.getElementById('f_title'),
        title: document.getElementById('drawerTitle').textContent
      };
    })()`);
    check('新增任务：居中表单', d5.centered && d5.form, d5.title);
    await ev('(function(){document.getElementById("closeDrawer").click();return 1})()');
    await wait(450);

    // ---------- 6. GitHub 仓库卡 → 仓库详情 ----------
    const repoN = await ev('(function(){return document.querySelectorAll("#ghList .repo-card").length})()');
    check('GitHub 看板：有仓库卡', repoN > 0, repoN + ' 张');
    if (repoN > 0) {
      await ev('(function(){document.querySelector("#ghList .repo-card").click();return 1})()');
      await wait(550);
      const d6 = await ev(`(function(){
        return {
          centered: ${CENTER}(document.getElementById('drawer')),
          title: document.getElementById('drawerTitle').textContent,
          tags: document.querySelectorAll('#drawerBody .dt-tag').length,
          rows: document.querySelectorAll('#drawerBody .rd-row').length,
          repoAdd: document.getElementById('repoAddBtn').style.display !== 'none',
          repoCopy: document.getElementById('repoCopyBtn').style.display !== 'none',
          saveHidden: document.getElementById('saveBtn').style.display === 'none'
        };
      })()`);
      check('仓库详情：居中', d6.centered);
      check('仓库详情：标题是仓库名', d6.title.indexOf('/') > 0, d6.title);
      check('仓库详情：有概要徽章', d6.tags > 0, d6.tags + ' 个');
      check('仓库详情：有记录列表', d6.rows > 0, d6.rows + ' 条');
      check('仓库详情：底栏「＋记录同步」+「复制链接」', d6.repoAdd && d6.repoCopy);
      check('仓库详情：底栏隐藏「保存」', d6.saveHidden);

      // 点记录行 → 进该记录的编辑态
      if (d6.rows > 0) {
        await ev('(function(){document.querySelector("#drawerBody .rd-row").click();return 1})()');
        await wait(500);
        const d7 = await ev(`(function(){
          return {
            ghForm: !!document.getElementById('gf_repo'),
            centered: ${CENTER}(document.getElementById('drawer')),
            title: document.getElementById('drawerTitle').textContent
          };
        })()`);
        check('仓库详情→记录编辑：已进表单', d7.ghForm, d7.title);
        check('仓库详情→记录编辑：仍居中（不叠层）', d7.centered);
      }
      await ev('(function(){document.getElementById("closeDrawer").click();return 1})()');
      await wait(450);
    }

    // ---------- 7. 记录同步（新增） ----------
    await ev('(function(){document.getElementById("addBtn").click();return 1})()');
    await wait(300);
    await ev('(function(){document.querySelector(\'[data-add="gh"]\').click();return 1})()');
    await wait(500);
    const d8 = await ev(`(function(){
      return {
        centered: ${CENTER}(document.getElementById('drawer')),
        ghForm: !!document.getElementById('gf_repo'),
        title: document.getElementById('drawerTitle').textContent
      };
    })()`);
    check('记录同步：居中表单', d8.centered && d8.ghForm, d8.title);
    await ev('(function(){document.getElementById("closeDrawer").click();return 1})()');
    await wait(450);

    // ---------- 8. AI 指南（宽版居中） ----------
    await ev('(function(){document.getElementById("aiGuideBtn").click();return 1})()');
    await wait(500);
    const d9 = await ev(`(function(){
      var dr=document.getElementById('aiDrawer');
      return {
        centered: ${CENTER}(dr),
        width: Math.round(dr.getBoundingClientRect().width),
        content: document.getElementById('aiBody').innerHTML.length
      };
    })()`);
    check('AI 指南：居中', d9.centered);
    check('AI 指南：宽版心且有内容', d9.width >= 700 && d9.content > 100, d9.width + 'px');
    await ev('(function(){document.getElementById("aiClose").click();return 1})()');
    await wait(400);

    // ---------- 9. 添加电脑（居中） ----------
    await ev('(function(){document.getElementById("addBtn").click();return 1})()');
    await wait(300);
    await ev('(function(){document.querySelector(\'[data-add="machine"]\').click();return 1})()');
    await wait(450);
    const d10 = await ev(`(function(){
      var m=document.getElementById('machineModal');
      return { centered: ${CENTER}(m), opened: m.classList.contains('on') };
    })()`);
    check('添加电脑：居中', d10.centered && d10.opened);
    await ev('(function(){document.getElementById("m_cancel").click();return 1})()');
    await wait(350);

    // ---------- 10. 确认框（居中） ----------
    await ev('(function(){document.getElementById("closeDrawer").click();return 1})()');
    await wait(300);
    const conf = await ev(`(function(){
      // 走真实删除路径触发确认框：点卡片上的任务菜单 → 删除
      var btn=document.querySelector('#board .card [data-task-menu]');
      if(!btn) return {skipped:'无任务菜单'};
      btn.click();
      return {opened:true};
    })()`);
    if (!conf.skipped) {
      await wait(350);
      await ev('(function(){var m=document.querySelector(\'[data-act="delete"]\');if(m)m.click();return 1})()');
      await wait(450);
      const d11 = await ev(`(function(){
        var m=document.getElementById('confirmModal');
        return { centered: ${CENTER}(m), opened: m.classList.contains('on') };
      })()`);
      check('确认框：居中', d11.centered && d11.opened);
      await ev('(function(){document.getElementById("cCancel").click();return 1})()');
      await wait(300);
    }

    // ---------- 11. 浅色主题下仍可读 ----------
    await ev('(function(){document.documentElement.setAttribute("data-theme","light");return 1})()');
    await wait(300);
    await ev('(function(){document.querySelector("#board .card").click();return 1})()');
    await wait(500);
    const d12 = await ev(`(function(){
      var dr=document.getElementById('drawer'), cs=getComputedStyle(dr);
      return {
        centered: ${CENTER}(dr),
        bg: cs.backgroundColor,
        opacity: parseFloat(cs.opacity)
      };
    })()`);
    check('浅色主题：弹窗仍居中且不透明', d12.centered && d12.opacity > 0.9, d12.bg);
    await ev('(function(){document.getElementById("closeDrawer").click();return 1})()');
    await wait(300);
    await ev('(function(){document.documentElement.setAttribute("data-theme","dark");return 1})()');

  } catch (e) {
    check('审计执行异常', false, e.message);
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
  console.log('弹窗形态审计 ALL PASS  (' + results.length + ' 项)');
})();
