# OntologyOps

本地单租户的企业本体与受治理智能助手 MVP。首个演示领域为工厂采购、供应商、物料、库存与质检；平台必须能够使用新上传的数据和文档创建不同领域的本体。

## 当前状态

项目处于“产品与技术设计评审完成、准备进入 M0 资源注册与关系内核”的阶段。现有代码属于迁移前基座，其中固定工厂 SQL、关键词 Agent、固定风险回答和硬编码权限不能作为 v1 验收能力。

状态、范围和门禁以以下文档为准：

1. [PRD](docs/01-PRD.md)
2. [技术方案](docs/02-Technical-Design.md)
3. [项目进度状态](docs/03-Project-Status.md)
4. [开发版本控制规则](docs/04-Development-Version-Control.md)
5. [高保真原型与验收记录](prototypes/)

## v1 的不可妥协边界

- 新上传数据必须实际贯穿 DatasetVersion、质量、映射、本体发布、受控工具与回答证据。
- Agent 只能调用已发布、已授权、只读的本体工具；不支持自由 text-to-SQL。
- 本期不做写回、审批、Action、自动任务、通用 BI、风险驾驶舱或多租户。
- 模型仅支持 GPT、DeepSeek 与明确标识的 Mock 模式。

## 开发与验收

开发从 M0 资源注册与关系内核开始，随后进入“新数据导入 → 质量 → 本体发布 → 智能助手 → 可追溯”的端到端闭环。任何模块都必须用新上传的数据完成浏览器验收；种子工厂数据仅可用于开发测试。

版本、staging、production 和回滚必须遵循 [开发版本控制规则](docs/04-Development-Version-Control.md)。
