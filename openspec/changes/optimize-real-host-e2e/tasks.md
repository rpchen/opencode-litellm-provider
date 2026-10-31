# Tasks

## 1. 场景与计时

- [x] 1.1 核查固定SHA旧断言及A/B/C/D前置映射；证据在workspace .tmp/ci-e2e-audit/implementation-assertion-map.md，正式测试说明随实施入库。
- [ ] 1.2 添加阶段/等待/命令纯计时并保留all串行入口；node --check通过，基准真实运行1次。
- [ ] 1.3 复验已有/v1/model/info固定fixture单元测试，保持样本/快照零差异；运行npm test及fixture Git检查。

## 2. 单轮性能

- [ ] 2.1 实现四组真实隔离bootstrap与场景，保留全请求、自然恢复、历史凭据/activation及通知重启；逐项断言映射回读并真实执行所有组。
- [ ] 2.2 实现临时宿主锁安装、resolve与同名汇总门禁；Node单元覆盖success/failure/cancel/skipped/missing，真实CI证明失败不误绿。
- [ ] 2.3 补正式E2E运行/覆盖文档并验证命令、required check与ruleset一致；不改src/dist/provenance。
- [ ] 2.4 同candidate/宿主锁对照旧串行1次与完整并行至少2次，报告墙钟/最长链/runner总用量与环境差异；目标未达继续实测定位。

## 3. 实际输入分流

- [ ] 3.1 实现candidate/harness Git对象与版本JSON字段比较及正负测试；非允许差异/缺基线/环境变化全跑。
- [ ] 3.2 绑定实际完整矩阵成功run与当轮宿主锁/配置，验证复用不递归引用smoke；当前候选真实安装/加载/身份/注册/请求通过。
- [ ] 3.3 与Pi/Core各自OpenSpec互引并同步共享完整CI约定，Pi tag全量/附件责任保留；严格规格与闭环检查通过。

## 4. 集成与交付

- [ ] 4.1 完成适用常规CI、真实宿主全组、汇总失败传播与准确SHA索引证据，独立gpt-6-astra代码审核后修复并主会话验收。
- [ ] 4.2 回填实测证据，通过CLI archive及strict validate；各受影响仓库PR互链，不合并、不tag、不发版。
