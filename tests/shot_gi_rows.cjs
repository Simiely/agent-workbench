// v39 附加实拍：本周（1 排）/ 近3个月（3 排）两个范围
const { launch } = require('./cdp.cjs');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.argv[2] || '8282', 10);
const OUT = path.join(__dirname, '..', 'design');

(async () => {
  const browser = await launch();
  const { cdp } = browser;
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await browser.goto('http://127.0.0.1:' + PORT + '/');
  await cdp.waitFor('(function(){return document.querySelectorAll("#ghIntensity .gi-cell").length>0})()', 15000);
  await new Promise(r => setTimeout(r, 600));
  async function shot(range, out) {
    await cdp.evalJson('(function(){document.querySelector(\'[data-gi-range="' + range + '"]\').click();return 1})()');
    await new Promise(r => setTimeout(r, 400));
    const box = await cdp.evalJson('(function(){var r=document.getElementById("ghIntensity").getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};})()');
    const s = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: box.x - 8, y: box.y - 8, width: box.w + 16, height: box.h + 16, scale: 1 } });
    fs.writeFileSync(out, Buffer.from(s.data, 'base64'));
    console.log('saved ' + out);
  }
  await shot('week', path.join(OUT, 'gh-intensity-v40-week.png'));
  await shot('q3', path.join(OUT, 'gh-intensity-v40-q3.png'));
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
