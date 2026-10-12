# Tasks

## 1. 实现

- [x] 1.1 以 Core 分组后的 `model_name` 集合识别新增、删除和未变化模型；未变化项复用上次成功 publication/ProviderSnapshot。
- [x] 1.2 只对新增模型执行 Core publication/diagnostics；删除项撤销注册，保持 withheld、publication gate 与 LKG 语义。
- [x] 1.3 移除 models.dev 6 小时 TTL；保留本地快照、force 最新请求和既有失败退避。

## 2. 验证与文档

- [x] 2.1 增加模型列表不变、新增本地命中、新增本地未命中、仅删除、同名 route 变化测试。
- [x] 2.2 更新 models.dev cache 测试、README 和 canonical spec delta，记录用户可见刷新行为变化。
- [x] 2.3 运行 OpenCode 完整交付门禁及 Real OpenCode 2.0.16 E2E；Ubuntu CI run `38250080359` 通过，普通 CI 与真实宿主门禁均通过。
- [x] 2.4 通过 OpenSpec strict validation 后使用 CLI archive，并再次验证 closure。
