# DOM 属性登记表

> 这张表存在的唯一原因：**v19 发生过一次真实事故**——管理栏新增的 `data-mact` 与机器菜单原有的 `data-mact` 撞车，导致机器菜单当时 5 个动作（改名/位置/左移/右移/删除）全部被劫持，表现为「删除电脑无反应」。（v1.0.2 起该菜单只留「删除」，属性归属规则不变。）
>
> 根因不是撞车本身，而是**没有一张「谁拥有哪个动作与属性」的表**。新增属性前必须先查本表；表里没有的，先登记再用。

## 一、命名空间约定

| 前缀 | 归属 | 用途 |
|---|---|---|
| `data-mact` | **机器菜单**（列头 kebab 菜单） | 机器动作（v1.0.2 起只剩 `delete`） |
| `data-acc-input` | **账号输入入口**（账号下拉菜单内） | 打开「输入其他账号…」输入框 |
| `data-mid` | 机器菜单配套 | 目标机器 id |
| `data-mb` | **管理栏**（批量操作） | 批量删除/移动/改优先级等 |
| `data-act` | 任务卡操作区 | 卡片级动作 |
| `data-tid` / `data-task-id` | 任务标识 | 任务 id（两处不同用途，见下） |
| `data-g*` | GitHub 看板 | 仓库/同步记录相关 |
| `data-open` / `data-edit` | 通用入口 | 打开抽屉 / 进入行内编辑 |
| `data-add` | 新增菜单 | 4 个选项：task / gh / machine / guide |
| `data-s` | 分段控件 | 分段值（`进行中` / `全部` / `已完成`） |

**硬规则**：`data-mact` / `data-mid` 属于机器菜单，`data-mb` 属于管理栏，两者永不混用。历史上它们撞过一次。

## 二、逐属性登记

### 任务卡

| 属性 | 含义 | 出现处 |
|---|---|---|
| `data-tid` | 任务 id | 任务卡容器、待办勾选项（`data-dtoggle` 复合值） |
| `data-task-id` | 任务 id | 行内编辑态的 title 元素 |
| `data-open` | 点击打开任务抽屉 | 卡片标题区域 |
| `data-edit` | 可行内编辑的字段名（`taskTitle` / `machineName` / …） | 标题、列名等可编辑元素 |
| `data-act` | 卡片级动作 | 卡片操作区 |
| `data-task-menu` | 打开任务菜单的触发元素 | 卡片右上角 |
| `data-dtoggle` | 待办勾选：`任务id:行号` | 待办清单项 |

### 看板列 / 机器

| 属性 | 含义 | 出现处 |
|---|---|---|
| `data-mid` | 机器 id | 机器菜单项、列容器 |
| `data-mact` | 机器菜单动作：`delete`（v1.0.2 起；`rename`/`place`/`left`/`right` 已随菜单项下线，代码分支保留但无入口） | 机器菜单项（1 个） |
| `data-acc-input` | 账号自由输入入口，值形如 `<机器id>:wb` / `<机器id>:trae` | 账号下拉菜单底部 |
| `data-acc-save` / `data-acc-cancel` | 账号输入框的保存 / 取消 | 账号输入菜单按钮 |
| `data-machine` | 机器名（文本） | 列容器 |
| `data-machine-id` | 机器 id | 列容器 |
| `data-machine-menu` | 打开机器菜单的触发元素 | 列头 |

### GitHub 看板

