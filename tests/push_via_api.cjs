// git 走代理失败时，用 GitHub API 直接把提交推上去（blob → tree → commit → ref）
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const T = process.env.GH_TOKEN;
const H = {
  Authorization: 'Bearer ' + T, 'User-Agent': 'awb',
  Accept: 'application/vnd.github+json', 'Content-Type': 'application/json'
};
const API = 'https://api.github.com/repos/Simiely/agent-workbench';
const ROOT = path.dirname(__dirname);

const BASE = process.argv[2] || '5ace04316585981f9075e114a7bf9b608da4762d';
const REF = process.argv[3] || 'main';
const TAG = process.argv[4] || 'v1.3.2';
const MSG = process.argv[5] || 'fix(gh): 版本号过长时不再撑破仓库卡片（v1.3.2）';

async function api(path, method, body) {
  const r = await fetch(API + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch (e) { j = t; }
  if (!r.ok) { console.error('API 失败', method, path, r.status, String(t).slice(0, 300)); process.exit(1); }
  return j;
}

(async () => {
  // 1) 本次改动文件（相对 BASE）
  const names = execFileSync('git', ['diff', '--name-status', BASE, 'HEAD'], { cwd: ROOT, encoding: 'utf8' })
    .trim().split('\n').map(l => l.split('\t'));
  const baseCommit = await api('/git/commits/' + BASE, 'GET');
  const baseTree = baseCommit.tree.sha;

  // 2) 每个文件建 blob
  const entries = [];
  for (const [st, file] of names) {
    const buf = fs.readFileSync(path.join(ROOT, file));
    const blob = await api('/git/blobs', 'POST', { content: buf.toString('base64'), encoding: 'base64' });
    entries.push({ path: file, mode: '100644', type: 'blob', sha: blob.sha });
    console.log('blob ' + st + ' ' + file + ' → ' + blob.sha.slice(0, 8));
  }

  // 3) 建 tree / commit
  const tree = await api('/git/trees', 'POST', { base_tree: baseTree, tree: entries });
  const commit = await api('/git/commits', 'POST', {
    message: MSG, tree: tree.sha, parents: [BASE]
  });
  console.log('commit →', commit.sha.slice(0, 8));

  // 4) 推 ref（快进）
  await api('/git/refs/heads/' + REF, 'PATCH', { sha: commit.sha, force: false });
  console.log('ref ' + REF + ' → ' + commit.sha.slice(0, 8));

  // 5) 打 tag（轻量标签足够 GitHub Release 用）
  try {
    await api('/git/refs', 'POST', { ref: 'refs/tags/' + TAG, sha: commit.sha });
    console.log('tag ' + TAG + ' 已创建');
  } catch (e) {
    console.log('tag 创建跳过（可能已存在）');
  }

  // 6) 校验
  const ref = await api('/git/ref/heads/' + REF, 'GET');
  console.log('校验 ' + REF + ' =', ref.object.sha.slice(0, 8), (ref.object.sha === commit.sha ? '✓' : '✗'));
})().catch(e => { console.error('E', e.message); process.exit(1); });
