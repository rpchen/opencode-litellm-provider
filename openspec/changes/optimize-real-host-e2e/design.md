# Design

## Context

参见proposal；只读审计固定bdd64df，成功E2E约773–794秒。用户已审核v2并授权实施。性能先独立交付，分流后续同步共享约定。

## Goals / Non-Goals

完成全部真实场景的单轮墙钟提速及可核验结果复用。不改变src/dist/provenance、产品pollInterval下限、TTL/backoff或主分支规则，不合并或发版。

## Decisions

采用A/B/C/D独立进程/runner，每组独立HOME/XDG/fake端点。A保留安装/激活/snapshot/全模型请求/blocked以及管理→legacy→ghostless旧凭据与activation因果链。B真实发现19模型后验证价格与LKG删除重加；C从无recovery身份LKG的真实基线验证metadata恢复/删除修复；D从修复后catalog真实基线验证ack重启、当轮notify及网络/auth恢复。抽取pure fixture/bootstrap helper，不重复A全部63次请求，不伪写snapshot/ack/credential文件。

默认完整执行，保留串行all模式供固定candidate对照；计时输出阶段、等待标签/次数、CLI和断言耗时，不记录敏感输入。缩短1秒观察间隔不是本次主要优化手段，全部恢复继续自然trigger(false)，不引入强刷或timer后门。

一次resolve-host产生精确宿主与普通npm manifest/lock；每组同锁npm ci到临时prefix，实际宿主installer安装固定candidate。Windows不支持PTY，本地只做适用静态/单元校验，真实性能由Ubuntu CI验证。同名汇总job显式依赖resolve及四组，完整模式所有result严格success才成功，缺组/意外skip/cancel/failure均失败；索引仍跟随准确main整体CI成功。

分流仅允许明确文档与版本字段变化；candidate与harness分别核对完整Git对象，宿主锁/Node/npm/OS/runner配置匹配且基线为实际完整成功才能复用；缺证据完整跑。当前候选必须真实安装/加载/身份/注册/请求。每轮重新解析latest及宿主锁，不能以旧锁冻结新输入。共享规范改动另在Core/Pi关联change记录，不复制Core业务逻辑。

| 现有行为差异 | 理由 |
|---|---|
| 单长进程变独立四组汇总 | 独立重建真实前置，保留全部场景，减少关键路径串行等待 |
| latest宿主全局安装变临时prefix锁安装 | 同轮固定宿主输入，支持精确对照及后续输入核对 |
| 主保护check由单job变汇总 | required名称/规则不变，完整性显式检查 |
| npm test不再嵌套执行索引与闭环工具测试 | CI已有test:codebase-memory与test:openspec-closure独立必跑步骤；保留全覆盖并在AGENTS列出本地命令，消除已核实重复 |

## Risks / Trade-offs

重复bootstrap会增加runner用量，A可能成为长组；先实测再决定是否独立管理组，并真实重建旧状态。4–6分钟是工程目标，不是已测收益。宿主锁外可变下载若不能约束则关闭复用，性能改造不受阻。

## Migration Plan

先只计时且all串行基准1次，再全部四组至少2次；同candidate/宿主锁/Node/npm，分别记录harness与runner差异。完整断言/请求映射、汇总负向、常规CI、独立review通过后archive；保留all入口支持回归和回滚调度。不创建更新构建，不改变交付产物。


## 实际输入复用实施

resolve中用已安装宿主运行当前candidate的delivery探针，再比较Git双输入、当轮精确宿主锁、实际安装包的外部依赖锁、各组自身环境与GitHub完整run/attempt/job/step。读取失败回退full；交付探针失败阻断门禁。仅full产出可复用记录，delivery不产出基线。汇总在delivery模式要求resolve成功、有效完整基线run/attempt和所有完整组明确skipped，拒绝混合成功/失败/缺失状态。

Core和Pi对应change均为verified-e2e-input-reuse，共享测试规范与adapter流程同步；Pi tag仍完整E2E，OpenCode Release原有交付/附件验证不减少。常规CI与准确main索引每次重跑，保护check名称/strict规则不改。

后续实测41178587569在A管理重启的单次同步command耗14.5秒，该时段fake服务与测试同进程且被spawnSync阻塞。此一处改为同宿主HTTP路由异步请求，保留payload/auth与全部原断言，并单独计时；不据此改任何产品timer或强刷语义。
