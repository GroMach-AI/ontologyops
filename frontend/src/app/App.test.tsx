import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

import App from "./App";

afterEach(() => vi.unstubAllGlobals());

it("shows every MVP navigation destination when status API is unavailable", () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  render(
    <MemoryRouter>
      <App />
    </MemoryRouter>,
  );

  expect(screen.getByRole("link", { name: "数据与管道" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "本体管理" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "智能问数" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "治理中心" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "模型管理" })).toBeInTheDocument();
  expect(screen.queryByText("风险驾驶舱")).not.toBeInTheDocument();
});
