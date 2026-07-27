import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import { ModelPage } from "./ModelPage";

const deepseek = { id: "deepseek", provider: "DeepSeek", model_name: "deepseek-v4-flash", enabled: false, is_default: false, base_url: "https://api.deepseek.com", api_key_env: "DEEPSEEK_API_KEY", temperature: 0, max_tokens: 4096, agent_enabled: true, modeling_enabled: true, verification_status: "unconfigured", last_error: null, available_models: [{ id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" }, { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" }] };

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("shows DeepSeek Flash and Pro in the approved API-key form", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ providers: [deepseek] }) }));
  render(<ModelPage role="admin" />);
  expect(await screen.findByRole("option", { name: "DeepSeek V4 Flash" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "DeepSeek V4 Pro" })).toBeInTheDocument();
  expect(screen.getByLabelText("API Key")).toHaveAttribute("type", "password");
  expect(screen.getByRole("button", { name: "测试连接" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "保存配置" })).not.toBeInTheDocument();
});

it("removes the redundant model-access heading while retaining the selected provider", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ providers: [deepseek] }) }));

  render(<ModelPage role="admin" />);

  expect(await screen.findByRole("heading", { name: "DeepSeek" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "模型接入" })).not.toBeInTheDocument();
});

it("keeps a model choice local until connection testing", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ providers: [deepseek] }) });
  vi.stubGlobal("fetch", fetchMock);
  render(<ModelPage role="admin" />);
  const user = userEvent.setup();
  await user.selectOptions(await screen.findByRole("combobox", { name: "选择模型" }), "deepseek-v4-pro");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("keeps a failed connection result visible without saving a Key", async () => {
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
  expect(screen.queryByText("已连接")).not.toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalledWith("/api/models/deepseek/local-secret", expect.anything());
});

it("saves a successful connection and replaces the entered Key with a mask", async () => {
  const verified = { ...deepseek, verification_status: "verified", last_error: null };
  const enabled = { ...verified, enabled: true, is_default: true };
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ providers: [deepseek] }) })
    .mockResolvedValueOnce({ ok: true, json: async () => verified })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ secret_ref: "DEEPSEEK_API_KEY", status: "stored_locally" }) })
    .mockResolvedValueOnce({ ok: true, json: async () => enabled });
  vi.stubGlobal("fetch", fetchMock);
  render(<ModelPage role="admin" />);
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("API Key"), "valid-key-for-test");
  await user.click(screen.getByRole("button", { name: "测试连接" }));
  expect(await screen.findByText("测试通过")).toBeInTheDocument();
  expect(screen.getByLabelText("API Key")).toHaveValue("••••••••••••");
  await user.click(screen.getByLabelText("API Key"));
  expect(screen.getByLabelText("API Key")).toHaveValue("");
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/models/deepseek/local-secret", expect.objectContaining({ method: "PUT" })));
  expect(fetchMock).toHaveBeenCalledWith("/api/models/deepseek", expect.objectContaining({ method: "PATCH" }));
});
