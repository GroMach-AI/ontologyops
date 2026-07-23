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
