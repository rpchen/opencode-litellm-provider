# Delta: model-discovery

## ADDED Requirements

### Requirement: models.dev catalog 来源、形状与 modelsDevUrl 语义

OpenCode SHALL 从 `https://models.dev/catalog.json` 获取 models.dev 数据（单请求、
`providers` 与 `models` 同 snapshot、同 TTL epoch、同 failure domain；60 s 超时、
6 h TTL、60 s retry、失败降级为空对象并走 Core unavailable 路径的既有语义不变）。
`modelsDevUrl` 仍接受自定义 http(s) 镜像，但镜像 MUST 为 catalog 形状；
provider-only（`api.json` 形状）或不可用 payload 由 Core 按其 `catalog-input`
契约处理，OpenCode 仅透传并在诊断中提示改用 catalog 形状。形状校验、registry
可用性、identity、authority、merge 全在 Core。

#### Scenario: 默认拉取 catalog 快照

- **WHEN** 扩展刷新 models.dev 数据且未配置 `modelsDevUrl`
- **THEN** 请求 `https://models.dev/catalog.json`，成功后同一 TTL 内复用，不再请求 `api.json`

#### Scenario: provider-only 镜像降级不断

- **WHEN** `modelsDevUrl` 指向 provider-only 镜像
- **THEN** Core 不做 canonical 解析，LiteLLM 完整者仍发布，其余 withheld + 有效 LKG 可恢复，诊断提示改用 catalog 形状
