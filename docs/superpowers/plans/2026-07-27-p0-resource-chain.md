# P0 Resource Chain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace JSON-only ontology Demo persistence and fake publication with a minimal real data-resource-to-release chain.

**Architecture:** FastAPI owns immutable data versions, quality decisions, drafts, mappings, releases and manifests in SQLite. React reads those API states and cannot mark a dataset trusted or publish a version locally.

**Tech Stack:** FastAPI, SQLAlchemy/SQLite, Pandas/Parquet/DuckDB, React/Vite/TypeScript, Vitest, pytest.

## Global Constraints

- Keep the application local and single tenant; never read or print `.env` or real API keys.
- Support only CSV/XLSX structured data; do not advertise PDF/DOCX parsing in this slice.
- Do not add MySQL, free SQL, Agent execution, metric/function/rule execution or Actions.
- Every Mapping must reference a trusted DatasetVersion and an actual source field.
- Releases and manifests are immutable; preserve all `prototypes/` files as references.

---

### Task 1: Persist profiled file DatasetVersions

**Files:**
- Modify: `backend/app/models/platform.py`, `backend/app/domain/pipeline.py`, `backend/app/api/data_sources.py`
- Test: `backend/tests/test_pipeline_runtime.py`

**Produces:** `POST /api/sources/upload` returns `{source_id, dataset_version_id, lifecycle_status: "profiled", profile}` and preview returns typed columns, rows, count and lifecycle status.

- [ ] **Step 1: Write the failing test**

```python
def test_file_upload_creates_profiled_dataset_version(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("ONTOLOGYOPS_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("ONTOLOGYOPS_METADATA_PATH", str(tmp_path / "metadata.db"))
    client = TestClient(app)
    response = client.post("/api/sources/upload", files={"file": ("orders.csv", b"order_id,qty\nPO-1,2\n", "text/csv")})
    assert response.status_code == 201
    assert response.json()["lifecycle_status"] == "profiled"
    preview = client.get(f"/api/datasets/{response.json()['dataset_version_id']}/preview")
    assert preview.json()["columns"][0]["name"] == "order_id"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest backend/tests/test_pipeline_runtime.py::test_file_upload_creates_profiled_dataset_version -q`

Expected: FAIL because upload has no versioned profile response.

- [ ] **Step 3: Write minimal implementation**

Add dataset lifecycle/profile fields. Make CSV/XLSX upload parse to a Parquet-backed `DatasetVersion(profiled)` and persist name, inferred type, unique count, null percentage and samples. Remove non-file upload branches.

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest backend/tests/test_pipeline_runtime.py::test_file_upload_creates_profiled_dataset_version -q`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add backend && git commit -m "feat: persist profiled file dataset versions"`

### Task 2: Add quality and trust gate

**Files:**
- Modify: `backend/app/api/data_sources.py`, `backend/app/models/platform.py`
- Create: `backend/tests/test_resource_chain.py`

**Produces:** `POST /api/datasets/{id}/quality-check` creates `QualityRun`; `POST /api/datasets/{id}/trust` alone transitions to `trusted` or `rejected`.

- [ ] **Step 1: Write the failing test**

```python
def test_duplicate_key_dataset_cannot_be_trusted(tmp_path: Path, monkeypatch) -> None:
    client = configured_client(tmp_path, monkeypatch)
    dataset_id = upload_csv(client, "orders.csv", b"order_id\nPO-1\nPO-1\n")
    quality = client.post(f"/api/datasets/{dataset_id}/quality-check", json={"unique_fields": ["order_id"]})
    assert quality.json()["status"] == "fail"
    trusted = client.post(f"/api/datasets/{dataset_id}/trust", json={"decision": "trusted", "reason": ""})
    assert trusted.status_code == 400
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest backend/tests/test_resource_chain.py::test_duplicate_key_dataset_cannot_be_trusted -q`

Expected: FAIL because quality/trust endpoints do not exist.

- [ ] **Step 3: Write minimal implementation**

Execute completeness and requested unique-key checks against the version’s Parquet data; persist status and bounded samples. Reject `trusted` after failed quality; allow a reasoned `rejected` transition.

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest backend/tests/test_resource_chain.py::test_duplicate_key_dataset_cannot_be_trusted -q`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add backend && git commit -m "feat: add dataset quality trust gate"`

### Task 3: Validate drafts and publish immutable manifests

**Files:**
- Create: `backend/app/domain/ontology_release.py`
- Modify: `backend/app/models/platform.py`, `backend/app/api/ontology_drafts.py`, `backend/app/main.py`
- Test: `backend/tests/test_resource_chain.py`

**Produces:** `POST /api/ontology-drafts/{id}/validate` returns `{valid, blockers}`; `POST /api/ontology-drafts/{id}/publish` returns `{release_id, semantic_version, manifest, status}`.

- [ ] **Step 1: Write the failing tests**

