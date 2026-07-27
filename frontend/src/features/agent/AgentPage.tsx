import { Bot, Send, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { DemoRole } from "../../components/AppShell";
import { EvidenceDrawer } from "./EvidenceDrawer";
import { sendAgentMessage, type TrustedAnswer } from "./agentApi";

type ConversationTurn = { question: string; answer: TrustedAnswer };

const STARTERS = ["有多少销售订单？", "有哪些供应商？", "目前有哪些产品？"];

export function AgentPage({ role }: { role: DemoRole }) {
  const [message, setMessage] = useState("");
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [evidenceAnswer, setEvidenceAnswer] = useState<TrustedAnswer | null>(null);
  const [contextEntityId, setContextEntityId] = useState<string | undefined>();
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;
    if (typeof thread.scrollTo === "function") thread.scrollTo({ top: thread.scrollHeight, behavior: "smooth" });
    else thread.scrollTop = thread.scrollHeight;
  }, [turns, loading]);

  async function submit() {
    const question = message.trim();
    if (!question || loading) return;
    setLoading(true);
    setError(null);
    try {
      const answer = await sendAgentMessage(question, role, contextEntityId);
      setTurns((items) => [...items, { question, answer }]);
      const entityId = answer.tool_calls.find((call) => "entity_id" in call)?.entity_id;
      if (answer.route === "ontology" && entityId) setContextEntityId(entityId);
      setMessage("");
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "发生未知错误");
    } finally {
      setLoading(false);
    }
  }

  return <div aria-label="智能助手工作台" className="oo-agent-page"><section className="oo-agent-main">
    <div aria-live="polite" className={`oo-agent-thread${turns.length === 0 ? " is-empty" : ""}`} ref={threadRef}>
      {turns.length === 0 ? <EmptyConversation onChoose={setMessage} /> : turns.map((turn, index) => <div className="oo-agent-turn" key={`${turn.question}-${index}`}>
        <article className="oo-chat-message oo-chat-user"><span>你</span><p>{turn.question}</p></article>
        <AnswerCard answer={turn.answer} onEvidence={() => setEvidenceAnswer(turn.answer)} />
      </div>)}
      {loading ? <div className="oo-agent-thinking"><Sparkles size={15} /> 正在分析…</div> : null}
      {error ? <div className="oo-agent-error">{error}</div> : null}
    </div>
    <div className="oo-agent-composer"><textarea aria-label="智能助手输入" placeholder="例如：有多少销售订单？" value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); } }} />
      <button aria-label="发送问题" className="oo-primary-button oo-agent-send" disabled={loading || !message.trim()} onClick={() => void submit()}><Send size={15} />发送</button>
    </div>
    <p className="oo-agent-hint">Enter 发送，Shift + Enter 换行</p>
  </section>{evidenceAnswer ? <EvidenceDrawer answer={evidenceAnswer} onClose={() => setEvidenceAnswer(null)} /> : null}</div>;
}

function EmptyConversation({ onChoose }: { onChoose: (question: string) => void }) {
  return <div className="oo-agent-empty"><div className="oo-agent-empty-mark"><Bot size={23} /></div><strong>开始对话</strong><p>企业数据问题基于本体查询，其他问题由大模型回答。</p><div className="oo-agent-starters">{STARTERS.map((question) => <button key={question} type="button" onClick={() => onChoose(question)}>{question}</button>)}</div></div>;
}

function AnswerCard({ answer, onEvidence }: { answer: TrustedAnswer; onEvidence: () => void }) {
  const isOntologyAnswer = answer.route === "ontology";
  const modelLabel = isOntologyAnswer ? "本体查询结果" : answer.model.mode === "real" ? `${answer.model.provider} · 通用回答` : "通用回答";
  return <article className="oo-chat-message oo-chat-agent"><div className="oo-chat-agent-head"><span><Bot size={15} />OntologyOps</span><small>{modelLabel}</small></div><p>{answer.answer}</p><div className="oo-agent-proof">{isOntologyAnswer ? <><span>{answer.tool_calls.length} 个受控工具调用</span><span>{answer.provenance.ontology_version}</span><button type="button" onClick={onEvidence}>查看证据</button></> : <span>不读取企业本体数据</span>}</div></article>;
}
