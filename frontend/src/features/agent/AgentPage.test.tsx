import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import { AgentPage } from "./AgentPage";


afterEach(() => vi.unstubAllGlobals());

it("continues a published entity query in the next turn and opens evidence", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        route: "ontology",
        answer: "当前已发布本体中已映射 2 条「销售订单」实体数据。",
        objects: [{ type: "SalesOrder", id: "SO-001", label: "SO-001" }],
        evidence: [{ kind: "entity_count", entity_id: "SalesOrder", count: 2, dataset_id: "dataset-1", mapping_id: "mapping-1" }],
        provenance: {
          sources: ["purchase_orders", "inventory"],
          updated_at: "2026-06-20T09:00:00",
          metric_definition: "按时交付订单数 / 应交付订单数",
          ontology_version: "v1.0.0",
        },
        tool_calls: [{ name: "query_entity_instances", entity_id: "SalesOrder", operation: "count", status: "success" }],
        model: { provider: "受控查询引擎", model_name: "ontology-instance-query", mode: "deterministic" },
      }),
    }).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        route: "ontology",
        answer: "当前已发布本体中共有 2 条「销售订单」实体数据：SO-001、SO-002。",
        objects: [], evidence: [],
        provenance: { sources: ["sales_orders.csv"], updated_at: "2026-07-27T00:00:00", metric_definition: "销售订单实例", ontology_version: "v1" },
        tool_calls: [{ name: "query_entity_instances", entity_id: "SalesOrder", operation: "list", status: "success" }],
        model: { provider: "受控查询引擎", model_name: "ontology-instance-query", mode: "deterministic" },
      }),
    }),
  );
  const user = userEvent.setup();
  render(<AgentPage role="operator" />);

  await user.click(screen.getByRole("button", { name: "有多少销售订单？" }));
  await user.click(screen.getByRole("button", { name: "发送问题" }));

  expect(await screen.findByText("当前已发布本体中已映射 2 条「销售订单」实体数据。")).toBeInTheDocument();
  await user.type(screen.getByRole("textbox", { name: "智能助手输入" }), "分别是哪几笔？");
  await user.click(screen.getByRole("button", { name: "发送问题" }));
  expect(await screen.findByText("当前已发布本体中共有 2 条「销售订单」实体数据：SO-001、SO-002。")).toBeInTheDocument();
  expect(vi.mocked(fetch).mock.calls[1][1]).toMatchObject({ body: expect.stringContaining('"context_entity_id":"SalesOrder"') });
  await user.click(screen.getAllByRole("button", { name: "查看证据" })[1]);
  expect(await screen.findByRole("dialog", { name: "关联证据" })).toBeInTheDocument();
});
