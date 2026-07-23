import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import { ModelPage } from "./ModelPage";

const deepseek = { id: "deepseek", provider: "DeepSeek", model_name: "deepseek-v4-flash", enabled: false, is_default: false, base_url: "https://api.deepseek.com", api_key_env: "DEEPSEEK_API_KEY", temperature: 0, max_tokens: 4096, agent_enabled: true, modeling_enabled: true, verification_status: "unconfigured", last_error: null, available_models: [{ id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" }, { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" }] };

afterEach(() => vi.unstubAllGlobals());

it("shows DeepSeek Flash and Pro in the approved API-key form", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ providers: [deepseek] }) }));
  render(<ModelPage role="admin" />);
  expect(await screen.findByRole("option", { name: "DeepSeek V4 Flash" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "DeepSeek V4 Pro" })).toBeInTheDocument();
  expect(screen.getByLabelText("API Key")).toHaveAttribute("type", "password");
  expect(screen.getByRole("button", { name: "测试连接" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "保存配置" })).toBeInTheDocument();
});

it("sends selected V4 Pro for a configuration update", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ providers: [deepseek] }) });
  vi.stubGlobal("fetch", fetchMock);
  render(<ModelPage role="admin" />);
  const user = userEvent.setup();
  await user.selectOptions(await screen.findByRole("combobox", { name: "选择模型" }), "deepseek-v4-pro");
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/models/deepseek", expect.objectContaining({ method: "PATCH" })));
});

it("keeps a failed connection result visible after refreshing the profile", async () => {
  const failed = { ...deepseek, verification_status: "failed", last_error: "无法验证连接，请检查 Key、Base URL 与网络。" };
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ providers: [deepseek] }) })
    .mockResolvedValueOnce({ ok: true, json: async () => failed })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ providers: [failed] }) });
  vi.stubGlobal("fetch", fetchMock);
  render(<ModelPage role="admin" />);
  const user = userEvent.setup();
  await user.click((await screen.findAllByRole("button", { name: "测试连接" })).at(-1)!);
  expect((await screen.findAllByText("无法验证连接，请检查 Key、Base URL 与网络。")).length).toBeGreaterThan(0);
});
