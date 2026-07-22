# M0 资源注册与关系内核 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立可持久化、可审计、可校验状态转换的 Resource、ResourceRelation 与 AuditEvent 内核，为后续新上传数据、本体发布和智能助手证据提供唯一资源链。

**Architecture:** 在现有 FastAPI 模块化单体中新增独立的资源模型、生命周期服务、注册服务与只面向开发/后续模块的资源 API。SQLite 仍是元数据存储；M0 不读取 DuckDB、不执行管道、不做本体发布或 Agent 逻辑。所有写操作通过服务层创建审计事件，关系边只能引用已存在资源。

**Tech Stack:** Python 3.12、FastAPI 0.115、Pydantic、SQLAlchemy 2.0、SQLite、pytest；前端本切片不新增页面。

## Global Constraints

- 只在 `dev` 工作目录实现，禁止修改 `main`。
- 禁止修改 `app/domain/semantic_tools.py`、`app/domain/agent.py` 的旧工厂运行逻辑；M0 新内核与 legacy 路径并存，后续模块迁移调用方。
- 不新增自由 SQL、外部连接、写回、Action、任务调度或 UI 模板数据。
- 所有资源使用 UUID 字符串；关系、状态和审计由后端创建，前端不得直接伪造。
- 资源 API 不公开为通用数据库查询接口；只允许本计划列出的创建、读取、转换与关系读取命令。
- 先写失败测试并确认失败，再写最小实现；每个逻辑切片完成后执行聚焦测试。
- 每次改动都提交并推送 `dev`；每一个 TDD 红灯测试与对应绿灯实现分别形成提交，红灯提交以 `test:` 前缀标记为有意未完成状态。本模块完成后再由项目负责人进行本地浏览器/数据链验收。

---

## 文件结构

| 文件 | 责任 |
| --- | --- |
| `backend/app/models/resources.py` | SQLAlchemy 的 `ResourceRecord` 与 `ResourceRelationRecord`。 |
| `backend/app/models/platform.py` | 保留 `Base`/旧模型；扩展 `AuditEvent` 的资源与关联字段。 |
| `backend/app/core/database.py` | 为新表与新增审计列提供 SQLite schema migration。 |
| `backend/app/domain/resource_lifecycle.py` | 生命周期规则和非法转换异常。 |
| `backend/app/services/resource_registry.py` | 创建资源、转换状态、建立关系、读取图邻接。 |
| `backend/app/services/audit.py` | 写入带 resource/correlation/outcome 的追加审计。 |
| `backend/app/api/resources.py` | M0 的受限 REST 命令与读取端点。 |
| `backend/app/main.py` | 注册 resources router。 |
| `backend/tests/test_resource_lifecycle.py` | 生命周期规则的纯领域测试。 |
| `backend/tests/test_resource_registry.py` | SQLite 服务集成测试。 |
| `backend/tests/test_resources_api.py` | FastAPI API 契约测试。 |
| `docs/03-Project-Status.md` | M0 每个切片的真实进度与验证记录。 |

## 资源契约

```python
ResourceType = Literal[
    "source_asset", "dataset", "dataset_version", "pipeline", "pipeline_run",
    "quality_rule", "quality_run", "ontology", "ontology_draft", "ontology_release",
    "object_type", "property", "link_type", "mapping", "metric", "read_function",
    "business_rule", "access_policy", "tool_registry_entry", "tool_call", "agent_answer",
]

class ResourceRecord:
    id: str
    resource_type: str
    display_name: str
    lifecycle_status: str
    version: int
    created_by: str
    metadata_json: str
    content_hash: str | None

class ResourceRelationRecord:
    id: str
    from_resource_id: str
    to_resource_id: str
    relation_type: str
    created_by: str
```

初始支持的转换：

```python
ALLOWED_TRANSITIONS = {
    "source_asset": {"registered": {"profiled", "rejected"}},
    "dataset_version": {"registered": {"profiled", "rejected"}, "profiled": {"trusted", "rejected"}},
    "ontology_draft": {"editing": {"validation_failed", "ready_to_publish"}, "validation_failed": {"editing"}, "ready_to_publish": {"editing", "published"}},
}
```

