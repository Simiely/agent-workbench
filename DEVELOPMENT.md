# DEVELOPMENT.md · 开发者手册

## 项目概览

Agent 工作台：给 AI Agent 的日常开发做台账 + 看板 + 交接。三张表（任务 / 机器登录态 / GitHub 同步记录），左右分屏单页应用，零依赖 Node 服务 + JSON 文件存储。

- 代码仓库即全部程序：`server.mjs`（约 400 行）+ `public/index.html`（约 3500 行，唯一前端真源）
- 数据与代码分离：运行时数据在仓库外 `../agent-workbench-data/`（平台托管时在 `CAP_STORAGE_DIR`）
- 测试体系：5 个快照回归套件（298 项断言）+ e2e + 9 个真实浏览器体检脚本，统一入口 `python tests/run_all.py`

架构细节（分层、数据流、渲染管线、扩展指南）见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)；DOM 属性契约见 [docs/DOM-ATTRIBUTES.md](docs/DOM-ATTRIBUTES.md)。

## 关键问题与方案

### 问题：范围切换点了没反应（parseInt 静默失效）

**TL;DR**：值的语义从数字改成语义字符串后，解析代码没跟着改。

- 问题：`data-gi-range` 从 `7/30/90` 改成 `week/month/q3` 后，`parseInt(...)` 全变 NaN 再 `|| 30` 兜底 → 点「本周/本月」永远落到近3个月
- 根因：值的语义变了，解析方式没跟着改；NaN 兜底把错误藏住了
- 解决：`var r = rb.getAttribute('data-gi-range'); if (r !== S.ghIntensityRange) {...}`——字符串直传，比较即判
- 预防：**值的语义变了，解析代码必须跟着改；枚举值禁止 parseInt**

### 问题：headless 测试里 Esc「失灵」（假警报）

**TL;DR**：合成键盘事件在 headless 里走隔离执行环境，根本到不了业务监听器。

- 问题：`document.dispatchEvent(new KeyboardEvent('keydown'))` 后弹窗不关，怀疑产品代码
- 根因：合成事件走隔离 world；同 world 注入的探针能收到（计数正常），主 world 的业务监听器收不到——探针「正常」严重误导排查方向
- 解决：用 CDP 原生 `Input.dispatchKeyEvent`（`type:'rawKeyDown'/'keyUp'` + `windowsVirtualKeyCode:27`）验证——Esc 一直正常
- 预防：**测键盘/输入一律 CDP 原生注入；「探针收到」≠「业务监听器收到」**

### 问题：KPI 迁位后「未同步」筛选点不动

**TL;DR**：容器 id 改名（DOM 搬家），事件绑定没跟着迁。

- 问题：KPI 从 `#ghSummary` 迁到 `#ghKpis` 后按钮还在、点击无效
- 根因：事件监听绑在旧 id 上，旧容器已不存在
- 解决：绑定跟着容器走；`tests/audit_gh_header.cjs` 加「筛选生效」断言兜底
- 预防：**改 id 先全局搜旧 id 的 addEventListener**

### 问题：普通弹窗被撑宽（xl 类残留）

**TL;DR**：加宽修饰类散落在多处加减，关闭时漏删。

- 问题：开过全年日历（`xl` 1320px）后，再开普通弹窗仍是超宽
- 根因：`closeDrawer` 只删 `on` 不删 `xl`
- 解决：`renderSheetLayer` 入口统一 `classList.toggle('xl', kind==='intensity')`，`closeDrawer` 同步移除；体检脚本断言「关闭后恢复标准宽」
- 预防：**修饰类集中在入口/出口一对函数里管理，不零散加减**

### 问题：测试污染真实数据（数据外置后新坑）

**TL;DR**：测试 spawn 的 server 默认读真实数据目录，必须用环境变量隔离。

- 问题：数据目录从仓库内 `.data/` 外置后，audit/e2e 起 server 会读写 `../agent-workbench-data/`，且依赖「库里恰好有演示数据」
- 根因：测试没有自己的数据边界，隐式依赖宿主环境
- 解决：`tests/fixture_db.cjs` 提供 `seedFixture(dir)`（相对日期种子）；10 个测试脚本 spawn server 时统一 `env.CAP_STORAGE_DIR = tests/_out/storage-<端口>`，落盘校验也读同一目录
- 预防：**测试自带夹具 + 显式存储目录，任何「首次跑通」都必须在空数据机器上成立**

### 问题：开发强度单排布局下方大量留白

**TL;DR**：固定格高 + 单排撑不满面板，改多排 + flex 自适应。

- 问题：面板对齐 KPI 高度（~156px）后单排 22px 格子下方浪费 ~70px
- 根因：格高写死、排数写死（1 排）
- 解决：`giRangeRows(range)` 单一事实源产出排数组（week 1 排 / month 2 排 / q3 按自然月 3 排），`.gi-rows/.gi-rowblock` 纵向 `flex:1` 平分高度；数字字号 `fitGiNum()` 按格子短边算出写入 CSS 变量 `--gi-num`，`ResizeObserver` 跟随面板尺寸
- 预防：**格子尺寸不写死 px；注意 flex 布局里「字号→格子尺寸」不要形成回环（格子尺寸须由 flex 决定）**
