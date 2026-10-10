# Tasks

本轮是设计Review，实施任务保持未完成。共享测试矩阵和16模型oracle位于Core同名change，具体Scenario映射在本仓库scenario-evidence.md。

## 1. 设计与依赖

- [x] 1.1 按用户Review修订整记录语义与16模型验收；撤回内部身份和协议阻断，T05/T06不实施。
- [ ] 1.2 获得设计Review结论；确认Core已按独立PR授权合入并记录完整稳定SHA后才开始2–5。

## 2. 宿主映射与输入

- [ ] 2.1 以单一Core SHA更新构建和dist/provenance；引入真实名称构造的合成发现输入与公开catalog子集到test/fixtures，T01/T28逐16项对比。
- [ ] 2.2 更新host/models.ts与register.ts的Model.Info/variants/limits边界；T13–T15/T24/T30验证无默认扩张、不支持/无档位/未知区别，更新README映射说明。
- [ ] 2.3 删除本地cap/旧provider权威假设，contextTierCap只接受不生效；T16/T17证明价格变更不影响模型发布与限制。

## 3. 快照与用户诊断

- [ ] 3.1 消费Core9/2缓存契约并迁移restore scope；T18–T21/T25覆盖价格容错、旧schema、重启、model_name、endpoint/凭据隔离及内部route/base_model变化不失效；同步升级说明。
- [ ] 3.2 精简默认诊断并添加主动allowlist来源审计；T22/T23/T31贯穿Core→ProviderSnapshot→RPC/command→TUI，不泄露URL/route/key，不提示models_dev_provider。
- [ ] 3.3 更新新基线的测试预期、README、ADR与openspec/config.yaml旧context；同步本deltas及publication Purpose，T27检查无矛盾与错误fixture预期，历史archive不改。

## 4. 真实宿主验收

- [ ] 4.1 使用真实OpenCode2.0.16自身installer安装不可变candidate commit/tag；隔离HOME/XDG、两个本地fake endpoints与独立credentials，留存package/Core SHA。
- [ ] 4.2 执行T33：16项最终注册/picker逐字段断言、每声明effort实际请求、无档位和不支持推理请求、Chat/Responses/Messages路径与SDK初始化；mock/factory/package smoke不能替代。
- [ ] 4.3 在真实宿主中注入价格错误、catalog outage、恢复、删除、auth、重启/activation并检查UI与注册一致；保存脱敏证据，逐Scenario回填自动化测试名/CI run。

## 5. 完成门禁

- [ ] 5.1 运行verify:dist、test:delivery、typecheck、test、test:tui-render、test:distribution、test:package、Real OpenCode2.0.16 E2E和validate:spec、test:openspec-closure、test:release-metadata；记录具体命令、退出码及未执行项。
- [ ] 5.2 仅实现和证据齐全后CLI archive新change，再strict/closure；PR依赖Core与Pi验证结果，不得自动合并。
- [ ] 5.3 获授权合并后finish_codebase_task核对准确main/index字节；Release另行授权，固定provenance不得跟随新main重建。
