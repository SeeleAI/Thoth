# Lessons Learned

- `EXP-001` `[rejected]`: 对公开仓库保留私人本地路径、历史快照来源或外部项目来源链
  - Reason: 这些信息对公开使用者没有运行价值，却会泄露内部环境与历史上下文
  - Retry condition: 无；公开仓库默认应保留公开可用、与当前实现直接相关的材料

- `EXP-002` `[rejected]`: 在公开 surface 中保留个人作者邮箱
  - Reason: 开源分发元数据需要组织级身份，不应强绑个人隐私信息
  - Retry condition: 仅在明确需要公开维护邮箱时再重新引入
