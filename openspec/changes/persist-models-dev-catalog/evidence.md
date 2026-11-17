# 验证证据

- 故障：用户提供 Pi 0.11.3 diagnostics，12 个 metadata-unavailable、models.dev degraded、LKG 0。独立 Core 重放当前线上公开目录后 12 个均可发布；未保存凭据或私网响应。
- 旧实现负向回放：`.tmp/catalog-negative/result.txt`，新缓存测试 3 fail / 1 pass；修复后全部通过。
- `test/catalog-persistence.test.ts`：restart reads the successful disk catalog without contacting models.dev；failed latest request preserves disk catalog across another restart；invalid disk content is ignored and mirror URLs do not reuse another source；invalid latest catalog cannot replace the previous complete catalog。
- `[CATALOG-RESTART]`：新宿主状态通过真实 Core 从磁盘缓存发布模型；Pi 额外确认成功空清单删除。对应 incremental-discovery.test.ts / sync.test.ts。
- Pi 完整产品测试 272 pass / 3 平台 skip；OpenCode 完整产品测试 250 pass。typecheck、固定 SHA 产物复验通过。
- 真实宿主 E2E 与远端 CI 尚待执行，不能以单元测试代替。未合并、未发版、未验证用户本机恢复。

## 范围与限制

公开 catalog 可跨两个 adapter 复用；仅保存成功的完整目录，来源隔离，不保存 LiteLLM 数据。重启仍重新解析本地公开目录，不重新获取本地已命中的模型。新安装没有缓存时仍依赖第一次联网。未加入模型家族特判、默认 limits 或绕过发布门槛。

## 补充验证

首次真实宿主 CI 的旧 LKG/临时故障注入只重置内存，新磁盘缓存被正确恢复，未进入预期故障分支。E2E 显式清除两个缓存层后继续验证真正无目录的 LKG 路径；没有降低原有断言。新增 `[CATALOG-RESTART-NEW]` 验证首次启动遇到新增模型元数据请求失败时，先捕获已有本地匹配为 LKG，已有模型不丢失且新增模型在源恢复后可重试。最终产品测试 Pi 274 pass / 3 skip，OpenCode 252 pass。真实宿主重跑待回读。
