import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { DemoRole } from "../../components/AppShell";

export type OntologyProperty = {
  name: string; type: string; is_key: boolean; description: string;
};

export type OntologyEntity = {
  name: string; label: string; description: string; source_file: string;
  properties: OntologyProperty[];
};

export type OntologyRelationship = {
  name: string; from_entity: string; to_entity: string; type: string;
  description: string; based_on: string;
};

export type Ontology = {
  id: string; name: string; scope: string;
  status: "draft" | "published"; version: string;
  objects: number; links: number; rules: number; updated: string;
  entities: OntologyEntity[];
  relationships: OntologyRelationship[];
};

type ColumnProfile = {
  name: string; inferred_type: string; total_rows: number;
  unique_count: number; null_percent: number; sample_values: string[];
};
type FileProfile = {
  source: string; type: string; total_rows?: number;
  columns?: ColumnProfile[]; note?: string;
};
type DetectedLink = {
  type: string; confidence: string; source_file: string;
  source_column: string; target_file: string; target_column: string; message: string;
};
type QAQuestion = { id: string; category: string; question: string; suggested: string[] };
type ProfilingResult = {
  profiling: { files_parsed: number; columns_total: number; details: FileProfile[] };
  links_detected: DetectedLink[];
  qa_questions: QAQuestion[];
};

type LLMAnalysis = {
  entities: OntologyEntity[];
  relationships: OntologyRelationship[];
  questions: QAQuestion[];
  summary: string;
};

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeLLMAnalysis(value: unknown, fallback?: LLMAnalysis): LLMAnalysis {
  const root = asRecord(value);
  const rawEntities = Array.isArray(root.entities) ? root.entities : [];
  const rawRelationships = Array.isArray(root.relationships) ? root.relationships : [];
  const rawQuestions = Array.isArray(root.questions) ? root.questions : [];

  const entities = rawEntities.map((item, entityIndex) => {
    const entity = asRecord(item);
    const rawProperties = Array.isArray(entity.properties) ? entity.properties : [];
    return {
      name: asString(entity.name, `Entity${entityIndex + 1}`),
      label: asString(entity.label, asString(entity.name, `实体 ${entityIndex + 1}`)),
      description: asString(entity.description),
      source_file: asString(entity.source_file),
      properties: rawProperties.map((item, propertyIndex) => {
        const property = asRecord(item);
        return {
          name: asString(property.name, `property_${propertyIndex + 1}`),
          type: asString(property.type, "string"),
          is_key: property.is_key === true,
          description: asString(property.description),
        };
      }),
    };
  });

  const relationships = rawRelationships.map((item, relationshipIndex) => {
    const relationship = asRecord(item);
    const rawType = asString(relationship.type, "many_to_one");
    const validType = ["one_to_one", "one_to_many", "many_to_one", "many_to_many"].includes(rawType)
      ? rawType : "many_to_one";
    return {
      name: asString(relationship.name, `关系 ${relationshipIndex + 1}`),
      from_entity: asString(relationship.from_entity),
      to_entity: asString(relationship.to_entity),
      type: validType,
      description: asString(relationship.description),
      based_on: asString(relationship.based_on),
    };
  });

  const questions = rawQuestions.map((item, questionIndex) => {
    const question = asRecord(item);
    return {
      id: asString(question.id, `llm-q-${questionIndex + 1}`),
      category: asString(question.category, "confirm"),
      question: asString(question.question, `请确认候选项 ${questionIndex + 1}`),
      suggested: Array.isArray(question.suggested)
        ? question.suggested.filter((option): option is string => typeof option === "string")
        : [],
    };
  });

  return {
    entities: entities.length > 0 ? entities : fallback?.entities ?? [],
    relationships: relationships.length > 0 ? relationships : fallback?.relationships ?? [],
    questions,
    summary: asString(root.summary, fallback?.summary ?? ""),
  };
}

