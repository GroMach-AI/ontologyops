# P0 资源链与发布边界修复设计

## 目标

将当前“上传资料后生成并保存一份本体 JSON”的 Demo，替换为可验证的最小资源链：文件上传形成可持久化的数据资源，数据集经受控处理和质量确认后才能进入本体映射；发布生成不可变版本快照，而不是仅改变前端状态。

本设计只处理审计中列为 P0 的问题，不扩展到 Agent、指标/函数/规则真实执行、通用连接器或多租户。

## 范围与非范围

### 本次实现

- CSV/XLSX 上传、字段 profiling、数据集版本持久化。
- 受控管道运行、质量检查与 `trusted` 决策。
- 本体草稿引用真实 `DatasetVersion`，保存实体类型、属性、关系和 Mapping。
- 发布校验、不可变 `OntologyRelease`、release manifest、当前发布版本指针。
- 前端展示真实状态、发布阻塞原因与发布版本。
- 移除明确废弃的工厂发布、固定候选、MySQL 接入和无引用临时文件。

### 明确不做

- PDF/DOCX 的本体建模输入。其页面入口和错误提示将在本切片中收敛为“暂不支持”，不伪造解析能力。
- 指标、只读函数、业务规则的编辑与执行；manifest 为后续资源预留结构。
- 发布后的 ToolRegistry 编译与智能助手运行。
- 自动质量修复、任意 SQL、MySQL 或其他数据库连接器。

## 目标资源模型

```text
SourceAsset
  -> DatasetVersion(profiled)
  -> PipelineRun / PipelineNodeRun
  -> DatasetVersion(trusted)
  -> OntologyDraft
  -> {EntityType, Property, LinkType, Mapping}
  -> OntologyRelease + ReleaseManifest
```

每个资源使用 UUID。文件路径由资源 ID 派生，原始文件名只作显示用途。草稿可编辑；release 和 manifest 一经发布不可修改。当前发布版本指针只保存 release ID。

## 数据流与接口

1. `POST /api/sources/upload` 上传 CSV/XLSX，创建 `SourceAsset` 与 `DatasetVersion(profiled)`，返回 profile 和资源 ID。
2. `POST /api/pipelines/{source_id}/run` 运行受限的去重、重命名、类型转换、空值过滤，创建新的 `DatasetVersion(profiled)` 和运行记录。
3. `POST /api/datasets/{id}/quality-check` 运行最小完整性和唯一性检查；建模者通过 `POST /api/datasets/{id}/trust` 明确决定 trusted/rejected。
4. `POST /api/ontology-drafts` 创建草稿；草稿中的 Mapping 必须引用 `trusted` DatasetVersion 与实际字段。
5. `POST /api/ontology-drafts/{id}/validate` 返回全部阻塞项：主键、字段、关联两端、数据集状态和候选审核状态。
6. `POST /api/ontology-drafts/{id}/publish` 在事务中写入 release、manifest 和当前指针。失败时不产生 release。

候选建模保留为辅助功能，但候选必须保存为 `proposed/accepted/rejected`，并带输入资源 ID 与证据摘要；不能直接把 LLM 输出当作已发布实体。

## 前端行为

- 数据与管道：真实显示上传后 DatasetVersion、profile、运行结果、质量结果和 trusted 状态；“确认并注册”不再只是前端状态切换。
- 本体管理：创建草稿时从 trusted 数据集选择输入；候选审核、实体/属性/关系和 Mapping 在草稿内保存。
- 发布：展示校验结果和变更摘要；仅通过校验时展示发布按钮。发布后显示 release ID、版本、manifest 摘要和当前版本。
- 空态：没有真实本体或数据资源时只显示下一步，不展示工厂实体数量、固定关系或伪状态。

## 清理清单

删除或移除路由：`publish-factory`、工厂候选生成、factory seed 自动路径、MySQL API 和对应前端入口。

删除无引用的临时截图/快照文件，但保留 `prototypes/` 下所有静态 HTML、CSS、JS 和设计 QA，作为设计参考。

不删除：`data/`、`.env`、四份核心管理文档、任何用户创建的本体或现有工作树。

## 错误与安全边界

- 未知文件类型、解析失败、未选择可信数据集、无效 Mapping、发布校验失败均返回结构化错误，不创建伪成功资源。
- 上传内容不作为 SQL、路径或可执行代码使用。
- 模型调用失败时候选保持未生成/失败状态，不降级为固定工厂候选。
- API Key 不进入数据模型、release manifest、审计详情或浏览器响应。

## 测试策略与验收

后端测试先覆盖：上传创建资源、管道新版本、质量拒绝阻止 Mapping、有效草稿发布 manifest、无效草稿不可发布、候选审核状态。

前端测试先覆盖：数据集状态来自 API、发布按钮受校验控制、发布后的 release 信息可见、空态无工厂硬编码。

浏览器验收使用一套全新 CSV/XLSX：上传、处理、质量检查、信任数据集、创建包含 Mapping 的草稿、发布 v1；刷新后可看见同一 release 和其输入资源。此验收不依赖种子工厂数据。

## 成功标准

- 不存在可访问的工厂发布、固定候选或 MySQL 连接路径。
- 所有发布版本都可回溯到实际 DatasetVersion 和 Mapping。
- 未经质量信任的数据无法进入发布 Mapping。
- 发布不会仅改变前端 badge；刷新后 release、manifest 与当前指针仍存在。
- 全部新增测试先失败后通过，前端现有测试、类型检查、生产构建及可用后端测试均通过。
