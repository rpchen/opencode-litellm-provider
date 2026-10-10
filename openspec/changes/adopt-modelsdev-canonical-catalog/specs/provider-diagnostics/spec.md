# Delta: provider-diagnostics

## ADDED Requirements

### Requirement: 诊断与 TUI 展示 canonical 与 serving 事实

诊断与 TUI 模型卡片 SHALL 在 Core 提供时展示：canonical identity 与证据、
serving 状态与 provider/record、推理档位状态（`unknown` 显示
`models_dev_provider` 恢复提示）、operator-configuration 键（明确不是
enforcement）、诊断候选、catalog 形状。Core 未提供这些字段时（旧 Core）SHALL
省略对应行，不崩溃、不编造。`serving-record-unresolved` /
`declared-unmatched` SHALL 给出可操作修复行（精确 wire id 或更改 provider 声明）。

#### Scenario: serving 未证明的档位 unknown 附恢复提示

- **WHEN** 某模型 canonical 已证明、serving 未证明、档位 unknown
- **THEN** 诊断/TUI 显示档位 unknown 及恢复提示，不展示任何可选档位

#### Scenario: unresolved serving 给出可操作修复

- **WHEN** 某模型为 `serving-record-unresolved` 或 `declared-unmatched`
- **THEN** 显示 warning 行并列出可精确命中的 SKU 候选
