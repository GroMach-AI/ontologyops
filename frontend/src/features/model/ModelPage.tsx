import { Plus, Save } from "lucide-react";
import { useEffect, useState } from "react";

import type { DemoRole } from "../../components/AppShell";

type Provider = { id: string; provider: string; model_name: string; enabled: boolean; is_default: boolean; base_url: string | null; api_key_env: string | null; temperature: number; max_tokens: number; agent_enabled: boolean; modeling_enabled: boolean; secret_policy: string };
type ProviderForm = { provider: string; model_name: string; base_url: string; api_key_env: string; temperature: number; max_tokens: number };
const initialForm: ProviderForm = { provider: "GPT", model_name: "gpt-4.1-mini", base_url: "https://api.openai.com/v1", api_key_env: "OPENAI_API_KEY", temperature: 0, max_tokens: 1024 };

export function ModelPage({ role }: { role: DemoRole }) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [notice, setNotice] = useState("正在加载服务端模型配置...");
  const [form, setForm] = useState<ProviderForm>(initialForm);
  const [showCreate, setShowCreate] = useState(false);
  const admin = role === "admin";
  const headers = { "Content-Type": "application/json", "X-Demo-Role": role };
  async function loadProviders() {
    const response = await fetch("/api/models", { headers: { "X-Demo-Role": role } });
    if (response.ok) { setProviders((await response.json()).providers); setNotice("API Key 仅记录环境变量名，浏览器与数据库都不会保存真实密钥。"); }
    else setNotice("模型配置加载失败。");
  }
  useEffect(() => { void loadProviders(); }, []);
  async function setDefault(provider: Provider) {
    const response = await fetch(`/api/models/${provider.id}`, { method: "PATCH", headers, body: JSON.stringify({ enabled: true, is_default: true, base_url: provider.base_url, api_key_env: provider.api_key_env, temperature: provider.temperature, max_tokens: provider.max_tokens, agent_enabled: true, modeling_enabled: true }) });
    if (response.ok) { setNotice(`${provider.provider} 已设为 Agent 默认模型。`); await loadProviders(); }
    else setNotice((await response.json()).detail ?? "切换失败。");
  }
  async function createProvider() {
    const response = await fetch("/api/models", { method: "POST", headers, body: JSON.stringify(form) });
    if (response.ok) { setNotice("Provider 已创建。请确认服务端环境变量中已设置对应 API Key，然后设为默认。 "); setShowCreate(false); setForm(initialForm); await loadProviders(); }
    else setNotice((await response.json()).detail ?? "创建失败。");
  }
  return <div className="stack-lg"><div className="section-heading"><div><p className="eyebrow">Provider 与模型路由</p><h2>模型管理</h2></div><button className="primary-button" disabled={!admin} onClick={() => setShowCreate((value) => !value)}><Plus size={15} />新增 Provider</button></div><p className="inline-notice">{notice}</p>{showCreate && <div className="panel"><p className="eyebrow">GPT / DeepSeek 配置</p><h3>新增 Provider</h3><div className="form-grid"><label className="form-field"><span>Provider</span><select value={form.provider} onChange={(event) => { const provider = event.target.value; setForm({ ...form, provider, model_name: provider === "DeepSeek" ? "deepseek-chat" : "gpt-4.1-mini", base_url: provider === "DeepSeek" ? "https://api.deepseek.com/v1" : "https://api.openai.com/v1", api_key_env: provider === "DeepSeek" ? "DEEPSEEK_API_KEY" : "OPENAI_API_KEY" }); }}><option value="GPT">GPT</option><option value="DeepSeek">DeepSeek</option></select></label><Field label="模型名称" value={form.model_name} onChange={(model_name) => setForm({ ...form, model_name })} /><Field label="Base URL" value={form.base_url} onChange={(base_url) => setForm({ ...form, base_url })} /><Field label="服务端环境变量名" value={form.api_key_env} onChange={(api_key_env) => setForm({ ...form, api_key_env })} /><Field label="Temperature" value={String(form.temperature)} onChange={(value) => setForm({ ...form, temperature: Number(value) })} /><Field label="最大输出 Token" value={String(form.max_tokens)} onChange={(value) => setForm({ ...form, max_tokens: Number(value) })} /></div><div className="button-row"><button className="primary-button" onClick={() => void createProvider()}><Save size={15} />保存 Provider</button></div></div>}{!admin ? <div className="panel"><h3>模型配置仅对管理员开放</h3><p className="muted">当前角色无法读取或切换模型；智能问数仍会按已发布的受控默认配置运行。</p></div> : <><div className="two-column">{providers.map((provider) => <div className="panel provider" key={provider.id}><span className={`badge ${provider.enabled ? "success" : "neutral"}`}>{provider.is_default ? "默认启用" : provider.enabled ? "已启用" : "未启用"}</span><h3>{provider.provider}</h3><strong>{provider.model_name}</strong><p>{provider.base_url ? `${provider.base_url} · ${provider.api_key_env}` : "无需 API Key，可用于本地演示"}</p><small>{provider.secret_policy}</small>{!provider.is_default ? <div className="button-row"><button className="secondary-button" onClick={() => void setDefault(provider)}>设为 Agent 默认</button></div> : null}</div>)}</div><div className="panel"><p className="eyebrow">调用日志</p><h3>模型调用审计</h3><p className="muted">每次智能问数均记录 Provider、模型、模式、成功状态与可用 Token 使用量；详细记录在治理中心审计流水中。</p></div></>}</div>;
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="form-field"><span>{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} /></label>; }
