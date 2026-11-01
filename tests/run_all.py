# -*- coding: utf-8 -*-
"""统一回归 runner：生成断言页 → headless Chromium 执行 → 读 document.title → 与基线快照比对。

用法：
    python tests/run_all.py            # 跑全部套件（有基线则比对，无基线则建立）
    python tests/run_all.py mk_v16     # 只跑指定套件
    python tests/run_all.py --bless    # 强制重建基线快照

判定规则：
    1. 页面抛异常 → title 含 FATAL → FAIL
    2. 断言里有 null 叶节点（通常代表「该元素没找到」）→ FAIL
    3. 与基线快照存在差异 → FAIL，列出变化的键（这是真正的回归信号）
    4. 其余 → PASS

基线文件：tests/_baseline/<suite>.json，首次运行自动生成。
"""
import io
import json
import os
import re
import subprocess
import sys

TD = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TD)
OUTROOT = os.path.join(TD, '_out')
BASE = os.path.join(TD, '_baseline')

# 套件定义：生成脚本 → 产出的 HTML 文件名列表
# legacy/ 下是被新版本取代的旧套件（断言指向已移除的 UI），默认不跑，保留作历史参考。
SUITES = [
    ('mk_v16', ['v16.html']),
    ('mk_manage', ['m.html']),
    ('mk_guide', ['p.html']),
    ('mk_regress', ['r_main.html', 'r_nomach.html']),
    ('mk_reg3', ['b3.html']),
]


