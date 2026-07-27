import { useEffect, useState } from "react";

import type { DemoRole } from "../../components/AppShell";

type QualityRule = {
  id: string;
  name: string;
  dataset_name: string;
  rule_type: string;
  field: string;
  latest_run: { status: string; pass_rate: number; created_at: string; sample_rows?: Array<Record<string, unknown>> } | null;
};

type Audit = { id: string; created_at: string; actor: string; event_type: string; resource_type: string };
type Lineage = { nodes: Array<{ id: string; label: string }>; edges: Array<{ from: string; to: string }> };
type GovernanceView = "rules" | "lineage" | "trace";

export function GovernancePage({ role }: { role: DemoRole }) {
  const [rules, setRules] = useState<QualityRule[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [lineage, setLineage] = useState<Lineage | null>(null);
  const [notice, setNotice] = useState("正在加载治理资源...");
  const [activeView, setActiveView] = useState<GovernanceView>("rules");
  const canRun = role === "admin" || role === "modeler";

  async function loadGovernance() {
    const [rulesResponse, auditResponse, lineageResponse] = await Promise.all([
      fetch("/api/governance/quality/rules"),
      fetch("/api/governance/audit"),
      fetch("/api/governance/lineage/metric/supplier_on_time_delivery_rate"),
    ]);
    if (rulesResponse.ok) setRules(await rulesResponse.json());
    if (auditResponse.ok) setAudit(await auditResponse.json());
    if (lineageResponse.ok) setLineage(await lineageResponse.json());
    setNotice("展示规则结果、资源血缘与最近审计事件。");
  }

  useEffect(() => { void loadGovernance(); }, []);

  async function runRule(rule: QualityRule) {
    setNotice(`正在运行 ${rule.name}...`);
    const response = await fetch(`/api/governance/quality/rules/${rule.id}/run`, {
      method: "POST",
      headers: { "X-Demo-Role": role },
    });
    if (response.ok) {
      setNotice(`${rule.name} 已完成运行，结果已写入最近事件。`);
      await loadGovernance();
      return;
    }
    setNotice("质量规则运行失败，请确认 Demo 数据已初始化。");
  }

  return <div className="oo-governance-page">
    <header className="oo-governance-heading">
      <div><p className="oo-eyebrow">规则、血缘与审计</p><h2>治理与可追溯</h2><p>{notice}</p></div>
      <button className="secondary-button" type="button" onClick={() => void loadGovernance()}>刷新</button>
    </header>
    <div className="oo-governance-layout">
      <section className="oo-governance-main" aria-label="治理证据">
        <div className="oo-governance-tabs" role="tablist" aria-label="治理视图">
          <ViewTab active={activeView === "rules"} id="rules" label="规则结果" onSelect={setActiveView} />
          <ViewTab active={activeView === "lineage"} id="lineage" label="数据血缘" onSelect={setActiveView} />
          <ViewTab active={activeView === "trace"} id="trace" label="可追溯性" onSelect={setActiveView} />
        </div>
        {activeView === "rules" ? <RulesView rules={rules} canRun={canRun} onRun={runRule} /> : null}
        {activeView === "lineage" ? <LineageView lineage={lineage} /> : null}
        {activeView === "trace" ? <TraceView audit={audit} /> : null}
      </section>
      <AuditRail audit={audit} />
    </div>
  </div>;
}

function ViewTab({ active, id, label, onSelect }: { active: boolean; id: GovernanceView; label: string; onSelect: (view: GovernanceView) => void }) {
  return <button aria-selected={active} className={active ? "is-active" : ""} role="tab" type="button" onClick={() => onSelect(id)}>{label}</button>;
}

function RulesView({ rules, canRun, onRun }: { rules: QualityRule[]; canRun: boolean; onRun: (rule: QualityRule) => Promise<void> }) {
  return <section className="oo-governance-view" role="tabpanel" aria-label="规则结果">
    <div className="oo-governance-view-head"><div><h3>规则结果</h3><p>规则失败时，对应数据不会进入可信映射。</p></div></div>
    {rules.length === 0 ? <EmptyState text="暂无质量规则。数据管道运行后将在这里显示规则结果。" /> : <div className="oo-rule-list">
      {rules.map((rule) => <article className="oo-rule-row" key={rule.id}>
        <div><strong>{formatRuleLabel(rule)}</strong><span>{rule.dataset_name} · <code>{rule.field}</code></span></div>
        <StatusBadge status={rule.latest_run?.status ?? "未运行"} />
        <span className="oo-rule-exception">{rule.latest_run?.sample_rows?.length ? `${rule.latest_run.sample_rows.length} 条异常` : "—"}</span>
        <button aria-label={`运行${rule.name}`} className="secondary-button" disabled={!canRun} type="button" onClick={() => void onRun(rule)}>运行</button>
      </article>)}
    </div>}
  </section>;
}

function LineageView({ lineage }: { lineage: Lineage | null }) {
  return <section className="oo-governance-view" role="tabpanel" aria-label="数据血缘">
    <div className="oo-governance-view-head"><div><h3>数据血缘</h3><p>从来源数据到本体指标，再到智能助手可引用的资源链。</p></div></div>
    {lineage?.nodes.length ? <ol className="oo-lineage-chain">{lineage.nodes.map((node, index) => <li key={node.id}><span>{index + 1}</span><div><strong>{index === 0 ? "来源文件" : node.label}</strong><small>{node.label}</small></div></li>)}</ol> : <EmptyState text="尚无可展示的资源血缘。请先运行数据管道并完成本体映射。" />}
  </section>;
}

function TraceView({ audit }: { audit: Audit[] }) {
  return <section className="oo-governance-view" role="tabpanel" aria-label="可追溯性">
    <div className="oo-governance-view-head"><div><h3>可追溯性</h3><p>记录对资源的操作，让数据结论可以回看操作人、时间和资源类型。</p></div></div>
    {audit.length ? <ol className="oo-trace-list">{audit.slice(0, 6).map((event) => <li key={event.id}><strong>{formatEvent(event.event_type)}</strong><span>{event.actor} · {event.resource_type} · {formatTime(event.created_at)}</span></li>)}</ol> : <EmptyState text="暂无可追溯事件。运行管道、发布本体或进行智能问数后会在这里记录。" />}
  </section>;
}

function AuditRail({ audit }: { audit: Audit[] }) {
  return <aside className="oo-audit-rail" aria-label="最近事件"><div><h3>最近事件</h3><p>影响数据、本体和智能助手回答的操作记录。</p></div>{audit.length ? <ol>{audit.slice(0, 6).map((event) => <li key={event.id}><strong>{formatEvent(event.event_type)}</strong><span>{event.resource_type} · {formatTime(event.created_at)}</span></li>)}</ol> : <EmptyState text="暂无审计事件。" />}</aside>;
}

function StatusBadge({ status }: { status: string }) {
  const normalized = status === "passed" ? "通过" : status === "failed" ? "需处理" : status;
  return <span className={`oo-governance-status is-${status === "passed" ? "success" : status === "failed" ? "warning" : "neutral"}`}>{normalized}</span>;
}

function EmptyState({ text }: { text: string }) { return <p className="oo-governance-empty">{text}</p>; }

function formatRuleLabel(rule: QualityRule) {
  const ruleTypes: Record<string, string> = { unique: "唯一性检查", not_null: "完整性检查", non_negative: "非负值检查", timely: "及时性检查", cross_field_equal: "一致性检查" };
  return `${rule.field} · ${ruleTypes[rule.rule_type] ?? rule.name}`;
}

function formatEvent(value: string) { return value.replaceAll("_", " "); }
function formatTime(value: string) { return new Date(value).toLocaleString("zh-CN", { hour12: false }); }
