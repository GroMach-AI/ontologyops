import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";

import { AppShell } from "./AppShell";

it("keeps the role selector without duplicating the selected role or MVP label", () => {
  render(
    <MemoryRouter>
      <AppShell role="admin" onRoleChange={vi.fn()} ontologies={[]}>
        <div>页面内容</div>
      </AppShell>
    </MemoryRouter>,
  );

  expect(screen.getByRole("combobox", { name: "切换当前角色" })).toHaveValue("admin");
  expect(screen.getByText("当前角色")).toBeInTheDocument();
  expect(screen.queryByText("管理员", { selector: "strong" })).not.toBeInTheDocument();
  expect(screen.queryByText("单租户 MVP")).not.toBeInTheDocument();
});
