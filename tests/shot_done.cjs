// 实拍「已完成」视图：起服务 → 加载 → 点分段「已完成」→ 截图
// 用法：node tests/shot_done.cjs <port> <out.png>
const { launch } = require('./cdp.cjs');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = parseInt(process.argv[2] || '8170', 10);
const OUT = process.argv[3] || 'C:/Temp/awb-done.png';
const ROOT = path.dirname(__dirname);

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'server.mjs'), String(PORT)], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.on('data', () => {});
  await new Promise(r => setTimeout(r, 1200));

  let browser = null;
  try {
    browser = await launch();
    const { cdp } = browser;
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1100, height: 860, deviceScaleFactor: 1, mobile: false
    });
    await browser.goto('http://127.0.0.1:' + PORT + '/');
    await cdp.waitFor('(function(){return document.querySelectorAll("#board .col").length>0})()', 15000);
    await new Promise(r => setTimeout(r, 800));

    // 点分段「已完成」
    const r1 = await cdp.evalJson(
      '(function(){var b=document.querySelector(\'#segTabs button[data-s="已完成"]\');' +
      'if(!b) return {err:"没有已完成分段"}; b.click();' +
      'return new Promise(function(res){setTimeout(function(){' +
      '  res({' +
      '    分段高亮: (function(){var o=document.querySelector("#segTabs button.on");return o?o.textContent.trim():""})(),' +
      '    卡片数: document.querySelectorAll("#board .card").length,' +
      '    置灰数: document.querySelectorAll("#board .card.done").length,' +
      '    弹窗存在: !!document.getElementById("doneModal"),' +
      '    列头: Array.prototype.map.call(document.querySelectorAll("#board .ch-count"),function(x){return x.textContent.trim()})' +
      '  })},600)})})()');
    console.log('已完成视图: ' + JSON.stringify(r1, null, 1));

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
