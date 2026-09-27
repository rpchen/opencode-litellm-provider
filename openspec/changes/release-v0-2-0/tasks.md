## 1. 准备
- [x] 1.1 核对远端 main、既有分支/PR、发行约定及工具能力。
- [x] 1.2 建立本变更；固定已实测源码、dist 和 core SHA。

## 2. 实施
- [ ] 2.1 同步 manifest 与 lockfile 根版本为 0.2.0；依赖解析不变。
- [ ] 2.2 更新发行说明、README 和维护者实测记录，不夸大验证范围。
- [ ] 2.3 新增固定 tag 显式发行入口、版本元数据检查与回归测试、上传附件复核。

## 3. 验证与收尾
- [ ] 3.1 运行完整 CI，包括原 LiteLLM fixtures/快照、固定 dist、干净环境、外部安装、TUI 与 OpenSpec strict。
- [ ] 3.2 确认 src/dist/provenance 与实测提交完全相同，lockfile 仅根版本变更；检查临时 workflow 不在最终 diff。
- [ ] 3.3 同步 distribution 主规格并归档变更，再检查最终提交 CI。

## Operational Checklist

仅在以上步骤实际完成后执行并在 PR / Release 保留外部运行证据：合并 PR；main CI 成功；创建新 v0.2.0 tag；Release workflow 成功；附件及 SHA-256 复核。不得在尚未发生时把这些外部操作写成通过。
