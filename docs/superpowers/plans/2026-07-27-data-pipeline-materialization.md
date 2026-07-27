# 数据管道与本体实体化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户上传一份新的 CSV 后，可完成数据存储、清洗与质量、本体映射，并在已发布本体中查看真实实体实例数量、数据详情和来源证据。

**Architecture:** 保留 `DataSource`、`Dataset`、`PipelineRun` 作为文件、版本和运行事实来源。新增独立的映射配置与实体实例表；映射运行只读取 `trusted` 数据集和已发布本体定义，按已确认字段映射持久化实体实例。前端以可拖动节点画布呈现四阶段，右侧面板编辑和运行受控配置，实体详情页读取新实例接口。

**Tech Stack:** FastAPI、SQLAlchemy/SQLite、Pandas/DuckDB、React、TypeScript、Vitest、pytest。

## Global Constraints

- 本期仅支持本地 CSV 文件上传；不得显示可用的 MySQL、API 或 Excel 连接器。
- 阶段名称固定为：数据连接、数据存储、数据清洗与质量、本体映射。
- LLM 只产出可编辑候选；清洗、质量与映射运行必须是确定性逻辑。
- 本体映射只能使用 `trusted` 数据集与 `published` 本体；不得在映射中创建实体类型。
- 不读取、输出或写入真实模型密钥；不实现写回、审批或自动 Action。
- 保持全局顶部与左侧导航；不修改无关模块或既有本体发布流程。

---

### Task 1: 持久化映射配置与实体实例

**Files:**
- Modify: `backend/app/models/platform.py`
- Modify: `backend/app/core/database.py`
- Create: `backend/tests/test_ontology_instances.py`

**Interfaces:**
- Produces `OntologyMappingRecord`（dataset_id、ontology_id、entity_id、主键字段、字段映射、状态）与 `OntologyEntityInstanceRecord`（ontology_id、entity_id、entity_key、properties_json、source_dataset_id、mapping_id、run_id）。
- Produces `OntologyRelationInstanceRecord` 作为后续 Link 实例的稳定存储边界；本切片不要求自动推导 Link。

- [ ] **Step 1: 写失败测试，验证同一本体实体类型的重复主键不允许重复实例**

```python
def test_entity_instance_key_is_unique_per_ontology_and_entity(tmp_path):
    engine = create_engine_and_schema(tmp_path / "metadata.db")
    # 创建相同 ontology_id/entity_id/entity_key 两次应抛出 IntegrityError
```

- [ ] **Step 2: 运行失败测试**

Run: `/Users/neo/Documents/AI Native/ontologyops/.venv/bin/python -m pytest backend/tests/test_ontology_instances.py -q`
Expected: FAIL，因为实例模型尚不存在。

- [ ] **Step 3: 新增模型与 SQLite 迁移，使用唯一约束保护实体实例身份**

```python
__table_args__ = (UniqueConstraint("ontology_id", "entity_id", "entity_key", name="uq_ontology_entity_instance"),)
```

- [ ] **Step 4: 运行测试验证通过**

Run: `/Users/neo/Documents/AI Native/ontologyops/.venv/bin/python -m pytest backend/tests/test_ontology_instances.py -q`
Expected: PASS。

### Task 2: 实现受控映射运行与实例查询 API

**Files:**
- Modify: `backend/app/domain/pipeline.py`
- Modify: `backend/app/api/pipelines.py`
- Modify: `backend/app/api/ontology_drafts.py`
- Create: `backend/tests/test_pipeline_materialization.py`

**Interfaces:**
- `POST /api/pipelines/{pipeline_id}/materialize` 接收 `dataset_id`、`ontology_id`、`entity_id`、`primary_key_field`、`field_mappings`。
- `GET /api/ontologies/{ontology_id}/entities/{entity_id}/instances` 返回实例总数、分页行、属性、源数据集、映射和运行 ID。
- `PipelineService.materialize_entity_instances(...)` 在验证后创建或更新实例，返回写入数、总数和证据资源 ID。

- [ ] **Step 1: 写失败测试，验证非 trusted 数据集被拒绝**

```python
response = client.post(f"/api/pipelines/{pipeline_id}/materialize", json={..."dataset_id": profiled_id...})
assert response.status_code == 400
assert "trusted" in response.json()["detail"]
```

- [ ] **Step 2: 写失败测试，验证 trusted CSV 能按主键实体化并可查询**

```python
assert result["written_count"] == 2
instances = client.get(f"/api/ontologies/{ontology_id}/entities/SalesOrder/instances").json()
assert instances["total"] == 2
assert instances["items"][0]["properties"]["order_id"] == "SO-001"
```

- [ ] **Step 3: 运行测试并确认失败原因是路由/服务缺失**

Run: `/Users/neo/Documents/AI Native/ontologyops/.venv/bin/python -m pytest backend/tests/test_pipeline_materialization.py -q`
Expected: FAIL，materialize 路由未实现。

- [ ] **Step 4: 实现验证、运行记录、实例 upsert 与资源关系**

```python
if dataset.stage != "trusted":
    raise ValueError("Only trusted dataset versions can be materialized")
if ontology.status != "published":
    raise ValueError("Only published ontologies can receive entity instances")
```

- [ ] **Step 5: 再运行聚焦测试**