| 属性 | 含义 | 出现处 |
|---|---|---|
| `data-repo` | `owner/repo` | 仓库卡容器、删整仓按钮 |
| `data-repo-add` | 新增同步记录 | 仓库卡按钮 |
| `data-repo-open` | 打开仓库详情弹窗（只读） | **仓库卡容器**（整卡判定，同 `data-open`） |
| `data-repo-toggle` | 展开/收起仓库下的同步记录 | 仓库卡按钮 |
| `data-gh-id` / `data-gid` | 同步记录 id | 同步记录行 |
| `data-gh-menu` | 打开同步记录菜单 | 同步记录行 |
| `data-gh-open` | 打开该条同步记录的编辑表单 | 仓库详情弹窗里的记录行 |
| `data-copy` / `data-copy-repo` | 复制仓库链接 | 仓库卡（独立按钮，不在仓库名上） |
| `data-gact` | 同步记录级动作 | 同步记录行 |
| `data-gk` | GitHub KPI 过滤键（目前只有 `unsync` 有行为） | `#ghKpis` 内的 KPI 按钮 |
| `data-gi-range` | 开发强度范围切换：`week` 本周 / `month` 本月 / `q3` 近3个月（**字符串本身就是唯一事实**，禁止 parseInt 转数字） | `#ghIntensity` 头部的范围按钮 |
| `data-gi-day` / `data-gi-n` | 开发强度格子：日期 / 当天去重仓库数 | `#ghIntensity` 的方块（`.gi-cell`，未来日期带 `.future`） |
| `data-hm-day` / `data-hm-n` | 日历热力图格子：日期 / 当天去重仓库数 | 弹窗内 `.hm` 格子（tooltip 委托用） |
| `data-hm-year` | 日历年份切换：`prev` / `next` | 弹窗年份导航按钮 |
| `data-hm-num` | 日历「显示数字」开关 | 弹窗头部按钮 |

### GitHub 看板头部（v40 布局）

| 容器 | 归属 | 内容 |
|---|---|---|
| `#ghKpis` | 概览数字 | 4 个低调内联数字（仓库 / 近30天版本 / 未同步 / 已归档），位于「选择电脑」下拉框**右侧同一行**。`data-gk="unsync"` 那个仍可点筛选 |
| `#ghIntensity` | 开发强度 | **多排方块格子热力**，每排左侧有排标签（`.gi-rowlabel`）：本周=1 排（周一~周日恒 7 格，标签「本周」）、本月=2 排（上半月 1~15 / 下半月 16~月末）、近3个月=3 排（最近 3 个自然月各一排，标签如「8月/9月/10月」）。**日期写在方块内**：每格一个小日期 `<em>`（几号，8.5px），有更新的格子再叠大数字 `<i>`；v39 的独立日期轴 `.gi-x` 已删。格子高度 `flex:1` 自适应撑满面板，大数字字号自适应（`fitGiNum()` 按格子短边 ~45%（高度预留日期位）算出写入 `--gi-num`，9~20px 夹逼；`ResizeObserver` 跟随面板尺寸变化）。未来日期画虚线灰格。**整块可点** → 打开按年日历热力弹窗（`kind: 'intensity'`，弹窗自动加 `.xl`）。高度与任务看板 KPI 四方块对齐（动态读取 `#summary .kpis`，本月 2 排时恰好对齐）。范围按钮只重绘头部（`renderGhIntensity`），不闪整栏。排切分单一事实源 = `giRangeRows(range)` |
| `#ghList` | 仓库卡列表 | 仓库聚合卡 |

> **搬位置的坑**：KPI 从 `#ghSummary` 迁到 `#ghKpis` 时，事件绑定必须跟着迁移 —— 否则「未同步」筛选会静默失效（按钮还在，点不动）。这类「DOM 搬家」的回归由 `tests/audit_gh_header.cjs` 兜底。
>
> **弹窗加宽的坑**：日历弹窗用 `renderSheetLayer` 入口 `classList.toggle('xl', kind==='intensity')` 统一管理，`closeDrawer` 里同步移除 —— 不要在各个渲染函数里零散加减 `xl`，否则切换面板时会残留。
>
> **范围值的坑**：`data-gi-range` 的值是语义字符串（week/month/q3）。曾用 `parseInt` 解析导致点「本周」被转成 NaN 再兜底成 30 —— 范围值**不许转数字**，字符串直传。
>
> **合成键盘事件的坑**：headless 测试里 `document.dispatchEvent(new KeyboardEvent('keydown'))` 走隔离执行环境，**主 world 的业务监听器收不到**（探针能收到，误导排查方向）。测 Esc 一律用 CDP 原生 `Input.dispatchKeyEvent`。
| `data-k` | 任务看板 KPI 过滤键 | KPI 按钮 |

### 管理模式 / 筛选 / 分段

