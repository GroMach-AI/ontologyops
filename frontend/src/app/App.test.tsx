import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

import App from "./App";

afterEach(() => vi.unstubAllGlobals());

it("shows every MVP navigation destination when status API is unavailable", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  render(
    <MemoryRouter>
      <App />
    </MemoryRouter>,
  );

  expect(await screen.findByRole("heading", { name: "本体管理" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "首页" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "数据管道" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "本体管理" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "智能助手" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "治理与可追溯" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "模型管理" })).toBeInTheDocument();
  expect(screen.queryByText("风险驾驶舱")).not.toBeInTheDocument();
});