def find_chrome():
    """定位 chrome-headless-shell。优先环境变量，其次 Playwright 缓存目录。"""
    env = os.environ.get('CHROME_HEADLESS')
    if env and os.path.isfile(env):
        return env
    local = os.environ.get('LOCALAPPDATA', '')
    root = os.path.join(local, 'ms-playwright')
    if os.path.isdir(root):
        for d in sorted(os.listdir(root), reverse=True):
            if d.startswith('chromium_headless_shell'):
                p = os.path.join(root, d, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe')
                if os.path.isfile(p):
                    return p
    return None


def gen_suite(name):
    """运行生成脚本，产出带断言的 HTML。"""
    gen = os.path.join(TD, name + '.py')
    if not os.path.isfile(gen):
        return False, '生成脚本缺失'
    try:
        subprocess.run([sys.executable, gen], cwd=TD, check=True,
                       capture_output=True, timeout=120)
    except subprocess.CalledProcessError as e:
        err = (e.stderr or b'').decode('utf-8', 'replace')[-500:]
        return False, '生成失败: ' + err.replace('\n', ' ')
    except subprocess.TimeoutExpired:
        return False, '生成超时'
    return True, ''


def run_html(chrome, path):
    """跑一次 headless，返回 document.title。"""
    try:
        p = subprocess.run(
            [chrome, '--headless', '--disable-gpu', '--no-sandbox',
             '--dump-dom', '--virtual-time-budget=8000',
             'file:///' + path.replace('\\', '/')],
            capture_output=True, timeout=120)
    except subprocess.TimeoutExpired:
        return None
    dom = p.stdout.decode('utf-8', 'replace')
    m = re.search(r'<title[^>]*>(.*?)</title>', dom, re.S)
    return m.group(1).strip() if m else None


def parse_title(title):
    """解析 title → (data, err)。支持 RESULT:: / RESULT2:: / DONE: 前缀。"""
    if not title:
        return None, '无 title（页面可能未执行到断言）'
    m = re.match(r'^RESULT\d*::(.*)$', title, re.S)
    if m:
        try:
            return json.loads(m.group(1)), None
        except Exception as e:
            return None, 'JSON 解析失败: %s' % e
    if 'DONE:' in title:
        try:
            return json.loads(title.split('DONE:', 1)[1]), None
        except Exception as e:
            return None, 'JSON 解析失败: %s' % e
    return None, 'title 不含断言标记: ' + title[:120]


def flatten(obj, prefix=''):
    """展平成 {路径: 叶子值}。"""
    out = {}
    if isinstance(obj, dict):
        for k, v in obj.items():
            out.update(flatten(v, prefix + '.' + str(k) if prefix else str(k)))
    elif isinstance(obj, list):
        out[prefix] = json.dumps(obj, ensure_ascii=False, sort_keys=True)
    else:
        out[prefix] = obj
    return out


def null_leaves(flat):
    return sorted(k for k, v in flat.items() if v is None)


def diff_flat(a, b):
    """比较两个展平字典，返回差异描述列表。"""
    msgs = []
    for k in sorted(set(a) | set(b)):
        if k not in a:
            msgs.append('  + 新增 %s = %r' % (k, b[k]))
        elif k not in b:
            msgs.append('  - 缺失 %s (基线 %r)' % (k, a[k]))
        elif a[k] != b[k]:
            msgs.append('  ~ 变化 %s: %r → %r' % (k, a[k], b[k]))
    return msgs


def main():
    args = sys.argv[1:]
    bless = '--bless' in args
    only = [a for a in args if not a.startswith('--')]

    chrome = find_chrome()
    if not chrome:
        print('FATAL 找不到 chrome-headless-shell')
        print('      设置环境变量 CHROME_HEADLESS=<绝对路径> 后重试')
        return 2

    suites = [s for s in SUITES if not only or s[0] in only]
    if not suites:
        print('没有匹配的套件，可选：' + ', '.join(s[0] for s in SUITES))
        return 2
    if not os.path.isdir(BASE):
        os.makedirs(BASE)

    print('chromium: ' + chrome)
    print('=' * 70)
    failed = []
    blessed = []

    for name, files in suites:
        ok, err = gen_suite(name)
        if not ok:
            print('%-12s FAIL   生成阶段: %s' % (name, err))
            failed.append(name)
            continue
        outdir = os.path.join(OUTROOT, name)
        basepath = os.path.join(BASE, name + '.json')
        base = {}
        if os.path.isfile(basepath):
            base = json.load(io.open(basepath, encoding='utf-8'))
        suite_blessed = False

        for f in files:
            path = os.path.join(outdir, f)
            if not os.path.isfile(path):
                print('%-12s SKIP   %s 未产出' % (name, f))
                continue
            title = run_html(chrome, path)
            data, perr = parse_title(title)
            if perr:
                print('%-12s FAIL   %-14s %s' % (name, f, perr))
                failed.append('%s/%s' % (name, f))
                continue
            if isinstance(data, dict) and 'FATAL' in data:
                print('%-12s FAIL   %-14s FATAL: %s' % (name, f, str(data['FATAL'])[:250]))
                failed.append('%s/%s' % (name, f))
                continue

            flat = flatten(data)
            nulls = null_leaves(flat)
            key = f[:-5]
            cur = base.get(key, {})

            if bless or key not in base:
                base[key] = flat
                blessed.append('%s/%s' % (name, f))
                suite_blessed = True
                note = '基线已建立（%d 项）' % len(flat)
                if nulls:
                    print('%-12s WARN   %-14s %s；空断言 %d: %s'
                          % (name, f, note, len(nulls), ', '.join(nulls[:5])))
                else:
                    print('%-12s BASELINE %-12s %s' % (name, f, note))
                continue

            msgs = diff_flat(cur, flat)
            if nulls:
                print('%-12s FAIL   %-14s 空断言 %d: %s'
                      % (name, f, len(nulls), ', '.join(nulls[:6])))
                failed.append('%s/%s' % (name, f))
                continue
            if msgs:
                print('%-12s FAIL   %-14s 与基线有 %d 处差异' % (name, f, len(msgs)))
                for m in msgs[:12]:
                    print(m)
                failed.append('%s/%s' % (name, f))
                continue
            print('%-12s PASS   %-14s %d 项断言与基线一致' % (name, f, len(flat)))

        # 该套件的基线立即落盘（每个套件独立一个文件，互不覆盖）
        if suite_blessed:
            json.dump(base, io.open(basepath, 'w', encoding='utf-8'),
                      ensure_ascii=False, indent=1, sort_keys=True)
            print('  → 基线已写入 %s' % os.path.relpath(basepath, ROOT))

    print('=' * 70)
    if blessed:
        print('本次新建基线: ' + ', '.join(blessed))
    if failed:
        print('FAILED: ' + ', '.join(failed))
        return 1
    print('ALL PASS  (%d suites)' % len(suites))

    # e2e 单独跑（默认只在无过滤参数时跑，避免单套件调试时受端口占用影响）
    if not only and not bless:
        if not run_e2e():
            return 1
        if not run_audit():
            return 1
    return 0


def run_e2e():
    """本地版 e2e：真实 node server + 真实 fetch（Node 侧零依赖 CDP 客户端）。"""
    import subprocess as sp
    e2e = os.path.join(TD, 'e2e_local.cjs')
    if not os.path.isfile(e2e):
        print('e2e_local.cjs 不存在，跳过')
        return True
    print('=' * 70)
    print('运行本地版 e2e（真实 server + 真实 fetch）...')
    try:
        p = sp.run(['node', e2e, '8171'], cwd=ROOT, capture_output=True, timeout=240)
    except sp.TimeoutExpired:
        print('e2e 超时')
        return False
    out = p.stdout.decode('utf-8', 'replace')
    for line in out.strip().split('\n'):
        print(line)
    if p.returncode != 0:
        err = p.stderr.decode('utf-8', 'replace').strip()
        if err:
            print(err[-600:])
        return False
    return True


def run_audit():
    """视图状态体检：一致性 + 守卫清零。"""
    import subprocess as sp
    print('=' * 70)
    ok = True
    for script, port, title in [
        ('audit_view_state.cjs', '8172', '运行视图状态一致性体检...'),
        ('audit_no_guards.cjs', '8173', '运行守卫清零审计...'),
        ('audit_write_paths.cjs', '8174', '运行真实写路径体检...'),
        ('audit_edge_cases.cjs', '8175', '运行边界情况体检...'),
        ('audit_sheet.cjs', '8176', '运行弹窗形态审计...'),
        ('audit_sheet_nav.cjs', '8178', '运行弹窗导航栈体检...'),
        ('audit_repo_card.cjs', '8177', '运行仓库卡交互体检...'),
        ('audit_gh_header.cjs', '8180', '运行 GitHub 看板头部体检...'),
        ('audit_platform_proxy.cjs', '8181', '运行平台反代适配体检...'),
        ('audit_account_edit.cjs', '8182', '运行机器菜单与账号编辑体检...'),
        ('audit_journey.cjs', '8179', '运行端到端旅程体检...'),
        ('audit_a11y.cjs', '8183', '运行无障碍体检（键盘 / aria / label 关联）...'),
    ]:
        path = os.path.join(TD, script)
        if not os.path.isfile(path):
            print(script + ' 不存在，跳过')
            continue
        print(title)
        try:
            p = sp.run(['node', path, port], cwd=ROOT, capture_output=True, timeout=240)
        except sp.TimeoutExpired:
            print('超时')
            ok = False
            continue
        out = p.stdout.decode('utf-8', 'replace')
        for line in out.strip().split('\n'):
            print(line)
        if p.returncode != 0:
            err = p.stderr.decode('utf-8', 'replace').strip()
            if err:
                print(err[-600:])
            ok = False
    return ok


if __name__ == '__main__':
    sys.exit(main())
