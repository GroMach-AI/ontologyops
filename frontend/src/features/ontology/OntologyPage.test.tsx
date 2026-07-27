// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OntologyDetailPage } from "./OntologyDetailPage";
import { OntologyPage, type Ontology } from "./OntologyPage";

function OntologyFlowHarness({ onCreated }: { onCreated: (ontology: Ontology) => void }) {
  const [ontologies, setOntologies] = useState<Ontology[]>([]);
  return (
    <Routes>
      <Route path="/ontology" element={<OntologyPage role="modeler" ontologies={ontologies} onCreated={(ontology) => { onCreated(ontology); setOntologies((items) => [...items, ontology]); }} />} />
      <Route path="/ontology/:id" element={<OntologyDetailPage role="modeler" ontologies={ontologies} onUpdate={() => undefined} />} />
    </Routes>
  );
}

describe("OntologyPage candidate review", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the candidate list when LLM entities omit nested fields", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          profiling: { files_parsed: 1, columns_total: 2, details: [] },
          links_detected: [],
          qa_questions: [],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          analysis: JSON.stringify({
            entities: [{ name: "Customer", label: "客户" }],
            relationships: [],
            questions: [{ category: "entity", question: "是否确认客户实体？", suggested: ["确认"] }],
            summary: "识别出客户实体。",
          }),
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          analysis: JSON.stringify({
            entities: [{ name: "Customer", label: "客户" }],
            summary: "已根据回答确认客户实体。",
          }),
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    const onCreated = vi.fn();
    const { container } = render(
      <MemoryRouter initialEntries={["/ontology"]}>
        <OntologyFlowHarness onCreated={onCreated} />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: /创建第一个本体/ }));
    await user.type(screen.getByPlaceholderText("例如：制造业本体、医疗运营本体"), "客户本体");
    await user.type(screen.getByPlaceholderText("说明行业、组织范围、关键决策场景与核心业务概念。"), "客户运营分析");

    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();
    await user.upload(fileInput!, new File(["customer_id,name\n1,Neo"], "customers.csv", { type: "text/csv" }));

    await user.click(screen.getByRole("button", { name: /下一步：分析数据/ }));
    await screen.findByText(/已解析 1 个文件/);
    await user.click(screen.getByRole("button", { name: /进入语义分析与问答/ }));

    await screen.findByText("是否确认客户实体？");
    await user.click(screen.getByRole("button", { name: "确认" }));
    await user.click(screen.getByRole("button", { name: /查看推荐列表/ }));

    await waitFor(() => expect(screen.getByText(/1 个实体/)).toBeInTheDocument());
    expect(screen.getByText("客户 (Customer)")).toBeInTheDocument();
    expect(screen.getByText("已根据回答确认客户实体。")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await user.click(screen.getByRole("button", { name: /确认并创建本体/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(await screen.findByRole("heading", { name: "客户本体" })).toBeInTheDocument();
    expect(screen.getByText("客户运营分析")).toBeInTheDocument();
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({
      name: "客户本体",
      entities: [expect.objectContaining({ name: "Customer", properties: [] })],
    }));
  });
});
