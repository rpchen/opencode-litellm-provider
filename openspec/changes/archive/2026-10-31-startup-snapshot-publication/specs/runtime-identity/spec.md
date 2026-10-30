## MODIFIED Requirements

### Requirement: 真实宿主 E2E
Real OpenCode latest E2E SHALL 真实安装 candidate 后验证：插件加载成功；diagnostics 显示 Runtime Identity 且短值与 candidate 对应；Core Commit 与 provenance 一致；audit 含完整值；startup 含同一 identity；不依赖 `.git`；不读取用户真实配置或 credential。

#### Scenario: [REAL-HOST-E2E] 真实宿主闭环
- **WHEN** 在隔离 HOME/XDG 与本地 fake LiteLLM 中用宿主 installer 安装不可变 commit
- **THEN** 上述 diagnostics / audit / startup / provenance 断言全部通过
