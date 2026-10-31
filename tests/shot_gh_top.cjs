// GitHub 置顶验证：滚动整栏后，强度 + 选电脑行仍钉在栏顶
const { launch } = require('./cdp.cjs');
const fs = require('fs');
const PORT = process.argv[2] || '8623';
const OUT = process.argv[3] || 'C:/Temp/gh-top.png';

(async () => {
  const b = await launch();
  const { cdp } = b;
  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 1024, deviceScaleFactor: 1, mobile: false });
    await b.goto('http://127.0.0.1:' + PORT + '/');
    await cdp.waitFor('document.querySelectorAll("#ghList .gh-card, #ghList .repo-card, #ghList .repo-entry").length>0', 12000);
    await new Promise(r => setTimeout(r, 700));

    const before = await cdp.evalJson(`(function(){
      var vg = document.querySelector('#viewGithub');
      var pt = vg.querySelector('.pane-top');
      return { vw: window.innerWidth,
        offset: Math.round((pt.getBoundingClientRect().top - vg.getBoundingClientRect().top) * 10) / 10,
        paneMax: vg.scrollHeight - vg.clientHeight };
    })()`);
    console.log('滚动前: ' + JSON.stringify(before));

    // 只滚整栏（.view 是滚动容器；gh-list 高度随内容，自身不产生滚动）
    await cdp.evalJson(`(function(){
      var vg = document.querySelector('#viewGithub');
      vg.scrollTop = vg.scrollHeight;
      return vg.scrollTop;
    })()`);
    await new Promise(r => setTimeout(r, 400));
    const after = await cdp.evalJson(`(function(){
      var vg = document.querySelector('#viewGithub');
      var pt = vg.querySelector('.pane-top');
      var it = pt.querySelector('#ghIntensity'), tb = pt.querySelector('.gh-toolbar');
      return { vw: window.innerWidth, scrolled: Math.round(vg.scrollTop),
        offset: Math.round((pt.getBoundingClientRect().top - vg.getBoundingClientRect().top) * 10) / 10,
        intensity: !!it, toolbar: !!tb,
        order: it && tb ? (it.getBoundingClientRect().top < tb.getBoundingClientRect().top) : null };
    })()`);
    console.log('滚动后: ' + JSON.stringify(after));
    const ok = after.offset === 0 && after.intensity && after.toolbar && after.order;
    console.log(ok ? '置顶 OK' : '置顶异常');
    process.exitCode = ok ? 0 : 1;

    // 只截 GitHub 栏，看置顶区在滚动后的样子
    const box = await cdp.evalJson(`(function(){
      var r = document.querySelector('#viewGithub').getBoundingClientRect();
      return { x: Math.max(0, Math.round(r.x)), y: 0,
        width: Math.min(Math.round(r.width), 1366 - Math.max(0, Math.round(r.x))),
        height: 1024, scale: 1 };
    })()`);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', clip: box });
    fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
    console.log('截图: ' + OUT);
  } catch (e) {
    console.error('失败: ' + e.message);
    process.exitCode = 1;
  } finally {
    await b.close();
  }
})();
