// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { OntologyGraphView } from "./OntologyGraphView";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("shows materialized entity instances and their source evidence", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      total: 2,
      items: [{ entity_key: "SO-001", properties: { sales_order_no: "SO-001", customer_code: "C-001" }, evidence: { dataset_id: "ds_trusted", mapping_id: "map_001", pipeline_run_id: "run_001" } }],
    }),
  }));
  render(
    <OntologyGraphView
      ontologyId="ontology_001"
      entities={[{ name: "SalesOrder", label: "销售订单", description: "订单", source_file: "sales.csv", properties: [{ name: "sales_order_no", type: "string", is_key: true, description: "销售订单号" }] }]}
      relationships={[]}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "实体数据" }));

  expect(await screen.findByText("2 条实体实例")).toBeInTheDocument();
  expect(screen.getAllByText("SO-001")).toHaveLength(2);
  expect(screen.getByText(/数据集 ds_trusted/)).toBeInTheDocument();
});

it("moves a relationship edge when its source entity card is dragged", () => {
  render(
    <OntologyGraphView
      entities={[
        { name: "SalesOrder", label: "销售订单", description: "订单", source_file: "sales.csv", properties: [] },
        { name: "InventoryLot", label: "库存批次", description: "库存", source_file: "inventory.csv", properties: [] },
      ]}
      relationships={[{ name: "库存履约", from_entity: "SalesOrder", to_entity: "InventoryLot", type: "many_to_many", description: "订单由库存履约", based_on: "" }]}
    />,
  );

  const edge = screen.getByTestId("graph-edge-SalesOrder-InventoryLot");
  const initialX = edge.getAttribute("x1");
  const node = screen.getByRole("button", { name: "移动实体 销售订单" });
  fireEvent.mouseDown(node, { clientX: 100, clientY: 100 });
  fireEvent.mouseMove(document, { clientX: 180, clientY: 100 });
  fireEvent.mouseUp(document);

  expect(edge.getAttribute("x1")).not.toBe(initialX);
});

it("renders a concise Chinese business label for a generated relationship name", () => {
  render(
    <OntologyGraphView
      entities={[
        { name: "SalesOrder", label: "销售订单", description: "订单", source_file: "sales.csv", properties: [] },
        { name: "InventoryLot", label: "库存批次", description: "库存", source_file: "inventory.csv", properties: [] },
      ]}
      relationships={[{ name: "SalesOrder_fulfilled_by_InventoryLot", from_entity: "SalesOrder", to_entity: "InventoryLot", type: "many_to_many", description: "订单优先使用库存批次履约。", based_on: "" }]}
    />,
  );

  expect(screen.getByText("库存履约")).toBeInTheDocument();
  expect(screen.queryByText("SalesOrder_fulfilled_by_InventoryLot")).not.toBeInTheDocument();
});

it("shows each entity property's semantic explanation in the structure panel", () => {
  render(
    <OntologyGraphView
      entities={[{
        name: "Product",
        label: "产品",
        description: "产品主数据",
        source_file: "product.csv",
        properties: [{ name: "product_id", type: "string", is_key: true, description: "产品唯一标识" }],
      }]}
      relationships={[]}
    />,
  );

  expect(screen.getByText("字段")).toBeInTheDocument();
  expect(screen.getByText("类型")).toBeInTheDocument();
  expect(screen.getByText("解释")).toBeInTheDocument();
  expect(screen.getByText("产品唯一标识")).toBeInTheDocument();
});

it("does not place an opaque rectangle over relationship lines", () => {
  const { container } = render(
    <OntologyGraphView
      entities={[
        { name: "Customer", label: "客户", description: "客户", source_file: "customer.csv", properties: [] },
        { name: "SalesOrder", label: "销售订单", description: "订单", source_file: "sales.csv", properties: [] },
      ]}
      relationships={[{ name: "Customer_places_SalesOrder", from_entity: "Customer", to_entity: "SalesOrder", type: "one_to_many", description: "客户下达销售订单。", based_on: "" }]}
    />,
  );

  expect(container.querySelector(".oo-graph-edge-label rect")).not.toBeInTheDocument();
});

it("keeps the conditional sales-order to production-plan relationship in the manufacturing flow", () => {
  render(
    <OntologyGraphView
      entities={[
        { name: "SalesOrder", label: "销售订单", description: "订单", source_file: "sales.csv", properties: [] },
        { name: "Product", label: "产品", description: "产品", source_file: "product.csv", properties: [] },
        { name: "ProductionPlan", label: "生产工单", description: "生产", source_file: "plan.csv", properties: [] },
      ]}
      relationships={[
        { name: "SalesOrder_orders_Product", from_entity: "SalesOrder", to_entity: "Product", type: "many_to_one", description: "订单产品", based_on: "" },
        { name: "SalesOrder_triggers_ProductionPlan", from_entity: "SalesOrder", to_entity: "ProductionPlan", type: "one_to_one", description: "库存不足时触发生产", based_on: "" },
      ]}
    />,
  );

  expect(screen.queryByTestId("graph-edge-SalesOrder-Product")).not.toBeInTheDocument();
  expect(screen.getByTestId("graph-edge-SalesOrder-ProductionPlan")).toBeInTheDocument();
  expect(screen.getByText("库存不足时触发")).toBeInTheDocument();
});

it("renders the inventory-shortage trigger as a solid straight line", () => {
  const { container } = render(
    <OntologyGraphView
      entities={[
        { name: "SalesOrder", label: "销售订单", description: "订单", source_file: "sales.csv", properties: [] },
        { name: "ProductionPlan", label: "生产工单", description: "生产", source_file: "plan.csv", properties: [] },
      ]}
      relationships={[{ name: "SalesOrder_triggers_ProductionPlan", from_entity: "SalesOrder", to_entity: "ProductionPlan", type: "one_to_one", description: "库存不足时触发生产", based_on: "" }]}
    />,
  );

  expect(container.querySelector('[data-testid="graph-edge-SalesOrder-ProductionPlan"]')).toHaveClass("is-strong");
  expect(container.querySelector('[data-testid="graph-conditional-edge-SalesOrder-ProductionPlan"]')).not.toBeInTheDocument();
});

it("enters canvas pan mode only while the space key is held", () => {
  render(<OntologyGraphView entities={[{ name: "Customer", label: "客户", description: "客户", source_file: "customer.csv", properties: [] }]} relationships={[]} />);
  const canvas = screen.getByRole("region", { name: "本体图谱画布" });

  expect(canvas).not.toHaveClass("is-pan-ready");
  fireEvent.keyDown(window, { code: "Space" });
  expect(canvas).toHaveClass("is-pan-ready");
  fireEvent.keyUp(window, { code: "Space" });
  expect(canvas).not.toHaveClass("is-pan-ready");
});
