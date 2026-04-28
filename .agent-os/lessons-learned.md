# Lessons Learned

- `EXP-001` `[rejected]`: 对公开仓库保留私人本地路径、历史快照来源或外部项目来源链
  - Reason: 这些信息对公开使用者没有运行价值，却会泄露内部环境与历史上下文
  - Retry condition: 无；公开仓库默认应保留公开可用、与当前实现直接相关的材料

- `EXP-002` `[rejected]`: 在公开 surface 中保留个人作者邮箱
  - Reason: 开源分发元数据需要组织级身份，不应强绑个人隐私信息
  - Retry condition: 仅在明确需要公开维护邮箱时再重新引入

- `EXP-003` `[rejected]`: 在 `re-init` 的 migration backup 中无差别复制生成态 dashboard 依赖树
  - Reason: `tools/dashboard/frontend/node_modules`、`dist` 等目录可再生成，却会把一次 `re-init` 的备份体积膨胀到百兆级，直接把集成测试超时预算吃满
  - Retry condition: 只有在用户明确要求“把第三方依赖目录也纳入 migration backup”时才重新放开；默认应继续跳过 `node_modules`、`dist`、`__pycache__`、`.pytest_cache`

- `EXP-004` `[rejected]`: 直接把系统默认 `/tmp` 当成本轮验证的唯一临时目录
  - Reason: 当前机器的 overlay 根盘已接近写满，`pytest tmp_path` 与 runtime 临时写入会出现大面积假失败，掩盖真正代码回归
  - Retry condition: 若系统 `/tmp` 容量恢复健康可重新使用；否则继续把高写入验证导向仓库外的大容量共享盘路径
