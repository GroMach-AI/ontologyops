import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DemoRole } from "../../components/AppShell";
import type { Ontology, OntologyProperty } from "../ontology/OntologyPage";

type Source = { id: string; name: string; kind: string; pipeline_id: string; dataset: { id: string; stage: string; schema?: string } | null };
type DatasetColumn = string | { name: string; type?: string; unique_count?: number; null_percent?: number };
type DatasetPreview = { dataset_version_id: string; lifecycle_status: string; columns: DatasetColumn[]; rows: Array<Record<string, unknown>>; row_count: number };
type NodeKind = "connection" | "storage" | "quality" | "mapping";
type NodePosition = { x: number; y: number };

const initialPositions: Record<NodeKind, NodePosition> = {
  connection: { x: 140, y: 196 }, storage: { x: 410, y: 196 }, quality: { x: 680, y: 196 }, mapping: { x: 950, y: 196 },
};
const NODE_SIZE = { width: 196, height: 170 };

const controlledFieldAliases: Record<string, string[]> = {
  sales_order_id: ["sales_order_no", "sales_order_code", "order_no", "order_id"],
  customer_id: ["customer_code", "customer_no"],
  product_id: ["product_code", "product_no", "material_code"],
  ordered_qty: ["quantity", "order_qty", "ordered_quantity"],
  fulfillment_mode: ["fulfillment_status", "fulfillment_type", "delivery_mode"],
  supplier_id: ["supplier_code", "supplier_no"],
  supplier_name: ["name"],
};

export function suggestFieldMappings(properties: OntologyProperty[], sourceColumns: string[]): Record<string, string> {
  const byNormalizedName = new Map(sourceColumns.map((column) => [column.trim().toLowerCase(), column]));
  return Object.fromEntries(properties.flatMap((property) => {
    const candidates = [property.name, ...(controlledFieldAliases[property.name] ?? [])];
    const matched = candidates.map((candidate) => byNormalizedName.get(candidate.trim().toLowerCase())).find(Boolean);
    return matched ? [[property.name, matched]] : [];
  }));
}

export function datasetColumnNames(columns: DatasetColumn[]): string[] {
  return columns.flatMap((column) => typeof column === "string" ? [column] : column.name ? [column.name] : []);
}

function horizontalPositions(canvasWidth: number): Record<NodeKind, NodePosition> {
  const width = Math.max(1100, canvasWidth);
  const gap = 76;
  const flowWidth = NODE_SIZE.width * 4 + gap * 3;
  const sidePadding = Math.max(56, (width - flowWidth) / 2);
  return {
    connection: { x: sidePadding, y: 196 },
    storage: { x: sidePadding + (NODE_SIZE.width + gap), y: 196 },
    quality: { x: sidePadding + (NODE_SIZE.width + gap) * 2, y: 196 },
    mapping: { x: sidePadding + (NODE_SIZE.width + gap) * 3, y: 196 },
  };
}

const nodeCopy: Record<NodeKind, { label: string; icon: string }> = {
  connection: { label: "数据连接", icon: "ph-file-csv" }, storage: { label: "数据存储", icon: "ph-database" }, quality: { label: "数据清洗与质量", icon: "ph-broom" }, mapping: { label: "本体映射", icon: "ph-share-network" },
};

