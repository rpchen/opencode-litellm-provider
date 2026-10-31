# 完整真实宿主E2E性能验证

2026-10-31，固定candidate `facb0c0a824091bec4409d0dcee73012a3e2f353`。产品src/dist未改变，全部旧场景保留；旧串行harness为`bdd64df970a6001b35f55ecee6b2efb25d3a0324`，四组harness为candidate提交。

## 同输入结果

| 指标（秒） | 旧串行对照 | 四组第1轮 | 四组第2轮 |
|---|---:|---:|---:|
| E2E分支关键路径（resolve开始→最后门禁/串行job完成） | 806 | 302 | 296 |
| 单组/旧串行测试步骤：A | 766（完整旧串行） | 250 | 252 |
| B测试步骤 | 包含于旧串行 | 172 | 171 |
| C测试步骤 | 包含于旧串行 | 201 | 199 |
| D测试步骤 | 包含于旧串行 | 240 | 242 |
| E2E相关job总runner-seconds（含resolve与汇总） | 804 | 984 | 976 |

新关键路径约5分钟，较同输入旧串行减少约63%；E2E job总runner时间增加约21–22%。这是墙钟优化，不是计费节省证明；GitHub实际计费粒度与排队另计。

第1轮是[PR完整CI](https://github.com/rpchen/opencode-litellm-provider/actions/runs/41173813192)，第2轮与旧串行在[同一个手动benchmark](https://github.com/rpchen/opencode-litellm-provider/actions/runs/41173828296)中共享宿主锁，全部job成功。手动run整体历时包含旧串行，不能拿作新常规CI耗时。常规CI job两次分别93、103秒，与E2E并行。

两个resolve记录均为：OpenCode2.2.5、Node22.23.4、npm10.9.9、Linux x64、ubuntu24 image `20261026.354.1`；host package-lock SHA-256均为`784b117422bf20d804de2d6f9575da47cbee7b3f443c6d119fb4709d154e7c79`。相同锁与记录不是整台虚机逐字节相同的证明。

## 为何变快

四个独立真实宿主各自建立必要状态，原有不同恢复链的自然30秒刷新等待重叠。第1轮B的5次refresh等待累计148秒、C的6次累计179秒，说明没有靠删除自然等待或改强刷获得提速；D保留真实通知/重启与网络/auth链。A仍保留全模型请求、blocked与管理/legacy/ghostless历史状态链，是当前最长组。

来源为Actions job/step时间戳及各组`e2e-timing-group-*` artifacts。计时JSON的嵌套phase会重叠，不相加当墙钟。原断言和因果前置映射见[e2e-validation.md](e2e-validation.md)，调度和基准命令见[e2e-ci.md](e2e-ci.md)。本数据不是之后任意宿主latest版本的时长保证；输入改变后仍须验证。
