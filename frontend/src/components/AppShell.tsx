import { useState } from "react";
import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";

export type DemoRole = "admin" | "modeler" | "operator";

type AppShellProps = {
  children: ReactNode;
  role: DemoRole;
  onRoleChange: (role: DemoRole) => void;
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

export function AppShell({ children, role, onRoleChange }: AppShellProps) {
  const location = useLocation();
  const section = navigation.find((item) => item.to === location.pathname)?.label ?? "首页";
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="oo-app">
      <header className="oo-topbar">
        <div className="oo-brand">
          <i className="ph ph-hexagon oo-brand-mark" aria-hidden="true" />
          <span>OntologyOps</span>
        </div>
        <div className="oo-switcher">
          <button
            className="oo-workspace-switcher"
            type="button"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
          >
            <span>制造业本体 · v1.0</span>
            <i className="ph ph-caret-down" aria-hidden="true" />
          </button>
          {menuOpen ? (
            <div className="oo-ontology-menu" role="menu">
              <div className="oo-ontology-menu-head">切换本体</div>
              <button className="oo-ontology-menu-item" type="button" onClick={() => setMenuOpen(false)}>
                <i className="ph ph-check" aria-hidden="true" />
                <span>制造业本体<small>当前 · v1.0 已发布</small></span>
              </button>
              <button className="oo-ontology-menu-item" type="button" onClick={() => setMenuOpen(false)}>
                <i className="ph ph-circles-three-plus" aria-hidden="true" />
                <span>服务运营本体<small>v0.3 草稿</small></span>
              </button>
              <button
                className="oo-ontology-menu-item oo-ontology-menu-create"
                type="button"
                onClick={() => setMenuOpen(false)}
              >
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
        <div className="oo-top-version">单租户 MVP</div>
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
            <strong>{roleLabels[role]}</strong>
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
