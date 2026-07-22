import { Bot, ChevronRight, Database, Send, Sparkles } from "lucide-react";
import { useState } from "react";

import type { DemoRole } from "../../components/AppShell";
import { EvidenceDrawer } from "./EvidenceDrawer";
import { sendAgentMessage, type TrustedAnswer } from "./agentApi";

const DEFAULT_QUESTION = "本月哪些供应商的订单最容易延期，且影响关键物料库存？";

export function AgentPage({ role }: { role: DemoRole }) {
  const [message, setMessage] = useState(DEFAULT_QUESTION);
  const [answer, setAnswer] = useState<TrustedAnswer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      setAnswer(await sendAgentMessage(message, role));
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "发生未知错误");
    } finally {
      setLoading(false);
    }
  }

  return <div aria-label="智能问数工作台" className="agent-layout"><section className="agent-main"><div className="section-heading"><div><p className="eyebrow">基于已发布本体 {answer?.provenance.ontology_version ?? ""}</p><h2>智能问数 Agent</h2><p className="muted">只调用已授权的对象、关系、指标与规则，并返回可验证的证据。</p></div><span className="badge neutral">当前角色：{role === "operator" ? "业务运营者" : role === "modeler" ? "本体建模者" : "管理员"}</span></div><div className="conversation"><div className="message user-message"><span>你</span><p>{message}</p></div>{answer ? <AnswerCard answer={answer} onEvidence={() => setEvidenceOpen(true)} /> : <div className="empty-agent"><Sparkles size={22} /><strong>准备就绪</strong><span>发送预置问题，查看基于工厂供应链本体的可信回答。</span></div>}{error && <div className="error-message">{error}</div>}</div><div className="composer"><textarea aria-label="智能问数输入" value={message} onChange={(event) => setMessage(event.target.value)} /><button aria-label="发送" className="primary-button send-button" disabled={loading || !message.trim()} onClick={submit}>{loading ? "分析中" : <><Send size={15} />发送</>}</button></div></section><aside className="agent-side panel"><p className="eyebrow">本体能力边界</p><h3>当前可调用</h3><ul className="tool-list"><li><Database size={16} />对象筛选与属性过滤</li><li><ChevronRight size={16} />对象关系追溯</li><li><Bot size={16} />指标与风险规则计算</li></ul><div className="side-note"><strong>受控模式</strong><span>不会访问未授权字段，也不会生成自由 SQL 或执行写回。</span></div></aside>{answer && evidenceOpen && <EvidenceDrawer answer={answer} onClose={() => setEvidenceOpen(false)} />}</div>;
}

function AnswerCard({ answer, onEvidence }: { answer: TrustedAnswer; onEvidence: () => void }) {
  const isRiskAnswer = answer.evidence.some((item) => item.kind === "critical_supply_risk");
  return <article className="message agent-message"><span><Bot size={15} />OntologyOps Agent</span><p>{answer.answer}</p>{isRiskAnswer && <div className="recommendation"><strong>人工处置建议</strong><span>优先核实延期订单的交期，并准备关键物料的替代供货方案。</span></div>}<div className="provenance-grid"><div><span>数据来源</span><b>{answer.provenance.sources.join(" · ")}</b></div><div><span>更新时间</span><b>{new Date(answer.provenance.updated_at).toLocaleString("zh-CN", { hour12: false })}</b></div><div><span>指标口径</span><b>{answer.provenance.metric_definition}</b></div><div><span>本体版本</span><b>{answer.provenance.ontology_version}</b></div></div><div className="answer-footer"><span>{answer.tool_calls.length} 个本体工具调用已记录</span><button className="secondary-button" onClick={onEvidence}>查看关联证据</button></div></article>;
}
