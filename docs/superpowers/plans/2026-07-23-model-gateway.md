# M5.0 Model Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a secure local ModelProfile gateway with DeepSeek V4 Flash and V4 Pro selection, explicit verification, and no silent Mock fallback.

**Architecture:** FastAPI owns profile metadata and verifies compatible providers with a server-side environment variable reference. React renders provider cards and configuration controls but never reads a secret. The model service uses only a verified enabled profile and surfaces structured availability errors to the caller.

**Tech Stack:** FastAPI, SQLAlchemy/SQLite, httpx, React/Vite, Vitest, pytest.

## Global Constraints

- Store only `secret_ref`, never API key values.
- DeepSeek display options map exactly to `deepseek-v4-flash` and `deepseek-v4-pro`.
- Do not silently use Mock when a real profile is selected but unavailable.
- Keep Mock explicit and test-only.
- Development occurs in `dev`; root prototype changes remain untouched.

---

### Task 1: Define verified model profiles and safe API contracts

**Files:**
- Modify: `backend/app/models/platform.py`
- Modify: `backend/app/core/database.py`
- Modify: `backend/app/api/models.py`
- Test: `backend/tests/test_model_config.py`

**Interfaces:**
- Produces `GET /api/models`, `PATCH /api/models/{id}`, and `POST /api/models/{id}/verify` profile contracts.

- [ ] **Step 1: Write failing API tests** for default DeepSeek Flash/Pro identifiers, no serialized secret value, verified-only enable/default, and rejected unverified default.
- [ ] **Step 2: Run** `.venv/bin/python -m pytest tests/test_model_config.py -q`; expect failures for missing verification fields and endpoint.
- [ ] **Step 3: Implement** profile schema/migration and API validation with `verification_status` and `secret_ref` only.
- [ ] **Step 4: Run** `.venv/bin/python -m pytest tests/test_model_config.py -q`; expect pass.
- [ ] **Step 5: Commit** model metadata and contract tests.

### Task 2: Implement provider verification and explicit execution errors

**Files:**
- Modify: `backend/app/services/model_provider.py`
- Modify: `backend/app/api/models.py`
- Modify: `backend/app/api/agent.py`
- Test: `backend/tests/test_model_config.py`
- Test: `backend/tests/test_agent.py`

**Interfaces:**
- Produces `ModelProviderService.verify(profile)` and a structured unavailable result for selected real profiles.

- [ ] **Step 1: Write failing tests** that mock `GET {base_url}/models`, assert no key in audit payload, and assert a missing/failed real configuration does not yield `mode=mock`.
- [ ] **Step 2: Run** the two test files; expect the silent fallback assertion to fail.
- [ ] **Step 3: Implement** bounded httpx verification, redacted audit events, and explicit errors without prompt data.
- [ ] **Step 4: Run** `.venv/bin/python -m pytest tests/test_model_config.py tests/test_agent.py -q`; expect pass.
- [ ] **Step 5: Commit** gateway verification and failure behavior.

### Task 3: Add local secret setup and DeepSeek profile defaults

**Files:**
- Create: `.env.example`
- Modify: `.gitignore`
- Modify: `scripts/dev.sh`
- Modify: `README.md`
- Test: `backend/tests/test_health.py`

**Interfaces:**
- Consumes `DEEPSEEK_API_KEY` from process environment only.

- [ ] **Step 1: Write a startup test** proving configuration status reports only present/missing, never the value.
- [ ] **Step 2: Run** the test; expect missing status endpoint/behavior.
- [ ] **Step 3: Add** ignored `.env.example`, safe dev startup loading, and a README instruction that the user edits `.env` locally.
- [ ] **Step 4: Run** `.venv/bin/python -m pytest tests/test_health.py -q`; expect pass.
- [ ] **Step 5: Commit** local secret setup.

### Task 4: Rebuild the React model management page

**Files:**
- Modify: `frontend/src/features/model/ModelPage.tsx`
- Modify: `frontend/src/styles/index.css`
- Test: `frontend/src/features/model/ModelPage.test.tsx`

**Interfaces:**
- Consumes the verified profile API; displays DeepSeek V4 Flash/Pro labels and their IDs; invokes verify and default actions.

- [ ] **Step 1: Write failing UI tests** for Flash/Pro selection, no API key input, disabled default action before verification, and visible verification failure.
- [ ] **Step 2: Run** `npm test -- --run ModelPage.test.tsx`; expect failures.
- [ ] **Step 3: Implement** the approved compact provider rail/form UI and status-specific actions.
- [ ] **Step 4: Run** `npm test -- --run ModelPage.test.tsx && npm run build`; expect pass.
- [ ] **Step 5: Commit** the functional model-management UI.

### Task 5: Integrated verification and documentation alignment

**Files:**
- Modify: `docs/01-PRD.md`
- Modify: `docs/02-Technical-Design.md`
- Modify: `docs/03-Project-Status.md`
- Test: `backend/tests/test_model_config.py`

- [ ] **Step 1: Update** model naming, compatible-provider boundary, explicit Mock behavior, and status to reflect M5.0.
- [ ] **Step 2: Run** `.venv/bin/python -m pytest -q`, `npm test -- --run`, and `npm run build`.
- [ ] **Step 3: Start** the local app, test the browser path with no key and then with a user-supplied local key; retain only the redacted evidence.
- [ ] **Step 4: Commit** documentation and verification result.
