// 发一个 GitHub Release：创建 release + 上传平台版 zip（附件名用 ASCII，中文会被 GitHub 吞掉）
const fs = require('fs');
const T = process.env.GH_TOKEN;
const H = {
  Authorization: 'Bearer ' + T, 'User-Agent': 'awb',
  Accept: 'application/vnd.github+json', 'Content-Type': 'application/json'
};
const API = 'https://api.github.com/repos/Simiely/agent-workbench';

const TAG = process.argv[2] || 'v1.3.2';
const NAME = process.argv[3] || 'agent-workbench-platform-' + TAG + '.zip';
const ZIP = process.argv[4] || ('C:/Temp/agent-workbench-releases/agent-workbench-平台版-' + TAG + '.zip');
const BODY = fs.readFileSync(process.argv[5] || 'C:/Temp/release-notes-' + TAG + '.md', 'utf8');

(async () => {
  const r = await fetch(API + '/releases', {
    method: 'POST', headers: H,
    body: JSON.stringify({ tag_name: TAG, name: process.argv[6] || TAG, body: BODY, draft: false, prerelease: false })
  });
  const j = await r.json();
  if (!r.ok) { console.error('创建失败', r.status, JSON.stringify(j).slice(0, 300)); process.exit(1); }
  console.log('release:', j.html_url);

  const buf = fs.readFileSync(ZIP);
  const up = j.upload_url.replace(/\{.*\}$/, '') + '?name=' + encodeURIComponent(NAME) + '&label=' + encodeURIComponent('平台版部署包');
  const ur = await fetch(up, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + T, 'User-Agent': 'awb', 'Content-Type': 'application/zip', 'Content-Length': String(buf.length) },
    body: buf
  });
  const uj = await ur.json().catch(() => ({}));
  console.log('附件:', ur.status, uj.name || uj.message || '');

  const fin = await (await fetch(API + '/releases/tags/' + TAG, { headers: H })).json();
  console.log('资产:', fin.assets.map(a => a.name + ' · ' + a.size + 'B').join(' | '));
  console.log('链接:', fin.html_url);
})().catch(e => { console.error('E', e.message); process.exit(1); });