未列出的类型在 M0 只能创建为 `registered`，不能调用状态转换；后续模块增加规则而不绕过此服务。

### Task 1: 资源模型与 SQLite schema migration

**Files:**
- Create: `backend/app/models/resources.py`
- Modify: `backend/app/models/platform.py`
- Modify: `backend/app/core/database.py`
- Test: `backend/tests/test_resource_registry.py`

**Interfaces:**
- Produces: `ResourceRecord`、`ResourceRelationRecord` 和扩展后的 `AuditEvent` 表。
- Consumes: `Base`、`utc_now()`、`create_engine_and_schema(path)`。

- [ ] **Step 1: 写入失败的 schema 测试**

```python
def test_schema_creates_resource_and_relation_tables(tmp_path):
    engine = create_engine_and_schema(tmp_path / "metadata.db")
    table_names = set(inspect(engine).get_table_names())
    assert {"resources", "resource_relations", "audit_events"} <= table_names
    audit_columns = {item["name"] for item in inspect(engine).get_columns("audit_events")}
    assert {"resource_id", "correlation_id", "outcome", "previous_hash"} <= audit_columns
```

- [ ] **Step 2: 在 `backend/` 目录执行失败测试**

Run: `../.venv/bin/python -m pytest tests/test_resource_registry.py::test_schema_creates_resource_and_relation_tables -v`

Expected: FAIL，原因是资源表尚不存在。

- [ ] **Step 3: 最小实现 SQLAlchemy 模型和可重复 migration**

```python
class ResourceRecord(Base):
    __tablename__ = "resources"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    resource_type: Mapped[str] = mapped_column(String(64), nullable=False)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    lifecycle_status: Mapped[str] = mapped_column(String(32), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_by: Mapped[str] = mapped_column(String(128), nullable=False)
    metadata_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    content_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)
```

`ResourceRelationRecord` 为两端 ID、关系类型、创建人、创建时间建立表；`AuditEvent` 追加 nullable `resource_id`、`correlation_id`、`outcome`、`previous_hash`。migration 使用 `inspect` 检查列后按缺失列逐项 `ALTER TABLE`，重复运行不得失败。

- [ ] **Step 4: 运行 schema 测试**

Run: `../.venv/bin/python -m pytest tests/test_resource_registry.py::test_schema_creates_resource_and_relation_tables -v`

Expected: PASS。

- [ ] **Step 5: 提交并推送**

```bash
git add backend/app/models/resources.py backend/app/models/platform.py backend/app/core/database.py backend/tests/test_resource_registry.py
git commit -m "建立资源关系持久化模型"
git push origin dev
```

### Task 2: 生命周期规则与资源注册服务

**Files:**
- Create: `backend/app/domain/resource_lifecycle.py`
- Create: `backend/app/services/resource_registry.py`
- Test: `backend/tests/test_resource_lifecycle.py`
- Test: `backend/tests/test_resource_registry.py`

**Interfaces:**
- Consumes: `ResourceRecord`、`ResourceRelationRecord`、SQLAlchemy `Engine`。
- Produces: `ResourceRegistry.create_resource()`、`transition_resource()`、`add_relation()`、`get_relations()`。

- [ ] **Step 1: 写入失败的生命周期测试**

```python
def test_dataset_version_can_only_be_trusted_after_profiled():
    assert can_transition("dataset_version", "registered", "profiled") is True
    assert can_transition("dataset_version", "profiled", "trusted") is True
    assert can_transition("dataset_version", "registered", "trusted") is False

def test_unknown_resource_type_cannot_transition():
    assert can_transition("metric", "registered", "trusted") is False
```

- [ ] **Step 2: 验证失败**

Run: `../.venv/bin/python -m pytest tests/test_resource_lifecycle.py -v`

Expected: FAIL，原因是 `resource_lifecycle` 模块不存在。

- [ ] **Step 3: 实现纯领域规则与服务写路径**

