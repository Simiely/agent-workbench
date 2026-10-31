// 正式版响应式改造的自检：宽屏窗格顶置顶 + 窄屏分页底部栏
const { launch } = require('./cdp.cjs');
const fs = require('fs');

const PORT = parseInt(process.argv[2] || '8620', 10);
const OUT = process.argv[3] || 'C:/Temp/app';
const URL = 'http://127.0.0.1:' + PORT + '/';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail !== undefined && detail !== '' ? '  → ' + detail : ''));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await launch();
  const { cdp } = browser;
  try {
    // ---------- 1. 宽屏 1366×1024：窗格顶部置顶 ----------
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 1024, deviceScaleFactor: 2, mobile: false });
    await browser.goto(URL);
    await cdp.waitFor('document.querySelectorAll("#board .col").length>0', 12000);
    await sleep(700);

    const wide = await cdp.evalJson(`(function(){
      var vb = document.querySelector('#viewBoard'), vg = document.querySelector('#viewGithub');
      var pb = vb.querySelector('.pane-top'), pg = vg.querySelector('.pane-top');
      return {
        hasBoardTop: !!pb, hasGhTop: !!pg,
        stickyB: pb ? getComputedStyle(pb).position : null,
        stickyG: pg ? getComputedStyle(pg).position : null,
        boardScrollable: vb.scrollHeight > vb.clientHeight + 1,
        ghListScrollable: (function(){var l=document.querySelector('#ghList');return l.scrollHeight>l.clientHeight+1})(),
        cols: document.querySelectorAll('#board .col').length
      };
    })()`);
    check('两栏都有 .pane-top', wide.hasBoardTop && wide.hasGhTop, JSON.stringify(wide));
    check('顶部容器是 sticky', wide.stickyB === 'sticky' && wide.stickyG === 'sticky',
      wide.stickyB + '/' + wide.stickyG);

    // 滚看板：顶部应保持在栏顶（相对 .view 视口位置不随滚动改变）
    const stuck = await cdp.evalJson(`(function(){
      var vb = document.querySelector('#viewBoard');
      var pb = vb.querySelector('.pane-top');
      var before = pb.getBoundingClientRect().top;
      var vr = vb.getBoundingClientRect().top;
      // 滚两个滚动容器：列体 + 整栏
      var body = document.querySelector('#board .col-body');
      if (body) body.scrollTop = body.scrollHeight;
      vb.scrollTop = vb.scrollHeight;
      return { before: Math.round(before - vr), after: null, bodyScrolled: body ? body.scrollTop : 0 };
    })()`);
    await sleep(400);
    const after = await cdp.evalJson(`(function(){
      var vb = document.querySelector('#viewBoard');
      var pb = vb.querySelector('.pane-top');
      return Math.round(pb.getBoundingClientRect().top - vb.getBoundingClientRect().top);
    })()`);
    check('滚动后看板顶部仍贴在栏顶', Math.abs(after) <= 2, '偏移 ' + after + 'px（滚前 ' + stuck.before + 'px）');

    const ghAfter = await cdp.evalJson(`(function(){
      var l = document.querySelector('#ghList');
      l.scrollTop = l.scrollHeight;
      var vg = document.querySelector('#viewGithub');
      vg.scrollTop = vg.scrollHeight;
      return null;
    })()`);
    await sleep(400);
    const ghTop = await cdp.evalJson(`(function(){
      var vg = document.querySelector('#viewGithub');
      return Math.round(vg.querySelector('.pane-top').getBoundingClientRect().top - vg.getBoundingClientRect().top);
    })()`);
    check('滚动后 GitHub 顶部仍贴在栏顶', Math.abs(ghTop) <= 2, '偏移 ' + ghTop + 'px');

    const s1 = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(OUT + '-wide.png', Buffer.from(s1.data, 'base64'));

    // ---------- 2. 窄屏 440×956：分页 + 底部 T-bar ----------
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 440, height: 956, deviceScaleFactor: 2, mobile: false });
    await browser.goto(URL);
    await cdp.waitFor('document.querySelectorAll("#board .col").length>0', 12000);
    await sleep(700);

    const m1 = await cdp.evalJson(`(function(){
      var tb = document.querySelector('#tabbar');
      var vb = document.querySelector('#viewBoard'), vg = document.querySelector('#viewGithub');
      return {
        tabbarShown: tb ? getComputedStyle(tb).display !== 'none' : false,
        tabbarBottom: tb ? Math.round(tb.getBoundingClientRect().bottom) : 0,
        vh: window.innerHeight,
        page: document.body.getAttribute('data-page'),
        boardShown: getComputedStyle(vb).display !== 'none',
        ghShown: getComputedStyle(vg).display !== 'none',
        topbarAddHidden: getComputedStyle(document.querySelector('#addBtn')).display === 'none',
        hOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        cols: document.querySelectorAll('#board .col').length
      };
    })()`);
    check('窄屏出现底部 T-bar', m1.tabbarShown, JSON.stringify(m1));
    check('底部栏贴在屏幕底', Math.abs(m1.tabbarBottom - m1.vh) <= 2, m1.tabbarBottom + ' vs ' + m1.vh);
    check('默认只显示看板一页', m1.boardShown && !m1.ghShown, 'board=' + m1.boardShown + ' gh=' + m1.ghShown);
    check('顶栏的新增按钮已下沉', m1.topbarAddHidden);
    check('没有横向溢出', !m1.hOverflow);

    const s2 = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(OUT + '-phone-board.png', Buffer.from(s2.data, 'base64'));

    // 切到仓库页
    await cdp.evalJson(`(function(){
      var b = document.querySelector('#tabbar [data-page="gh"]');
      if (b) b.click();
      return 1;
    })()`);
    await sleep(500);
    const m2 = await cdp.evalJson(`(function(){
      var vb = document.querySelector('#viewBoard'), vg = document.querySelector('#viewGithub');
      return {
        page: document.body.getAttribute('data-page'),
        boardShown: getComputedStyle(vb).display !== 'none',
        ghShown: getComputedStyle(vg).display !== 'none',
        ghRows: document.querySelectorAll('#ghList .gh-card, #ghList .repo-card, #ghList .repo-entry').length,
        activeTab: (function(){var t=document.querySelector('#tabbar .tb-item.on');return t?t.getAttribute('data-page'):null})()
      };
    })()`);
    check('点仓库切到 GitHub 页', m2.ghShown && !m2.boardShown, JSON.stringify(m2));
    check('底部栏高亮跟随', m2.activeTab === 'gh', String(m2.activeTab));

    const s3 = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(OUT + '-phone-gh.png', Buffer.from(s3.data, 'base64'));

    // 抽屉在手机上是底部弹层
    await cdp.evalJson(`(function(){
      var b = document.querySelector('#tabbar [data-page="board"]'); if (b) b.click();
      return 1;
    })()`);
    await sleep(400);
    await cdp.evalJson(`(function(){
      var c = document.querySelector('#board .card');
      if (c) c.click();
      return 1;
    })()`);
    await sleep(600);
    const dr = await cdp.evalJson(`(function(){
      var d = document.querySelector('#drawer');
      var r = d.getBoundingClientRect();
      return { on: d.classList.contains('on'), bottom: Math.round(r.bottom), vh: window.innerHeight,
               width: Math.round(r.width), vw: window.innerWidth };
    })()`);
    check('手机上抽屉是底部弹层', dr.on && Math.abs(dr.bottom - dr.vh) <= 2 && dr.width >= dr.vw - 2,
      JSON.stringify(dr));
    const s4 = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(OUT + '-phone-drawer.png', Buffer.from(s4.data, 'base64'));
  } catch (e) {
    check('执行未抛错', false, e && e.message);
    console.error(e);
  } finally {
    await browser.close();
  }

  const failed = results.filter(r => !r.ok);
  console.log('');
  if (failed.length) {
    console.log('FAILED ' + failed.length + '/' + results.length);
    failed.forEach(f => console.log('  - ' + f.name));
    process.exit(1);
  }
  console.log('ALL PASS (' + results.length + ' 项)');
})();
