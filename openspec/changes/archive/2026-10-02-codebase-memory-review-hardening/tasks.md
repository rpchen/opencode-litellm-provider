## 1. 发布工具修复

- [x] 1.1 解析原生 indexed 状态并拒绝所有非成功返回。
- [x] 1.2 统一工作刷新为规范化 Git 根目录派生身份。
- [x] 1.3 同步四仓库发布工具与对应测试。

## 2. 验证与交付

- [x] 2.1 旧实现复现降级结果被接受，新增 [CBM-DEGRADED] 回归通过；原有五个测试通过。
- [x] 2.2 更新开发文档并执行 strict validation 与 closure。
- [x] 2.3 使用 CLI archive 同步 canonical specs，再次 strict validation。