export function OntologyPage({ role, ontologies, onCreated }: { role: DemoRole; ontologies: Ontology[]; onCreated?: (onto: Ontology) => void }) {
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [createStep, setCreateStep] = useState<"form" | "llm" | "review">("form");
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");
  const editable = role === "admin" || role === "modeler";

  const [formName, setFormName] = useState("");
  const [formScope, setFormScope] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [profiling, setProfiling] = useState<ProfilingResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [llm, setLlm] = useState<LLMAnalysis | null>(null);
  const [qIndex, setQIndex] = useState(0);
  const [qAnswers, setQAnswers] = useState<Record<string, string>>({});
  const [customDraft, setCustomDraft] = useState("");
  const [refining, setRefining] = useState(false);
  const [editing, setEditing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const llmRawText = useRef("");

  function openCreate() {
    setFormName(""); setFormScope(""); setFiles([]);
    setProfiling(null); setLlm(null); setQAnswers({}); setQIndex(0);
    setCreateStep("form"); setShowCreate(true);
  }
  function closeCreate() {
    setShowCreate(false);
    // reset dialog state so a fresh open starts clean
    setCreateStep("form");
    setFormName("");
    setFormScope("");
    setFiles([]);
    setProfiling(null);
    setLlm(null);
    setQIndex(0);
    setQAnswers({});
    setCustomDraft("");
    setEditing(false);
    setRefining(false);
  }

  async function runProfiling() {
    const name = formName.trim();
    const scope = formScope.trim();
    if (!name || !scope) {
      setNotice("请先填写本体名称与企业建模目标。");
      return;
    }
    if (files.length === 0) {
      setNotice("请先上传至少一个业务资料（CSV / Excel / PDF / Word）。");
      return;
    }
    setCreating(true);
    const form = new FormData();
    form.append("name", name);
    form.append("scope", scope);
    for (const f of files) form.append("files", f);
    try {
      const res = await fetch("/api/ontology-drafts/upload", { method: "POST", body: form });
      if (!res.ok) throw new Error((await res.json()).detail ?? "分析失败");
      const data = await res.json() as ProfilingResult;
      setProfiling(data);
      setCreateStep("llm");
    } catch (e) {
      setNotice("数据解析失败：" + (e instanceof Error ? e.message : "请检查文件格式。"));
      setCreateStep("form");  // make sure dialog form remains reachable
    } finally {
      setCreating(false);
    }
  }

  async function runLLMAnalysis() {
    if (!profiling) return;
    setAnalyzing(true);
    try {
      const res = await fetch("/api/ontology-drafts/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft: { name: formName, scope: formScope },
          profiling: profiling.profiling,
          links_detected: profiling.links_detected,
        }),
      });
      const data = await res.json();
      const text: string = data.analysis ?? "";
      llmRawText.current = text;
      let parsed: LLMAnalysis | null = null;
      try {
        const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").replace(/,(\s*[}\]])/g, "$1").trim();
        const jsonStart = cleaned.indexOf("{");
        const jsonEnd = cleaned.lastIndexOf("}");
        if (jsonStart >= 0 && jsonEnd > jsonStart) {
          parsed = JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1)) as LLMAnalysis;
        }
      } catch {}
      if (parsed) {
        parsed = normalizeLLMAnalysis(parsed);
        if (parsed.questions.length === 0 && parsed.relationships.length > 0) {
          parsed.questions = parsed.relationships.slice(0, 3).map((r, i) => ({
            id: `auto-q-${i}`,
            category: "relationship",
            question: `检测到潜在关系：「${r.name}」（${r.from_entity} → ${r.to_entity}）。是否确认？`,
            suggested: ["确认", "调整", "跳过"],
          }));
        }
        if (parsed.questions.length === 0) {
          parsed.questions = [
            {
              id: "auto-q-fallback",
              category: "confirm",
              question: "基于以上分析，是否确认将生成的对象和关系加入草稿？",
              suggested: ["确认全部", "稍后审核"],
            },
          ];
        }
        setLlm(parsed);
      } else {
        setLlm({
          entities: [],
          relationships: [],
          questions: [
            {
              id: "parse-fail",
              category: "error",
              question: "LLM 返回无法解析为结构化 JSON，请查看下方原始输出。是否继续？",
              suggested: ["继续", "重试"],
            },
          ],
          summary: text,
        });
      }
      setQIndex(0);
      setQAnswers({});
      setCreateStep("llm");
    } catch (e) {
      setNotice("LLM 分析请求失败：" + (e instanceof Error ? e.message : "请检查 API Key 配置。"));
      setCreateStep("form");  // let the user re-upload or retry instead of stuck dialog
    } finally {
      setAnalyzing(false);
    }
  }

  function answerQuestion(qid: string, answer: string) {
    if (qid === "parse-fail") {
      if (answer === "重试") runLLMAnalysis();
      else { setCreateStep("review"); }
      return;
    }
    setQAnswers((prev) => ({ ...prev, [qid]: answer }));
  }
  async function nextQuestion() {
    if (!llm) return;

    const currentQuestion = llm.questions[qIndex];
    if (!currentQuestion) {
      setCreateStep("review");
      return;
    }

    const updatedAnswers = { ...qAnswers };
    if (updatedAnswers[currentQuestion.id] === "") {
      updatedAnswers[currentQuestion.id] = customDraft.trim() || "(未填写)";
      setQAnswers(updatedAnswers);
      setCustomDraft("");
    }

    if (qIndex < llm.questions.length - 1) {
      setQIndex((index) => index + 1);
      return;
    }

    setRefining(true);
    try {
      const res = await fetch("/api/ontology-drafts/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          analysis: llmRawText.current || JSON.stringify(llm),
          answers: updatedAnswers,
          draft: { name: formName, scope: formScope },
        }),
      });
      if (!res.ok) throw new Error("候选优化请求失败");

      const data = await res.json();
      const text = typeof data.analysis === "string" ? data.analysis : "";
      const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").replace(/,(\s*[}\]])/g, "$1").trim();
      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");
      if (start < 0 || end <= start) throw new Error("候选优化结果不是有效 JSON");

      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      setLlm({ ...normalizeLLMAnalysis(parsed, llm), questions: [] });
      llmRawText.current = text;
    } catch (error) {
      setLlm({ ...normalizeLLMAnalysis(llm), questions: [] });
      setNotice(`候选优化未完成，已保留初始推荐：${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setRefining(false);
      setCreateStep("review");
    }
  }
  function prevQuestion() {
    if (qIndex > 0) setQIndex(qIndex - 1);
  }

  async function onCreateSubmit() {
    const name = formName.trim();
    const scope = formScope.trim();
    if (!name || !scope) return;
    const id = "onto-" + Date.now();
    const entities = llm?.entities ?? [];
    const relationships = llm?.relationships ?? [];
    const onto: Ontology = {
      id, name, scope, status: "draft", version: "0.1",
      objects: entities.length || profiling?.profiling.columns_total || 0,
      links: relationships.length || profiling?.links_detected.length || 0,
      rules: Object.keys(qAnswers).length,
      updated: "刚刚",
      entities,
      relationships,
    };
    try {
      await fetch("/api/ontology-drafts/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(onto),
      });
    } catch { /* persistence failure is non-blocking */ }
    onCreated?.(onto);
    closeCreate();
    navigate(`/ontology/${id}`);
  }

  function addFiles(newFiles: FileList | null) {
    if (!newFiles) return;
    setFiles((f) => [...f, ...Array.from(newFiles)]);
    if (fileInput.current) fileInput.current.value = "";
  }
  function removeFile(index: number) { setFiles((f) => f.filter((_, i) => i !== index)); }
  function formatSize(bytes: number) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1048576).toFixed(1) + " MB";
  }

  return (
    <div>
      {notice ? (
        <div className="oo-notice">{notice}
          <button className="oo-notice-close" onClick={() => setNotice("")}><i className="ph ph-x"></i></button>
        </div>
      ) : null}

      {ontologies.length === 0 ? (
        <div className="oo-empty">
          <i className="ph ph-stack oo-empty-icon" />
          <h2 className="oo-empty-title">还没有本体</h2>
          <p className="oo-empty-desc">本体是组织的运营语义层，建在数字资产之上。上传业务资料后，系统自动分析数据结构并生成可审核的语义候选。</p>
          {editable ? (
            <button className="oo-primary-button" type="button" onClick={openCreate}>
              <i className="ph ph-plus"></i>创建第一个本体
            </button>
          ) : (
            <p className="muted">请联系管理员或本体建模者创建本体。</p>
          )}
        </div>
      ) : null}

      {ontologies.length > 0 ? (
        <div>
          {editable ? (
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
              <button className="oo-secondary-button" type="button" onClick={openCreate}>
                <i className="ph ph-plus"></i>创建本体
              </button>
            </div>
          ) : null}
          <div className="oo-card-grid">
            {ontologies.map((o) => (
              <div className="oo-onto-card" key={o.id}>
                <div className="oo-onto-card-head">
                  <h3>{o.name}</h3>
                  {o.status === "draft"
                    ? <span className="oo-badge oo-badge-draft">v{o.version} 草稿</span>
                    : <span className="oo-badge oo-badge-ok">v{o.version} 已发布</span>}
                </div>
                <p className="oo-onto-desc">{o.scope}</p>
                <div className="oo-onto-stats">
                  <div><strong>{o.objects}</strong><span>实体</span></div>
                  <div><strong>{o.links}</strong><span>关系</span></div>
                  <div><strong>{o.rules}</strong><span>指标/规则</span></div>
                </div>
                <div className="oo-onto-footer">
                  <small className="muted">{o.updated}</small>
                  <button className="oo-primary-button" type="button" onClick={() => navigate(`/ontology/${o.id}`)}>
                    进入本体 <i className="ph ph-arrow-right"></i>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {showCreate ? (
        <div className="oo-backdrop" onClick={closeCreate}>
          <div className="oo-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <div className="oo-dialog-head">
              <div>
                <h2>创建本体</h2>
                <p>上传业务文件 → 数据自动分析 → LLM 大模型 语义分析与问答 → 确认推荐 → 创建本体。</p>
              </div>
              <button className="oo-close-button" type="button" onClick={closeCreate}><i className="ph ph-x"></i></button>
            </div>

            {createStep === "form" && !refining ? (
              <>
                <div className="oo-dialog-form">
                  <div className="oo-field">
                    <label>本体名称</label>
                    <input placeholder="例如：制造业本体、医疗运营本体" value={formName} onChange={(e) => setFormName(e.target.value)} />
                  </div>
                  <div className="oo-field">
                    <label>企业与建模目标</label>
                    <textarea placeholder="说明行业、组织范围、关键决策场景与核心业务概念。" value={formScope} onChange={(e) => setFormScope(e.target.value)} rows={3} />
                  </div>
                  <div className="oo-field">
                    <label>业务资料（CSV / Excel / PDF / Word）</label>
                    <div className="oo-upload-zone"
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
                      onClick={() => fileInput.current?.click()}>
                      <i className="ph ph-file-arrow-up"></i>
                      <span>拖拽文件到此处 或 点击选择</span>
                      <small>.csv .xlsx .xls .pdf .docx .doc</small>
                      <input ref={fileInput} type="file" multiple accept=".csv,.xlsx,.xls,.pdf,.docx,.doc" hidden onChange={(e) => addFiles(e.target.files)} />
                    </div>
                    {files.length > 0 ? (
                      <ul className="oo-upload-list">
                        {files.map((f, i) => (
                          <li key={i}>
                            <i className={`ph ph-${f.name.match(/\.(csv|xlsx|xls)$/i) ? "table" : f.name.match(/\.pdf$/i) ? "file-pdf" : "file-doc"}`}></i>
                            <span>{f.name}</span>
                            <small>{formatSize(f.size)}</small>
                            <button type="button" onClick={() => removeFile(i)}><i className="ph ph-x"></i></button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </div>
                <div className="oo-dialog-foot">
                  <button className="oo-secondary-button" type="button" onClick={closeCreate}>取消</button>
                  <button className="oo-primary-button" type="button" onClick={runProfiling} disabled={creating || !formName.trim() || !formScope.trim()}>
                    {creating ? "正在分析…" : <><i className="ph ph-magnifying-glass"></i>下一步：分析数据</>}
                  </button>
                </div>
              </>
            ) : null}

            {createStep === "llm" && profiling && !refining ? (
              <>
                <div className="oo-dialog-form" style={{ maxHeight: "58vh", overflowY: "auto" }}>
                  <div style={{ padding: "8px 0", color: "oklch(0.35 0.07 160)", fontSize: 13, fontWeight: 700 }}>
                    <i className="ph ph-check-circle" style={{ marginRight: 6 }}></i>
                    已解析 {profiling.profiling.files_parsed} 个文件，共 {profiling.profiling.columns_total} 个字段
                  </div>
                  <details style={{ marginBottom: 12, fontSize: 12, color: "oklch(0.48 0.018 155)" }}>
                    <summary style={{ cursor: "pointer", fontWeight: 600 }}>查看字段分析详情</summary>
                    <div style={{ marginTop: 8, padding: "8px 12px", background: "oklch(0.972 0.006 155)", borderRadius: 6 }}>
                      {profiling.profiling.details.filter((d) => d.type === "tabular").map((d) => (
                        <div key={d.source} style={{ marginBottom: 6 }}>
                          <strong>📄 {d.source}</strong>（{d.total_rows} 行）
                          <div>{d.columns?.map((c) => <span key={c.name} style={{ display: "inline-block", padding: "1px 6px", margin: "2px", border: "1px solid oklch(0.9 0.01 155)", borderRadius: 3 }}>{c.name}</span>)}</div>
                        </div>
                      ))}
                      {profiling.links_detected.length > 0 ? (
                        <div style={{ marginTop: 8 }}>
                          检测到 {profiling.links_detected.length} 个潜在关系：
                          {profiling.links_detected.map((l, i) => (
                            <div key={i} style={{ fontSize: 11, color: "oklch(0.45 0.115 160)" }}>
                              {l.message}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </details>

                  {!llm ? (
                    <div style={{ textAlign: "center", padding: "16px 0" }}>
                      <button className="oo-primary-button" type="button" onClick={runLLMAnalysis} disabled={analyzing}
                        style={{ background: "oklch(0.52 0.14 285)" }}>
                        <i className="ph ph-brain"></i>
                        {analyzing ? "LLM 分析中，约需 30-60 秒…" : "下一步：进入语义分析与问答"}
                      </button>
                    </div>
                  ) : null}

                  {llm && llm.questions.length > 0 ? (
                    <div style={{
                      border: "1px solid oklch(0.7 0.07 160)", borderRadius: 8,
                      padding: 16, background: "oklch(0.975 0.018 160)"
                    }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "oklch(0.35 0.07 160)" }}>
                          <i className="ph ph-chat-circle-dots" style={{ marginRight: 6 }}></i>
                          LLM 大模型 正在询问 {llm.questions.length} 个问题
                        </div>
                        <div style={{ fontSize: 11, color: "oklch(0.48 0.018 155)" }}>
                          {qIndex + 1} / {llm.questions.length}
                        </div>
                      </div>

                      {(() => {
                        const q = llm.questions[qIndex];
                        const val = qAnswers[q.id];
                        const answered = val !== undefined && val !== "" ? true : (customDraft ? true : false);
                        return (
                          <div>
                            <div style={{ fontSize: 12, color: "oklch(0.63 0.015 155)", marginBottom: 4 }}>分类：{q.category}</div>
                            <div style={{ fontSize: 14, fontWeight: 600, color: "oklch(0.23 0.018 155)", marginBottom: 10, lineHeight: 1.5 }}>
                              {q.question}
                            </div>
                            <div style={{ fontSize: 11, color: "oklch(0.48 0.018 155)", marginBottom: 8 }}>
                              AI 建议：{q.suggested.join(" / ")}
                            </div>
                            {q.id === "parse-fail" && llm.summary ? (
                              <details style={{ marginBottom: 10 }}>
                                <summary style={{ fontSize: 11, color: "oklch(0.58 0.16 28)", cursor: "pointer" }}>查看 LLM 原始返回（前 800 字符）</summary>
                                <pre style={{ fontSize: 10, color: "oklch(0.45 0.018 155)", background: "#fff", padding: 8, borderRadius: 4, maxHeight: 200, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all", marginTop: 4 }}>{llm.summary.slice(0, 800)}</pre>
                              </details>
                            ) : null}
                            {q.suggested.length > 0 ? (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                                {q.suggested.map((s) => (
                                  <button
                                    key={s}
                                    type="button"
                                    className={qAnswers[q.id] === s ? "oo-primary-button" : "oo-secondary-button"}
                                    style={{ padding: "4px 10px", fontSize: 12, minHeight: 30 }}
                                    onClick={() => answerQuestion(q.id, s)}
                                  >
                                    {s}
                                  </button>
                                ))}
                                <button
                                  type="button"
                                  className={qAnswers[q.id] === "" ? "oo-primary-button" : "oo-secondary-button"}
                                  style={{ padding: "4px 10px", fontSize: 12, minHeight: 30 }}
                                  onClick={() => { setCustomDraft(""); answerQuestion(q.id, ""); }}
                                >
                                  {qAnswers[q.id] === "" ? "正在自定义…" : "自定义…"}
                                </button>
                              </div>
                            ) : null}
                            {qAnswers[q.id] === "" ? (
                              <input
                                placeholder="输入你的回答后点击下一题即可提交"
                                value={customDraft}
                                onChange={(e) => setCustomDraft(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") { answerQuestion(q.id, customDraft); setCustomDraft(""); } }}
                                autoFocus
                                style={{ width: "100%", padding: "8px 10px", border: "1px solid oklch(0.53 0.13 160)", borderRadius: 6, marginBottom: 8, outline: "none" }}
                              />
                            ) : null}
                            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
                              <button className="oo-secondary-button" type="button" onClick={prevQuestion} disabled={qIndex === 0}
                                style={{ padding: "6px 14px", fontSize: 12, minHeight: 32 }}>
                                <i className="ph ph-arrow-left"></i> 上一题
                              </button>
                              <button className="oo-primary-button" type="button" onClick={nextQuestion} disabled={!answered}
                                style={{ padding: "6px 14px", fontSize: 12, minHeight: 32 }}>
                                {qIndex === llm.questions.length - 1 ? <><i className="ph ph-check"></i> 查看推荐列表</> : <><i className="ph ph-arrow-right"></i> 下一题</>}
                              </button>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  ) : null}

                  {llm && llm.questions.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "12px 0" }}>
                      <p style={{ fontSize: 12, color: "oklch(0.48 0.018 155)", marginBottom: 12 }}>
                        LLM 大模型 未提出澄清问题，可直接查看推荐。
                      </p>
                      <button className="oo-primary-button" type="button" onClick={() => setCreateStep("review")}
                        style={{ padding: "6px 14px", fontSize: 12 }}>
                        <i className="ph ph-arrow-right"></i> 查看推荐列表
                      </button>
                    </div>
                  ) : null}
                </div>
                <div className="oo-dialog-foot">
                  <button className="oo-secondary-button" type="button" onClick={() => { setLlm(null); setCreateStep("form"); }}>返回修改</button>
                </div>
              </>
            ) : null}

            {createStep === "review" && llm ? (
              llm.entities.length === 0 && llm.relationships.length === 0 ? (
                <div style={{ padding: 20, textAlign: "center", color: "oklch(0.55 0.02 155)", fontSize: 13, lineHeight: 1.7 }}>
                  <p style={{ marginBottom: 12 }}>LLM 大模型 未能生成有效的本体结构。这可能是因为返回格式无法识别。</p>
                  <p style={{ fontSize: 11, color: "oklch(0.63 0.015 155)" }}>请关闭窗口后重试创建。</p>
                </div>
              ) : (
              <>
                <div className="oo-dialog-form" style={{ maxHeight: "58vh", overflowY: "auto" }}>
                  <div style={{ padding: "8px 0", color: "oklch(0.35 0.07 160)", fontSize: 13, fontWeight: 700, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span><i className="ph ph-list-checks" style={{ marginRight: 6 }}></i>LLM 大模型 推荐本体结构{refining ? "（基于你的回答调整中…）" : ""}</span>
                    <button className="oo-secondary-button" type="button" onClick={() => setEditing((v) => !v)}
                      style={{ padding: "3px 10px", fontSize: 11, minHeight: 28 }}>
                      <i className={`ph ph-${editing ? "eye" : "pencil-simple"}`}></i>
                      {editing ? "查看" : "编辑"}
                    </button>
                  </div>
                  {llm.summary && !editing ? (
                    <p style={{ fontSize: 12, color: "oklch(0.48 0.018 155)", background: "oklch(0.972 0.006 155)", padding: 10, borderRadius: 6, lineHeight: 1.55, marginBottom: 12 }}>
                      {llm.summary}
                    </p>
                  ) : null}

                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, color: "oklch(0.45 0.115 160)" }}>
                    <i className="ph ph-cube" style={{ marginRight: 5 }}></i>{llm.entities.length} 个实体
                  </div>
                  {llm.entities.map((e, ei) => (
                    <div key={e.name} style={{ border: "1px solid oklch(0.9 0.01 155)", borderRadius: 6, padding: 10, marginBottom: 8, fontSize: 12, background: "#fff" }}>
                      {editing ? (
                        <div style={{ display: "grid", gap: 6 }}>
                          <div style={{ display: "flex", gap: 8 }}>
                            <input value={e.label} placeholder="中文名" style={{ flex: 1, padding: "4px 6px", border: "1px solid oklch(0.82 0.014 155)", borderRadius: 4, fontSize: 12 }} onChange={(ev) => {
                              const next = [...llm.entities]; next[ei] = { ...next[ei], label: ev.target.value }; setLlm({ ...llm, entities: next });
                            }} />
                            <input value={e.name} placeholder="英文名" style={{ flex: 1, padding: "4px 6px", border: "1px solid oklch(0.82 0.014 155)", borderRadius: 4, fontSize: 12 }} onChange={(ev) => {
                              const next = [...llm.entities]; next[ei] = { ...next[ei], name: ev.target.value }; setLlm({ ...llm, entities: next });
                            }} />
                            <button type="button" onClick={() => { setLlm({ ...llm, entities: llm.entities.filter((_, k) => k !== ei) }); }}
                              style={{ border: 0, background: "transparent", color: "oklch(0.58 0.18 28)", cursor: "pointer", fontSize: 16 }}>
                              <i className="ph ph-trash"></i>
                            </button>
                          </div>
                          <textarea value={e.description} placeholder="业务定义" rows={2} style={{ padding: "4px 6px", border: "1px solid oklch(0.82 0.014 155)", borderRadius: 4, fontSize: 12, resize: "vertical" }} onChange={(ev) => {
                            const next = [...llm.entities]; next[ei] = { ...next[ei], description: ev.target.value }; setLlm({ ...llm, entities: next });
                          }} />
                          <div style={{ fontSize: 11, fontWeight: 600, color: "oklch(0.48 0.018 155)", marginTop: 4 }}>属性</div>
                          {e.properties.map((p, pi) => (
                            <div key={pi} style={{ display: "flex", gap: 6, alignItems: "center", background: "oklch(0.972 0.006 155)", padding: "4px 6px", borderRadius: 4 }}>
                              <input value={p.name} placeholder="属性名" style={{ flex: 1, padding: "3px 6px", border: "1px solid oklch(0.82 0.014 155)", borderRadius: 3, fontSize: 11 }} onChange={(ev) => {
                                const next = [...llm.entities]; const props = [...next[ei].properties]; props[pi] = { ...props[pi], name: ev.target.value }; next[ei] = { ...next[ei], properties: props }; setLlm({ ...llm, entities: next });
                              }} />
                              <select value={p.type} style={{ padding: "3px 6px", border: "1px solid oklch(0.82 0.014 155)", borderRadius: 3, fontSize: 11 }} onChange={(ev) => {
                                const next = [...llm.entities]; const props = [...next[ei].properties]; props[pi] = { ...props[pi], type: ev.target.value }; next[ei] = { ...next[ei], properties: props }; setLlm({ ...llm, entities: next });
                              }}>
                                <option value="string">string</option>
                                <option value="integer">integer</option>
                                <option value="float">float</option>
                                <option value="date">date</option>
                                <option value="boolean">boolean</option>
                                <option value="enum">enum</option>
                              </select>
                              <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 3 }}>
                                <input type="checkbox" checked={p.is_key} onChange={(ev) => {
                                  const next = [...llm.entities]; const props = [...next[ei].properties]; props[pi] = { ...props[pi], is_key: ev.target.checked }; next[ei] = { ...next[ei], properties: props }; setLlm({ ...llm, entities: next });
                                }} /> 主键
                              </label>
                              <button type="button" onClick={() => {
                                const next = [...llm.entities]; next[ei] = { ...next[ei], properties: e.properties.filter((_, k) => k !== pi) }; setLlm({ ...llm, entities: next });
                              }} style={{ border: 0, background: "transparent", color: "oklch(0.58 0.18 28)", cursor: "pointer", fontSize: 14 }}>
                                <i className="ph ph-x"></i>
                              </button>
                            </div>
                          ))}
                          <button type="button" className="oo-secondary-button" style={{ padding: "3px 10px", fontSize: 11, minHeight: 28 }} onClick={() => {
                            const next = [...llm.entities]; next[ei] = { ...next[ei], properties: [...e.properties, { name: "", type: "string", is_key: false, description: "" }] }; setLlm({ ...llm, entities: next });
                          }}>
                            <i className="ph ph-plus"></i> 添加属性
                          </button>
                          <div style={{ color: "oklch(0.63 0.015 155)", fontSize: 11 }}>来源：{e.source_file}</div>
                        </div>
                      ) : (
                        <>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                            <span style={{ minWidth: 24, color: "oklch(0.45 0.115 160)", fontWeight: 700, fontSize: 11 }}>{ei + 1}.</span>
                            <strong style={{ fontWeight: 600 }}>{e.label} ({e.name})</strong>
                          </div>
                          <div style={{ color: "oklch(0.48 0.018 155)", marginBottom: 6, paddingLeft: 30 }}>{e.description}</div>
                          <div style={{ color: "oklch(0.63 0.015 155)", fontSize: 11, paddingLeft: 30 }}>来源：{e.source_file || "未指定"}</div>
                          {e.properties.length > 0 ? (
                            <div style={{ marginTop: 6, paddingLeft: 30, display: "flex", flexWrap: "wrap", gap: 4 }}>
                              {e.properties.map((p) => (
                                <span key={p.name} style={{ padding: "2px 6px", background: "oklch(0.94 0.04 160)", borderRadius: 3, fontSize: 11 }}>
                                  {p.is_key ? "🔑 " : ""}{p.name} : {p.type}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <div style={{ color: "oklch(0.58 0.16 28)", fontSize: 11, paddingLeft: 30, marginTop: 6, fontStyle: "italic" }}>该实体未提取出属性</div>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                  {editing ? (
                    <button type="button" className="oo-secondary-button" style={{ width: "100%", padding: "6px", fontSize: 12 }} onClick={() => {
                      setLlm({ ...llm, entities: [...llm.entities, { name: "", label: "", description: "", source_file: "", properties: [] }] });
                    }}>
                      <i className="ph ph-plus"></i> 添加实体
                    </button>
                  ) : null}

                  {llm.relationships.length > 0 ? (
                    <>
                      <div style={{ fontSize: 12, fontWeight: 700, marginTop: 12, marginBottom: 6, color: "oklch(0.45 0.115 160)" }}>
                        <i className="ph ph-link" style={{ marginRight: 5 }}></i>{llm.relationships.length} 个关系
                      </div>
                      {llm.relationships.map((r, i) => {
                        const fromLabel = llm.entities.find((e) => e.name === r.from_entity)?.label || r.from_entity;
                        const toLabel = llm.entities.find((e) => e.name === r.to_entity)?.label || r.to_entity;
                        const hasFromTo = r.from_entity && r.to_entity;
                        return (
                        <div key={i} style={{ padding: "6px 10px", borderLeft: "3px solid oklch(0.53 0.13 160)", marginBottom: 6, fontSize: 12, color: "oklch(0.48 0.018 155)", lineHeight: 1.5, background: "#fff", display: "grid", gap: editing ? 6 : 0 }}>
                          {editing ? (
                            <>
                              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                <span style={{ minWidth: 24, color: "oklch(0.45 0.115 160)", fontWeight: 700, fontSize: 11 }}>{i + 1}.</span>
                                <select value={r.from_entity || ""} style={{ padding: "3px 6px", border: "1px solid oklch(0.82 0.014 155)", borderRadius: 4, fontSize: 12, maxWidth: 120 }} onChange={(ev) => {
                                  const next = [...llm.relationships]; next[i] = { ...next[i], from_entity: ev.target.value }; setLlm({ ...llm, relationships: next });
                                }}>
                                  <option value="">— 未指定 —</option>
                                  {llm.entities.map((e) => <option key={e.name} value={e.name}>{e.label || e.name}</option>)}
                                </select>
                                <span style={{ color: "oklch(0.63 0.015 155)" }}>→</span>
                                <select value={r.to_entity || ""} style={{ padding: "3px 6px", border: "1px solid oklch(0.82 0.014 155)", borderRadius: 4, fontSize: 12, maxWidth: 120 }} onChange={(ev) => {
                                  const next = [...llm.relationships]; next[i] = { ...next[i], to_entity: ev.target.value }; setLlm({ ...llm, relationships: next });
                                }}>
                                  <option value="">— 未指定 —</option>
                                  {llm.entities.map((e) => <option key={e.name} value={e.name}>{e.label || e.name}</option>)}
                                </select>
                                <select value={r.type} style={{ padding: "3px 6px", border: "1px solid oklch(0.82 0.014 155)", borderRadius: 4, fontSize: 12 }} onChange={(ev) => {
                                  const next = [...llm.relationships]; next[i] = { ...next[i], type: ev.target.value as any }; setLlm({ ...llm, relationships: next });
                                }}>
                                  <option value="one_to_many">一对多</option>
                                  <option value="many_to_one">多对一</option>
                                  <option value="many_to_many">多对多</option>
                                  <option value="one_to_one">一对一</option>
                                </select>
                                <button type="button" onClick={() => { setLlm({ ...llm, relationships: llm.relationships.filter((_, k) => k !== i) }); }}
                                  style={{ border: 0, background: "transparent", color: "oklch(0.58 0.18 28)", cursor: "pointer", fontSize: 16 }}>
                                  <i className="ph ph-trash"></i>
                                </button>
                              </div>
                              <input value={r.description} placeholder="谁与谁是什么关系，例如：客户可以下订单" style={{ padding: "3px 6px", border: "1px solid oklch(0.82 0.014 155)", borderRadius: 4, fontSize: 11 }} onChange={(ev) => {
                                const next = [...llm.relationships]; next[i] = { ...next[i], description: ev.target.value }; setLlm({ ...llm, relationships: next });
                              }} />
                            </>
                          ) : (
                            <>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                <span style={{ minWidth: 24, color: "oklch(0.45 0.115 160)", fontWeight: 700, fontSize: 11 }}>{i + 1}.</span>
                                <strong style={{ color: "oklch(0.23 0.018 155)" }}>{r.name || `关系 ${i + 1}`}</strong>
                                <span style={{ color: "oklch(0.63 0.015 155)" }}>·</span>
                                <span>{r.type === "one_to_many" ? "一对多" : r.type === "many_to_one" ? "多对一" : r.type === "many_to_many" ? "多对多" : r.type === "one_to_one" ? "一对一" : "未指定基数"}</span>
                              </div>
                              <div style={{ color: "oklch(0.48 0.018 155)", paddingLeft: 30, marginTop: 2 }}>
                                {hasFromTo ? (
                                  <><span>{fromLabel}</span><span style={{ margin: "0 6px", color: "oklch(0.45 0.115 160)" }}>→</span><span>{toLabel}</span></>
                                ) : (
                                  <span style={{ color: "oklch(0.58 0.16 28)", fontStyle: "italic" }}>from/to 未指定，需手动选择实体</span>
                                )}
                              </div>
                              {r.description ? (
                                <div style={{ color: "oklch(0.63 0.015 155)", fontSize: 11, paddingLeft: 30, marginTop: 2 }}>{r.description}</div>
                              ) : null}
                            </>
                          )}
                        </div>
                        );
                      })}
                      {editing ? (
                        <button type="button" className="oo-secondary-button" style={{ width: "100%", padding: "6px", fontSize: 12 }} onClick={() => {
                          setLlm({ ...llm, relationships: [...llm.relationships, { name: "", from_entity: "", to_entity: "", type: "many_to_one", description: "", based_on: "" }] });
                        }}>
                          <i className="ph ph-plus"></i> 添加关系
                        </button>
                      ) : null}
                    </>
                  ) : null}

                  {Object.keys(qAnswers).length > 0 ? (
                    <details style={{ marginTop: 12 }}>
                      <summary style={{ cursor: "pointer", fontSize: 12, color: "oklch(0.48 0.018 155)", fontWeight: 600 }}>查看 {Object.keys(qAnswers).length} 个问答记录</summary>
                      <div style={{ marginTop: 8 }}>
                        {llm.questions.map((q) => qAnswers[q.id] ? (
                          <div key={q.id} style={{ padding: 8, background: "oklch(0.972 0.006 155)", borderRadius: 4, marginBottom: 4, fontSize: 11 }}>
                            <div style={{ color: "oklch(0.48 0.018 155)" }}>问：{q.question}</div>
                            <div style={{ color: "oklch(0.35 0.07 160)", fontWeight: 600 }}>答：{qAnswers[q.id]}</div>
                          </div>
                        ) : null)}
                      </div>
                    </details>
                  ) : null}
                </div>
                <div className="oo-dialog-foot">
                  <button className="oo-secondary-button" type="button" onClick={() => setCreateStep("llm")}>返回问答</button>
                  <button className="oo-primary-button" type="button" onClick={onCreateSubmit}>
                    <i className="ph ph-check"></i>确认并创建本体
                  </button>
                </div>
              </>
              )
            ) : null}

            {refining ? (
              <div style={{ textAlign: "center", padding: "60px 20px" }}>
                <i className="ph ph-spinner oo-spinner" style={{ fontSize: 32, color: "oklch(0.53 0.13 160)" }}></i>
                <p style={{ marginTop: 16, fontSize: 14, fontWeight: 600, color: "oklch(0.35 0.07 160)" }}>
                  LLM 大模型 正在基于你的回答调整本体结构…
                </p>
                <p style={{ fontSize: 11, color: "oklch(0.55 0.02 155)", marginTop: 8 }}>
                  所有确认的问题将反馈给大模型，让推荐更贴近业务现实。约需 15-30 秒。
                </p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}