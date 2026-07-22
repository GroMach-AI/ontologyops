import { Download, RotateCcw, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { DemoRole } from "../../components/AppShell";

type OntologyDefinition = {
  objects: Array<{ id: string; label: string; key: string; attributes?: Array<{ id: string; label: string; type: string }> }>;
  links: Array<{ name: string; from: string; to: string; cardinality?: string }>;
  mappings: Array<{ object: string; dataset: string; key: string }>;
  metrics: Array<{ id: string; label: string; definition: string }>;
  functions: Array<{ id: string; label: string; definition: string }>;
  rules: Array<{ id: string; label: string; definition: string }>;
};
type Version = { id: string; status: string; semantic_version: string; published_at: string | null; definition: OntologyDefinition };
type Impact = { base_version: string | null; affected: Record<string, { added: string[]; removed: string[]; changed: string[] }>; downstream: { agent_tools: string[]; pages: string[] } };

export function OntologyPage({ role }: { role: DemoRole }) {
  const [definition, setDefinition] = useState<OntologyDefinition | null>(null);
  const [editor, setEditor] = useState("");
  const [versions, setVersions] = useState<Version[]>([]);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [notice, setNotice] = useState("正在载入本体草稿与版本历史...");
  const importRef = useRef<HTMLInputElement>(null);
  const editable = role === "admin" || role === "modeler";

  function headers() { return { "Content-Type": "application/json", "X-Demo-Role": role }; }
  function assignDefinition(next: OntologyDefinition) { setDefinition(next); setEditor(JSON.stringify(next, null, 2)); }
  async function loadState() {
    const [draftResponse, versionResponse] = await Promise.all([fetch("/api/ontology/draft"), fetch("/api/ontology/versions")]);
    if (draftResponse.ok) assignDefinition((await draftResponse.json()).definition);
    else await loadCandidate();
    if (versionResponse.ok) setVersions((await versionResponse.json()).versions);
    const impactResponse = await fetch("/api/ontology/draft/impact");
    if (impactResponse.ok) setImpact(await impactResponse.json()); else setImpact(null);
    setNotice("对象、属性、Link、字段映射、指标、函数和规则都保存在本体草稿中。");
  }
  async function loadCandidate() {
    const response = await fetch("/api/ontology/candidates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ datasets: ["purchase_orders", "inventory", "suppliers"] }) });
    if (!response.ok) { setNotice("候选建议加载失败，请确认后端已启动。"); return; }
    assignDefinition((await response.json()).definition);
    setNotice("当前为明确标记的 Mock 候选；请审核后保存草稿。");
  }
  useEffect(() => { void loadState(); }, []);
  function applyEditor() {
    try { assignDefinition(JSON.parse(editor) as OntologyDefinition); setNotice("草稿编辑内容已解析，保存后才会写入平台元数据。"); }
    catch { setNotice("JSON 格式无效，未应用修改。"); }
  }
  async function saveDraft() {
    if (!definition) return;
    const response = await fetch("/api/ontology/draft", { method: "PATCH", headers: headers(), body: JSON.stringify({ definition }) });
    if (response.ok) { setNotice("草稿已保存。已发布版本不会被改写。"); const impactResponse = await fetch("/api/ontology/draft/impact"); if (impactResponse.ok) setImpact(await impactResponse.json()); }
    else setNotice((await response.json()).detail ?? "保存失败：当前角色没有编辑权限。");
  }
  async function publishDraft() {
    await saveDraft();
    const response = await fetch("/api/ontology/publish", { method: "POST", headers: { "X-Demo-Role": role } });
    if (response.ok) { setNotice(`发布成功：${(await response.json()).semantic_version}，Agent 将使用该版本。`); await loadState(); }
    else setNotice((await response.json()).detail ?? "发布失败。");
  }
  async function rollback(version: Version) {
    const response = await fetch(`/api/ontology/versions/${version.id}/rollback`, { method: "POST", headers: { "X-Demo-Role": role } });
    if (response.ok) { assignDefinition((await response.json()).definition); setNotice(`${version.semantic_version} 已恢复为可编辑草稿。`); }
    else setNotice((await response.json()).detail ?? "回滚失败。");
  }
  function exportDefinition() {
    if (!definition) return;
    const blob = new Blob([JSON.stringify(definition, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "ontology-draft.json"; anchor.click(); URL.revokeObjectURL(url);
  }
  async function importDefinition(file: File) { try { assignDefinition(JSON.parse(await file.text()) as OntologyDefinition); setNotice("已导入 JSON 草稿，请审核并保存。 "); } catch { setNotice("导入失败：需要有效的本体 JSON 文件。"); } }

  const changedCount = impact ? Object.values(impact.affected).reduce((total, value) => total + value.added.length + value.removed.length + value.changed.length, 0) : 0;
  return <div className="stack-lg"><div className="section-heading"><div><p className="eyebrow">草稿与不可变发布历史</p><h2>工厂供应链本体</h2></div><div className="button-row compact"><input ref={importRef} className="visually-hidden" type="file" accept=".json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importDefinition(file); }} /><button className="secondary-button" onClick={() => importRef.current?.click()} disabled={!editable}><Upload size={15} />导入</button><button className="secondary-button" onClick={exportDefinition} disabled={!definition}><Download size={15} />导出</button><button className="secondary-button" onClick={() => void saveDraft()} disabled={!definition || !editable}>保存草稿</button><button className="primary-button" onClick={() => void publishDraft()} disabled={!definition || !editable}>发布版本</button></div></div><p className="inline-notice">{notice}</p><div className="ontology-layout"><div className="panel ontology-graph"><p className="eyebrow">对象与关系</p><h3>业务语义图</h3><div className="object-grid">{definition?.objects.map((object, index) => <div className="object-card" key={object.id}><span>O{index + 1}</span><strong>{object.label}</strong><small>{object.attributes?.length ?? 0} 个属性 · {object.key}</small></div>)}</div></div><aside className="panel candidate-panel"><p className="eyebrow">资源摘要</p><h3>当前草稿</h3><ul className="policy-list"><li><span>对象</span><b>{definition?.objects.length ?? 0}</b></li><li><span>Link</span><b>{definition?.links.length ?? 0}</b></li><li><span>指标 / 函数 / 规则</span><b>{`${definition?.metrics.length ?? 0} / ${definition?.functions.length ?? 0} / ${definition?.rules.length ?? 0}`}</b></li></ul><div className="button-row"><button className="secondary-button" onClick={() => void loadCandidate()} disabled={!editable}>生成候选</button></div></aside></div><div className="two-column ontology-editor-layout"><div className="panel"><div className="tabs"><button className="active">资源编辑器</button><button>对象</button><button>属性</button><button>Link</button><button>映射</button><button>指标</button><button>函数</button></div><p className="muted">通过 JSON 资源编辑器统一编辑所有本体资源；保存前可反复调整，发布后形成不可变快照。</p><textarea aria-label="本体资源编辑器" className="ontology-editor" value={editor} onChange={(event) => setEditor(event.target.value)} disabled={!editable} /><div className="button-row"><button className="secondary-button" onClick={applyEditor} disabled={!editable}>应用编辑</button></div></div><div className="stack-lg"><div className="panel"><p className="eyebrow">发布前影响检查</p><h3>{impact?.base_version ? `相对 ${impact.base_version} 的变更` : "首次发布"}</h3><p className="muted">{changedCount ? `${changedCount} 项资源变化将影响智能问数和治理中心。` : "草稿与已发布版本一致，或尚未形成基线。"}</p><div className="chip-list">{impact && Object.entries(impact.affected).flatMap(([kind, value]) => [...value.added.map((name) => `${kind}: +${name}`), ...value.changed.map((name) => `${kind}: ~${name}`), ...value.removed.map((name) => `${kind}: -${name}`)]).slice(0, 10).map((label) => <span className="chip" key={label}>{label}</span>)}</div></div><div className="panel"><p className="eyebrow">版本历史</p><h3>已发布快照</h3><div className="version-list">{versions.filter((version) => version.status !== "draft").map((version) => <div className="version-row" key={version.id}><div><strong>{version.semantic_version}</strong><small>{version.status} · {version.published_at ? new Date(version.published_at).toLocaleString("zh-CN", { hour12: false }) : "-"}</small></div><button className="secondary-button" onClick={() => void rollback(version)} disabled={!editable}><RotateCcw size={14} />回滚为草稿</button></div>)}{!versions.some((version) => version.status !== "draft") && <p className="muted">尚无已发布版本。</p>}</div></div></div></div></div>;
}
