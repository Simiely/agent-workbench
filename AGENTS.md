# AGENTS.md · 项目规则

> 📌 **文档基线**：2026-10-31（commit `543edfb`）完成四件套重写
> **更新文档/代码后，请更新此行**（日期 + 新 commit hash），并在 CHANGELOG 追加版本

## 技术栈

- Node ≥ 18（ESM，`.mjs`），**零 npm 依赖**——只用 `node:http / fs / path / crypto / url`
- 前端：单文件 `public/index.html`，**ES5 风格**（IIFE + `var` + 字符串拼 DOM + 事件委托），无构建步骤
- 测试：Python 3（`tests/run_all.py` 统一入口）+ 零依赖 CDP 客户端（`tests/cdp.cjs`）+ headless Chromium（Playwright 缓存的 `chrome-headless-shell`）

## 关键坑（改动前必读）

- **`data-gi-range` 的值是语义字符串（week/month/q3），禁止 `parseInt`**——曾因 parseInt 全变 NaN 导致点「本周/本月」静默失效
- **headless 测试里合成 `dispatchEvent(new KeyboardEvent(...))` 走隔离执行环境，主 world 业务监听器收不到**（同 world 探针却收得到，严重误导排查）。测键盘一律 CDP 原生 `Input.dispatchKeyEvent`
- **容器 id 改名 = DOM 搬家，事件绑定必须跟着迁**，否则功能静默失效（按钮还在、点不动）
- **弹窗加宽类 `xl` 只在 `renderSheetLayer` 入口统一 toggle，`closeDrawer` 里同步移除**——在各渲染函数里零散加减会残留
- **测试绝不读写真实数据目录**（`../agent-workbench-data`）：一律用 `tests/fixture_db.cjs` 夹具 + `tests/_out/storage-<端口>`，server 侧靠 `CAP_STORAGE_DIR` 环境变量隔离

## 约定

- UI 标签与代码注释都用中文；页面是单文件，直接改 `public/index.html`，没有生成步骤
- 数据与代码分离：仓库里没有任何运行时数据；首启即空壳，演示数据用 `--reseed` 按需生成
- 颜色 5 档热力（`giLevel`/`hm`）头部与日历共用同一套配色规则，改一处要两处对齐
- 断言基线快照（`tests/_baseline/`）是有意契约：值变化 = 行为变化，先确认再 `--bless`

## 常用命令

```bash
node server.mjs [端口] [--reseed]     # 起服务（默认 8151）
python tests/run_all.py [--bless]     # 全部测试（5 套件 + e2e + 9 体检）
python tests/run_all.py mk_v16        # 只跑单套件
node tests/shot_intensity.cjs 8282 out.png   # 开发强度实拍（需先起一个带数据的服务）
```

## 详细规则（按需查看）

- DOM 属性契约：@docs/DOM-ATTRIBUTES.md
- 架构与扩展指南：@docs/ARCHITECTURE.md
- 关键问题与方案：@DEVELOPMENT.md
