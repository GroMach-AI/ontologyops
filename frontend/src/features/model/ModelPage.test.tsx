import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import { ModelPage } from "./ModelPage";

const deepseek = { id: "deepseek", provider: "DeepSeek", model_name: "deepseek-v4-flash", enabled: false, is_default: false, base_url: "https://api.deepseek.com", api_key_env: "DEEPSEEK_API_KEY", temperature: 0, max_tokens: 4096, agent_enabled: true, modeling_enabled: true, verification_status: "unconfigured", last_error: null, available_models: [{ id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" }, { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" }] };
const compatible = { id: "compatible", provider: "Compatible", model_name: "custom-model", enabled: false, is_default: false, base_url: "", api_key_env: "COMPATIBLE_API_KEY", temperature: 0, max_tokens: 4096, agent_enabled: true, modeling_enabled: true, verification_status: "unconfigured", last_error: null, available_models: [] };

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

it("labels the GPT provider as ChatGPT", async () => {
  const gpt = { ...deepseek, id: "gpt", provider: "GPT", model_name: "gpt-4.1-mini", base_url: "https://api.openai.com/v1", available_models: [{ id: "gpt-4.1-mini", label: "GPT-4.1 mini" }] };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ providers: [deepseek, gpt] }) }));
  render(<ModelPage role="admin" />);
  const user = userEvent.setup();

  await user.click(await screen.findByRole("button", { name: /ChatGPT/ }));

  expect(await screen.findByRole("heading", { name: "ChatGPT" })).toBeInTheDocument();
});

it("uses a bundled DeepSeek mark instead of a remote image", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ providers: [deepseek] }) }));
  render(<ModelPage role="admin" />);

  const marks = await screen.findAllByAltText("DeepSeek");
  expect(marks).not.toHaveLength(0);
  expect(marks.every((mark) => mark.getAttribute("src") === "/assets/deepseek-mark.svg")).toBe(true);
});

it("keeps a model choice local until connection testing", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ providers: [deepseek] }) });
  vi.stubGlobal("fetch", fetchMock);
  render(<ModelPage role="admin" />);
  const user = userEvent.setup();
  await user.selectOptions(await screen.findByRole("combobox", { name: "选择模型" }), "deepseek-v4-pro");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("shows an independent OpenAI-compatible configuration after selecting other models", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ providers: [deepseek, compatible] }) }));
  render(<ModelPage role="admin" />);
  const user = userEvent.setup();

  await user.click(await screen.findByRole("button", { name: /其他兼容模型/ }));

  expect(await screen.findByRole("heading", { name: "其他兼容模型" })).toBeInTheDocument();
  expect(screen.getByLabelText("模型 ID")).toHaveValue("custom-model");
  expect(screen.getByLabelText("Base URL")).toHaveValue("");
  expect(screen.getByLabelText("Base URL")).not.toHaveAttribute("readonly");
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
