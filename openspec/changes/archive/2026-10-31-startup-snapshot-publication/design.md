# Design

## Context

宿主可能在首轮发现结束之前读取和缓存模型。现有代码已经校验并恢复持久化快照，但状态门禁禁止发布，且初始化未等待本地恢复。

## Decisions

先完成本地 connection、配置与快照兼容校验并发布，然后结束初始化；网络发现继续异步执行。引入 snapshot 状态表示已发布但未由本进程网络确认；成功后转 active，暂时错误保留 snapshot，认证及 notfound 继续清除。沿用现有 endpoint fingerprint、凭据和 activation 门禁。

## Risks / Trade-offs

初始化增加本地存储与凭据读取耗时，但不等待网络。宿主 reload 和初始化顺序须由真实 OpenCode 固定版本验证；避免把模拟测试当作真实宿主证据。
