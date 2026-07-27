import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import { PipelinePage, datasetColumnNames, suggestFieldMappings } from "./PipelinePage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("suggests controlled semantic field mappings for a sales-order dataset", () => {
  const mappings = suggestFieldMappings(
    [
      { name: "sales_order_id", type: "string", is_key: true, description: "销售订单唯一标识" },
      { name: "customer_id", type: "string", is_key: false, description: "关联客户 ID" },
      { name: "product_id", type: "string", is_key: false, description: "关联产品 ID" },
      { name: "order_date", type: "date", is_key: false, description: "下单日期" },
      { name: "ordered_qty", type: "integer", is_key: false, description: "订购数量" },
      { name: "fulfillment_mode", type: "enum", is_key: false, description: "履约模式" },
    ],
    ["sales_order_no", "customer_code", "product_code", "order_date", "quantity", "fulfillment_status"],
  );

  expect(mappings).toEqual({
    sales_order_id: "sales_order_no",
    customer_id: "customer_code",
    product_id: "product_code",
    order_date: "order_date",
    ordered_qty: "quantity",
    fulfillment_mode: "fulfillment_status",
  });
});

it("normalizes the string column array returned by the dataset preview API", () => {
  expect(datasetColumnNames(["sales_order_no", "customer_code"])).toEqual(["sales_order_no", "customer_code"]);
});

it("automatically selects the best matching entity and permits mapping for an existing trusted dataset", async () => {
  const ontology = {
    id: "onto-1", name: "制造业本体", scope: "", status: "published" as const, version: "3", objects: 2, links: 0, rules: 0, updated: "",
    entities: [
      { name: "Product", label: "产品", description: "", source_file: "", properties: [{ name: "product_id", type: "string", is_key: true, description: "产品 ID" }] },
      { name: "SalesOrder", label: "销售订单", description: "", source_file: "", properties: [{ name: "sales_order_id", type: "string", is_key: true, description: "销售订单 ID" }, { name: "customer_id", type: "string", is_key: false, description: "客户 ID" }] },
    ], relationships: [],
  };
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url === "/api/sources") return Promise.resolve({ ok: true, json: async () => ({ sources: [{ id: "source-1", name: "sales_orders.csv", kind: "csv", pipeline_id: "source-1", dataset: { id: "dataset-trusted", stage: "trusted" } }] }) });
    if (url === "/api/datasets/dataset-trusted/preview") return Promise.resolve({ ok: true, json: async () => ({ dataset_version_id: "dataset-trusted", lifecycle_status: "trusted", columns: ["sales_order_no", "customer_code"], rows: [], row_count: 2 }) });
    if (url === "/api/ontology-drafts/list") return Promise.resolve({ ok: true, json: async () => ({ ontologies: [ontology] }) });
    return Promise.resolve({ ok: false, json: async () => ({}) });
  }));
  const user = userEvent.setup();

  render(<PipelinePage role="modeler" />);
  await user.click(await screen.findByRole("button", { name: "本体映射" }));

  expect(await screen.findByLabelText("目标实体类型")).toHaveValue("SalesOrder");
  expect(screen.getByRole("button", { name: "验证并填充实体数据" })).toBeEnabled();
  expect(screen.getByText("sales_order_no")).toBeInTheDocument();
});

it("starts with a CSV-only data connection and does not imply MySQL support", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sources: [] }) }));

  render(<PipelinePage role="modeler" />);

  expect(await screen.findByTestId("connection-dropzone")).toBeInTheDocument();
  expect(screen.queryByText(/MySQL/)).not.toBeInTheDocument();
});

it("allows one data connection to select multiple CSV files while keeping them independently selectable", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sources: [] }) }));

  const { container } = render(<PipelinePage role="modeler" />);

  expect(await screen.findByTestId("connection-dropzone")).toBeInTheDocument();
  expect(container.querySelector('input[type="file"]')).toHaveAttribute("multiple");
  expect(screen.getByText("每个文件会分别创建独立的数据源和原始数据集；请在下方选择当前要处理的文件。"))
    .toBeInTheDocument();
});

it("accepts a CSV dropped onto the data connection upload area", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ sources: [] }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ source_id: "source-1" }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ sources: [] }) });
  vi.stubGlobal("fetch", fetchMock);

  render(<PipelinePage role="modeler" />);

  const dropzone = await screen.findByTestId("connection-dropzone");
  fireEvent.drop(dropzone, { dataTransfer: { files: [new File(["order_id\\nSO-1"], "sales_orders.csv", { type: "text/csv" })] } });

  expect(await screen.findByText("CSV 已连接，原始数据集和字段画像已创建。")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith("/api/sources/upload", expect.objectContaining({ method: "POST" }));
});

it("shows an explicit human-review AI suggestion for the quality node", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sources: [] }) }));
  const user = userEvent.setup();

  render(<PipelinePage role="modeler" />);
  await user.click(await screen.findByRole("button", { name: "数据清洗与质量" }));

  expect(screen.getByText("AI 建议，需人工确认")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "采用为草稿" })).toBeInTheDocument();
});

it("places preview run in the canvas action bar instead of the isolated page header", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sources: [] }) }));

  render(<PipelinePage role="modeler" />);

  expect(await screen.findByTestId("pipeline-actionbar")).toContainElement(screen.getByRole("button", { name: "预览运行" }));
});

it("starts the four controlled nodes in a horizontal sequence", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sources: [] }) }));

  render(<PipelinePage role="modeler" />);

  const connection = await screen.findByRole("button", { name: "数据连接" });
  const storage = screen.getByRole("button", { name: "数据存储" });
  const quality = screen.getByRole("button", { name: "数据清洗与质量" });
  const mapping = screen.getByRole("button", { name: "本体映射" });
  expect(connection.style.top).toBe(storage.style.top);
  expect(storage.style.top).toBe(quality.style.top);
  expect(quality.style.top).toBe(mapping.style.top);
});
