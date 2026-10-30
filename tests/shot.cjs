// 本地服务实拍：起服务 → 无头浏览器加载 → 截图。用法：node tests/shot.cjs <port> <out.png> [高度]
const { launch } = require('./cdp.cjs');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = parseInt(process.argv[2] || '8165', 10);
const OUT = process.argv[3] || 'C:/Temp/awb-shot.png';
const HEIGHT = parseInt(process.argv[4] || '900', 10);
const ROOT = path.dirname(__dirname);

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'server.mjs'), String(PORT)], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  await new Promise(r => setTimeout(r, 1200));

  let browser = null;
  try {
    browser = await launch();
    const { cdp } = browser;
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1600, height: HEIGHT, deviceScaleFactor: 1, mobile: false
    });
    await browser.goto('http://127.0.0.1:' + PORT + '/');
    await cdp.waitFor(
      '(function(){return document.querySelectorAll("#board .col").length>0})()', 15000);
    await new Promise(r => setTimeout(r, 1200));

    const info = await cdp.evalJson(
      '(function(){return {' +
      ' cols: Array.prototype.map.call(document.querySelectorAll("#board .col .ch-name"),function(n){return n.textContent.trim()}),' +
      ' cards: document.querySelectorAll("#board .card").length,' +
      ' repos: document.querySelectorAll("#ghList .repo-card").length,' +
      ' kpi: Array.prototype.map.call(document.querySelectorAll("#summary .kpi .num"),function(n){return n.textContent.trim()}),' +
      ' unsync: document.querySelectorAll("#ghList .re-res.un").length,' +
      ' archived: document.querySelectorAll("#ghList .re-res").length' +
      '}})()');
    console.log('渲染状态: ' + JSON.stringify(info, null, 1));

    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
    console.log('截图已保存: ' + OUT);
  } catch (e) {
    console.error('失败: ' + e.message);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})();
