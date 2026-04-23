# Lessons Learned

## Exploration Records

- `EXP-001` `[rejected]`: 将内部合同层直接暴露为公开 skills
  - Motivation: 试图把 core / audit / exec / memory / counsel / testing 模块化为可复用 skill
  - Method: 在 plugin `skills/` 目录下直接放置 `thoth-*` 公开 skill
  - Result: 安装后这些内部模块直接出现在公开 slash surface 中
  - Why not selected: 这会污染用户可见命令面，不符合宿主体验与产品边界
  - Retry condition: 仅当宿主未来支持真正的内部非公开 skill 模块机制时才值得重访

- `EXP-002` `[rejected]`: 为 Codex 单独暴露公开 `:codex` 命令变体
  - Motivation: 希望让 `/thoth:run:codex`、`/thoth:loop:codex`、`/thoth:review:codex` 看起来更直接
  - Method: 为每个主命令新增独立公开 codex 变体
  - Result: 公共命令面膨胀，并形成伪二级命令结构
  - Why not selected: 宿主不提供真正的层级命令树，executor-mode 更干净且更符合控制平面设计
  - Retry condition: 除非宿主未来引入正式的子命令树语义，否则不重试

- `EXP-003` `[rejected]`: 把公开命令 frontmatter 改成 bare names
  - Motivation: 试图让 plugin namespace 仅由宿主提供，从而避免双重 namespace
  - Method: 将 `name: thoth:run` 一类前缀改成 bare `run`
  - Result: 实际安装后命令裸露为 `/run`、`/loop` 等，不符合期望
  - Why not selected: 当前宿主行为要求明确保留 `/thoth:*` 公共命令名
  - Retry condition: 仅当宿主将 plugin command names 的 namespace 行为文档化并与当前行为不同步时再重审

- `EXP-004` `[rejected]`: 把早期完整插件蓝图当成当前 checkout 已实现事实
  - Motivation: 早期蓝图信息量高，容易被误当成当前仓库能力
  - Method: 直接沿用旧蓝图描述当前 repo 结构与能力
  - Result: 与当前 repo 实现状态及后续 V2 规划发生错位
  - Why not selected: 当前 repo 必须以代码事实为准，规划材料只能作为目标架构与设计依据
  - Retry condition: 无；这是长期 truthfulness guardrail

- `EXP-005` `[rejected]`: 在当前机器上使用 Claude marketplace 的 GitHub shorthand `Royalvice/Thoth`
  - Motivation: 希望让 Claude 与 Codex 都统一用简短的 GitHub repo 形式安装 marketplace
  - Method: 执行 `claude plugin marketplace add Royalvice/Thoth`
  - Result: 本机 Claude CLI 在 clone 到 `/root/.claude/plugins/marketplaces/Royalvice-Thoth` 时失败；随后改用完整 Git URL 成功
  - Why not selected: 当前这台机器上的 Claude marketplace 对 shorthand 路径处理存在实际失败；完整 Git URL 更稳
  - Retry condition: 若后续 Claude CLI 修复该路径处理或在其他机器上验证 shorthand 稳定，可重新评估 README 是否补充 shorthand 形式
