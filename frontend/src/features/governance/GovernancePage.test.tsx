import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import { GovernancePage } from "./GovernancePage";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("shows the three evidence views without exposing rule creation", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    if (input.includes("quality/rules")) return { ok: true, json: async () => [] };
    if (input.includes("governance/audit")) return { ok: true, json: async () => [] };
    if (input.includes("permissions/preview")) return { ok: true, json: async () => ({ hidden_fields: [] }) };
    return { ok: true, json: async () => ({ nodes: [], edges: [] }) };
  }));

  render(<GovernancePage role="modeler" />);

  expect(await screen.findByRole("tab", { name: "规则结果" })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "数据血缘" })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "可追溯性" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "新建质量规则" })).not.toBeInTheDocument();
});

it("shows API-backed lineage and recent audit events", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    if (input.includes("quality/rules")) return { ok: true, json: async () => [] };
    if (input.includes("governance/audit")) return { ok: true, json: async () => [{ id: "audit-1", created_at: "2026-07-27T10:18:00", actor: "modeler", event_type: "quality_rule_run", resource_type: "quality_rule" }] };
    return { ok: true, json: async () => ({ nodes: [{ id: "source", label: "ERP / purchase_orders.csv" }, { id: "agent", label: "智能问数 Agent" }], edges: [{ from: "source", to: "agent" }] }) };
  }));
  const user = userEvent.setup();

  render(<GovernancePage role="modeler" />);
  await user.click(await screen.findByRole("tab", { name: "数据血缘" }));

  expect(await screen.findByText("ERP / purchase_orders.csv")).toBeInTheDocument();
  expect(screen.getByText("quality rule run")).toBeInTheDocument();
});
