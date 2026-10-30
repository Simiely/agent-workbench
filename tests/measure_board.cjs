// 量测看板宽度自适应情况：不同视口/分屏下，board 的 scrollWidth vs clientWidth、列宽、是否出横向滚动条
const { launch } = require('./cdp.cjs');
const { spawn } = require('child_process');
const path = require('path');

const PORT = parseInt(process.argv[2] || '8180', 10);
const ROOT = path.dirname(__dirname);

const PROBE = `(function(){
  var b=document.getElementById('board');
  var cols=b.querySelectorAll('.col');
  var vw=document.getElementById('viewBoard');
  var w=b.clientWidth, sw=b.scrollWidth;
  return {
    视口宽: window.innerWidth,
    看板容器宽: w,
    内容宽: sw,
    溢出: sw-w,
    有横向滚动条: sw>w+1,
    列数: cols.length,
    列宽: Array.prototype.map.call(cols,function(c){return Math.round(c.getBoundingClientRect().width)}),
    分屏比例: vw? vw.getBoundingClientRect().width : 0
  };
})()`;

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

    for (const [w, h] of [[1600, 900], [1400, 860], [1200, 800], [1000, 760]]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: w, height: h, deviceScaleFactor: 1, mobile: false
      });
      await browser.goto('http://127.0.0.1:' + PORT + '/');
      await cdp.waitFor('(function(){return document.querySelectorAll("#board .col").length>0})()', 15000);
      await new Promise(r => setTimeout(r, 600));
      const r = await cdp.evalJson(PROBE);
      console.log('视口 ' + w + 'px → ' + JSON.stringify(r));
    }
  } catch (e) {
    console.error('失败: ' + e.message);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})();
