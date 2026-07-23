import { Check, Plug, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { DemoRole } from "../../components/AppShell";

type ModelOption = { id: string; label: string };
type Provider = {
  id: string; provider: string; model_name: string; enabled: boolean; is_default: boolean;
  base_url: string | null; api_key_env: string | null; temperature: number; max_tokens: number;
  agent_enabled: boolean; modeling_enabled: boolean; verification_status: "unconfigured" | "pending" | "verified" | "failed";
  last_error: string | null; available_models: ModelOption[];
};

const providerLabels = { DeepSeek: "DeepSeek 官方接口", GPT: "OpenAI 官方接口", Compatible: "OpenAI 兼容 API" } as const;

export function ModelPage({ role }: { role: DemoRole }) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedName, setSelectedName] = useState("DeepSeek");
  const [notice, setNotice] = useState("正在读取服务端模型配置…");
  const [apiKey, setApiKey] = useState("");
  const admin = role === "admin";
  const headers = { "Content-Type": "application/json", "X-Demo-Role": role };
  const selected = useMemo(() => providers.find((item) => item.provider === selectedName) ?? providers.find((item) => item.provider === "DeepSeek"), [providers, selectedName]);

  async function load() {
    const response = await fetch("/api/models", { headers: { "X-Demo-Role": role } });
    if (!response.ok) { setNotice("模型配置加载失败。"); return; }
    setProviders((await response.json()).providers.filter((item: Provider) => item.provider !== "Mock Provider"));
    setNotice("API Key 仅从本机环境变量读取；浏览器与数据库均不保存密钥。");
  }
  useEffect(() => { void load(); }, [role]);

  async function verify() {
    if (!selected) return;
    setNotice("正在验证连接…");
    const response = await fetch(`/api/models/${selected.id}/verify`, { method: "POST", headers });
    const payload = await response.json();
    setNotice(response.ok && payload.verification_status === "verified" ? "连接已验证。现在可以设为默认模型。" : payload.last_error ?? payload.detail ?? "连接验证失败。");
    await load();
  }
  async function saveLocalKey() {
    if (!selected || !apiKey) return;
    const response = await fetch(`/api/models/${selected.id}/local-secret`, { method: "PUT", headers, body: JSON.stringify({ api_key: apiKey }) });
    const payload = await response.json();
    setApiKey("");
    setNotice(response.ok ? `已仅保存到本机 .env：${payload.secret_ref}。现在可测试连接。` : payload.detail ?? "本机 Key 保存失败。");
  }
  async function save(modelName: string, asDefault = false) {
    if (!selected) return;
    const response = await fetch(`/api/models/${selected.id}`, { method: "PATCH", headers, body: JSON.stringify({ enabled: asDefault, is_default: asDefault, model_name: modelName, base_url: selected.base_url, api_key_env: selected.api_key_env, temperature: selected.temperature, max_tokens: selected.max_tokens, agent_enabled: true, modeling_enabled: true }) });
    const payload = await response.json();
    setNotice(response.ok ? (asDefault ? "已设为默认模型。" : "模型选择已保存；请重新测试连接。") : payload.detail ?? "保存失败。");
    await load();
  }

  if (!admin) return <div className="panel"><h3>模型配置仅对管理员开放</h3><p className="muted">当前角色无法读取或调整本机模型配置。</p></div>;
  const options = selected?.available_models ?? [];
  return <div className="model-page">
    <div className="section-heading model-heading"><div><h2>模型接入</h2><p className="muted">为本体候选生成配置模型</p></div></div>
    <p className="inline-notice" role="status">{notice}</p>
    <div className="model-console">
      <aside className="provider-rail" aria-label="API Provider">
        <strong>API Provider</strong>
        <ProviderButton name="DeepSeek" label={providerLabels.DeepSeek} selected={selectedName === "DeepSeek"} provider={providers.find((item) => item.provider === "DeepSeek")} icon={<img src="https://cdn.simpleicons.org/deepseek/4D6BFE" alt="" />} onClick={() => setSelectedName("DeepSeek")} />
        <ProviderButton name="GPT" label={providerLabels.GPT} selected={selectedName === "GPT"} provider={providers.find((item) => item.provider === "GPT")} icon={<Sparkles size={17} />} onClick={() => setSelectedName("GPT")} />
        <ProviderButton name="Compatible" label={providerLabels.Compatible} selected={selectedName === "Compatible"} provider={providers.find((item) => item.provider === "Compatible")} icon={<Plug size={17} />} onClick={() => setSelectedName("Compatible")} />
      </aside>
      <section className="model-form">
        {selected ? <>
          <div className="model-form-title"><span className="model-icon"><img src="https://cdn.simpleicons.org/deepseek/4D6BFE" alt="" /></span><h3>{selected.provider}</h3></div>
          <label className="form-field"><span>模型</span><select aria-label="选择模型" value={selected.model_name} onChange={(event) => void save(event.target.value)}>{options.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label className="form-field"><span>本机密钥环境变量</span><input readOnly value={selected.api_key_env ?? "未配置"} /></label>
          <label className="form-field"><span>API Key（仅本机）</span><div className="local-key-row"><input aria-label="API Key" type="password" value={apiKey} placeholder="输入后仅写入本机 .env" onChange={(event) => setApiKey(event.target.value)} /><button className="secondary-button" disabled={!apiKey} onClick={() => void saveLocalKey()}>保存 Key</button></div></label>
          <label className="form-field"><span>Base URL</span><input readOnly value={selected.base_url ?? "未配置"} /></label>
          <div className="model-actions"><button className="secondary-button" onClick={() => void verify()}>测试连接</button><button className="primary-button" disabled={selected.verification_status !== "verified"} onClick={() => void save(selected.model_name, true)}><Check size={15} />设为默认</button></div>
          <p className={selected.verification_status === "verified" ? "connection-state verified" : "connection-state"}>{selected.verification_status === "verified" ? "已连接" : selected.last_error ?? "尚未验证连接"}</p>
        </> : <p className="muted">此 Provider 尚未配置。MVP 当前只允许 DeepSeek、GPT 与明确测试用 Mock。</p>}
      </section>
    </div>
  </div>;
}

function ProviderButton({ name, label, selected, provider, icon, onClick }: { name: "DeepSeek" | "GPT" | "Compatible"; label: string; selected: boolean; provider?: Provider; icon: React.ReactNode; onClick: () => void }) {
  return <button className={`provider-choice ${selected ? "selected" : ""}`} onClick={onClick}><span className="provider-icon">{icon}</span><span><b>{name === "Compatible" ? "其他兼容模型" : name}</b><small>{label}</small></span>{provider?.verification_status === "verified" ? <em>已连接</em> : null}</button>;
}
