import { Bot, Database, FileSearch, Send, Sparkles } from "lucide-react";
import { useState } from "react";

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

  async function submit() {
    const question = message.trim();
    if (!question || loading) return;
    setLoading(true);
    setError(null);
    try {
      const answer = await sendAgentMessage(question, role);
      setTurns((items) => [...items, { question, answer }]);
      setMessage("");
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "发生未知错误");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div aria-label="智能助手工作台" className="oo-agent-page">
      <section className="oo-agent-main">
        <header className="oo-agent-hero">
          <div>
            <span className="oo-eyebrow">已发布本体 · 受控查询</span>
            <h2>对话</h2>
            <p>基于已映射到本体的实体数据回答；每个结论均可回溯到数据集、映射与运行记录。</p>
          </div>
          <span className="oo-agent-role">{role === "operator" ? "业务运营者" : role === "modeler" ? "本体建模者" : "管理员"}</span>
        </header>

        <div className="oo-agent-thread" aria-live="polite">
          {turns.length === 0 ? <EmptyConversation onChoose={setMessage} /> : turns.map((turn, index) => (
            <div className="oo-agent-turn" key={`${turn.question}-${index}`}>
              <article className="oo-chat-message oo-chat-user"><span>你</span><p>{turn.question}</p></article>
              <AnswerCard answer={turn.answer} onEvidence={() => setEvidenceAnswer(turn.answer)} />
            </div>
          ))}
          {loading ? <div className="oo-agent-thinking"><Sparkles size={15} /> 正在调用受控本体工具…</div> : null}
          {error ? <div className="oo-agent-error">{error}</div> : null}
        </div>

        <div className="oo-agent-composer">
          <textarea
            aria-label="智能助手输入"
            placeholder="例如：有多少销售订单？"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <button aria-label="发送问题" className="oo-primary-button oo-agent-send" disabled={loading || !message.trim()} onClick={() => void submit()}>
            <Send size={15} />发送
          </button>
        </div>
        <p className="oo-agent-hint">Enter 发送，Shift + Enter 换行。不会生成 SQL、写入数据或执行业务动作。</p>
      </section>

      <aside className="oo-agent-context" aria-label="查询范围说明">
        <div className="oo-agent-context-head"><Database size={17} /><div><span>当前查询范围</span><strong>已发布本体</strong></div></div>
        <p>仅检索已完成可信映射并填充到实体类型的数据。未填充的实体会明确返回“暂无数据”。</p>
        <div className="oo-agent-boundary"><FileSearch size={15} /><span>受控实体实例查询<br />数据集、映射与运行记录可追溯</span></div>
      </aside>
      {evidenceAnswer ? <EvidenceDrawer answer={evidenceAnswer} onClose={() => setEvidenceAnswer(null)} /> : null}
    </div>
  );
}

function EmptyConversation({ onChoose }: { onChoose: (question: string) => void }) {
  return <div className="oo-agent-empty">
    <div className="oo-agent-empty-mark"><Bot size={23} /></div>
    <strong>从已发布本体开始提问</strong>
    <p>助手只基于已映射的实体实例回答；还没有填充的数据不会被推测或编造。</p>
    <div className="oo-agent-starters">{STARTERS.map((question) => <button key={question} type="button" onClick={() => onChoose(question)}>{question}</button>)}</div>
  </div>;
}

function AnswerCard({ answer, onEvidence }: { answer: TrustedAnswer; onEvidence: () => void }) {
  const modelLabel = answer.model.mode === "real" ? `${answer.model.provider} · ${answer.model.model_name}` : "受控查询结果";
  return <article className="oo-chat-message oo-chat-agent">
    <div className="oo-chat-agent-head"><span><Bot size={15} />OntologyOps</span><small>{modelLabel}</small></div>
    <p>{answer.answer}</p>
    <div className="oo-agent-proof"><span>{answer.tool_calls.length} 个受控工具调用</span><span>{answer.provenance.ontology_version}</span><button type="button" onClick={onEvidence}>查看证据</button></div>
  </article>;
}
