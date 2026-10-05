# Tasks

- [x] storage key + restore/persist 生命周期 + 已持久化标记
- [x] `litellm-publication.state` 暴露 acknowledgement（仍为只读）
- [x] diagnostics 提醒状态行
- [x] `test/publication.test.ts`：跨 restart 抑制、material change 重新提醒、损坏记录不影响 publication
- [x] Real OpenCode v2 E2E（Ubuntu/PTY）：surface → restart 抑制 → material change 重新 surface
