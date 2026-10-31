// 共享账号面板截图：打开某台电脑的 WB 面板，看是不是列出全库共享名单
const { launch } = require('./cdp.cjs');
const fs = require('fs');
const PORT = parseInt(process.argv[2] || '8622', 10);
const OUT = process.argv[3] || 'C:/Temp/acc-shared';
const W = parseInt(process.argv[4] || '1366', 10);
const H = parseInt(process.argv[5] || '1024', 10);
const QS = process.argv[6] || 'theme=dark';

(async () => {
  const b = await launch();
  const { cdp } = b;
  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false });
    await b.goto('http://127.0.0.1:' + PORT + '/');
    await cdp.waitFor('document.querySelectorAll("#board .col").length>0', 12000);
    await new Promise(r => setTimeout(r, 800));

    // 给第二台电脑也登记一个别的电脑用过的号，让共享效果可见
    const box = await cdp.evalJson(`(function(){
      var p = document.querySelector('.col[data-machine-id="m2"] .ch-acc .acc[data-switch="m2:wb"]');
      if (!p) return null;
      p.scrollIntoView({ block: 'center', inline: 'center' });
      var r = p.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()`);
    if (!box) throw new Error('没找到第二台电脑的 WB 胶囊');
    for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await cdp.send('Input.dispatchMouseEvent', { type: t, x: box.x, y: box.y, button: 'left', clickCount: 1 });
    }
    await new Promise(r => setTimeout(r, 600));

    const info = await cdp.evalJson(`(function(){
      var rows = [].map.call(document.querySelectorAll('.acc-panel .acc-row'), function(r){
        return r.querySelector('.nm').textContent.trim()
          + (r.classList.contains('on') ? '*' : '')
          + (r.querySelector('.tag.sub') ? ' [' + r.querySelector('.tag.sub').textContent.trim() + ']' : '');
      });
      return { title: (document.querySelector('.acc-panel .mh') || {}).textContent || '', rows: rows };
    })()`);
    console.log('面板: ' + JSON.stringify(info));

    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(OUT + '.png', Buffer.from(shot.data, 'base64'));
    console.log('截图: ' + OUT + '.png');
  } catch (e) {
    console.error('失败: ' + e.message);
    process.exitCode = 1;
  } finally {
    await b.close();
  }
})();
