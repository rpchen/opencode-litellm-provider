# shared-discovery-core Specification

## Purpose
定义独立 LiteLLM discovery core 的唯一维护位置、OpenCode 宿主边界、完整 SHA 的更新构建、缓存真实性、固定产物复验及与构建环境无关的安装契约。

## Requirements

### Requirement: 共享发现逻辑的唯一维护位置

宿主无关的 LiteLLM 发现与元数据逻辑 SHALL 只在 rpchen/litellm-discovery-core 维护；OpenCode SHALL 经公共入口消费，保留宿主适配、网络、刷新、凭据及审计职责。

#### Scenario: 中立模型适配到 OpenCode
- **WHEN** 共享 core 返回不包含 package 的 ModelSpec
- **THEN** OpenCode 适配层 SHALL 使用既有协议 SDK 映射补齐宿主数据，且协议、能力、价格、限制、推理和模型排序保持兼容。

#### Scenario: 不维护本地业务副本
- **WHEN** 开发者更新宿主无关发现规则
- **THEN** 修改 SHALL 位于独立 core；本仓库只生成被 Git 忽略的源码并提交编译产物，不保留手工同步的 core 实现。

### Requirement: 更新构建固定一次完整 SHA

更新构建 SHALL 显式解析 core/main 的完整 commit SHA，并对类型检查、测试、编译使用同一 SHA；提交的 provenance SHALL 包含公开仓库、分支和 SHA，不包含凭据、本机路径或不确定时间戳。

#### Scenario: 更新构建期间 main 前移
- **WHEN** 选定 SHA 后远端 main 出现新提交
- **THEN** 当前构建 SHALL 继续使用已选定 SHA；下一次显式更新构建才采用新提交。

#### Scenario: 非法显式输入
- **WHEN** 指定的 SHA 不是完整的 40 位十六进制字符串
- **THEN** 准备步骤 SHALL 在 Git 获取或修改生成目录之前失败。

### Requirement: 缓存与 Git commit 内容一致

源码准备 SHALL 核对提交身份并拒绝脏的缓存工作树，同时从选定 commit 的 Git 对象导出受版本控制的源码，不从可能变化的工作树复制业务实现。

#### Scenario: 任一类别的缓存污染
- **WHEN** 缓存存在暂存、未暂存或未跟踪文件修改
- **THEN** 准备 SHALL 明确失败，不清理污染、不继续编译，也不生成声称原 SHA 的产物。

#### Scenario: 干净环境获取
- **WHEN** 没有平级仓库、缓存或预生成 core
- **THEN** 显式更新构建 SHALL 从公开独立仓库获取源码，并完成生成和编译。

### Requirement: 固定复验验收待交付产物

CI 和 Release SHALL 读取候选 dist/core-provenance.json，以其 SHA 在独立目录重建，再比较候选 dist 的全部路径与字节；不得先删除或覆盖候选 dist，不得在复验时解析最新 main。

#### Scenario: provenance 缺失或无效
- **WHEN** provenance 不存在、不可解析、来源不符或 SHA 无效
- **THEN** 固定复验 SHALL 失败，不回退最新 main。

#### Scenario: 候选产物有差异
- **WHEN** 候选 dist 存在内容修改、缺失文件、多余文件或符号链接
- **THEN** 复验 SHALL 失败，且保持候选产物不变。

#### Scenario: 已发布输入保持不变
- **WHEN** core/main 在插件发布后发生变化
- **THEN** 已发布插件和其固定复验输入 SHALL 不变，只有下一次插件更新构建才纳入新 core。

### Requirement: 安装与运行独立于构建环境

交付包 SHALL 包含 core 编译产物、声明和 provenance，保持既有 OpenCode 入口及 peer 契约；安装和运行不得下载 core 或依赖源码、平级目录、构建缓存、生命周期脚本。

#### Scenario: 外部消费者禁用安装脚本
- **WHEN** 独立消费者在源码工作区以外通过 npm install --ignore-scripts 安装产物
- **THEN** 测试 SHALL 在独立进程确认入口解析自已安装包，并执行必要的插件初始化；提供宿主 peer，明确区分替身测试与真实宿主验证。
