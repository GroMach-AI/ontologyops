import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { GovernancePage } from "./GovernancePage";

afterEach(() => vi.unstubAllGlobals());

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
