// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

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
  it("shows ontology overview, entities, relationships and publishes the draft", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();

    render(
      <MemoryRouter initialEntries={["/ontology/onto-manufacturing"]}>
        <Routes>
          <Route path="/ontology/:id" element={<OntologyDetailPage role="modeler" ontologies={[ontology]} onUpdate={onUpdate} />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "制造运营本体" })).toBeInTheDocument();
    expect(screen.getAllByText("客户").length).toBeGreaterThan(0);
    expect(screen.getByText("customer_id")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /发布版本/ }));
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: "published", version: "1.0" }));
    expect(screen.getByText(/版本 1.0 已发布/)).toBeInTheDocument();
  });
});
