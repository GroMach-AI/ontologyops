import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import type { DemoRole } from "../../components/AppShell";
import type { Ontology, OntologyEntity } from "./OntologyPage";

type DetailTab = "overview" | "entities" | "relationships" | "versions";

type OntologyDetailPageProps = {
  role: DemoRole;
  ontologies: Ontology[];
  onUpdate: (ontology: Ontology) => void;
};

const tabLabels: Array<{ id: DetailTab; label: string; icon: string }> = [
  { id: "overview", label: "概览", icon: "ph-squares-four" },
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

function EntityInspector({ entity }: { entity: OntologyEntity | null }) {
  if (!entity) {
    return (
      <aside className="oo-detail-inspector oo-detail-inspector-empty">
        <i className="ph ph-cursor-click" aria-hidden="true" />
        <strong>选择一个实体</strong>
        <span>点击画布中的实体卡片，查看属性与来源。</span>
      </aside>
    );
  }

  return (
    <aside className="oo-detail-inspector">
      <div className="oo-inspector-head">
        <span className="oo-detail-icon"><i className="ph ph-cube" aria-hidden="true" /></span>
        <div>
          <strong>{entity.label || entity.name}</strong>
          <code>{entity.name}</code>
        </div>
      </div>
      <p>{entity.description || "尚未补充业务定义。"}</p>
      <div className="oo-inspector-source">
        <span>数据来源</span>
        <strong>{entity.source_file || "待映射"}</strong>
      </div>
      <div className="oo-inspector-section-title">属性 · {entity.properties.length}</div>
      <div className="oo-property-list">
        {entity.properties.length > 0 ? entity.properties.map((property, index) => (
          <div className="oo-property-row" key={`${property.name}-${index}`}>
            <span className="oo-property-key">
              {property.is_key ? <i className="ph ph-key" title="主键" aria-label="主键" /> : <i className="ph ph-dot-outline" aria-hidden="true" />}
              <b>{property.name}</b>
            </span>
            <code>{property.type}</code>
            <small>{property.description || "—"}</small>
          </div>
        )) : (
          <div className="oo-detail-mini-empty">暂无属性</div>
        )}
      </div>
    </aside>
  );
}

export function OntologyDetailPage({ role, ontologies, onUpdate }: OntologyDetailPageProps) {
  const { id } = useParams();
  const navigate = useNavigate();
  const ontology = ontologies.find((item) => item.id === id);
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [selectedEntityName, setSelectedEntityName] = useState("");
  const [notice, setNotice] = useState("");
  const editable = role === "admin" || role === "modeler";

  const selectedEntity = useMemo(() => {
    if (!ontology) return null;
    return ontology.entities.find((entity) => entity.name === selectedEntityName) ?? ontology.entities[0] ?? null;
  }, [ontology, selectedEntityName]);

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

  function publishOntology() {
    if (!ontology) return;
    const published = { ...ontology, status: "published" as const, version: "1.0", updated: "刚刚" };
    onUpdate(published);
    setNotice("版本 1.0 已发布，本体现在可供应用层使用。");
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

      <button className="oo-detail-back" type="button" onClick={() => navigate("/ontology")}>
        <i className="ph ph-arrow-left" aria-hidden="true" />本体管理
      </button>

      <section className="oo-detail-hero">
        <div className="oo-detail-title-block">
          <span className="oo-detail-icon oo-detail-icon-large"><i className="ph ph-hexagon" aria-hidden="true" /></span>
          <div>
            <div className="oo-detail-title-line">
              <h2>{ontology.name}</h2>
              <span className={`oo-badge ${ontology.status === "published" ? "oo-badge-ok" : "oo-badge-draft"}`}>
                v{ontology.version} {ontology.status === "published" ? "已发布" : "草稿"}
              </span>
            </div>
            <p>{ontology.scope}</p>
            <div className="oo-detail-meta">
              <span><i className="ph ph-clock" aria-hidden="true" />{ontology.updated}更新</span>
              <span><i className="ph ph-database" aria-hidden="true" />本地工作区</span>
            </div>
          </div>
        </div>
        <div className="oo-detail-actions">
          <button className="oo-secondary-button" type="button" onClick={() => setNotice("当前已是最新草稿，可以继续检查实体和关系。") }>
            <i className="ph ph-pencil-simple" aria-hidden="true" />编辑草稿
          </button>
          {editable && ontology.status === "draft" ? (
            <button className="oo-primary-button" type="button" onClick={publishOntology}>
              <i className="ph ph-paper-plane-tilt" aria-hidden="true" />发布版本
            </button>
          ) : null}
        </div>
      </section>

      <nav className="oo-detail-tabs" aria-label="本体详情导航">
        {tabLabels.map((tab) => (
          <button className={activeTab === tab.id ? "is-active" : ""} key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}>
            <i className={`ph ${tab.icon}`} aria-hidden="true" />{tab.label}
            {tab.id === "entities" ? <span>{ontology.entities.length}</span> : null}
            {tab.id === "relationships" ? <span>{ontology.relationships.length}</span> : null}
          </button>
        ))}
      </nav>

      {activeTab === "overview" ? (
        <div className="oo-detail-content">
          <section className="oo-detail-metrics" aria-label="本体指标">
            <div><span className="oo-detail-metric-icon"><i className="ph ph-cube" /></span><p><strong>{ontology.objects}</strong><span>实体类型</span></p></div>
            <div><span className="oo-detail-metric-icon"><i className="ph ph-share-network" /></span><p><strong>{ontology.links}</strong><span>关系类型</span></p></div>
            <div><span className="oo-detail-metric-icon"><i className="ph ph-function" /></span><p><strong>{ontology.rules}</strong><span>规则与确认</span></p></div>
            <div><span className="oo-detail-metric-icon"><i className="ph ph-check-circle" /></span><p><strong>{ontology.status === "published" ? "可用" : "草稿"}</strong><span>当前状态</span></p></div>
          </section>

          <section className="oo-detail-model-section">
            <div className="oo-detail-section-head">
              <div><span>语义模型</span><h3>实体关系视图</h3></div>
              <small>点击实体查看属性</small>
            </div>
            <div className="oo-detail-model-layout">
              <div className="oo-detail-canvas">
                {ontology.entities.length > 0 ? (
                  <div className="oo-entity-map">
                    {ontology.entities.map((entity) => {
                      const isSelected = selectedEntity?.name === entity.name;
                      return (
                        <button className={`oo-entity-node${isSelected ? " is-selected" : ""}`} type="button" key={entity.name} onClick={() => setSelectedEntityName(entity.name)}>
                          <span className="oo-detail-icon"><i className="ph ph-cube" /></span>
                          <span><strong>{entity.label || entity.name}</strong><code>{entity.name}</code></span>
                          <small>{entity.properties.length} 个属性</small>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="oo-detail-canvas-empty"><i className="ph ph-cube" /><span>尚未定义实体</span></div>
                )}
                {ontology.relationships.length > 0 ? (
                  <div className="oo-relationship-ribbon">
                    <span>已连接关系</span>
                    {ontology.relationships.slice(0, 5).map((relationship, index) => (
                      <div key={`${relationship.name}-${index}`}>
                        <b>{relationship.from_entity}</b><i className="ph ph-arrow-right" /><b>{relationship.to_entity}</b><small>{cardinalityLabel(relationship.type)}</small>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              <EntityInspector entity={selectedEntity} />
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === "entities" ? (
        <section className="oo-detail-table-panel">
          <div className="oo-detail-section-head"><div><span>对象类型</span><h3>实体定义</h3></div><small>{ontology.entities.length} 个实体</small></div>
          {ontology.entities.length > 0 ? (
            <table className="oo-detail-table">
              <thead><tr><th>实体</th><th>英文标识</th><th>属性</th><th>主键</th><th>来源</th></tr></thead>
              <tbody>{ontology.entities.map((entity) => (
                <tr key={entity.name} onClick={() => { setSelectedEntityName(entity.name); setActiveTab("overview"); }}>
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