| 属性 | 含义 | 出现处 |
|---|---|---|
| `data-mb` | 管理栏动作：`del-task` / `del-repo` / `sel-move` / `sel-prio` / `del-machine` 等 | 管理栏按钮 |
| `data-sel-move` | 批量移动目标机器 id | 移动下拉选项 |
| `data-sel-prio` | 批量优先级值 | 优先级下拉选项 |
| `data-pick` | 选择值（选择类下拉） | 选择项 |
| `data-switch` | 开关型筛选 | 筛选控件 |
| `data-key` | 通用键 | 通用 |
| `data-s` | 分段值（`全部` / `进行中`） | 分段按钮 |
| `data-add` | 新增菜单项值 | 新增菜单按钮 |

### 平台标记（已全部移除）

`data-page-node-id`、`data-pnid-children`、`data-sp-*` 是资料库平台的绑定标记，本项目已不再使用——`public/index.html` 里零残留。若将来从旧版本迁移过来看到这些属性，说明拿的是过期的页面文件。

## 三、新增属性前的检查流程

1. 查本表：属性名是否已被别的子系统占用？
2. 若未占用，选一个**带子系统前缀**的名字（`data-mb` / `data-g*` / `data-sel-*`），不要用裸名。
3. 在本表登记：属性名 / 含义 / 出现处。
4. 在事件委托处确保新属性**不会**被既有分支抢先命中——委托是「谁先匹配谁执行」，不是「谁更具体谁执行」。

## 四、事件委托分支顺序（踩坑点）

全局委托按 `closest('[data-xxx]')` 顺序匹配，**先命中先执行**。已知的顺序敏感点：

| 场景 | 症状 | 正确做法 |
|---|---|---|
| 管理栏 `data-mb` vs 机器菜单 `data-mact` | 机器菜单动作被吞 | 用不同属性名，从根上避免 |
| `data-open`（打开抽屉） vs `data-edit`（行内编辑） | 点标题总是进编辑 | 编辑分支要判 `closest('[data-edit]')` 命中且当前不在编辑态 |
| `del-repo`（删整仓） vs 「先点选对象」拦截 | 按钮可见但确认框不弹 | 删整仓分支**必须排在**「先点选」拦截之前 |
| `data-edit-task`（卡片编辑按钮） vs `data-open`（卡片容器） | 期望进表单却进了只读详情 | 两个语义不同：卡片容器挂 `data-open` 进详情，「编辑」按钮挂 `data-edit-task` 直接进表单。委托里 `[data-edit-task]` 分支必须排在 `[data-open]` **之前** |
| `data-repo-open`（仓库详情） vs `data-mb="del-repo"`（删整仓） | 点「删整仓」却打开了详情弹窗 | `data-mb` 分支排在前面并 `return`；仓库详情走独立属性 |
| **整卡判定 vs 卡内按钮** | 判定属性挂在卡片容器上时，点卡内任何按钮都会被卡片抢走 | 整卡判定分支必须排在**所有卡内按钮分支之后**。仓库卡里依次是：`data-mb`（删整仓）→ `data-copy-repo`（复制链接）→ `data-repo-toggle`（查看全部）→ `data-repo-add`（记录同步）→ `data-gh-menu`（⋯ 菜单）→ `data-gact`（菜单项）→ **最后**才是 `data-repo-open` |

**通用规则**：新增的「打开详情」类属性，要检查它**内部是否还嵌着别的可点元素**。若内层元素有自己的属性分支，只要那些分支排在前面并 `return`，就不会被外层抢走。

**整卡判定的两条铁律**：
1. 判定属性挂**容器**，不挂标题文字（标题降级为纯文本）
2. 判定分支排在**所有卡内按钮之后** —— 这是最容易踩的坑，因为 `closest()` 会从点击目标向上找到最近的匹配祖先，卡内按钮没有该属性时会被容器命中

## 五、id 约定

- `id` 只用于**全局唯一**的常驻元素（`board` / `ghList` / `ghKpis` / `ghIntensity` / `summary` / `mask` / `saveBtn` / `addBtn` …），共 187 个。
- 动态生成的元素（卡片、列、仓库）**不写 id**，用 `data-*` 承载标识，避免重复 id 与「拿到失效节点」的经典 bug。
- 测试脚本里取节点一律**现查现用**，不要复用重渲染前的引用。
