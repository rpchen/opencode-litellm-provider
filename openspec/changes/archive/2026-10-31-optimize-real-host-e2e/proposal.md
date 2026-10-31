# Proposal

## Why

真实OpenCode E2E成功路径约13分钟，主要生命周期转换串行等待真实后台发现；另有已验证输入在版本提交与合并过程反复执行完整矩阵。用户已批准先完成单轮并行提速，再做实际输入验证分流；减少PR数量不作为减少CI次数的依据。

## What Changes

- 将真实E2E按宿主/模型/管理、价格/LKG、元数据恢复、通知/故障四组隔离执行，保留全部旧断言及各自真实状态前置。
- 统一解析并锁定当轮宿主安装输入，增加计时与唯一同名required check汇总；失败、取消、缺组不得成功。
- 移除npm test内部重复调用的索引与OpenSpec工具测试，保留CI已有独立必跑步骤，并在本地复验命令列明。
- 后续阶段仅在真实输入与成功完整基线相符时复用行为矩阵，当前候选仍做真实安装/加载/身份/模型请求验证；不匹配完整执行。
- 用固定产品输入的旧串行基准和至少两次完整并行验证交付性能结果，不以补计时完成代替提速。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `release-governance`: 完整真实宿主门禁可由全部隔离分组汇总；记录实际输入及适用的结果复用边界。

## Impact

修改测试脚本、CI及治理文档；不改变产品discovery、30秒下限、TTL/backoff、src/dist或Core业务语义。宿主依赖面仍是既有installer、HTTP/session/command/RPC、PTY、模型与凭据接口；这些experimental接口的兼容风险继续由真实宿主测试覆盖，不新增宿主API。分流共享约定在Core及Pi各自change互引，Pi tag完整E2E及Release附件责任保留。
