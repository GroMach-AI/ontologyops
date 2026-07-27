# 治理与可追溯展示页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `/governance` 收敛为读取真实治理资源的轻量展示页。

**Architecture:** 保持 `GovernancePage` 作为单一路由组件，继续通过既有治理 API 获取规则、审计和血缘数据。组件内部只保留视图页签与运行既有质量规则的行为，使用现有应用样式词汇建立主内容和审计侧栏。

**Tech Stack:** React、TypeScript、Vitest、Testing Library、既有 Vite 前端。

## Global Constraints

- 仅修改 `/governance` 及其测试、样式，不改变其他路由和后端 API。
- 不新增规则创建、编辑、删除、权限模拟或静态业务数据。
- 所有状态展示来源于现有治理接口返回。
- 任何代码改动先以失败测试定义行为，再实现最小代码。
- 依照 `docs/04-Development-Version-Control.md` 在验证后提交并推送 `dev`。

---

### Task 1: 用测试锁定轻量治理页结构

**Files:**
- Create: `frontend/src/features/governance/GovernancePage.test.tsx`
- Modify: `frontend/src/features/governance/GovernancePage.tsx`

**Interfaces:**
- Consumes: `GovernancePage({ role: DemoRole })`。
- Produces: 页签“规则结果”“数据血缘”“可追溯性”，以及真实 API 请求的可观察渲染。

- [x] **Step 1: Write the failing test**

```tsx
it("renders the three evidence views and no rule-creation action", async () => {
  render(<GovernancePage role="modeler" />);
  expect(await screen.findByRole("tab", { name: "规则结果" })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "数据血缘" })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "可追溯性" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "新建质量规则" })).not.toBeInTheDocument();
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- GovernancePage.test.tsx`

Expected: FAIL because the page currently has no evidence-view tabs and still exposes `新建质量规则`.

- [x] **Step 3: Write minimal implementation**

Replace the current metric grid, permission preview and creation form with a tab state defaulting to `rules`. Render three labelled tab buttons and the matching content panel. Keep the refresh handler and existing `runRule` function.

- [x] **Step 4: Run test to verify it passes**

Run: `npm test -- GovernancePage.test.tsx`

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add frontend/src/features/governance/GovernancePage.tsx frontend/src/features/governance/GovernancePage.test.tsx
git commit -m "精简治理与可追溯页面"
```

### Task 2: 渲染真实规则、血缘和审计证据

**Files:**
- Modify: `frontend/src/features/governance/GovernancePage.tsx`
- Modify: `frontend/src/features/governance/GovernancePage.test.tsx`

**Interfaces:**
- Consumes: `GET /api/governance/quality/rules`、`GET /api/governance/audit`、`GET /api/governance/lineage/metric/supplier_on_time_delivery_rate`。
- Produces: 规则行、线性血缘链、最近事件时间线和空态。

- [x] **Step 1: Write the failing test**

```tsx
it("shows API-backed lineage and recent audit events", async () => {
  render(<GovernancePage role="modeler" />);
  await user.click(screen.getByRole("tab", { name: "数据血缘" }));
  expect(await screen.findByText("来源文件")).toBeInTheDocument();
  expect(screen.getByText("最近事件")).toBeInTheDocument();
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- GovernancePage.test.tsx`

Expected: FAIL because the existing page has no tabbed lineage panel or side audit rail.

- [x] **Step 3: Write minimal implementation**

Render source API labels in the lineage chain, map audit entries to a right-side timeline, and show explicit empty-state text if rules, lineage nodes or audit events are unavailable. Do not insert fallback business records.

- [x] **Step 4: Run test to verify it passes**

Run: `npm test -- GovernancePage.test.tsx`

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add frontend/src/features/governance/GovernancePage.tsx frontend/src/features/governance/GovernancePage.test.tsx
git commit -m "展示治理证据与审计事件"
```

### Task 3: 完成样式与全量验证

**Files:**
- Modify: `frontend/src/styles/index.css`
- Test: `frontend/src/features/governance/GovernancePage.test.tsx`

**Interfaces:**
- Consumes: 任务 1 和任务 2 的语义 className。
- Produces: 自适应两栏治理页，窄屏下审计栏置于主内容下方。

- [x] **Step 1: Write the failing test**

```tsx
it("turns an API quality-rule type into a readable result label", async () => {
  render(<GovernancePage role="modeler" />);
  expect(await screen.findByText("sales_order_no · 唯一性检查")).toBeInTheDocument();
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- GovernancePage.test.tsx`

Expected: FAIL because the rule row still displays the backend rule name verbatim.

- [x] **Step 3: Write minimal implementation**

Add concise styles for `.oo-governance-layout`, `.oo-governance-tabs`, `.oo-rule-list`, `.oo-lineage-chain` and `.oo-audit-rail`. Use existing design tokens, retain keyboard-visible tabs, map rule types to readable Chinese labels, and give each `运行` button an accessible label containing the rule name.

- [x] **Step 4: Run tests, lint and build**

Run: `npm test -- --run && npm run lint && npm run build`

Expected: all frontend tests pass, TypeScript emits no errors, and Vite build exits 0.

- [x] **Step 5: Browser verify and commit**

Open `http://127.0.0.1:5175/governance`, verify all three tabs and the audit rail at desktop width, then:

```bash
git add frontend/src/features/governance/GovernancePage.tsx frontend/src/features/governance/GovernancePage.test.tsx frontend/src/styles/index.css
git commit -m "完善轻量治理展示样式"
git push origin dev
```