```python
def can_transition(resource_type: str, source: str, target: str) -> bool:
    return target in ALLOWED_TRANSITIONS.get(resource_type, {}).get(source, set())

def assert_transition(resource_type: str, source: str, target: str) -> None:
    if not can_transition(resource_type, source, target):
        raise InvalidLifecycleTransition(resource_type, source, target)
```

`ResourceRegistry.create_resource()` 固定生成 UUID、初始状态 `registered`、version `1`；`transition_resource()` 先读资源、调用 `assert_transition()`，成功后更新状态并写审计；`add_relation()` 先确认两端存在，拒绝自指关系，后写 relation 和审计。

- [ ] **Step 4: 添加服务集成测试并运行**

```python
def test_registry_records_relation_and_audit(tmp_path):
    registry = ResourceRegistry(create_engine_and_schema(tmp_path / "metadata.db"))
    source = registry.create_resource("source_asset", "供应商文件", "modeler")
    dataset = registry.create_resource("dataset_version", "供应商 v1", "modeler")
    relation = registry.add_relation(source.id, dataset.id, "produced_by", "modeler")
    assert relation.from_resource_id == source.id
    assert registry.get_relations(source.id, "outgoing")[0].to_resource_id == dataset.id
```

Run: `../.venv/bin/python -m pytest tests/test_resource_lifecycle.py tests/test_resource_registry.py -v`

Expected: PASS。

- [ ] **Step 5: 提交并推送**

```bash
git add backend/app/domain/resource_lifecycle.py backend/app/services/resource_registry.py backend/tests/test_resource_lifecycle.py backend/tests/test_resource_registry.py
git commit -m "实现资源生命周期与关系服务"
git push origin dev
```

### Task 3: 带关联信息的审计链

**Files:**
- Modify: `backend/app/services/audit.py`
- Modify: `backend/app/services/resource_registry.py`
- Test: `backend/tests/test_resource_registry.py`

**Interfaces:**
- Consumes: `write_audit_event(engine, ...)`。
- Produces: 资源创建、转换、关系建立对应的 AuditEvent，带 `resource_id`、`correlation_id`、`outcome` 与 `previous_hash`。

- [ ] **Step 1: 写入失败的审计测试**

```python
def test_resource_transition_writes_chained_audit_event(tmp_path):
    registry = ResourceRegistry(create_engine_and_schema(tmp_path / "metadata.db"))
    resource = registry.create_resource("dataset_version", "供应商 v1", "modeler")
    registry.transition_resource(resource.id, "profiled", "modeler", correlation_id="run-01")
    event = registry.list_audit_events(resource.id)[-1]
    assert event.resource_id == resource.id
    assert event.correlation_id == "run-01"
    assert event.outcome == "succeeded"
    assert event.previous_hash
```

- [ ] **Step 2: 验证失败**

Run: `../.venv/bin/python -m pytest tests/test_resource_registry.py::test_resource_transition_writes_chained_audit_event -v`

Expected: FAIL，原因是审计记录缺少 M0 字段。

- [ ] **Step 3: 最小实现**

```python
def write_audit_event(..., resource_id: str | None = None, correlation_id: str | None = None,
                      outcome: str = "succeeded") -> AuditEvent:
    previous = latest_event_hash(session)
    event = AuditEvent(..., resource_id=resource_id, correlation_id=correlation_id,
                       outcome=outcome, previous_hash=previous)
```

审计 payload 只保存安全元数据：资源类型、状态前后值、关系类型和 ID；不得保存文件内容、密钥或原始业务字段。

- [ ] **Step 4: 运行资源测试**

Run: `../.venv/bin/python -m pytest tests/test_resource_lifecycle.py tests/test_resource_registry.py -v`

Expected: PASS。

- [ ] **Step 5: 提交并推送**

```bash
git add backend/app/services/audit.py backend/app/services/resource_registry.py backend/tests/test_resource_registry.py
git commit -m "补全资源操作审计链"
git push origin dev
```

### Task 4: M0 受限资源 API

**Files:**
- Create: `backend/app/api/resources.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_resources_api.py`

