## 1. OpenSpec
- [x] 1.1 proposal / design / specs/runtime-identity（`openspec validate --all --strict --no-interactive` 通过）

## 2. Implementation
- [x] 2.1 `src/host/runtime-identity.ts` canonical 对象（读取、校验、短形式、单例缓存、测试缝）
- [x] 2.2 `scripts/` digest 共享实现 + `build.mjs` / `distribution.mjs` 生成 `dist/runtime-identity.json`
- [x] 2.3 `src/host/diagnostics.ts` 使用 canonical identity（短形式 Runtime Identity 块）
- [x] 2.4 `src/host/audit.ts` 导出完整 `runtimeIdentity`（单 + multi）
- [x] 2.5 `src/index.ts` startup log（同一 identity，不泄露凭据/路径，无网络/Git）
- [x] 2.6 `scripts/verify-dist.mjs` / `test-distribution.mjs` / `test-package.ts` 增加 identity ↔ bytes ↔ provenance 一致性验证
- [x] 2.7 `dist/` 按现有 provenance SHA 重建（含 identity），`verify:dist` 通过

## 3. Tests（Specification Scenario Coverage = 100%）
- [x] 3.1 `test/runtime-identity.test.ts`（schema 生成、version 来源、Core SHA 来源、digest 合法、顺序稳定、路径归一、自排除无递归、非法输入拒绝、clean rebuild 一致、文件变化敏感、metadata 自身变化不递归）
- [x] 3.2 diagnostics / audit / startup 同源断言（canonical 对象同一性）
- [x] 3.3 distribution verification 负向测试（missing / malformed identity 拒绝）
- [x] 3.4 package test（tarball 包含、可安装后读取、无 `.git`/源码依赖、provenance 一致）
- [x] 3.5 每个 Scenario 在测试名或注释中带 `[SCENARIO-ID]`（14/14 覆盖，手工核对通过；`check-scenario-coverage` 脚本仅覆盖 endpoint-management 能力）

## 4. Real host E2E
- [x] 4.1 Real OpenCode 2.0.16 E2E 脚本已更新：真实安装 candidate 后验证 diagnostics 短值、audit 完整值、startup 同一 identity、不依赖 `.git`、不读用户真实配置/凭据（本地 Windows 无 POSIX PTY，待 CI Ubuntu 运行）

## 5. README
- [x] 5.1 `README updated: Runtime Identity（diagnostics / audit-export / startup log）`

## 6. Closure
- [x] 6.1 `openspec archive add-runtime-identity` 后 `openspec validate --all --strict --no-interactive`，closure gate 通过（本提交即归档提交，CI 复验）

## Requirement / Scenario → Test Evidence

| Scenario | Evidence files |
|---|---|
| IDENTITY-FIELDS | test/runtime-identity.test.ts |
| DIGEST-DETERMINISTIC | test/runtime-identity.test.ts, scripts/test-distribution.mjs |
| SELF-EXCLUSION | test/runtime-identity.test.ts |
| DIAG-SHORT | test/diagnostics.test.ts |
| AUDIT-FULL | test/audit.test.ts, test/audit-command.test.ts, test/multi-audit-command.test.ts |
| STARTUP-LOG | test/index.test.ts |
| VERIFY-STRICT | scripts/test-distribution.mjs, scripts/verify-dist.mjs |
| PACKAGE-IDENTITY | scripts/test-package.ts |
| REPRODUCIBLE-BUILD | test/runtime-identity.test.ts, scripts/test-distribution.mjs |
| REAL-HOST-E2E | scripts/e2e-opencode-v2.mjs |