```python
def test_untrusted_mapping_blocks_release(tmp_path: Path, monkeypatch) -> None:
    client = configured_client(tmp_path, monkeypatch)
    draft_id = create_supplier_draft(client, upload_csv(client, "suppliers.csv", b"supplier_id,name\nS-1,Neo\n"))
    result = client.post(f"/api/ontology-drafts/{draft_id}/validate").json()
    assert result["valid"] is False
    assert result["blockers"][0]["code"] == "mapping_dataset_not_trusted"

def test_valid_draft_publishes_immutable_manifest(tmp_path: Path, monkeypatch) -> None:
    client = configured_client(tmp_path, monkeypatch)
    dataset_id = trust_uploaded_supplier_dataset(client)
    draft_id = create_supplier_draft(client, dataset_id)
    published = client.post(f"/api/ontology-drafts/{draft_id}/publish")
    assert published.status_code == 201
    assert published.json()["manifest"]["mappings"][0]["dataset_version_id"] == dataset_id
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest backend/tests/test_resource_chain.py -q`

Expected: FAIL because validation, release and manifest do not exist.

- [ ] **Step 3: Write minimal implementation**

Persist draft definition plus candidate decisions. Validate primary keys, actual Mapping fields, trusted DatasetVersions, valid relationship endpoints and terminal candidate decisions. In one transaction create immutable manifest, release and current-release pointer; supersede the prior current release.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest backend/tests/test_resource_chain.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add backend && git commit -m "feat: validate and publish immutable ontology releases"`

### Task 4: Gate React workflow on real resource state

**Files:**
- Modify: `frontend/src/features/pipeline/PipelinePage.tsx`, `frontend/src/features/ontology/OntologyPage.tsx`, `frontend/src/features/ontology/OntologyDetailPage.tsx`, `frontend/src/app/App.tsx`
- Modify: `frontend/src/features/ontology/OntologyPage.test.tsx`
- Create: `frontend/src/features/ontology/OntologyRelease.test.tsx`

**Produces:** real data lifecycle display; publish disabled on blockers; success renders returned release ID/version/manifest summary; empty state does not synthesize an ontology.

- [ ] **Step 1: Write the failing UI test**

```tsx
it("keeps publication unavailable when the API reports a mapping blocker", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ valid: false, blockers: [{ code: "mapping_dataset_not_trusted", message: "供应商数据集尚未可信" }] }) }));
  renderDetailDraft();
  expect(await screen.findByText("供应商数据集尚未可信")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /发布版本/ })).toBeDisabled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/features/ontology/OntologyRelease.test.tsx`

Expected: FAIL because publication is currently a local mutation.

- [ ] **Step 3: Write minimal implementation**

Use data profile/quality/trust APIs in the pipeline. Use draft validation/publish APIs in ontology pages. Remove frontend-only “registered” and “published” state; render blockers and release metadata returned by the API.

- [ ] **Step 4: Run regression checks**

Run: `npm test -- --run && npm run lint && npm run build`

Expected: all tests pass, no TypeScript errors, production build succeeds.

- [ ] **Step 5: Commit**

Run: `git add frontend && git commit -m "feat: gate ontology UI on resource validation"`

### Task 5: Remove legacy runtime paths and synchronize records

**Files:**
- Delete: `backend/app/api/ontology.py`, `backend/app/seed/factory_seed.py`, `backend/app/seed/__init__.py`, `backend/tests/test_ontology.py`, `backend/tests/test_ontology_candidates.py`
- Modify: `backend/app/api/data_sources.py`, `backend/requirements.txt`, `README.md`, `docs/01-PRD.md`, `docs/02-Technical-Design.md`, `docs/03-Project-Status.md`
- Test: `backend/tests/test_resource_chain.py`

**Produces:** no factory-publish, fixed-candidate, factory-seed or MySQL route; project records state M3 is incomplete until browser E2E acceptance.

- [ ] **Step 1: Write the failing cleanup test**

```python
def test_removed_legacy_routes_are_not_registered() -> None:
    paths = {route.path for route in app.routes}
    assert "/api/ontology/publish-factory" not in paths
    assert "/api/ontology/candidates" not in paths
    assert "/api/sources/mysql" not in paths
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest backend/tests/test_resource_chain.py::test_removed_legacy_routes_are_not_registered -q`

Expected: FAIL because paths are currently registered.

- [ ] **Step 3: Write minimal implementation**

Remove verified legacy runtime modules/routes/imports/tests and unused PyMySQL dependency. Keep `prototypes/`, `data/`, `.env`, the four core documents and user-created resources. Update documentation truthfully.

- [ ] **Step 4: Run complete verification**

Run: `python3 -m pytest backend/tests -q && cd frontend && npm test -- --run && npm run lint && npm run build`

Expected: all executable tests pass.

- [ ] **Step 5: Commit**

Run: `git add -A && git commit -m "chore: remove legacy factory and connector paths"`

## Final browser acceptance

- [ ] Upload a new non-seed CSV/XLSX, process it, run quality, trust the passing version, create a mapped draft, validate, publish and refresh.
- [ ] Record only IDs/statuses and screenshots without dataset contents or API keys in `docs/03-Project-Status.md`.
- [ ] Confirm an empty database shows no fixed manufacturing ontology.
