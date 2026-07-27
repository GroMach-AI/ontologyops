import { useState } from "react";
import type { ReactNode } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";

export type DemoRole = "admin" | "modeler" | "operator";

export type OntologySummary = {
  id: string; name: string; version: string; status: "draft" | "published";
};

type AppShellProps = {
  children: ReactNode;
  role: DemoRole;
  onRoleChange: (role: DemoRole) => void;
  ontologies: OntologySummary[];
  onCreated?: () => void;
};

const navigation = [
  { to: "/", label: "首页", icon: "ph-house" },
  { to: "/data-pipeline", label: "数据与管道", icon: "ph-database" },
  { to: "/ontology", label: "本体管理", icon: "ph-share-network" },
  { to: "/apps/agent", label: "智能助手", icon: "ph-chats-circle" },
  { to: "/governance", label: "治理与可追溯", icon: "ph-shield-check" },
  { to: "/models", label: "模型管理", icon: "ph-cube" },
];

const roleLabels: Record<DemoRole, string> = {
  admin: "管理员",
  modeler: "本体建模者",
  operator: "业务运营者",
};

export function AppShell({ children, role, onRoleChange, ontologies, onCreated }: AppShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const section = navigation.find((item) => item.to === location.pathname || (item.to !== "/" && location.pathname.startsWith(item.to + "/")))?.label ?? "首页";
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeOntologyId, setActiveOntologyId] = useState<string | null>(null);
  const routeOntologyId = location.pathname.startsWith("/ontology/") ? location.pathname.split("/")[2] : null;
  const currentOntology = ontologies.find((o) => o.id === routeOntologyId)
    ?? ontologies.find((o) => o.id === activeOntologyId)
    ?? ontologies[0]
    ?? null;
  const switcherLabel = currentOntology
    ? `${currentOntology.name} · ${currentOntology.version}${currentOntology.status === "published" ? " 已发布" : " 草稿"}`
    : "创建或选择本体";
  const isOnOntologyPage = location.pathname === "/ontology";
  const goCreate = () => {
    setMenuOpen(false);
    if (!isOnOntologyPage) navigate("/ontology");
    onCreated?.();
  };

  return (
    <div className="oo-app">
      <header className="oo-topbar">
        <div className="oo-brand">
          <i className="ph ph-hexagon oo-brand-mark" aria-hidden="true" />
          <span>OntologyOps</span>
        </div>
        <div className="oo-switcher">
          <button
            className="oo-workspace-switcher" type="button"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
            style={!currentOntology ? { color: "oklch(0.58 0.04 155)" } : undefined}
          >
            <span>{switcherLabel}</span>
            <i className={"ph " + (currentOntology ? "ph-caret-down" : "ph-plus")} aria-hidden="true" />
          </button>
          {menuOpen ? (
            <div className="oo-ontology-menu" role="menu">
              <div className="oo-ontology-menu-head">{ontologies.length > 0 ? "切换本体" : "还没有本体"}</div>
              {ontologies.length > 0 ? (
                ontologies.map((o) => (
                  <button key={o.id} className="oo-ontology-menu-item" type="button"
                    onClick={() => { setActiveOntologyId(o.id); setMenuOpen(false); navigate(`/ontology/${o.id}`); }}>
                    <i className={"ph " + (o.id === currentOntology?.id ? "ph-check" : "ph-circles-three-plus")} aria-hidden="true" />
                    <span>{o.name}<small>{o.id === currentOntology?.id ? "当前" : ""} · {o.version}{o.status === "published" ? " 已发布" : " 草稿"}</small></span>
                  </button>
                ))
              ) : (
                <div style={{ padding: "8px 12px", fontSize: 12, color: "oklch(0.6 0.015 155)", lineHeight: 1.4 }}>
                  在本体管理页面点击"创建本体"开始第一个本体的建模。
                </div>
              )}
              <button className="oo-ontology-menu-item oo-ontology-menu-create" type="button" onClick={goCreate}>
                <i className="ph ph-plus" aria-hidden="true" />
                <span>创建本体</span>
              </button>
            </div>
          ) : null}
        </div>
        <div className="oo-top-status">
          <span className="oo-status-dot" />
          <span>本地运行</span>
        </div>
        <div className="oo-top-tools" aria-label="全局工具">
          <button className="oo-top-icon" type="button" aria-label="通知">
            <i className="ph ph-bell" aria-hidden="true" />
          </button>
          <button className="oo-top-icon" type="button" aria-label="帮助">
            <i className="ph ph-question" aria-hidden="true" />
          </button>
          <button className="oo-top-icon" type="button" aria-label="个人账户">
            <i className="ph ph-user-circle" aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="oo-shell">
        <aside className="oo-sidebar">
          <nav className="oo-nav" aria-label="主导航">
            {navigation.map(({ to, label, icon }) => (
              <NavLink
                className={({ isActive }) => "oo-nav-item" + (isActive ? " is-active" : "")}
                key={to}
                to={to}
                end={to === "/"}
              >
                <i className={"ph " + icon} aria-hidden="true" />
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="oo-sidebar-foot">
            <span>当前角色</span>
            <select
              aria-label="切换当前角色"
              value={role}
              onChange={(event) => onRoleChange(event.target.value as DemoRole)}
            >
              {(Object.keys(roleLabels) as DemoRole[]).map((value) => (
                <option key={value} value={value}>
                  {roleLabels[value]}
                </option>
              ))}
            </select>
          </div>
        </aside>
        <main>
          <div className="oo-page-heading">
            <div>
              <span className="oo-eyebrow">OntologyOps / {section}</span>
              <h1>{section}</h1>
            </div>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
