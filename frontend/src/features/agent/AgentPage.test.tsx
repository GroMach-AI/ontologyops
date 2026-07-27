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
        answer: "当前已发布本体中已映射 2 条「销售订单」实体数据。",
        objects: [{ type: "SalesOrder", id: "SO-001", label: "SO-001" }],
        evidence: [{ kind: "entity_count", entity_id: "SalesOrder", count: 2, dataset_id: "dataset-1", mapping_id: "mapping-1" }],
        provenance: {
          sources: ["purchase_orders", "inventory"],
          updated_at: "2026-06-20T09:00:00",
          metric_definition: "按时交付订单数 / 应交付订单数",
          ontology_version: "v1.0.0",
        },
        tool_calls: [{ name: "evaluate_rule", status: "success" }],
        model: { provider: "受控查询引擎", model_name: "ontology-instance-query", mode: "deterministic" },
      }),
    }),
  );
  const user = userEvent.setup();
  render(<AgentPage role="operator" />);

  await user.click(screen.getByRole("button", { name: "有多少销售订单？" }));
  await user.click(screen.getByRole("button", { name: "发送问题" }));

  expect(await screen.findByText("当前已发布本体中已映射 2 条「销售订单」实体数据。")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "查看证据" }));
  expect(await screen.findByRole("dialog", { name: "关联证据" })).toBeInTheDocument();
});
