import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import { AgentPage } from "./AgentPage";


afterEach(() => vi.unstubAllGlobals());

it("renders provenance and opens evidence", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        answer: "华东精铸存在关键物料供应风险。",
        objects: [{ type: "Supplier", id: "SUP-001", label: "华东精铸" }],
        evidence: [{ supplier: "华东精铸", order_number: "PO-2026-001", material: "伺服电机" }],
        provenance: {
          sources: ["purchase_orders", "inventory"],
          updated_at: "2026-06-20T09:00:00",
          metric_definition: "按时交付订单数 / 应交付订单数",
          ontology_version: "v1.0.0",
        },
        tool_calls: [{ name: "evaluate_rule", status: "success" }],
      }),
    }),
  );
  const user = userEvent.setup();
  render(<AgentPage role="operator" />);

  await user.click(screen.getByRole("button", { name: "发送" }));

  expect(await screen.findByText("数据来源")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "查看关联证据" }));
  expect(await screen.findByRole("dialog", { name: "关联证据" })).toBeInTheDocument();
});
