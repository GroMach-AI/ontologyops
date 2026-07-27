// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OntologyDetailPage } from "./OntologyDetailPage";
import type { Ontology } from "./OntologyPage";

const ontology: Ontology = {
  id: "onto-manufacturing",
  name: "制造运营本体",
  scope: "连接客户、销售订单与产品，支撑生产运营决策。",
  status: "draft",
  version: "0.1",
  objects: 2,
  links: 1,
  rules: 3,
  updated: "刚刚",
  entities: [
    {
      name: "Customer",
      label: "客户",
      description: "购买产品或服务的业务主体。",
      source_file: "customers.csv",
      properties: [
        { name: "customer_id", type: "string", is_key: true, description: "客户唯一标识" },
        { name: "name", type: "string", is_key: false, description: "客户名称" },
      ],
    },
    {
      name: "SalesOrder",
      label: "销售订单",
      description: "客户发起的产品购买订单。",
      source_file: "sales_orders.csv",
      properties: [
        { name: "order_id", type: "string", is_key: true, description: "订单唯一标识" },
      ],
    },
  ],
  relationships: [
    {
      name: "CustomerPlacesOrder",
      from_entity: "Customer",
      to_entity: "SalesOrder",
      type: "one_to_many",
      description: "一个客户可以发起多个销售订单。",
      based_on: "customer_id",
    },
  ],
};

describe("OntologyDetailPage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
  it("blocks publication when the API reports an untrusted mapping", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        valid: false,
        blockers: [{ code: "mapping_dataset_not_trusted", message: "供应商数据集尚未可信" }],
      }),
    }));
    const blocked = { ...ontology, draftId: "draft-1" };

    render(
      <MemoryRouter initialEntries={["/ontology/onto-manufacturing"]}>
        <Routes>
          <Route path="/ontology/:id" element={<OntologyDetailPage role="modeler" ontologies={[blocked]} onUpdate={() => undefined} />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("供应商数据集尚未可信")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发布 v0.1" })).toBeDisabled();
  });

  it("shows ontology overview, entities, relationships and publishes the draft", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ valid: true, blockers: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ release_id: "release-1", semantic_version: "v1" }) }));
    const publishable = { ...ontology, draftId: "draft-2" };

    render(
      <MemoryRouter initialEntries={["/ontology/onto-manufacturing"]}>
        <Routes>
          <Route path="/ontology/:id" element={<OntologyDetailPage role="modeler" ontologies={[publishable]} onUpdate={onUpdate} />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "制造运营本体" })).toBeInTheDocument();
    expect(screen.getAllByText("客户").length).toBeGreaterThan(0);
    expect(screen.getByText("customer_id")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByRole("button", { name: "发布 v0.1" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "发布 v0.1" }));
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: "published", version: "1", releaseId: "release-1" }));
    expect(screen.getByText(/版本 v1 已发布/)).toBeInTheDocument();
  });

  it("keeps the detail header focused on publishing, without an edit-draft action", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ valid: true, blockers: [] }),
    }));

    render(
      <MemoryRouter initialEntries={["/ontology/onto-manufacturing"]}>
        <Routes>
          <Route path="/ontology/:id" element={<OntologyDetailPage role="modeler" ontologies={[{ ...ontology, draftId: "draft-3" }]} onUpdate={() => undefined} />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("button", { name: "发布 v0.1" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "编辑草稿" })).not.toBeInTheDocument();
  });

  it("removes the redundant ontology-structure heading above the graph", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ valid: true, blockers: [] }),
    }));

    render(
      <MemoryRouter initialEntries={["/ontology/onto-manufacturing"]}>
        <Routes>
          <Route path="/ontology/:id" element={<OntologyDetailPage role="modeler" ontologies={[{ ...ontology, draftId: "draft-4" }]} onUpdate={() => undefined} />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByRole("heading", { name: "本体结构" })).not.toBeInTheDocument();
  });
});
