# AGENTS.md · 项目规则

> 📌 **文档基线**：2026-11-02，v1.5.2（无障碍第一批 + 去装饰阴影 + 场景走查修复）
> **更新文档/代码后，请更新此行**（日期 + 新 commit hash），并在 CHANGELOG 追加版本

## 技术栈

- Node ≥ 18（ESM，`.mjs`），**零 npm 依赖**——只用 `node:http / fs / path / crypto / url`
- 前端：单文件 `public/index.html`，**ES5 风格**（IIFE + `var` + 字符串拼 DOM + 事件委托），无构建步骤
- 测试：Python 3（`tests/run_all.py` 统一入口）+ 零依赖 CDP 客户端（`tests/cdp.cjs`）+ headless Chromium（Playwright 缓存的 `chrome-headless-shell`）

## 关键坑（改动前必读）

- **机器表的 `WorkBuddy账号` / `TRAE账号` 是派生只读**：真相在 `accounts` 表（一台机 × 一个平台可多条，至多一条「当前」）。别再往机器记录里存账号值，读接口会按 accounts 现算；写入侧会自动翻译成「设为当前」
- **`data-gi-range` 的值是语义字符串（week/month/q3），禁止 `parseInt`**——曾因 parseInt 全变 NaN 导致点「本周/本月」静默失效
- **headless 测试里合成 `dispatchEvent(new KeyboardEvent(...))` 走隔离执行环境，主 world 业务监听器收不到**（同 world 探针却收得到，严重误导排查）。测键盘一律 CDP 原生 `Input.dispatchKeyEvent`
- **容器 id 改名 = DOM 搬家，事件绑定必须跟着迁**，否则功能静默失效（按钮还在、点不动）
- **弹窗加宽类 `xl` 只在 `renderSheetLayer` 入口统一 toggle，`closeDrawer` 里同步移除**——在各渲染函数里零散加减会残留
- **测试绝不读写真实数据目录**（`../agent-workbench-data`）：一律用 `tests/fixture_db.cjs` 夹具 + `tests/_out/storage-<端口>`，server 侧靠 `CAP_STORAGE_DIR` 环境变量隔离
- **服务端校验是最后一道闸**：`checkRecord()` 查必填/枚举/机器名唯一，`applyDefaults()` 补时间戳；新增字段时三处要同步——`SCHEMAS`、`REQUIRED/ENUMS`、`/api/contract.json`
- **基线只存不变量**：夹具用相对日期（`_iso(n)`），凡是「今天/本月/第几周」派生出的值，先换算成布尔再进断言
- **手机断点是 700，不是 640/760**：`--dump-dom` 默认视口 748，断点一旦越过 748，`mk_v16` 的列数断言会被判成手机形态（会假红）
- **浮层层级顺序**：T-bar 30 < 抽屉遮罩 40 / 抽屉 41 < 确认框遮罩 44 / 确认框 45；改任何一个都要检查弹窗能不能盖住底栏
- **KPI 高度是开发强度的对齐基准**：`renderGhIntensity` 读 `#summary .kpis` 的实际高度，改 KPI 的 padding/字号会连带影响右栏热力面板高度（`audit_gh_header` 会测）
- **详情就地编辑的委托顺序**：`[data-dt-set] → [data-dt-menu] → [data-dt-todo] → [data-dt-edit]` 必须排在 `[data-edit]` **之前**，否则被通用行内编辑抢走；单字段保存统一走 `saveTaskField()`（一个字段 + 更新时间），别在渲染函数里直接写库
- **账号冲突要看 `curOthers` 而不是 `others`**：`others` 只代表「别的电脑登记过这个号」，`curOthers` 才是「别的电脑也在用」。胶囊标红只在「本机当前就是这个号」时触发
- **顶栏电脑选择存 `localStorage('awb.aiMachine')`**：机器被删/改名要能退回第一台并纠正存储值，否则下拉会显示一个不存在的电脑

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
- 重构计划 + 注意事项 + 排障手册：@docs/REFACTOR-PLAN.md
- 待办清单（P1/P2/P3 + 验收口径）：@docs/TODO.md
