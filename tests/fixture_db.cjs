// 测试夹具：与 server.mjs --reseed 同一套演示数据，日期全部相对「今天」生成。
// 用途：audit_*.cjs / e2e_local.cjs 启动 server 前，把 CAP_STORAGE_DIR 指到
// tests/_out/storage-<端口> 临时目录并落一份 db.json —— 测试自给自足，
// 永远不读不写真实数据目录（../agent-workbench-data）。
'use strict';

function makeDb() {
  const daysAgo = (n, h = 10) => {
    const d = new Date(Date.now() - n * 86400000);
    d.setHours(h, 20, 0, 0);
    return d.toISOString();
  };
  return {
    machines: [
      { _id: 'm1', '机器名': '台式机-家', '位置': '家', '最后确认': daysAgo(0), '排序': 1 },
      { _id: 'm2', '机器名': '笔记本', '位置': '随身', '最后确认': daysAgo(1), '排序': 2 },
      { _id: 'm3', '机器名': 'N100-小主机', '位置': '客厅', '最后确认': daysAgo(6), '排序': 3 },
    ],
    // 登录账号：台式机-家 的 WorkBuddy 有两个号（主号在用、备用号闲置），其余每机一个
    accounts: [
      { _id: 'a1', '账号名': 'WB-主号', '平台': 'WorkBuddy', '所属电脑': '台式机-家', '当前': true, '备注': '公司号', '最后确认': daysAgo(0), '排序': 1 },
      { _id: 'a2', '账号名': 'WB-备用号', '平台': 'WorkBuddy', '所属电脑': '台式机-家', '当前': false, '备注': '个人号', '最后确认': daysAgo(20), '排序': 2 },
      { _id: 'a3', '账号名': 'TRAE-主号', '平台': 'TRAE', '所属电脑': '台式机-家', '当前': true, '备注': '', '最后确认': daysAgo(0), '排序': 1 },
      { _id: 'a4', '账号名': 'WB-副号', '平台': 'WorkBuddy', '所属电脑': '笔记本', '当前': true, '备注': '', '最后确认': daysAgo(1), '排序': 1 },
      { _id: 'a5', '账号名': 'TRAE-副号', '平台': 'TRAE', '所属电脑': '笔记本', '当前': true, '备注': '', '最后确认': daysAgo(1), '排序': 1 },
      { _id: 'a6', '账号名': 'WB-主号', '平台': 'WorkBuddy', '所属电脑': 'N100-小主机', '当前': true, '备注': '', '最后确认': daysAgo(6), '排序': 1 },
    ],
    _meta: { accountsMigrated: daysAgo(0) },
    tasks: [
      { _id: 't1', '任务标题': 'ae-tools v1.5.8 发布联调', '状态': '进行中', '优先级': 'P1', '所在电脑': '台式机-家',
        '目录': 'D:\\ae-tools', '进度': 'CHANGELOG / panel README / 测试文件三件套已同步',
        '待办': '[x] 版本号对齐 v1.5.8\n[x] 测试文件更新\n[ ] MountainSpectrum 解耦「父层变换」与「控制点固定形状」\n[ ] 沙箱验证后推 remote',
        '交接内容': '解耦时先动 src/ 下的变换矩阵，控制点数组结构保持不变，回滚点见 CHANGELOG v1.5.7。',
        '更新时间': daysAgo(0, 9), '排序': 1 },
      { _id: 't2', '任务标题': 'local-llm-playbook 部署方案评估', '状态': '进行中', '优先级': 'P1', '所在电脑': '台式机-家',
        '目录': 'D:\\local-llm-playbook', '进度': '候选模型对比表已建，待补权重评分',
        '待办': '[ ] Qwen3 / GLM 系列在 16GB VRAM 的实测\n[ ] hf-mirror 与 modelscope 下载脚本\n[ ] 定稿「一套主方案 + 参数级切换」',
        '交接内容': '阅读模式是逐篇处理（5000+ 字中文长文档），32K 上下文够用，不要整本书方案。',
        '更新时间': daysAgo(1, 15), '排序': 2 },
      { _id: 't3', '任务标题': 'floorplan 编辑器 v0.3 做减法', '状态': '进行中', '优先级': 'P2', '所在电脑': '笔记本',
        '目录': 'D:\\home-inventory', '进度': 'paint/fill/sample/split 已合并成多步流程',
        '待办': '[ ] 移除剩余低频工具\n[ ] 渲染端 floorplan.js 与模块源码对齐\n[ ] 作为子模块嵌入宿主',
        '交接内容': '产品可用性优先，必要时调整 home-inventory 宿主来适配模块，不要反过来。',
        '更新时间': daysAgo(2, 11), '排序': 1 },
      { _id: 't4', '任务标题': 'LoginStateSwitcher 12 槽位维护', '状态': '进行中', '优先级': 'P0', '所在电脑': '台式机-家',
        '目录': 'C:\\tools\\LoginStateSwitcher', '进度': 'MultiSwitch 切换正常，GitHub 已同步',
        '待办': '[ ] WorkBuddy 侧新增账号的槽位登记\n[ ] exe 重新打包',
        '交接内容': '',
        '更新时间': daysAgo(3, 20), '排序': 3 },
      { _id: 't5', '任务标题': '本地 AI 视频三线部署', '状态': '进行中', '优先级': 'P2', '所在电脑': '台式机-家',
        '目录': 'E:\\ai-video', '进度': 'FlashVSR 升频跑通，SeedVR2 显存待调',
        '待办': '[ ] SeedVR2 在 16GB VRAM 的分段策略\n[ ] MiniMax H3 生成链路验证\n[ ] E 盘素材目录整理',
        '交接内容': '素材进 E:\\素材，产出统一落 E:\\产出，C 盘只放程序和模型。',
        '更新时间': daysAgo(5, 14), '排序': 4 },
      { _id: 't6', '任务标题': '知识库项目推 GitHub（四件套）', '状态': '已完成', '优先级': 'P2', '所在电脑': '笔记本',
        '目录': 'D:\\knowledge-base', '进度': 'README / AGENTS / DEVELOPMENT / CHANGELOG 已齐',
        '待办': '[x] single-project 模板套用\n[x] 推送 Simiely/knowledge-base',
        '交接内容': '',
        '更新时间': daysAgo(4, 18), '排序': 2 },
      { _id: 't7', '任务标题': 'HyperOS 4 定制 AOD', '状态': '已完成', '优先级': 'P2', '所在电脑': '笔记本',
        '目录': '', '进度': '主题编辑器产出 mtz，已刷机预览',
        '待办': '[x] AOD 版式设计\n[x] 刷机验证',
        '交接内容': '字体渲染在深色下偏细，后续版本可以加粗一档。',
        '更新时间': daysAgo(9, 16), '排序': 3 },
      { _id: 't8', '任务标题': 'Slay the Spire 2 存档备份', '状态': '已完成', '优先级': 'P2', '所在电脑': 'N100-小主机',
        '目录': 'C:\\Saves\\StS2', '进度': '255 层进度已备份，自定义 profile 已留档',
        '待办': '[x] Goldberg/GSE 存档目录定位\n[x] 备份脚本',
        '交接内容': '',
        '更新时间': daysAgo(12, 21), '排序': 5 },
    ],
    github: [
      // 记录级状态 = 是否同步（本地做完还没推就是「未同步」）；仓库级 = 是否归档
      { _id: 'g1', '同步时间': daysAgo(0, 9), '电脑': '台式机-家', 'GitHub账号': 'Simiely', '仓库': 'Simiely/ae-tools', '内容': 'v1.5.8 发布：CHANGELOG + panel README + 测试文件', '同步版本': 'v1.5.8', '是否同步': '已同步', '仓库归档': false },
      { _id: 'g2', '同步时间': daysAgo(1, 16), '电脑': '台式机-家', 'GitHub账号': 'Simiely', '仓库': 'Simiely/ae-tools', '内容': 'MountainSpectrum 控制点驱动重构', '同步版本': 'v1.5.7', '是否同步': '已同步', '仓库归档': false },
      { _id: 'g3', '同步时间': daysAgo(2, 11), '电脑': '台式机-家', 'GitHub账号': 'Simiely', '仓库': 'Simiely/ae-tools', '内容': '低频工具合并，本地先攒着', '同步版本': 'v1.5.6', '是否同步': '未同步', '仓库归档': false },
      { _id: 'g4', '同步时间': daysAgo(3, 10), '电脑': '台式机-家', 'GitHub账号': 'Simiely', '仓库': 'Simiely/LoginStateSwitcher', '内容': 'MultiSwitch 12 槽位加密调整', '同步版本': 'v2.3.0', '是否同步': '已同步', '仓库归档': false },
      { _id: 'g5', '同步时间': daysAgo(4, 18), '电脑': '笔记本', 'GitHub账号': 'Simiely', '仓库': 'Simiely/knowledge-base', '内容': 'README 先行', '同步版本': 'v0.1.0', '是否同步': '已同步', '仓库归档': false },
      { _id: 'g6', '同步时间': daysAgo(6, 13), '电脑': '笔记本', 'GitHub账号': 'Simiely', '仓库': 'Simiely/knowledge-base', '内容': 'AGENTS / DEVELOPMENT / CHANGELOG 三件套完成，还没推', '同步版本': 'v0.2.0', '是否同步': '未同步', '仓库归档': false },
      { _id: 'g7', '同步时间': daysAgo(6, 15), '电脑': '台式机-家', 'GitHub账号': 'Simiely', '仓库': 'Simiely/workbuddy-skills', '内容': 'scenario-walkthrough v3 上架', '同步版本': 'v3.0.0', '是否同步': '已同步', '仓库归档': false },
      { _id: 'g8', '同步时间': daysAgo(8, 20), '电脑': '笔记本', 'GitHub账号': 'Simiely', '仓库': 'Simiely/home-inventory', '内容': 'floorplan 子模块嵌入改造', '同步版本': 'v0.3.0', '是否同步': '已同步', '仓库归档': false },
      { _id: 'g9', '同步时间': daysAgo(11, 14), '电脑': '笔记本', 'GitHub账号': 'Simiely', '仓库': 'Simiely/home-inventory', '内容': '低频工具合并成多步流程，本地先攒着', '同步版本': 'v0.3.1', '是否同步': '未同步', '仓库归档': false },
      { _id: 'g10', '同步时间': daysAgo(13, 9), '电脑': '台式机-家', 'GitHub账号': 'Simiely', '仓库': 'Simiely/tools-center', '内容': 'tool.json V1 兼容映射验证', '同步版本': 'v0.7.0', '是否同步': '已同步', '仓库归档': false },
      { _id: 'g11', '同步时间': daysAgo(20, 15), '电脑': '台式机-家', 'GitHub账号': 'Simiely', '仓库': 'Simiely/local-llm-playbook', '内容': 'playbook 骨架', '同步版本': 'v0.1.0', '是否同步': '已同步', '仓库归档': false },
      { _id: 'g12', '同步时间': daysAgo(30, 16), '电脑': '笔记本', 'GitHub账号': 'Simiely', '仓库': 'Simiely/hyperos-aod-theme', '内容': 'AOD 定制主题定稿，项目结束归档', '同步版本': 'v1.0', '是否同步': '已同步', '仓库归档': true },
    ],
  };
}

// 把种子落到 dir/db.json（目录不存在则创建），返回 dir 供 CAP_STORAGE_DIR 使用
function seedFixture(dir) {
  const fs = require('fs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(require('path').join(dir, 'db.json'), JSON.stringify(makeDb(), null, 2));
  return dir;
}

module.exports = { makeDb, seedFixture };
