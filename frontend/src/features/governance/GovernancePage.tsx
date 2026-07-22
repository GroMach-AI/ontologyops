import { useEffect, useState } from "react";

import type { DemoRole } from "../../components/AppShell";

type QualityRule = { id: string; name: string; dataset_name: string; rule_type: string; field: string; latest_run: { status: string; pass_rate: number; created_at: string; sample_rows?: Array<Record<string, unknown>> } | null };
type Audit = { id: string; created_at: string; actor: string; event_type: string; resource_type: string };
type Lineage = { nodes: Array<{ id: string; label: string }>; edges: Array<{ from: string; to: string }> };

export function GovernancePage({ role }: { role: DemoRole }) {
  const [rules, setRules] = useState<QualityRule[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [policy, setPolicy] = useState<{ hidden_fields: string[] }>({ hidden_fields: [] });
  const [lineage, setLineage] = useState<Lineage | null>(null);
  const [notice, setNotice] = useState("正在加载治理资源...");
  const [showCreate, setShowCreate] = useState(false);
  const [newRule, setNewRule] = useState({ name: "", dataset_name: "purchase_orders", rule_type: "not_null", field: "" });
  const canEdit = role === "admin" || role === "modeler";

  async function loadGovernance() {
    const [rulesResponse, auditResponse, policyResponse, lineageResponse] = await Promise.all([
      fetch("/api/governance/quality/rules"), fetch("/api/governance/audit"), fetch(`/api/governance/permissions/preview?role=${role}`), fetch("/api/governance/lineage/metric/supplier_on_time_delivery_rate"),
    ]);
    if (rulesResponse.ok) setRules(await rulesResponse.json());
    if (auditResponse.ok) setAudit(await auditResponse.json());
    if (policyResponse.ok) setPolicy(await policyResponse.json());
    if (lineageResponse.ok) setLineage(await lineageResponse.json());
    setNotice("质量、血缘、权限和审计均从本地服务实时读取。");
  }
  useEffect(() => { void loadGovernance(); }, [role]);

  async function runRule(rule: QualityRule) {
    setNotice(`正在运行 ${rule.name}...`);
    const response = await fetch(`/api/governance/quality/rules/${rule.id}/run`, { method: "POST", headers: { "X-Demo-Role": role } });
    if (response.ok) { setNotice(`${rule.name} 已完成运行并写入审计。`); await loadGovernance(); }
    else setNotice("质量规则运行失败，请确认 Demo 数据已初始化。");
  }

  async function createRule() {
    const response = await fetch("/api/governance/quality/rules", { method: "POST", headers: { "Content-Type": "application/json", "X-Demo-Role": role }, body: JSON.stringify(newRule) });
    if (response.ok) { setNotice("质量规则已创建。可立即运行并查看异常样本。"); setShowCreate(false); setNewRule({ name: "", dataset_name: "purchase_orders", rule_type: "not_null", field: "" }); await loadGovernance(); }
    else setNotice((await response.json()).detail ?? "创建规则失败。");
  }

  return <div className="stack-lg"><div className="section-heading"><div><p className="eyebrow">质量、血缘、权限与审计</p><h2>治理中心</h2></div><div className="button-row compact"><button className="secondary-button" onClick={() => void loadGovernance()}>刷新数据</button><button className="primary-button" disabled={!canEdit} onClick={() => setShowCreate((value) => !value)}>新建质量规则</button></div></div><p className="inline-notice">{notice}</p>{showCreate && <div className="panel"><p className="eyebrow">质量规则配置</p><h3>新建规则</h3><div className="form-grid"><Field label="规则名称" value={newRule.name} onChange={(name) => setNewRule({ ...newRule, name })} /><Field label="数据集" value={newRule.dataset_name} onChange={(dataset_name) => setNewRule({ ...newRule, dataset_name })} /><label className="form-field"><span>规则类型</span><select value={newRule.rule_type} onChange={(event) => setNewRule({ ...newRule, rule_type: event.target.value })}><option value="not_null">完整性</option><option value="unique">唯一性</option><option value="non_negative">值域</option><option value="timely">及时性</option><option value="cross_field_equal">跨字段一致性</option></select></label><Field label="目标字段" value={newRule.field} onChange={(field) => setNewRule({ ...newRule, field })} /></div><div className="button-row"><button className="primary-button" onClick={() => void createRule()}>保存规则</button></div></div>}<div className="metric-grid">{rules.slice(0, 3).map((rule) => <Metric key={rule.id} title={rule.name} value={rule.latest_run ? `${Math.round(rule.latest_run.pass_rate * 100)}%` : "未运行"} detail={`${rule.dataset_name}.${rule.field}`} />)}</div><div className="two-column"><div className="panel"><p className="eyebrow">端到端血缘</p><h3>供应商准时交付率</h3><div className="lineage">{lineage?.nodes.map((node, index) => <span key={node.id}>{index ? <i>→</i> : null}{node.label}</span>) ?? <span>正在加载血缘...</span>}</div></div><div className="panel"><p className="eyebrow">权限预览</p><h3>{role === "operator" ? "业务运营者" : role === "admin" ? "管理员" : "本体建模者"}</h3><ul className="policy-list"><li><span>供应商名称</span><b className="visible">可见</b></li><li><span>供应商风险等级</span><b className="visible">可见</b></li><li><span>合同单价</span><b className={policy.hidden_fields.includes("contract_unit_price") ? "hidden" : "visible"}>{policy.hidden_fields.includes("contract_unit_price") ? "隐藏" : "可见"}</b></li></ul></div></div><div className="panel"><p className="eyebrow">质量规则</p><h3>规则运行与结果</h3><table><thead><tr><th>规则</th><th>数据集</th><th>最近状态</th><th>异常样本</th><th>操作</th></tr></thead><tbody>{rules.map((rule) => <tr key={rule.id}><td>{rule.name}</td><td className="mono">{rule.dataset_name}.{rule.field}</td><td><span className={rule.latest_run?.status === "passed" ? "badge success" : "badge neutral"}>{rule.latest_run?.status ?? "未运行"}</span></td><td>{rule.latest_run?.sample_rows?.length ? `${rule.latest_run.sample_rows.length} 条` : "-"}</td><td><button className="secondary-button" disabled={!canEdit} onClick={() => void runRule(rule)}>运行</button></td></tr>)}</tbody></table></div><div className="panel"><p className="eyebrow">审计流水</p><h3>最近事件</h3><table><thead><tr><th>时间</th><th>操作人</th><th>事件</th><th>资源</th></tr></thead><tbody>{audit.length ? audit.slice(0, 12).map((event) => <tr key={event.id}><td>{new Date(event.created_at).toLocaleString("zh-CN", { hour12: false })}</td><td>{event.actor}</td><td>{event.event_type}</td><td>{event.resource_type}</td></tr>) : <tr><td colSpan={4}>暂无审计事件</td></tr>}</tbody></table></div></div>;
}

function Metric({ title, value, detail }: { title: string; value: string; detail: string }) { return <div className="metric-card neutral"><span>{title}</span><strong>{value}</strong><small>{detail}</small></div>; }
function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="form-field"><span>{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} /></label>; }
