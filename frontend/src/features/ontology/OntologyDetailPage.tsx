import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import type { DemoRole } from "../../components/AppShell";
import type { Ontology } from "./OntologyPage";
import { OntologyGraphView } from "./OntologyGraphView";

type DetailTab = "graph" | "entities" | "relationships" | "versions";

type OntologyDetailPageProps = {
  role: DemoRole;
  ontologies: Ontology[];
  onUpdate: (ontology: Ontology) => void;
};

type DraftValidation = {
  valid: boolean;
  blockers: Array<{ code: string; message: string }>;
};

const tabLabels: Array<{ id: DetailTab; label: string; icon: string }> = [
  { id: "graph", label: "关系图谱", icon: "ph-graph" },
  { id: "entities", label: "实体", icon: "ph-cube" },
  { id: "relationships", label: "关系", icon: "ph-share-network" },
  { id: "versions", label: "版本", icon: "ph-git-branch" },
];

function cardinalityLabel(type: string) {
  if (type === "one_to_many") return "一对多";
  if (type === "many_to_one") return "多对一";
  if (type === "many_to_many") return "多对多";
  if (type === "one_to_one") return "一对一";
  return type || "待确认";
}

export function OntologyDetailPage({ role, ontologies, onUpdate }: OntologyDetailPageProps) {
  const { id } = useParams();
  const navigate = useNavigate();
  const ontology = ontologies.find((item) => item.id === id);
  const [activeTab, setActiveTab] = useState<DetailTab>("graph");
  const [selectedEntityName, setSelectedEntityName] = useState("");
  const [notice, setNotice] = useState("");
  const [validation, setValidation] = useState<DraftValidation | null>(null);
  const [validationLoading, setValidationLoading] = useState(false);
  const editable = role === "admin" || role === "modeler";

  useEffect(() => {
    if (!ontology?.draftId || ontology.status !== "draft") return;
    let current = true;
    setValidationLoading(true);
    void fetch(`/api/ontology-drafts/${ontology.draftId}/validate`, { method: "POST" })
      .then(async (response) => {
        if (!response.ok) throw new Error("无法校验草稿");
        return response.json() as Promise<DraftValidation>;
      })
      .then((result) => { if (current) setValidation(result); })
      .catch(() => { if (current) setValidation({ valid: false, blockers: [{ code: "validation_unavailable", message: "无法完成发布校验。" }] }); })
      .finally(() => { if (current) setValidationLoading(false); });
    return () => { current = false; };
  }, [ontology?.draftId, ontology?.status]);

  if (!ontology) {
    return (
      <div className="oo-detail-not-found">
        <i className="ph ph-warning-circle" aria-hidden="true" />
        <h2>没有找到这个本体</h2>
        <p>本体可能尚未创建，或者当前页面已刷新导致本地草稿失效。</p>
        <button className="oo-primary-button" type="button" onClick={() => navigate("/ontology")}>
          <i className="ph ph-arrow-left" aria-hidden="true" />返回本体管理
        </button>
      </div>
    );
  }

  async function publishOntology() {
    if (!ontology?.draftId || !validation?.valid) return;
    try {
      const response = await fetch(`/api/ontology-drafts/${ontology.draftId}/publish`, {
        method: "POST",
      });
      if (!response.ok) throw new Error("发布失败");
      const result = await response.json() as { release_id: string; semantic_version: string };
      onUpdate({ ...ontology, status: "published", version: result.semantic_version.replace(/^v/, ""), releaseId: result.release_id, updated: "刚刚" });
      setNotice(`版本 ${result.semantic_version} 已发布，本体现在可供应用层使用。`);
    } catch {
      setNotice("发布失败，请先检查草稿校验结果。");
    }
  }

  return (
    <div className="oo-detail-page">
      {notice ? (
        <div className="oo-notice">
          <i className="ph ph-check-circle" aria-hidden="true" />
          <span>{notice}</span>
          <button className="oo-notice-close" type="button" aria-label="关闭提示" onClick={() => setNotice("")}><i className="ph ph-x" /></button>
        </div>
      ) : null}

      <header className="oo-detail-context">
        <button className="oo-detail-back" type="button" onClick={() => navigate("/ontology")}><i className="ph ph-arrow-left" aria-hidden="true" />本体管理</button>
        <span className="oo-detail-context-divider" aria-hidden="true" />
        <h1>{ontology.name}</h1>
        <span className={`oo-badge ${ontology.status === "published" ? "oo-badge-ok" : "oo-badge-draft"}`}>v{ontology.version} {ontology.status === "published" ? "已发布" : "草稿"}</span>
        {editable && ontology.status === "draft" ? (
          <button className="oo-primary-button oo-detail-publish" type="button" onClick={publishOntology} disabled={validationLoading || validation?.valid !== true}>
            <i className="ph ph-paper-plane-tilt" aria-hidden="true" />发布 v{ontology.version}
          </button>
        ) : null}
      </header>

      {ontology.status === "draft" && validation?.blockers.length ? (
        <div className="oo-notice" role="status">
          <i className="ph ph-warning-circle" aria-hidden="true" />
          <span>{validation.blockers.map((blocker) => blocker.message).join(" ")}</span>
        </div>
      ) : null}

      <section className="oo-detail-view-head">
        <nav className="oo-detail-tabs" aria-label="本体详情导航">
        {tabLabels.map((tab) => (
          <button className={activeTab === tab.id ? "is-active" : ""} key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}>
            <i className={`ph ${tab.icon}`} aria-hidden="true" />{tab.label}
            {tab.id === "entities" ? <span>{ontology.entities.length}</span> : null}
            {tab.id === "relationships" ? <span>{ontology.relationships.length}</span> : null}
          </button>
        ))}
        </nav>
      </section>

      {activeTab === "graph" ? (
        <OntologyGraphView
          ontologyId={ontology.id}
          entities={ontology.entities}
          relationships={ontology.relationships}
          initialSelected={selectedEntityName}
        />
      ) : null}

      {activeTab === "entities" ? (
        <section className="oo-detail-table-panel">
          <div className="oo-detail-section-head"><div><span>对象类型</span><h3>实体定义</h3></div><small>{ontology.entities.length} 个实体</small></div>
          {ontology.entities.length > 0 ? (
            <table className="oo-detail-table">
              <thead><tr><th>实体</th><th>英文标识</th><th>属性</th><th>主键</th><th>来源</th></tr></thead>
              <tbody>{ontology.entities.map((entity) => (
                <tr key={entity.name} onClick={() => { setSelectedEntityName(entity.name); setActiveTab("graph"); }}>
                  <td><i className="ph ph-cube" /> <strong>{entity.label || entity.name}</strong></td>
                  <td><code>{entity.name}</code></td>
                  <td>{entity.properties.length}</td>
                  <td>{entity.properties.find((property) => property.is_key)?.name ?? "—"}</td>
                  <td>{entity.source_file || "待映射"}</td>
                </tr>
              ))}</tbody>
            </table>
          ) : <div className="oo-detail-mini-empty">暂无实体定义</div>}
        </section>
      ) : null}

      {activeTab === "relationships" ? (
        <section className="oo-detail-table-panel">
          <div className="oo-detail-section-head"><div><span>链接类型</span><h3>关系定义</h3></div><small>{ontology.relationships.length} 个关系</small></div>
          {ontology.relationships.length > 0 ? (
            <table className="oo-detail-table">
              <thead><tr><th>关系</th><th>起点实体</th><th>终点实体</th><th>基数</th><th>业务定义</th></tr></thead>
              <tbody>{ontology.relationships.map((relationship, index) => (
                <tr key={`${relationship.name}-${index}`}>
                  <td><i className="ph ph-share-network" /> <strong>{relationship.name}</strong></td>
                  <td><code>{relationship.from_entity}</code></td>
                  <td><code>{relationship.to_entity}</code></td>
                  <td><span className="oo-relation-type">{cardinalityLabel(relationship.type)}</span></td>
                  <td>{relationship.description || "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          ) : <div className="oo-detail-mini-empty">暂无关系定义</div>}
        </section>
      ) : null}

      {activeTab === "versions" ? (
        <section className="oo-detail-table-panel">
          <div className="oo-detail-section-head"><div><span>变更历史</span><h3>版本记录</h3></div></div>
          <div className="oo-version-timeline">
            <div className="is-current"><span><i className="ph ph-git-commit" /></span><div><strong>v{ontology.version} · {ontology.status === "published" ? "已发布" : "当前草稿"}</strong><p>包含 {ontology.objects} 个实体、{ontology.links} 个关系和 {ontology.rules} 个规则确认。</p><small>{ontology.updated}</small></div></div>
            <div><span><i className="ph ph-sparkle" /></span><div><strong>本体初始化</strong><p>由数据 profiling 与大模型语义分析生成初始结构。</p><small>创建时</small></div></div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
