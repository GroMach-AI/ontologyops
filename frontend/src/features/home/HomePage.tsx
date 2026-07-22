import { ArrowRight, Bot, Database, GitBranch, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

const shortcuts = [
  { to: "/data-pipeline", title: "接入数据", text: "导入文件、拖拽配置并运行管道", icon: Database },
  { to: "/ontology", title: "管理本体", text: "编辑对象、关系、映射与发布版本", icon: GitBranch },
  { to: "/apps/agent", title: "开始智能问数", text: "通过本体获得可信结论", icon: Bot },
  { to: "/governance", title: "查看治理", text: "质量、血缘与权限审计", icon: ShieldCheck },
];
type Overview = { published_ontology: { semantic_version: string; object_count: number; link_count: number } | null; latest_pipeline: { status: string; input_rows: number; output_rows: number } | null; quality_rule_count: number; agent_query_count: number; default_model: { model_name: string; provider: string; is_default: boolean } | null; recent_activity: Array<{ id: string; event_type: string; resource_type: string; created_at: string }> };

export function HomePage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [notice, setNotice] = useState("正在读取本地平台运行状态...");
  async function loadOverview() {
    try {
      const response = await fetch("/api/overview");
      if (response.ok) { setOverview(await response.json()); setNotice("以下内容来自平台元数据与审计日志。 "); }
      else setNotice("无法读取平台状态，请确认后端已启动。");
    } catch {
      setNotice("无法读取平台状态，请确认后端已启动。");
    }
  }
  useEffect(() => { void loadOverview(); }, []);
  return <div className="stack-lg"><div className="hero-row"><div><p className="eyebrow">本体驱动的数据与 AI 工作台</p><h2>把分散数据变成可验证的业务回答</h2><p className="muted">从数据接入、清洗、本体发布到智能问数，跑通可追溯的业务闭环。</p></div><div className="version-card"><span>已发布本体</span><strong>{overview?.published_ontology?.semantic_version ?? "未发布"}</strong><small>{overview?.published_ontology ? `${overview.published_ontology.object_count} 个对象 · ${overview.published_ontology.link_count} 条关系` : "请先创建并发布本体"}</small></div></div><p className="inline-notice">{notice}</p><div className="metric-grid"><Metric label="最近管道运行" value={overview?.latest_pipeline?.status ?? "暂无"} detail={overview?.latest_pipeline ? `输入 ${overview.latest_pipeline.input_rows} 行 · 输出 ${overview.latest_pipeline.output_rows} 行` : "等待手动运行"} tone={overview?.latest_pipeline?.status === "success" ? "success" : "neutral"} /><Metric label="数据质量规则" value={String(overview?.quality_rule_count ?? 0)} detail="在治理中心运行并查看样本" tone="warning" /><Metric label="Agent 查询" value={String(overview?.agent_query_count ?? 0)} detail="均记录工具调用与权限审计" tone="neutral" /><Metric label="默认模型" value={overview?.default_model?.model_name ?? "Mock"} detail={overview?.default_model?.provider ?? "Mock Provider"} tone="neutral" /></div><div className="section-heading"><div><p className="eyebrow">快捷入口</p><h3>继续工作</h3></div><button className="secondary-button" onClick={() => void loadOverview()}>刷新状态</button></div><div className="shortcut-grid">{shortcuts.map(({ to, title, text, icon: Icon }) => <Link className="shortcut-card" key={to} to={to}><Icon size={20} /><div><strong>{title}</strong><span>{text}</span></div><ArrowRight size={16} /></Link>)}</div><div className="panel activity-panel"><div className="section-heading"><div><p className="eyebrow">最近活动</p><h3>平台事件</h3></div></div><ul className="timeline">{overview?.recent_activity.length ? overview.recent_activity.map((event) => <li key={event.id}><b>{event.event_type}</b><span>{event.resource_type} · {new Date(event.created_at).toLocaleString("zh-CN", { hour12: false })}</span></li>) : <li><b>暂无事件</b><span>导入数据、发布本体或发起智能问数后将在这里显示。</span></li>}</ul></div></div>;
}

function Metric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: string }) { return <div className={`metric-card ${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>; }
