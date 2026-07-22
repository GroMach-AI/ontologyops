import type { ReactNode } from "react";
import {
  Bot,
  Boxes,
  DatabaseZap,
  GitBranch,
  Home,
  ShieldCheck,
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";

export type DemoRole = "admin" | "modeler" | "operator";

type AppShellProps = {
  children: ReactNode;
  role: DemoRole;
  onRoleChange: (role: DemoRole) => void;
};

const navigation = [
  { to: "/", label: "首页", icon: Home },
  { to: "/data-pipeline", label: "数据与管道", icon: DatabaseZap },
  { to: "/ontology", label: "本体管理", icon: GitBranch },
  { to: "/apps/agent", label: "智能问数", icon: Bot },
  { to: "/governance", label: "治理中心", icon: ShieldCheck },
  { to: "/models", label: "模型管理", icon: Boxes },
];

const roleLabels: Record<DemoRole, string> = {
  admin: "管理员",
  modeler: "本体建模者",
  operator: "业务运营者",
};

export function AppShell({ children, role, onRoleChange }: AppShellProps) {
  const location = useLocation();
  const section = navigation.find((item) => item.to === location.pathname)?.label ?? "首页";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <strong>OntologyOps</strong>
          <span>企业数据与智能问数</span>
        </div>
        <nav aria-label="主导航" className="nav-list">
          {navigation.map(({ to, label, icon: Icon }) => (
            <NavLink className="nav-link" key={to} to={to} end={to === "/"}>
              <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="role-box">
          <span className="eyebrow">当前角色</span>
          <select
            aria-label="切换当前角色"
            value={role}
            onChange={(event) => onRoleChange(event.target.value as DemoRole)}
          >
            {(Object.keys(roleLabels) as DemoRole[]).map((value) => (
              <option key={value} value={value}>{roleLabels[value]}</option>
            ))}
          </select>
          <small>本地 MVP · v0.3</small>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">OntologyOps / {section}</span>
            <h1>{section}</h1>
          </div>
          <div className="topbar-status"><span className="status-dot" />本地演示环境</div>
        </header>
        <section className="page-content">{children}</section>
      </main>
    </div>
  );
}
