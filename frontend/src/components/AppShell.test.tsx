import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

import { AppShell } from "./AppShell";

afterEach(cleanup);

it("keeps the role selector without duplicating the selected role or MVP label", () => {
  render(
    <MemoryRouter>
      <AppShell role="admin" onRoleChange={vi.fn()} ontologies={[]}>
        <div>页面内容</div>
      </AppShell>
    </MemoryRouter>,
  );

  expect(screen.getByRole("combobox", { name: "切换当前角色" })).toHaveValue("admin");
  expect(screen.getByRole("button", { name: "暂无本体" })).toBeInTheDocument();
  expect(screen.getByText("当前角色")).toBeInTheDocument();
  expect(screen.queryByText("管理员", { selector: "strong" })).not.toBeInTheDocument();
  expect(screen.queryByText("单租户 MVP")).not.toBeInTheDocument();
});

it("places ontology management before the renamed data-pipeline navigation item", () => {
  render(
    <MemoryRouter>
      <AppShell role="admin" onRoleChange={vi.fn()} ontologies={[]}>
        <div>页面内容</div>
      </AppShell>
    </MemoryRouter>,
  );

  const labels = within(screen.getByRole("navigation", { name: "主导航" }))
    .getAllByRole("link")
    .map((link) => link.textContent);
  expect(labels).toEqual(["本体管理", "数据管道", "智能助手", "治理与可追溯", "模型管理"]);
});
