import { useCallback, useEffect, useRef, useState } from "react";
import type { DemoRole } from "../../components/AppShell";
import type { Ontology } from "../ontology/OntologyPage";

/* ====== Types ====== */
type Source = { id: string; name: string; kind: string; pipeline_id: string | null; dataset: { id: string; stage: string } | null };
type ColumnProfile = { name: string; type: string; unique_count: number; null_percent: number; samples: string[] };
type RenameEntry = { from: string; to: string };
type CastEntry = { field: string; target: string };
type MappingEntry = { field: string; entity: string; property: string };

const STEPS = [
  { id: 0, label: "数据连接", desc: "上传 csv / excel 文件，登记数据源" },
  { id: 1, label: "数据存储", desc: "确认 schema 并在本地存储中注册数据集版本" },
  { id: 2, label: "数据预处理", desc: "程序清洗 · LLM 推荐类型转换与重命名" },
  { id: 3, label: "本体映射", desc: "LLM 推荐字段 → 属性映射 · 人工确认" },
] as const;

type PreprocTab = "dedup" | "rename" | "cast";

/* ====== Component ====== */
export function PipelinePage({ role }: { role: DemoRole }) {
  const editable = role === "admin" || role === "modeler";

  /* step */
  const [activeStep, setActiveStep] = useState(0);
  const [notice, setNotice] = useState("");

  /* step 1 - 数据连接 */
  const [sources, setSources] = useState<Source[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  /* step 2 - 数据存储 */
  const [previewCols, setPreviewCols] = useState<ColumnProfile[]>([]);
  const [previewRows, setPreviewRows] = useState(0);
  const [selectedFile, setSelectedFile] = useState("");
  const [datasetRegistered, setDatasetRegistered] = useState(false);

  /* step 3 - 数据预处理 */
  const [preprocTab, setPreprocTab] = useState<PreprocTab>("dedup");
  const [dedupKeys, setDedupKeys] = useState<string[]>(["customer_id"]);
  const [renames, setRenames] = useState<RenameEntry[]>([]);
  const [casts, setCasts] = useState<CastEntry[]>([]);
  /* llm suggestions */
  const [llmRenames, setLlmRenames] = useState<RenameEntry[]>([]);
  const [llmCasts, setLlmCasts] = useState<CastEntry[]>([]);
  const [llmLoading, setLlmLoading] = useState(false);

  /* step 4 - 本体映射 */
  const [ontologies, setOntologies] = useState<Ontology[]>([]);
  const [targetOntology, setTargetOntology] = useState<string>("");
  const [mappings, setMappings] = useState<MappingEntry[]>([]);
  const [llmMappings, setLlmMappings] = useState<MappingEntry[]>([]);

  /* ---- data fetching ---- */
  const loadSources = useCallback(async () => {
    const res = await fetch("/api/sources");
    if (res.ok) setSources((await res.json()).sources);
  }, []);

  useEffect(() => { void loadSources(); }, [loadSources]);

  /* ---- step 1: upload ---- */
  async function uploadFile(file: File) {
    setUploading(true);
    setNotice(`正在登记 ${file.name}...`);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch("/api/sources/upload", { method: "POST", headers: { "X-Demo-Role": role }, body: form });
      const body = await res.json();
      if (!res.ok) { setNotice(body.detail ?? "导入失败"); return; }
      setNotice("数据源已登记。可进入下一步确认存储。");
      await loadSources();
    } catch { setNotice("上传请求失败"); }
    finally { setUploading(false); }
  }

  /* ---- step 2: preview ---- */
  async function previewSource(source: Source) {
    setSelectedFile(source.name);
    if (!source.dataset?.id) {
      setPreviewCols([]);
      setPreviewRows(0);
      setNotice("该数据源暂无数据集，请先通过本体创建的 profiling 获得字段信息。");
      return;
    }
    try {
      const res = await fetch(`/api/datasets/${source.dataset.id}/preview`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setPreviewCols(data.columns ?? []);
      setPreviewRows(data.row_count ?? 0);
    } catch {
      setNotice("无法获取数据集预览。");
    }
  }

  function registerDataset() {
    setDatasetRegistered(true);
    setNotice("数据集版本已注册，可进入预处理。");
    setActiveStep(2);
  }

  /* ---- step 3: llm suggestions ---- */
  async function loadLlmSuggestions() {
    if (llmRenames.length > 0 || llmCasts.length > 0) return;
    setLlmLoading(true);
    try {
      const res = await fetch("/api/ontology-drafts/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft: { name: "preproc", scope: "数据预处理" },
          profiling: { details: [] },
          links_detected: [],
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const text = (data.analysis ?? "") as string;
      let parsed: { suggestions?: { rename?: RenameEntry[]; cast?: CastEntry[] } } = {};
      try {
        const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        const start = cleaned.indexOf("{");
        const end = cleaned.lastIndexOf("}");
        if (start >= 0 && end > start) parsed = JSON.parse(cleaned.slice(start, end + 1));
      } catch { /* ignore parse errors */ }
      if (parsed.suggestions?.rename?.length) setLlmRenames(parsed.suggestions.rename);
      if (parsed.suggestions?.cast?.length) setLlmCasts(parsed.suggestions.cast);
    } finally { setLlmLoading(false); }
  }

  useEffect(() => { if (activeStep === 2) void loadLlmSuggestions(); }, [activeStep]);

  /* ---- step 4: load ontologies & llm mapping ---- */
  useEffect(() => {
    if (activeStep !== 3) return;
    (async () => {
      try {
        const res = await fetch("/api/v1/resources?type=ResourceDefinition");
        if (res.ok) {
          const data = await res.json();
          setOntologies(data.resources ?? []);
        }
      } catch { /* ignore */ }
    })();
  }, [activeStep]);

  /* ====== render ====== */
  return (
    <div>
      {notice ? (
        <div className="oo-notice" style={{ marginBottom: 20 }}>
          <i className="ph ph-info" />
          <span>{notice}</span>
          <button className="oo-notice-close" type="button" onClick={() => setNotice("")}><i className="ph ph-x" /></button>
        </div>
      ) : null}

      {/* 页头 */}
      <div className="oo-page-heading" style={{ marginBottom: 20 }}>
        <div>
          <span className="oo-eyebrow" style={{ marginBottom: 0 }}>数据管道</span>
          <h1>数据与管道</h1>
          <div className="oo-heading-meta" style={{ marginTop: 8 }}>
            <span>程序驱动 · LLM 仅在需要时提供候选 · 人类最终确认</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <button className="oo-secondary-button" type="button" onClick={() => fileInput.current?.click()}>
            <i className="ph ph-plus" />新建管道
          </button>
          <input ref={fileInput} type="file" multiple accept=".csv,.xlsx" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadFile(f); }} />
        </div>
      </div>

      {/* 主区域：左侧纵向步骤 + 右侧详情 */}
      <div style={{
        display: "grid", gridTemplateColumns: "222px minmax(0, 1fr)", gap: 0, minHeight: 480,
        border: "1px solid oklch(0.9 0.01 155)", borderRadius: 10, overflow: "hidden",
        background: "#fff", boxShadow: "0 3px 7px oklch(0.16 0.016 155 / 0.07)",
      }}>
        {/* 左侧步骤 */}
        <div style={{ borderRight: "1px solid oklch(0.9 0.01 155)", background: "#fff", display: "flex", flexDirection: "column" }}>
          {STEPS.map((step) => {
            const isActive = activeStep === step.id;
            const isLLM = step.id === 2 || step.id === 3;
            return (
              <button key={step.id} type="button" onClick={() => setActiveStep(step.id)}
                style={{
                  cursor: "pointer", border: 0, width: "100%", textAlign: "left",
                  display: "flex", alignItems: "flex-start", gap: 12,
                  padding: "14px 14px", borderBottom: "1px solid oklch(0.9 0.01 155)",
                  borderLeft: isActive ? "3px solid oklch(0.53 0.13 160)" : "3px solid transparent",
                  background: isActive ? "oklch(0.94 0.04 160)" : "#fff",
                  transition: "background .1s",
                }}
              >
                <div style={{
                  width: 30, height: 30, flex: "0 0 auto", borderRadius: 8,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 13, fontWeight: 700,
                  color: isActive ? "#fff" : "oklch(0.63 0.015 155)",
                  background: isActive ? "oklch(0.53 0.13 160)" : "oklch(0.972 0.006 155)",
                }}>{step.id + 1}</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <strong style={{ fontSize: 13, color: isActive ? "oklch(0.23 0.018 155)" : "oklch(0.48 0.018 155)" }}>
                      {step.label}
                    </strong>
                    {isLLM ? (
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 6px",
                        borderRadius: 4, fontSize: 9, fontWeight: 700,
                        color: "oklch(0.43 0.13 285)", background: "oklch(0.95 0.05 285)",
                      }}>
                        <i className="ph ph-sparkle" style={{ fontSize: 10 }} />AI
                      </span>
                    ) : null}
                  </div>
                  <div style={{ marginTop: 4, color: "oklch(0.63 0.015 155)", fontSize: 10, lineHeight: 1.4 }}>
                    {step.desc}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* 右侧详情 */}
        <div style={{ minWidth: 0 }}>

          {/* ===== 步骤 1: 数据连接 ===== */}
          {activeStep === 0 ? (
            <div>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14,
                minHeight: 54, padding: "0 18px", borderBottom: "1px solid oklch(0.9 0.01 155)",
              }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>数据源列表</h2>
                  <p style={{ margin: "2px 0 0", color: "oklch(0.63 0.015 155)", fontSize: 12 }}>
                    {sources.length} 个文件已连接
                  </p>
                </div>
                <button className="oo-primary-button" type="button" style={{ minHeight: 30, padding: "0 10px", fontSize: 11 }}
                  onClick={() => setActiveStep(1)}>
                  下一步 <i className="ph ph-arrow-right" />
                </button>
              </div>
              {sources.length > 0 ? (
                <div style={{ overflowX: "auto" }}>
                  <table style={{
                    width: "100%", borderCollapse: "collapse", fontSize: 12, marginTop: 0,
                  }}>
                    <thead>
                      <tr style={{ height: 38, color: "oklch(0.63 0.015 155)", background: "oklch(0.997 0.002 155)", fontSize: 11, fontWeight: 700 }}>
                        <th style={{ padding: "0 16px", textAlign: "left" }}>文件名</th>
                        <th style={{ padding: "0 16px", textAlign: "left" }}>类型</th>
                        <th style={{ padding: "0 16px", textAlign: "left" }}>状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sources.map((s) => (
                        <tr key={s.id}
                          onClick={() => previewSource(s)}
                          style={{
                            cursor: "pointer", height: 46,
                            background: selectedFile === s.name ? "oklch(0.94 0.04 160)" : undefined,
                          }}>
                          <td style={{ padding: "0 16px", borderTop: "1px solid oklch(0.9 0.01 155)" }}>
                            <strong style={{ fontSize: 12 }}>{s.name}</strong>
                          </td>
                          <td style={{ padding: "0 16px", borderTop: "1px solid oklch(0.9 0.01 155)", color: "oklch(0.63 0.015 155)" }}>
                            <span className="oo-badge oo-badge-draft" style={{ fontSize: 10, padding: "2px 6px" }}>{s.kind}</span>
                          </td>
                          <td style={{ padding: "0 16px", borderTop: "1px solid oklch(0.9 0.01 155)" }}>
                            <span className="oo-badge oo-badge-ok" style={{ fontSize: 10, padding: "2px 6px" }}>已连接</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ padding: "48px 20px", textAlign: "center", color: "oklch(0.63 0.015 155)", fontSize: 12 }}>
                  暂无数据源，请上传 csv 文件
                </div>
              )}
              <div style={{ padding: 14, borderTop: "1px solid oklch(0.9 0.01 155)" }}>
                <div style={{
                  border: "2px dashed oklch(0.82 0.014 155)", borderRadius: 8,
                  padding: "22px 16px", textAlign: "center", color: "oklch(0.63 0.015 155)",
                  fontSize: 12, background: "oklch(0.972 0.006 155)", cursor: "pointer",
                }} onClick={() => fileInput.current?.click()}>
                  <i className="ph ph-file-arrow-up" style={{ fontSize: 24, display: "block", marginBottom: 6, color: "oklch(0.45 0.115 160)" }} />
                  拖拽或点击上传 csv / excel 文件
                </div>
              </div>
            </div>
          ) : null}

          {/* ===== 步骤 2: 数据存储 ===== */}
          {activeStep === 1 ? (
            <div>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14,
                minHeight: 54, padding: "0 18px", borderBottom: "1px solid oklch(0.9 0.01 155)",
              }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>字段 schema 确认</h2>
                  <p style={{ margin: "2px 0 0", color: "oklch(0.63 0.015 155)", fontSize: 12 }}>
                    {selectedFile || "请先选择数据源"} · 由程序推断（无 LLM 参与）
                  </p>
                </div>
                <button className="oo-primary-button" type="button" style={{ minHeight: 30, padding: "0 10px", fontSize: 11 }}
                  onClick={registerDataset} disabled={datasetRegistered}>
                  <i className="ph ph-database" />{datasetRegistered ? "已注册" : "确认并注册"}
                </button>
              </div>
              {previewCols.length > 0 ? (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginTop: 0 }}>
                    <thead>
                      <tr style={{ height: 38, color: "oklch(0.63 0.015 155)", background: "oklch(0.997 0.002 155)", fontSize: 11, fontWeight: 700 }}>
                        <th style={{ padding: "0 16px", textAlign: "left" }}>字段</th>
                        <th style={{ padding: "0 16px", textAlign: "left" }}>类型</th>
                        <th style={{ padding: "0 16px", textAlign: "left" }}>唯一值</th>
                        <th style={{ padding: "0 16px", textAlign: "left" }}>空值</th>
                        <th style={{ padding: "0 16px", textAlign: "left" }}>样例</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewCols.map((col) => (
                        <tr key={col.name} style={{ height: 46 }}>
                          <td style={{ padding: "0 16px", borderTop: "1px solid oklch(0.9 0.01 155)" }}>
                            <strong style={{ fontSize: 12 }}>{col.name}</strong>
                          </td>
                          <td style={{ padding: "0 16px", borderTop: "1px solid oklch(0.9 0.01 155)", color: "oklch(0.48 0.018 155)" }}>
                            {col.type}
                          </td>
                          <td style={{ padding: "0 16px", borderTop: "1px solid oklch(0.9 0.01 155)", color: "oklch(0.48 0.018 155)" }}>
                            {col.unique_count}
                          </td>
                          <td style={{ padding: "0 16px", borderTop: "1px solid oklch(0.9 0.01 155)" }}>
                            {col.null_percent}%
                          </td>
                          <td style={{ padding: "0 16px", borderTop: "1px solid oklch(0.9 0.01 155)", color: "oklch(0.63 0.015 155)", fontSize: 11 }}>
                            {col.samples?.slice(0, 3).join(", ") || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ padding: "48px 20px", textAlign: "center", color: "oklch(0.63 0.015 155)", fontSize: 12 }}>
                  {selectedFile ? "暂无字段信息，请通过本体创建流程上传文件。" : "请先在数据连接步骤上传 csv 文件。"}
                </div>
              )}
            </div>
          ) : null}

          {/* ===== 步骤 3: 数据预处理 ===== */}
          {activeStep === 2 ? (
            <div>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14,
                minHeight: 54, padding: "0 18px", borderBottom: "1px solid oklch(0.9 0.01 155)",
              }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>数据预处理</h2>
                  <p style={{ margin: "2px 0 0", color: "oklch(0.63 0.015 155)", fontSize: 12 }}>
                    程序执行清洗 · LLM 提供候选建议
                  </p>
                </div>
                <button className="oo-primary-button" type="button" style={{ minHeight: 30, padding: "0 10px", fontSize: 11 }}
                  onClick={() => setActiveStep(3)}>
                  保存并下一步 <i className="ph ph-arrow-right" />
                </button>
              </div>

              {/* LLM 推荐条 */}
              {(llmRenames.length > 0 || llmCasts.length > 0) ? (
                <div style={{
                  margin: "14px 18px", padding: "12px 14px",
                  border: "1px solid oklch(0.78 0.08 285)", borderRadius: 8,
                  background: "oklch(0.97 0.025 285)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <i className="ph ph-sparkle" style={{ color: "oklch(0.43 0.13 285)", fontSize: 16 }} />
                    <strong style={{ fontSize: 13, color: "oklch(0.43 0.13 285)" }}>
                      LLM 推荐 · {llmRenames.length + llmCasts.length} 条候选
                    </strong>
                    <span style={{ marginLeft: "auto", fontSize: 11, color: "oklch(0.63 0.015 155)" }}>
                      基于字段名和样例值推断
                    </span>
                  </div>
                  {llmRenames.map((r, i) => (
                    <div key={`ren-${i}`} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, marginTop: 4 }}>
                      <i className="ph ph-arrow-right" style={{ color: "oklch(0.63 0.015 155)", fontSize: 11 }} />
                      <span><b>{r.from}</b> → <b>{r.to}</b></span>
                      <button className="oo-primary-button" type="button" style={{ minHeight: 24, padding: "0 8px", fontSize: 10, marginLeft: "auto" }}
                        onClick={() => { setRenames((prev) => [...prev, r]); setLlmRenames((prev) => prev.filter((_, j) => j !== i)); }}>
                        采纳
                      </button>
                    </div>
                  ))}
                  {llmCasts.map((c, i) => (
                    <div key={`cast-${i}`} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, marginTop: 4 }}>
                      <i className="ph ph-arrow-right" style={{ color: "oklch(0.63 0.015 155)", fontSize: 11 }} />
                      <span><b>{c.field}</b> → <b>{c.target}</b></span>
                      <button className="oo-primary-button" type="button" style={{ minHeight: 24, padding: "0 8px", fontSize: 10, marginLeft: "auto" }}
                        onClick={() => { setCasts((prev) => [...prev, c]); setLlmCasts((prev) => prev.filter((_, j) => j !== i)); }}>
                        采纳
                      </button>
                    </div>
                  ))}
                </div>
              ) : llmLoading ? (
                <div style={{ padding: "14px 18px", fontSize: 12, color: "oklch(0.63 0.015 155)" }}>
                  <i className="ph ph-spinner oo-spinner" /> LLM 预填中...
                </div>
              ) : null}

              {/* Tabs */}
              <div style={{ display: "flex", gap: 4, borderBottom: "1px solid oklch(0.9 0.01 155)" }}>
                {(["dedup", "rename", "cast"] as PreprocTab[]).map((tab) => (
                  <button key={tab} type="button"
                    onClick={() => setPreprocTab(tab)}
                    style={{
                      padding: "9px 13px", border: 0, borderBottom: preprocTab === tab ? "2px solid oklch(0.53 0.13 160)" : "2px solid transparent",
                      color: preprocTab === tab ? "oklch(0.23 0.018 155)" : "oklch(0.63 0.015 155)",
                      fontWeight: preprocTab === tab ? 700 : 400,
                      background: "transparent", fontSize: 12, cursor: "pointer",
                    }}>
                    {tab === "dedup" ? "去重" : tab === "rename" ? "字段重命名" : "类型转换"}
                  </button>
                ))}
              </div>

              {preprocTab === "dedup" ? (
                <div style={{ padding: 18 }}>
                  <div className="oo-notice" style={{ marginBottom: 14, fontSize: 12 }}>
                    <i className="ph ph-git-merge" />
                    <span>已对数据集执行精确去重扫描：0 个精确重复行。</span>
                  </div>
                  <div style={{ border: "1px solid oklch(0.9 0.01 155)", borderRadius: 8 }}>
                    <div style={{ padding: "10px 14px", borderBottom: "1px solid oklch(0.9 0.01 155)", fontSize: 13, fontWeight: 600 }}>
                      去重依据字段
                    </div>
                    <div style={{ padding: "10px 14px" }}>
                      {["customer_id", "name", "contact"].map((f) => (
                        <label key={f} style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 32, fontSize: 12, cursor: "pointer" }}>
                          <input type="checkbox" checked={dedupKeys.includes(f)}
                            onChange={() => setDedupKeys((prev) => prev.includes(f) ? prev.filter((k) => k !== f) : [...prev, f])} />
                          {f}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {preprocTab === "rename" ? (
                <div style={{ padding: 14 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ height: 34, color: "oklch(0.63 0.015 155)", fontSize: 11 }}>
                        <th style={{ textAlign: "left", padding: "0 8px" }}>原字段</th>
                        <th style={{ textAlign: "left", padding: "0 8px" }}>新字段</th>
                        <th style={{ textAlign: "left", padding: "0 8px" }}>来源</th>
                      </tr>
                    </thead>
                    <tbody>
                      {["customer_id", "name", "region", "credit_level"].map((f) => {
                        const renamed = renames.find((r) => r.from === f);
                        const isLlm = llmRenames.some((r) => r.from === f);
                        return (
                          <tr key={f} style={{ height: 44 }}>
                            <td style={{ padding: "0 8px", borderTop: "1px solid oklch(0.9 0.01 155)" }}><strong>{f}</strong></td>
                            <td style={{ padding: "0 8px", borderTop: "1px solid oklch(0.9 0.01 155)" }}>
                              <input value={renamed?.to ?? f}
                                onChange={(e) => {
                                  const updated = renames.filter((r) => r.from !== f);
                                  if (e.target.value !== f) updated.push({ from: f, to: e.target.value });
                                  setRenames(updated);
                                }}
                                style={{
                                  padding: "4px 6px", border: "1px solid oklch(0.82 0.014 155)", borderRadius: 4,
                                  fontSize: 12, width: 140,
                                  background: isLlm ? "oklch(0.94 0.04 160)" : "#fff",
                                }} />
                            </td>
                            <td style={{ padding: "0 8px", borderTop: "1px solid oklch(0.9 0.01 155)" }}>
                              {isLlm ? <span className="oo-badge" style={{ fontSize: 9, padding: "2px 6px", color: "oklch(0.43 0.13 285)", background: "oklch(0.95 0.05 285)" }}>AI</span> : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {preprocTab === "cast" ? (
                <div style={{ padding: 14 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ height: 34, color: "oklch(0.63 0.015 155)", fontSize: 11 }}>
                        <th style={{ textAlign: "left", padding: "0 8px" }}>字段</th>
                        <th style={{ textAlign: "left", padding: "0 8px" }}>当前</th>
                        <th style={{ textAlign: "left", padding: "0 8px" }}>目标类型</th>
                        <th style={{ textAlign: "left", padding: "0 8px" }}>来源</th>
                      </tr>
                    </thead>
                    <tbody>
                      {["since", "credit_level"].map((f) => {
                        const cast = casts.find((c) => c.field === f);
                        const isLlm = llmCasts.some((c) => c.field === f);
                        return (
                          <tr key={f} style={{ height: 44 }}>
                            <td style={{ padding: "0 8px", borderTop: "1px solid oklch(0.9 0.01 155)" }}><strong>{f}</strong></td>
                            <td style={{ padding: "0 8px", borderTop: "1px solid oklch(0.9 0.01 155)", color: "oklch(0.48 0.018 155)" }}>
                              {f === "since" ? "integer" : "string"}
                            </td>
                            <td style={{ padding: "0 8px", borderTop: "1px solid oklch(0.9 0.01 155)" }}>
                              <select value={cast?.target ?? ""}
                                onChange={(e) => {
                                  const updated = casts.filter((c) => c.field !== f);
                                  if (e.target.value) updated.push({ field: f, target: e.target.value });
                                  setCasts(updated);
                                }}
                                style={{
                                  padding: "3px 6px", border: "1px solid oklch(0.82 0.014 155)", borderRadius: 4,
                                  fontSize: 12,
                                  background: isLlm ? "oklch(0.94 0.04 160)" : "#fff",
                                }}>
                                <option value="">—</option>
                                <option value="string">string</option>
                                <option value="integer">integer</option>
                                {f === "since" ? <option value="date">date</option> : <option value="enum">enum</option>}
                              </select>
                            </td>
                            <td style={{ padding: "0 8px", borderTop: "1px solid oklch(0.9 0.01 155)" }}>
                              {isLlm ? <span className="oo-badge" style={{ fontSize: 9, padding: "2px 6px", color: "oklch(0.43 0.13 285)", background: "oklch(0.95 0.05 285)" }}>AI</span> : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* ===== 步骤 4: 本体映射 ===== */}
          {activeStep === 3 ? (
            <div>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14,
                minHeight: 54, padding: "0 18px", borderBottom: "1px solid oklch(0.9 0.01 155)",
              }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>字段映射</h2>
                  <p style={{ margin: "2px 0 0", color: "oklch(0.63 0.015 155)", fontSize: 12 }}>
                    LLM 基于字段名与属性语义推荐 · 人类最终确认
                  </p>
                </div>
                <button className="oo-primary-button" type="button" style={{ minHeight: 30, padding: "0 10px", fontSize: 11 }}
                  onClick={() => setNotice("映射已确认，数据将接入本体。")}>
                  <i className="ph ph-check" />确认映射
                </button>
              </div>

              {/* LLM 预填提示 */}
              {llmMappings.length > 0 ? (
                <div style={{
                  margin: "14px 18px", padding: "12px 14px",
                  border: "1px solid oklch(0.78 0.08 285)", borderRadius: 8,
                  background: "oklch(0.97 0.025 285)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <i className="ph ph-sparkle" style={{ color: "oklch(0.43 0.13 285)", fontSize: 16 }} />
                    <strong style={{ fontSize: 13, color: "oklch(0.43 0.13 285)" }}>
                      LLM 自动预填 · {llmMappings.length} 条映射
                    </strong>
                    <span style={{ marginLeft: "auto", fontSize: 11, color: "oklch(0.63 0.015 155)" }}>
                      已自动应用 · 可逐条调整
                    </span>
                  </div>
                </div>
              ) : (
                <div style={{
                  margin: "14px 18px", padding: "12px 14px",
                  border: "1px solid oklch(0.82 0.014 155)", borderRadius: 8,
                  background: "oklch(0.972 0.006 155)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <i className="ph ph-info" style={{ color: "oklch(0.45 0.115 160)" }} />
                    <span style={{ fontSize: 12, color: "oklch(0.48 0.018 155)" }}>
                      请先在左侧选择目标本体后，LLM 将根据字段名自动预填映射建议。
                    </span>
                  </div>
                </div>
              )}

              {/* 映射配置 */}
              <div style={{ display: "grid" }}>
                <div style={{
                  padding: "12px 18px", borderBottom: "1px solid oklch(0.9 0.01 155)",
                  display: "flex", alignItems: "center", gap: 10,
                  background: "oklch(0.997 0.002 155)", fontSize: 11, color: "oklch(0.63 0.015 155)",
                }}>
                  <span style={{ width: 140 }}>数据集字段</span>
                  <span style={{ width: 30 }} />
                  <span>本体实体属性</span>
                </div>
                {["customer_id", "name", "region", "credit_level", "since"].map((f) => {
                  const mapping = mappings.find((m) => m.field === f);
                  const isLlm = llmMappings.some((m) => m.field === f);
                  return (
                    <div key={f} className="resource-line" style={{
                      display: "grid", gridTemplateColumns: "18px minmax(0, 1fr) 170px auto",
                      gap: 10, alignItems: "center", minHeight: 46, padding: "0 16px",
                      borderBottom: "1px solid oklch(0.9 0.01 155)",
                      fontSize: 12, color: "oklch(0.48 0.018 155)",
                    }}>
                      <i className="ph ph-file-text" style={{ fontSize: 16, color: "oklch(0.63 0.015 155)" }} />
                      <div>
                        <strong style={{ color: "oklch(0.23 0.018 155)" }}>{f}</strong>
                      </div>
                      <select value={mapping ? `${mapping.entity}.${mapping.property}` : ""}
                        onChange={(e) => {
                          const updated = mappings.filter((m) => m.field !== f);
                          if (e.target.value) {
                            const [entity, property] = e.target.value.split(".");
                            updated.push({ field: f, entity, property });
                          }
                          setMappings(updated);
                        }}
                        style={{
                          padding: "3px 6px", border: `1px solid ${isLlm ? "oklch(0.53 0.13 160)" : "oklch(0.82 0.014 155)"}`,
                          borderRadius: 4, fontSize: 11,
                          background: isLlm ? "oklch(0.94 0.04 160)" : "#fff",
                        }}>
                        <option value="">— 不映射 —</option>
                        <option value="Customer.customer_id">Customer.customer_id</option>
                        <option value="Customer.name">Customer.name</option>
                        <option value="Customer.region">Customer.region</option>
                        <option value="Customer.credit_level">Customer.credit_level</option>
                        <option value="Customer.since">Customer.since</option>
                        <option value="SalesOrder.order_id">SalesOrder.order_id</option>
                      </select>
                      {isLlm ? (
                        <span className="oo-badge" style={{ fontSize: 9, padding: "2px 6px", color: "oklch(0.43 0.13 285)", background: "oklch(0.95 0.05 285)" }}>
                          AI 推荐
                        </span>
                      ) : (
                        <span style={{ color: "oklch(0.63 0.015 155)", fontSize: 10 }}>人工</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

        </div>
      </div>
    </div>
  );
}