Run: `/Users/neo/Documents/AI Native/ontologyops/.venv/bin/python -m pytest backend/tests/test_pipeline_materialization.py -q`
Expected: PASS。

### Task 3: 重建数据管道前端为画布与右侧配置面板

**Files:**
- Modify: `frontend/src/features/pipeline/PipelinePage.tsx`
- Modify: `frontend/src/styles/index.css`
- Create: `frontend/src/features/pipeline/PipelinePage.test.tsx`

**Interfaces:**
- 画布展示数据连接、数据存储、数据清洗与质量、本体映射四类节点。
- 数据连接右侧仅显示 CSV 上传；节点可拖动，边随节点位置更新。
- 映射节点调用 materialize API，运行成功后显示实例写入数并提供“查看实体数据”。

- [ ] **Step 1: 写失败前端测试，验证页面只显示 CSV 上传且无 MySQL 可用入口**

```tsx
expect(screen.getByRole("button", { name: /上传 CSV/i })).toBeInTheDocument();
expect(screen.queryByText(/MySQL/)).not.toBeInTheDocument();
```

- [ ] **Step 2: 写失败前端测试，验证点击清洗节点时显示“AI 建议，需人工确认”**

```tsx
await user.click(screen.getByText("数据清洗与质量"));
expect(screen.getByText("AI 建议，需人工确认")).toBeInTheDocument();
```

- [ ] **Step 3: 运行前端测试确认失败**

Run: `npm test -- --run src/features/pipeline/PipelinePage.test.tsx`
Expected: FAIL，因为旧向导没有目标画布与文案。

- [ ] **Step 4: 用受控节点画布替换旧分步表单**

```tsx
type PipelineNodeKind = "connection" | "storage" | "quality" | "mapping";
// Pointer drag updates node positions; SVG edge endpoints read those positions.
```

- [ ] **Step 5: 运行聚焦前端测试**

Run: `npm test -- --run src/features/pipeline/PipelinePage.test.tsx`
Expected: PASS。

### Task 4: 在本体详情页提供实体数据查看

**Files:**
- Modify: `frontend/src/features/ontology/OntologyDetailPage.tsx`
- Modify: `frontend/src/features/ontology/OntologyDetailPage.test.tsx`

**Interfaces:**
- 实体详情增加“实体数据”标签页，显示实例总数、最近同步时间、表格、实例属性/来源证据。
- 仅在已发布本体且接口有实例时显示真实数据；无实例时展示明确空状态。

- [ ] **Step 1: 写失败测试，验证实体数据标签显示 API 返回的总数和订单号**

```tsx
expect(await screen.findByText("实体数据")).toBeInTheDocument();
await user.click(screen.getByText("实体数据"));
expect(await screen.findByText("2 条实体实例")).toBeInTheDocument();
expect(screen.getByText("SO-001")).toBeInTheDocument();
```

- [ ] **Step 2: 运行失败测试**

Run: `npm test -- --run src/features/ontology/OntologyDetailPage.test.tsx`
Expected: FAIL，因为实体实例视图不存在。

- [ ] **Step 3: 实现实例列表与来源证据抽屉/详情面板**

```tsx
fetch(`/api/ontologies/${ontology.id}/entities/${entity.id}/instances`)
```

- [ ] **Step 4: 运行前端实体详情测试**

Run: `npm test -- --run src/features/ontology/OntologyDetailPage.test.tsx`
Expected: PASS。

### Task 5: 新增制造业上传数据与端到端验收

**Files:**
- Create: `data/test-data/sales_orders_upload.csv`
- Create: `data/test-data/sales_orders_quality_failure.csv`
- Modify: `PROJECT_STATUS.md`
- Test: `backend/tests/test_pipeline_materialization.py`

**Interfaces:**
- `sales_orders_upload.csv` 含 6 条销售订单，含订单号、客户编码、产品编码、下单日期、数量、订单状态。
- `sales_orders_quality_failure.csv` 含重复订单号与空客户编码，用于质量门禁失败验收。

- [ ] **Step 1: 添加脱敏、小规模制造业 CSV fixture**

```csv
sales_order_no,customer_code,product_code,order_date,quantity,order_status
SO-001,C-001,PRD-100,2026-07-01,20,confirmed
```

- [ ] **Step 2: 后端完整回归**

Run: `/Users/neo/Documents/AI Native/ontologyops/.venv/bin/python -m pytest -q`
Expected: 所有测试 PASS。

- [ ] **Step 3: 前端质量门禁**

Run: `npm test -- --run && npm run lint && npm run build`
Expected: 全部 PASS。

- [ ] **Step 4: 浏览器端到端验收**

Run: 在 `/pipelines` 上传 `sales_orders_upload.csv`，运行清洗与质量，选择已发布制造业本体及 SalesOrder 映射，确认写入 6 条实例；转到本体实体数据，核对总数、`SO-001` 属性和来源数据集 ID。

## Plan Self-Review

- 覆盖 CSV 上传、数据存储、确定性清洗/质量、人工确认的 AI 候选、映射实体化和本体数据查看。
- 不包含 MySQL/API 连接、Action、写回或自动发布。
- 所有接口均有状态和权限前置条件，所有实体实例均保存数据集、映射和运行证据。
