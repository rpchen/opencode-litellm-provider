# Tasks

## 1. 场景与计时

- [x] 1.1 核查固定SHA旧断言及A/B/C/D前置映射；证据在workspace .tmp/ci-e2e-audit/implementation-assertion-map.md，正式测试说明随实施入库。
- [x] 1.2 添加阶段/等待/命令纯计时并保留all串行入口；node --check通过，基准真实运行1次。
- [x] 1.3 复验已有/v1/model/info固定fixture单元测试，保持样本/快照零差异；运行npm test及fixture Git检查。

## 2. 单轮性能

- [x] 2.1 实现四组真实隔离bootstrap与场景，保留全请求、自然恢复、历史凭据/activation及通知重启；逐项断言映射回读并真实执行所有组。
- [x] 2.2 实现临时宿主锁安装、resolve与同名汇总门禁；Node单元覆盖success/failure/cancel/skipped/missing，真实CI证明失败不误绿。
- [x] 2.3 补正式E2E运行/覆盖文档并验证命令、required check与ruleset一致；不改src/dist/provenance。
- [x] 2.4 同candidate/宿主锁对照旧串行1次与完整并行至少2次，报告墙钟/最长链/runner总用量与环境差异；目标未达继续实测定位。

## 3. 实际输入分流

- [x] 3.1 实现candidate/harness Git对象与版本JSON字段比较及正负测试；非允许差异/缺基线/环境变化全跑。
- [x] 3.2 绑定实际完整矩阵成功run与当轮宿主锁/配置，验证复用不递归引用smoke；当前候选真实安装/加载/身份/注册/请求通过。
- [x] 3.3 与Pi/Core各自OpenSpec互引并同步共享完整CI约定，Pi tag全量/附件责任保留；严格规格与闭环检查通过。

## 4. 集成与交付

- [x] 4.1 完成适用常规CI、真实宿主全组、汇总失败传播与候选CI索引生成证据（不要求未授权main发布），独立gpt-6-astra代码审核后修复并主会话验收。
- [x] 4.2 回填实测证据，通过CLI archive及strict validate；各受影响仓库PR互链，不合并、不tag、不发版。

## 已完成证据（2026-10-31）

完整并行两轮41173813192/41173828296均成功；同candidate facb0c0、OpenCode2.2.5与宿主锁对照旧串行。关键路径302/296秒，对照806秒；runner用量+21–22%，详见docs/e2e-performance.md。原断言映射、244产品测试与43场景通过，交付/fixture零差异。后续真实失败传播与复用集成证据如下，不据单元测试代替。

## 最终实施验收证据

完整：41178587569(5069db5)与41179401172(e114658)全A–D及常规CI成功，full/complete；版本PR41179240839(40279ae)在真实merge checkout引用41178587569/1，当前真实探针17秒、四组明确skipped、无新full记录。实际受控B失败41179266423，A/C/D成功但唯一aggregate明确失败。规则API回读CI+Real OpenCode latest E2E/strict/squash保持；Release/index/merge-gate文件无差异，候选CI索引生成步骤通过，不要求未授权main发布/finish。

Astra报告phase4-astra-review：Pi浅checkout和过时说明已修，删除无实际旧基线支持的步骤名兼容/递归记录查找；基线模块修订后50测试通过。父回读并补真实验收；仅一处管理重启异步HTTP实测14.5秒→355ms，全部后续TUI断言通过。完整累计及成本见docs/e2e-performance.md，不混淆phase2约5分钟与phase3 6:08/6:03。

最终工作流移除已证实未使用的harness npm ci，保留宿主锁/实际plugin安装和常规CI；归档后的最终准确SHA CI负责无harness node_modules的完整验证。跨仓PR：Core40、Pi64、workspace4；测试临时PR75/76和分支/worktree已关闭清理。没有合并/tag/Release。归档与最终CI记录属于PR最后验收，不能把前轮绿色冒称最终提交通过。