export function PipelinePage({ role }: { role: DemoRole }) {
  const editable = role === "admin" || role === "modeler";
  const inputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ kind: NodeKind; startX: number; startY: number; origin: NodePosition } | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [selectedNode, setSelectedNode] = useState<NodeKind>("connection");
  const [positions, setPositions] = useState(initialPositions);
  const [preview, setPreview] = useState<DatasetPreview | null>(null);
  const [run, setRun] = useState<{ id: string; dataset_id: string; output_rows: number } | null>(null);
  const [trustedDatasetId, setTrustedDatasetId] = useState("");
  const [ontologies, setOntologies] = useState<Ontology[]>([]);
  const [ontologyId, setOntologyId] = useState("");
  const [entityId, setEntityId] = useState("");
  const [mappingResult, setMappingResult] = useState<{ written_count: number; total_count: number } | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [draggingFiles, setDraggingFiles] = useState(false);

  const selectedSource = sources.find((source) => source.id === selectedSourceId) ?? null;
  const selectedOntology = ontologies.find((ontology) => ontology.id === ontologyId) ?? null;
  const selectedEntity = selectedOntology?.entities.find((entity) => entity.name === entityId) ?? null;
  const previewColumnNames = useMemo(() => datasetColumnNames(preview?.columns ?? []), [preview]);
  const primaryField = useMemo(() => previewColumnNames.find((column) => /sales_order_no|order_id|订单号/i.test(column)) ?? previewColumnNames[0] ?? "", [previewColumnNames]);
  const suggestedFieldMappings = useMemo(
    () => suggestFieldMappings(selectedEntity?.properties ?? [], previewColumnNames),
    [selectedEntity, previewColumnNames],
  );
  const primaryKeyProperty = selectedEntity?.properties.find((property) => property.is_key);
  const primaryKeySource = primaryKeyProperty ? suggestedFieldMappings[primaryKeyProperty.name] : primaryField;
  const activeTrustedDatasetId = trustedDatasetId || (selectedSource?.dataset?.stage === "trusted" ? selectedSource.dataset.id : "");

  const loadSources = useCallback(async () => {
    const response = await fetch("/api/sources");
    if (!response.ok) return;
    const body = await response.json() as { sources: Source[] };
    setSources(body.sources);
    setSelectedSourceId((current) => current || body.sources[0]?.id || "");
  }, []);

  useEffect(() => { void loadSources(); }, [loadSources]);
  useEffect(() => {
    const arrangeNodes = () => setPositions(horizontalPositions(canvasRef.current?.clientWidth ?? 1100));
    arrangeNodes();
    window.addEventListener("resize", arrangeNodes);
    return () => window.removeEventListener("resize", arrangeNodes);
  }, []);
  useEffect(() => {
    if (selectedNode !== "mapping" || ontologies.length) return;
    void (async () => {
      const response = await fetch("/api/ontology-drafts/list");
      if (!response.ok) return;
      const body = await response.json() as { ontologies: Ontology[] };
      const published = body.ontologies.filter((ontology) => ontology.status === "published");
      setOntologies(published);
      setOntologyId((current) => current || published[0]?.id || "");
    })();
  }, [selectedNode, ontologies.length]);
  useEffect(() => {
    setEntityId((current) => current || selectedOntology?.entities[0]?.name || "");
  }, [selectedOntology]);
  useEffect(() => {
    if (!selectedSource?.dataset?.id) { setPreview(null); return; }
    void (async () => {
      const response = await fetch(`/api/datasets/${selectedSource.dataset?.id}/preview`);
      if (response.ok) setPreview(await response.json() as DatasetPreview);
    })();
  }, [selectedSource?.dataset?.id]);
  useEffect(() => {
    if (!selectedOntology || !previewColumnNames.length) return;
    const ranked = selectedOntology.entities
      .map((entity) => ({ entity, score: Object.keys(suggestFieldMappings(entity.properties, previewColumnNames)).length }))
      .sort((left, right) => right.score - left.score);
    if (ranked[0]?.score > 0) setEntityId(ranked[0].entity.name);
  }, [selectedOntology, previewColumnNames]);

  async function uploadCsvFiles(files: File[]) {
    if (!files.length) return;
    if (files.some((file) => !file.name.toLowerCase().endsWith(".csv"))) { setNotice("本期仅支持 CSV 文件。"); return; }
    setBusy(true); setNotice("");
    try {
      const uploaded = [] as Array<{ source_id: string }>;
      for (const file of files) {
        const form = new FormData(); form.append("file", file);
        const response = await fetch("/api/sources/upload", { method: "POST", headers: { "X-Demo-Role": role }, body: form });
        const body = await response.json();
        if (!response.ok) throw new Error(`${file.name}：${body.detail || "上传失败"}`);
        uploaded.push(body as { source_id: string });
      }
      await loadSources();
      setSelectedSourceId(uploaded[0].source_id);
      setSelectedNode("storage");
      setNotice(files.length === 1 ? "CSV 已连接，原始数据集和字段画像已创建。" : `已连接 ${files.length} 个 CSV 文件；每个文件均已创建独立的数据源和原始数据集。`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "上传失败"); } finally { setBusy(false); }
  }

  async function runQualityPipeline() {
    if (!selectedSource) { setNotice("请先上传并选择一个 CSV 文件。"); return; }
    setBusy(true); setNotice("");
    try {
      const runResponse = await fetch(`/api/pipelines/${selectedSource.pipeline_id}/run`, { method: "POST", headers: { "Content-Type": "application/json", "X-Demo-Role": role }, body: JSON.stringify({ transforms: [] }) });
      const runBody = await runResponse.json(); if (!runResponse.ok) throw new Error(runBody.detail || "管道运行失败");
      setRun(runBody); const field = primaryField; if (!field) throw new Error("没有可用于质量检查的字段");
      const qualityResponse = await fetch(`/api/datasets/${runBody.dataset_id}/quality-check`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ unique_fields: [field] }) });
      const qualityBody = await qualityResponse.json(); if (!qualityResponse.ok) throw new Error(qualityBody.detail || "质量检查失败");
      if (qualityBody.status !== "pass") { setNotice("质量检查未通过，不能用于本体映射。请修复重复值后重新运行。"); return; }
      const trustResponse = await fetch(`/api/datasets/${runBody.dataset_id}/trust`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision: "trusted", reason: `${field} 唯一性检查通过` }) });
      const trustBody = await trustResponse.json(); if (!trustResponse.ok) throw new Error(trustBody.detail || "可信决策失败");
      setTrustedDatasetId(runBody.dataset_id); setSelectedNode("mapping"); setNotice(`清洗与质量通过，生成 ${runBody.output_rows} 行可信数据集。`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "运行失败"); } finally { setBusy(false); }
  }

  async function materialize() {
    if (!selectedSource || !selectedEntity || !activeTrustedDatasetId || !primaryField) { setNotice("请先完成可信数据集和实体类型选择。"); return; }
    const fieldMappings = suggestedFieldMappings;
    if (!primaryKeySource) { setNotice(`未能为实体主键 ${primaryKeyProperty?.name || ""} 找到 CSV 字段候选。`); return; }
    setBusy(true); setNotice("");
    try {
      const response = await fetch(`/api/pipelines/${selectedSource.pipeline_id}/materialize`, { method: "POST", headers: { "Content-Type": "application/json", "X-Demo-Role": role }, body: JSON.stringify({ dataset_id: activeTrustedDatasetId, ontology_id: ontologyId, entity_id: selectedEntity.name, primary_key_field: primaryKeySource, field_mappings: fieldMappings }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.detail || "本体映射失败");
      setMappingResult(body); setNotice(`映射通过：已写入 ${body.written_count} 条实体实例。`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "映射失败"); } finally { setBusy(false); }
  }

  function startDrag(kind: NodeKind, event: React.PointerEvent<HTMLButtonElement>) {
    if (!editable) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = { kind, startX: event.clientX, startY: event.clientY, origin: positions[kind] };
  }
  function drag(event: React.PointerEvent<HTMLButtonElement>) {
    const active = dragRef.current; if (!active) return;
    const maxX = Math.max(12, (canvasRef.current?.clientWidth ?? 1100) - NODE_SIZE.width - 12);
    const maxY = Math.max(24, (canvasRef.current?.clientHeight ?? 564) - NODE_SIZE.height - 18);
    setPositions((current) => ({ ...current, [active.kind]: { x: Math.max(12, Math.min(maxX, active.origin.x + event.clientX - active.startX)), y: Math.max(24, Math.min(maxY, active.origin.y + event.clientY - active.startY)) } }));
  }
  function stopDrag() { dragRef.current = null; }

  const nodeMeta = (kind: NodeKind) => {
    if (kind === "connection") return { title: selectedSource?.name || "上传 CSV 文件", desc: selectedSource ? "CSV 已连接，可查看字段画像与来源证据。" : "第一步，选择本地 CSV 文件并建立数据连接。", badge: selectedSource ? "已连接" : "待上传" };
    if (kind === "storage") return { title: selectedSource?.dataset?.id ? "原始数据集版本" : "等待数据连接", desc: selectedSource?.dataset?.id ? `数据集 ${selectedSource.dataset.id}，schema 与文件指纹已保存。` : "上传 CSV 后由系统自动创建数据集版本。", badge: selectedSource?.dataset?.id ? "已注册" : "待创建" };
    if (kind === "quality") return { title: "清洗与质量", desc: activeTrustedDatasetId ? "已生成可信数据集，可进入本体映射。" : "确定性清洗与质量规则在运行时执行。", badge: activeTrustedDatasetId ? "已可信" : "待运行" };
    return { title: selectedEntity ? `${selectedEntity.label || selectedEntity.name} · ${selectedEntity.name}` : "选择实体类型", desc: mappingResult ? `已写入 ${mappingResult.total_count} 条实体实例。` : selectedEntity ? "已生成字段映射候选，请确认后填充实体数据。" : "仅选择已发布本体中的实体类型。", badge: mappingResult ? "已写入" : selectedEntity ? "待确认" : "待映射" };
  };
  const active = nodeMeta(selectedNode);

  return <div className="oo-pipeline-page">
    <div className="oo-pipeline-heading"><div><h1>销售订单履约</h1><div className="oo-heading-meta"><span>草稿</span><span>·</span><span>目标：已发布本体</span></div></div></div>
    {notice ? <div className="oo-notice oo-pipeline-notice"><i className="ph ph-info" /><span>{notice}</span><button type="button" className="oo-notice-close" onClick={() => setNotice("")}><i className="ph ph-x" /></button></div> : null}
    <div className="oo-pipeline-workspace">
      <section className="oo-pipeline-canvas-shell">
        <div className="oo-pipeline-canvas" ref={canvasRef} aria-label="数据管道画布">
          <svg className="oo-pipeline-edges" aria-hidden="true"><defs><marker id="pipeline-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L7,4 L0,8 z" /></marker></defs>{([ ["connection", "storage", "注册版本"], ["storage", "quality", "清洗输入"], ["quality", "mapping", "可信映射"] ] as const).map(([from, to, label]) => { const a = positions[from]; const b = positions[to]; const fromCenter = { x: a.x + NODE_SIZE.width / 2, y: a.y + NODE_SIZE.height / 2 }; const toCenter = { x: b.x + NODE_SIZE.width / 2, y: b.y + NODE_SIZE.height / 2 }; const dx = toCenter.x - fromCenter.x; const dy = toCenter.y - fromCenter.y; const scale = 1 / Math.max(Math.abs(dx) / (NODE_SIZE.width / 2), Math.abs(dy) / (NODE_SIZE.height / 2)); const start = { x: fromCenter.x + dx * scale, y: fromCenter.y + dy * scale }; const end = { x: toCenter.x - dx * scale, y: toCenter.y - dy * scale }; return <g key={label}><line x1={start.x} y1={start.y} x2={end.x} y2={end.y} markerEnd="url(#pipeline-arrow)" /><text x={(start.x + end.x) / 2} y={(start.y + end.y) / 2 - 9}>{label}</text></g>; })}</svg>
          {(Object.keys(nodeCopy) as NodeKind[]).map((kind) => { const meta = nodeMeta(kind); return <button key={kind} type="button" aria-label={nodeCopy[kind].label} className={`oo-pipeline-node ${selectedNode === kind ? "is-selected" : ""}`} style={{ left: positions[kind].x, top: positions[kind].y }} onClick={() => setSelectedNode(kind)} onPointerDown={(event) => startDrag(kind, event)} onPointerMove={drag} onPointerUp={stopDrag} onPointerCancel={stopDrag}><span className="oo-pipeline-node-kind"><i className={`ph ${nodeCopy[kind].icon}`} />{nodeCopy[kind].label}</span><strong>{meta.title}</strong><small>{meta.desc}</small><footer><code>{kind === "connection" ? selectedSource?.id?.slice(0, 8) || "CSV" : kind === "storage" ? selectedSource?.dataset?.id?.slice(0, 8) || "dataset" : kind === "quality" ? run?.id?.slice(0, 8) || "rule" : selectedEntity?.name || "entity"}</code><span className={`oo-badge ${meta.badge.includes("已") ? "oo-badge-ok" : "oo-badge-draft"}`}>{meta.badge}</span></footer></button>; })}
          {!selectedSource ? <button type="button" className="oo-pipeline-upload-empty" onClick={() => inputRef.current?.click()}><i className="ph ph-file-arrow-up" />上传 CSV 文件</button> : null}
          <div className="oo-pipeline-canvas-tip"><i className="ph ph-hand-grabbing" />拖动卡片后，连线会同步更新</div>
        </div>
        <footer className="oo-pipeline-actionbar" data-testid="pipeline-actionbar"><span><i className="ph ph-play-circle" />运行清洗与质量规则后，才可进入本体映射</span><button className="oo-primary-button" type="button" disabled={!editable || busy} onClick={runQualityPipeline}><i className="ph ph-play" />{busy ? "处理中…" : "预览运行"}</button></footer>
      </section>
      <aside className="oo-pipeline-inspector"><header><span className="oo-eyebrow">{nodeCopy[selectedNode].label}</span><h2>{active.title}</h2><p>{active.desc}</p></header>
        {selectedNode === "connection" ? <section><h3>上传 CSV 文件</h3><input ref={inputRef} type="file" accept=".csv,text/csv" multiple hidden onChange={(event) => { const files = Array.from(event.target.files ?? []); if (files.length) void uploadCsvFiles(files); event.currentTarget.value = ""; }} /><button data-testid="connection-dropzone" className={`oo-pipeline-dropzone ${draggingFiles ? "is-dragging" : ""}`} type="button" disabled={!editable || busy} onClick={() => inputRef.current?.click()} onDragEnter={(event) => { event.preventDefault(); setDraggingFiles(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (event.currentTarget === event.target) setDraggingFiles(false); }} onDrop={(event) => { event.preventDefault(); setDraggingFiles(false); const files = Array.from(event.dataTransfer.files); if (files.length) void uploadCsvFiles(files); }}><i className="ph ph-upload-simple" /><strong>拖放 CSV 文件到此处</strong><span>或点击选择文件，可一次上传多个文件</span></button><p className="oo-pipeline-help">每个文件会分别创建独立的数据源和原始数据集；请在下方选择当前要处理的文件。</p>{sources.length ? <label className="oo-pipeline-field">已连接文件<select value={selectedSourceId} onChange={(event) => setSelectedSourceId(event.target.value)}>{sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</select></label> : null}</section> : null}
        {selectedNode === "storage" ? <section><h3>数据集版本</h3><div className="oo-pipeline-kv"><span>状态</span><strong>{selectedSource?.dataset?.stage || "等待上传"}</strong></div><div className="oo-pipeline-kv"><span>行数</span><strong>{preview?.row_count ?? "—"}</strong></div><div className="oo-pipeline-kv"><span>字段数</span><strong>{preview?.columns.length ?? "—"}</strong></div><div className="oo-pipeline-kv"><span>数据集 ID</span><strong>{selectedSource?.dataset?.id || "—"}</strong></div></section> : null}
        {selectedNode === "quality" ? <section><h3>规则与人工确认</h3><div className="oo-pipeline-ai"><div><i className="ph ph-sparkle" /><strong>AI 建议，需人工确认</strong></div><p>建议规范订单日期，并对 {primaryField || "订单标识"} 执行唯一性检查。</p><div><button type="button" onClick={() => setNotice("建议已采用为规则草稿，仍需运行验证。")}><span>采用为草稿</span></button><button type="button" onClick={() => setNotice("请在规则配置中调整字段或阈值。")}><span>修改</span></button></div></div><div className="oo-pipeline-rule"><span>{primaryField || "订单标识"} 唯一性</span><b>{activeTrustedDatasetId ? "通过" : "待运行"}</b></div><button className="oo-secondary-button oo-full-width" type="button" disabled={!editable || busy || !selectedSource} onClick={runQualityPipeline}><i className="ph ph-play" />运行清洗与质量</button></section> : null}
        {selectedNode === "mapping" ? <section><h3>映射配置</h3>{ontologies.length ? <><label className="oo-pipeline-field">已发布本体<select value={ontologyId} onChange={(event) => { setOntologyId(event.target.value); setEntityId(""); }}>{ontologies.map((ontology) => <option key={ontology.id} value={ontology.id}>{ontology.name} · v{ontology.version}</option>)}</select></label><label className="oo-pipeline-field">目标实体类型<select value={entityId} onChange={(event) => setEntityId(event.target.value)}>{selectedOntology?.entities.map((entity) => <option key={entity.name} value={entity.name}>{entity.label || entity.name}</option>)}</select></label>{selectedEntity ? <><p className="oo-pipeline-help">已按字段语义生成候选映射；确认后将可信数据集填充为实体实例。</p><div className="oo-pipeline-mapping-list">{selectedEntity.properties.map((property) => <div key={property.name}><code>{property.is_key ? <b>PK</b> : null}{property.name}</code><i className="ph ph-arrow-right" /><span>{suggestedFieldMappings[property.name] || "未映射"}</span></div>)}</div></> : null}<button className="oo-primary-button oo-full-width" type="button" disabled={!editable || busy || !activeTrustedDatasetId || !primaryKeySource} onClick={materialize}><i className="ph ph-check" />验证并填充实体数据</button>{mappingResult ? <button className="oo-secondary-button oo-full-width" type="button" onClick={() => window.location.assign(`/ontology/${ontologyId}`)}><i className="ph ph-table" />查看 {mappingResult.total_count} 条实体数据</button> : null}</> : <p className="oo-pipeline-help">请先创建并发布本体，再选择目标实体类型。</p>}</section> : null}
        <footer><button className="oo-secondary-button oo-full-width" type="button" onClick={() => setNotice("资源追溯将在治理与可追溯中查看。")}>查看资源追溯</button></footer>
      </aside>
    </div>
    <div className="oo-pipeline-footnote"><i className="ph ph-info" />大模型只生成可审阅的建议草稿。清洗、质量与映射均由确定性规则执行，并保留数据集、映射和运行证据。</div>
  </div>;
}
