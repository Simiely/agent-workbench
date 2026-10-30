// 测量开发强度条形的实际宽度与数字裁切情况
const { launch } = require('./cdp.cjs');

const PORT = parseInt(process.argv[2] || '8194', 10);

(async () => {
  let browser = null;
  try {
    browser = await launch();
    const { cdp } = browser;
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1600, height: 900, deviceScaleFactor: 1, mobile: false
    });
    await browser.goto('http://127.0.0.1:' + PORT + '/');
    await cdp.waitFor(
      '(function(){return document.querySelectorAll("#ghIntensity .gi-row").length>0})()', 15000);
    await new Promise(r => setTimeout(r, 600));

    const info = await cdp.evalJson(
      '(function(){' +
      'var rows=Array.prototype.slice.call(document.querySelectorAll("#ghIntensity .gi-row"));' +
      'return rows.map(function(r){' +
      '  var bar=r.querySelector(".gi-bar"),tr=r.querySelector(".gi-track"),num=r.querySelector(".gi-num");' +
      '  return {txt:r.textContent.trim(),' +
      '   barW:Math.round(bar.getBoundingClientRect().width),' +
      '   trackW:Math.round(tr.getBoundingClientRect().width),' +
      '   inlineW:bar.style.width,' +
      '   numRight:Math.round(num.getBoundingClientRect().right),' +
      '   listRight:Math.round(document.querySelector("#ghIntensity .gi-list").getBoundingClientRect().right),' +
      '   numClipped:num.getBoundingClientRect().right>document.querySelector("#ghIntensity .gi-list").getBoundingClientRect().right+0.5};' +
      '});' +
      '})()');
    console.log(JSON.stringify(info, null, 1));
  } catch (e) {
    console.error('失败: ' + e.message);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
})();