**Interfaces:**
- Produces: `POST /api/v1/resources`、`GET /api/v1/resources/{id}`、`POST /api/v1/resources/{id}/transition`、`POST /api/v1/resources/{id}/relations`、`GET /api/v1/resources/{id}/relations`。
- Error contract: `{ "code": str, "message": str, "resource_id": str | null, "correlation_id": str | null, "details": list[object] }`。

- [ ] **Step 1: 写入失败的 API 测试**

```python
def test_resource_api_creates_transitions_and_reads_relation(client):
    created = client.post("/api/v1/resources", json={
        "resource_type": "dataset_version", "display_name": "新供应商文件", "metadata": {},
    }, headers={"X-Demo-Role": "modeler"})
    assert created.status_code == 201
    resource_id = created.json()["id"]
    transitioned = client.post(f"/api/v1/resources/{resource_id}/transition", json={"target_status": "profiled"})
    assert transitioned.status_code == 200
    assert transitioned.json()["lifecycle_status"] == "profiled"
```

- [ ] **Step 2: 验证失败**

Run: `../.venv/bin/python -m pytest tests/test_resources_api.py -v`

Expected: FAIL，原因是 `/api/v1/resources` 未注册。

- [ ] **Step 3: 实现 Pydantic 输入校验、角色门禁和 router**

`resource_type` 必须属于 M0 白名单；`display_name` 去除首尾空格且不可为空；`metadata` 必须为 JSON object；只有 `modeler` / `admin` 可创建、转换和建立关系，`operator` 只读。非法转换返回 409，未知资源返回 404，角色拒绝返回 403；不暴露通用过滤、SQL 或任意 relation 删除端点。

- [ ] **Step 4: 运行 API 和全量后端测试**

Run: `../.venv/bin/python -m pytest tests/test_resources_api.py tests/test_resource_lifecycle.py tests/test_resource_registry.py -v && ../.venv/bin/python -m pytest tests -q`

Expected: 新测试和既有 25 项测试均 PASS。

- [ ] **Step 5: 提交并推送**

```bash
git add backend/app/api/resources.py backend/app/main.py backend/tests/test_resources_api.py
git commit -m "提供资源内核受限接口"
git push origin dev
```

### Task 5: M0 验收记录与模块交接

**Files:**
- Modify: `docs/03-Project-Status.md`
- Test: `backend/tests/test_resource_lifecycle.py`
- Test: `backend/tests/test_resource_registry.py`
- Test: `backend/tests/test_resources_api.py`

**Interfaces:**
- Consumes: M0 的 API、资源服务和审计链。
- Produces: 真实的 M0 状态记录；M1 可以通过 `ResourceRegistry` 注册 SourceAsset / DatasetVersion。

- [ ] **Step 1: 更新状态文档的可验证事实**

记录 M0 的提交、测试命令、测试数量、API 契约、未完成的浏览器验收依赖（M1 新文件导入）。不得把 API 或单测通过写成“新数据端到端验收通过”。

- [ ] **Step 2: 运行最终验证**

Run: `../.venv/bin/python -m pytest tests -q && cd ../../frontend && npm test -- --run && npm run lint && npm run build`

Expected: 后端全绿；前端既有测试、类型检查和构建均通过。

- [ ] **Step 3: 提交并推送**

```bash
git add docs/03-Project-Status.md
git commit -m "记录 M0 资源内核验收状态"
git push origin dev
```

## 覆盖性检查

| PRD / 技术方案要求 | 计划任务 |
| --- | --- |
| 资源唯一标识、版本、状态、创建人和时间 | Task 1 / Task 2 |
| 真实依赖关系与影响分析基础 | Task 1 / Task 2 |
| 非法状态转换拒绝 | Task 2 / Task 4 |
| 资源、关系、状态操作审计 | Task 3 |
| 后端强制角色门禁 | Task 4 |
| M1 可从新文件创建 SourceAsset/DatasetVersion | Task 2 / Task 5 |
| 不将 M0 API/测试误报为全链路浏览器验收 | Task 5 |

计划不包含自由 SQL、Action、写回、Agent 改造、管道、质量规则、本体发布或新的业务页面；这些分别属于后续 M1–M6。
