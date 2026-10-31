// UI v2b 交互态截图：账号面板 / 抽屉 / GitHub 窗格 / 浅色
const { launch } = require('./cdp.cjs');
const path = require('path');
const fs = require('fs');
const url = require('url');

const W = parseInt(process.argv[2] || '1366', 10);
const H = parseInt(process.argv[3] || '1024', 10);
const OUT = process.argv[4];
const SCENE = process.argv[5] || 'panel';
const QS = process.argv[6] || 'clean&theme=dark';
const FILE = url.pathToFileURL(path.join(path.dirname(__dirname), 'design', 'ui-v2b.html')).href + (QS ? '?' + QS : '');

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await launch();
  const { cdp } = browser;
  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false });
    await browser.goto(FILE);
    await cdp.waitFor('!!document.querySelector("#board .col")', 8000);
    await sleep(500);

    const click = async sel => {
      const box = await cdp.evalJson(`(function(){
        var e=document.querySelector('${sel}'); if(!e) return null;
        e.scrollIntoView({block:'center', inline:'center'});
        var r=e.getBoundingClientRect();
        return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
      })()`);
      if (!box) throw new Error('没找到 ' + sel);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    };

    if (SCENE === 'panel') {
      await click('.pill[data-switch$=":wb"]');
      await sleep(500);
    } else if (SCENE === 'drawer') {
      await click('.card[data-task-id="t1"]');
      await sleep(600);
    } else if (SCENE === 'gh') {
      await cdp.evalJson(`(function(){
        var b=document.querySelector('.pane-switch button[data-pane="gh"]');
        if (b) { b.click(); }
        else { document.querySelector('#tGh').click(); }
        return 1;
      })()`);
      await sleep(600);
    } else if (SCENE === 'manage') {
      await cdp.evalJson(`(function(){document.querySelector('#manageBtn').click();return 1})()`);
      await sleep(300);
      await click('.card[data-task-id="t1"] .sel-box');
      await click('.card[data-task-id="t2"] .sel-box');
      await sleep(400);
    }
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
    console.log('截图: ' + OUT);
  } catch (e) {
    console.error('失败: ' + e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
