import { Database, X } from "lucide-react";

import type { TrustedAnswer } from "./agentApi";

export function EvidenceDrawer({ answer, onClose }: { answer: TrustedAnswer; onClose: () => void }) {
  return <div className="oo-agent-drawer-backdrop" onMouseDown={onClose}>
    <aside aria-label="关联证据" aria-modal="true" className="oo-agent-drawer" onMouseDown={(event) => event.stopPropagation()} role="dialog">
      <header><div><span className="oo-eyebrow">可追溯证据</span><h2>本体查询记录</h2></div><button aria-label="关闭关联证据" className="oo-close-button" onClick={onClose}><X size={18} /></button></header>
      <section><span className="oo-agent-drawer-label">数据来源</span><div className="oo-agent-source-list">{answer.provenance.sources.length ? answer.provenance.sources.map((source) => <span key={source}>{source}</span>) : <span>本次实体尚未映射数据集</span>}</div></section>
      <section><span className="oo-agent-drawer-label">查询结果</span><ul className="oo-agent-evidence-list">{answer.evidence.length ? answer.evidence.map((item, index) => <EvidenceItem item={item} key={index} />) : <li>本次未执行数据实体查询。</li>}</ul></section>
      <section className="oo-agent-trace"><Database size={15} /><div><strong>{answer.provenance.ontology_version}</strong><span>{answer.provenance.metric_definition}</span></div></section>
    </aside>
  </div>;
}

function EvidenceItem({ item }: { item: Record<string, unknown> }) {
  if (item.kind === "entity_no_data") return <li><strong>{String(item.entity_label)}</strong><span>尚无已映射实体数据</span></li>;
  if (item.kind === "entity_count") return <li><strong>{String(item.entity_id)} · {String(item.count)} 条</strong><span>数据集 {String(item.dataset_id)} · 映射 {String(item.mapping_id)}</span></li>;
  const properties = item.properties && typeof item.properties === "object" ? Object.entries(item.properties as Record<string, unknown>).slice(0, 4).map(([key, value]) => `${key}: ${String(value)}`).join(" · ") : "";
  return <li><strong>{String(item.entity_key ?? item.entity_id)}</strong><span>{properties || "实体实例"}</span><small>数据集 {String(item.dataset_id)}</small></li>;
}
