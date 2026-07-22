import { Background, Controls, MiniMap, ReactFlow, type Edge, type Node, useEdgesState, useNodesState } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Database, Play, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { DemoRole } from "../../components/AppShell";

const stageDefinitions = [
  ["source", "数据源"], ["raw_dataset", "原始数据集"], ["transform", "转换"],
  ["clean_dataset", "清洗数据集"], ["ontology_mapping", "本体映射"], ["publish", "发布"],
] as const;
type Stage = typeof stageDefinitions[number][0];
type Source = { id: string; name: string; kind: string; pipeline_id: string | null; dataset: { id: string; stage: string } | null };
type PipelineRun = { id: string; status: string; input_rows: number; output_rows: number; created_at: string; error_message?: string | null };
type Transform = { type: "rename" | "select" | "drop_null" | "fill_null" | "filter_equals" | "cast"; from?: string; to?: string; field?: string; value?: string; dtype?: string; fields?: string[] };

const initialNodes: Node[] = stageDefinitions.map(([id, label], index) => ({
  id,
  position: { x: index * 226, y: index % 2 ? 190 : 70 },
  data: { label, status: "waiting", output: "等待配置" },
  type: "default",
}));
const initialEdges: Edge[] = stageDefinitions.slice(0, -1).map(([id], index) => ({ id: `${id}-${stageDefinitions[index + 1][0]}`, source: id, target: stageDefinitions[index + 1][0], animated: false }));

export function PipelinePage({ role }: { role: DemoRole }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);
  const [sources, setSources] = useState<Source[]>([]);
  const [activePipeline, setActivePipeline] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<Stage>("transform");
  const [transforms, setTransforms] = useState<Transform[]>([]);
  const [draftTransform, setDraftTransform] = useState<Transform>({ type: "rename", from: "", to: "" });
  const [run, setRun] = useState<{ rowCount: number; rows: Record<string, unknown>[] } | null>(null);
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [showMySql, setShowMySql] = useState(false);
  const [mySql, setMySql] = useState({ host: "127.0.0.1", port: "3306", username: "root", password: "", database: "", table: "", password_env: "MYSQL_PASSWORD" });
  const [notice, setNotice] = useState("在画布中拖拽节点、选择转换节点配置规则，然后手动运行。");
  const [running, setRunning] = useState(false);

  async function loadSources() {
    const response = await fetch("/api/sources");
    if (response.ok) setSources((await response.json()).sources);
  }
  useEffect(() => { void loadSources(); }, []);
  useEffect(() => { if (activePipeline) void loadRuns(activePipeline); }, [activePipeline]);

  async function loadRuns(pipelineId: string) {
    const response = await fetch(`/api/pipelines/${pipelineId}/runs`);
    if (response.ok) setRuns((await response.json()).runs);
  }

  function updateNode(stage: Stage, status: string, output: string) {
    setNodes((current) => current.map((node) => node.id === stage ? { ...node, data: { ...node.data, status, output } } : node));
  }

  async function uploadFile(file: File) {
    setNotice(`正在登记 ${file.name}...`);
    const form = new FormData(); form.append("file", file);
    const response = await fetch("/api/sources/upload", { method: "POST", headers: { "X-Demo-Role": role }, body: form });
    const body = await response.json();
    if (!response.ok) { setNotice(body.detail ?? "导入失败，请检查文件格式。"); return; }
    if (body.pipeline_id) {
      setActivePipeline(body.pipeline_id);
      updateNode("source", "ready", file.name);
      setNotice("数据源已登记。现在可配置转换节点并运行画布。");
    } else setNotice("文档已登记并提取文本，可用于后续本体候选与知识检索。");
    await loadSources();
  }

  async function saveMySqlSource() {
    const response = await fetch("/api/sources/mysql", { method: "POST", headers: { "Content-Type": "application/json", "X-Demo-Role": role }, body: JSON.stringify({ ...mySql, port: Number(mySql.port) }) });
    const body = await response.json();
    if (!response.ok) { setNotice(body.detail ?? "MySQL 数据源保存失败。"); return; }
    setActivePipeline(body.pipeline_id); setShowMySql(false); updateNode("source", "ready", `${mySql.database}.${mySql.table}`); setNotice("MySQL 只读数据源已登记，密钥仅通过服务端环境变量读取。"); await loadSources();
  }

  function addTransform() {
    if (draftTransform.type === "rename" && (!draftTransform.from || !draftTransform.to)) { setNotice("字段改名需要填写原字段和新字段。"); return; }
    if (["drop_null", "fill_null", "filter_equals", "cast"].includes(draftTransform.type) && !draftTransform.field) { setNotice("该转换需要选择字段。"); return; }
    setTransforms((current) => [...current, draftTransform]);
    setDraftTransform({ type: "rename", from: "", to: "" });
    updateNode("transform", "configured", `${transforms.length + 1} 条转换规则`);
  }

  async function runPipeline() {
    if (!activePipeline) { setNotice("请先导入 CSV 或 Excel 数据源。"); return; }
    setRunning(true);
    stageDefinitions.forEach(([stage]) => updateNode(stage, "running", "运行中"));
    const response = await fetch(`/api/pipelines/${activePipeline}/run`, { method: "POST", headers: { "Content-Type": "application/json", "X-Demo-Role": role }, body: JSON.stringify({ transforms }) });
    const body = await response.json();
    setRunning(false);
    if (!response.ok) {
      setNotice(body.detail ?? "管道运行失败。");
      updateNode("transform", "failed", body.detail ?? "失败");
      return;
    }
    (body.nodes as Array<{ type: Stage; status: string; output: string }>).forEach((node) => updateNode(node.type, node.status, node.output));
    setRun({ rowCount: body.preview.row_count, rows: body.preview.rows });
    setNotice(`运行成功：输入 ${body.input_rows} 行，输出 ${body.output_rows} 行；运行记录已写入治理审计。`);
    await loadSources();
    await loadRuns(activePipeline);
  }

  const selectedData = useMemo(() => nodes.find((node) => node.id === selectedNode)?.data, [nodes, selectedNode]);
  return <div className="stack-lg pipeline-page"><div className="section-heading"><div><p className="eyebrow">可编辑数据管道</p><h2>从原始数据到可信映射</h2></div><div className="button-row compact"><input ref={inputRef} className="visually-hidden" type="file" accept=".csv,.xlsx,.docx,.pdf" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadFile(file); }} /><button className="secondary-button" onClick={() => inputRef.current?.click()}><Upload size={15} />导入文件</button><button className="secondary-button" onClick={() => setShowMySql((value) => !value)}><Database size={15} />连接 MySQL</button><button className="primary-button" disabled={running || !activePipeline} onClick={() => void runPipeline()}><Play size={15} />{running ? "运行中" : "运行画布"}</button></div></div><p className="inline-notice">{notice}</p>{showMySql && <div className="panel"><p className="eyebrow">只读连接</p><h3>MySQL 数据源</h3><div className="form-grid"><PipelineField label="主机" value={mySql.host} onChange={(host) => setMySql({ ...mySql, host })} /><PipelineField label="端口" value={mySql.port} onChange={(port) => setMySql({ ...mySql, port })} /><PipelineField label="用户名" value={mySql.username} onChange={(username) => setMySql({ ...mySql, username })} /><PipelineField label="密码（仅本次连接测试）" value={mySql.password} type="password" onChange={(password) => setMySql({ ...mySql, password })} /><PipelineField label="数据库" value={mySql.database} onChange={(database) => setMySql({ ...mySql, database })} /><PipelineField label="表名" value={mySql.table} onChange={(table) => setMySql({ ...mySql, table })} /><PipelineField label="服务端密码环境变量" value={mySql.password_env} onChange={(password_env) => setMySql({ ...mySql, password_env })} /></div><div className="button-row"><button className="primary-button" onClick={() => void saveMySqlSource()}>验证并登记</button></div></div>}<div className="pipeline-workspace"><div className="flow-canvas"><ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onNodeClick={(_, node) => setSelectedNode(node.id as Stage)} fitView><Background gap={18} size={1} /><Controls showInteractive={false} /><MiniMap zoomable pannable /></ReactFlow></div><aside className="panel node-inspector"><p className="eyebrow">节点配置</p><h3>{String(selectedData?.label ?? "未选中")}</h3><p className="muted">状态：{String(selectedData?.status ?? "waiting")} · {String(selectedData?.output ?? "等待配置")}</p>{selectedNode === "transform" ? <TransformInspector draft={draftTransform} onChange={setDraftTransform} onAdd={addTransform} transforms={transforms} /> : <p className="muted">拖拽该节点可以调整画布布局。运行时节点输出会写入本次管道记录。</p>}</aside></div><div className="two-column"><div className="panel"><p className="eyebrow">数据源</p><h3>已登记资产</h3><table><thead><tr><th>名称</th><th>类型</th><th>状态</th></tr></thead><tbody>{sources.length ? sources.map((source) => <tr className={source.pipeline_id === activePipeline ? "selected-row" : ""} key={source.id} onClick={() => source.pipeline_id && setActivePipeline(source.pipeline_id)}><td>{source.name}</td><td>{source.kind.toUpperCase()}</td><td><span className={source.dataset ? "badge success" : "badge neutral"}>{source.dataset ? "可信数据" : "待运行"}</span></td></tr>) : <tr><td colSpan={3}>尚未导入数据</td></tr>}</tbody></table></div><div className="panel"><p className="eyebrow">本次输出预览</p><h3>清洗后数据</h3>{run ? <><div className="run-summary"><strong>成功</strong><span>输出 {run.rowCount} 行</span></div><pre>{JSON.stringify(run.rows.slice(0, 3), null, 2)}</pre></> : <p className="muted">运行画布后显示可信数据集预览。</p>}</div></div><div className="panel"><p className="eyebrow">运行历史</p><h3>{activePipeline ? "当前数据源的可追溯执行记录" : "请选择一个数据源"}</h3><table><thead><tr><th>时间</th><th>状态</th><th>输入</th><th>输出</th></tr></thead><tbody>{runs.length ? runs.map((item) => <tr key={item.id}><td>{new Date(item.created_at).toLocaleString("zh-CN", { hour12: false })}</td><td><span className={item.status === "success" ? "badge success" : "badge neutral"}>{item.status}</span></td><td>{item.input_rows}</td><td>{item.output_rows}</td></tr>) : <tr><td colSpan={4}>暂无运行记录</td></tr>}</tbody></table></div></div>;
}

function TransformInspector({ draft, onChange, onAdd, transforms }: { draft: Transform; onChange: (value: Transform) => void; onAdd: () => void; transforms: Transform[] }) {
  return <div className="transform-inspector"><label>转换类型<select value={draft.type} onChange={(event) => onChange({ type: event.target.value as Transform["type"] })}><option value="rename">字段改名</option><option value="select">保留字段</option><option value="cast">类型转换</option><option value="drop_null">删除空值</option><option value="fill_null">填充空值</option><option value="filter_equals">筛选等值</option></select></label>{draft.type === "rename" ? <><label>原字段<input value={draft.from ?? ""} onChange={(event) => onChange({ ...draft, from: event.target.value })} placeholder="例如 order_no" /></label><label>新字段<input value={draft.to ?? ""} onChange={(event) => onChange({ ...draft, to: event.target.value })} placeholder="例如 order_number" /></label></> : draft.type === "select" ? <label>保留字段（逗号分隔）<input value={(draft.fields ?? []).join(",")} onChange={(event) => onChange({ ...draft, fields: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} placeholder="order_number,promised_at" /></label> : <><label>字段<input value={draft.field ?? ""} onChange={(event) => onChange({ ...draft, field: event.target.value })} placeholder="字段名" /></label>{["filter_equals", "fill_null"].includes(draft.type) && <label>{draft.type === "fill_null" ? "填充值" : "保留值"}<input value={draft.value ?? ""} onChange={(event) => onChange({ ...draft, value: event.target.value })} placeholder="值" /></label>}{draft.type === "cast" && <label>目标类型<select value={draft.dtype ?? "string"} onChange={(event) => onChange({ ...draft, dtype: event.target.value })}><option value="string">string</option><option value="int">int</option><option value="float">float</option></select></label>}</>}<button className="secondary-button" onClick={onAdd}>加入转换</button><div className="transform-list">{transforms.length ? transforms.map((item, index) => <span className="chip" key={`${item.type}-${index}`}>{item.type}</span>) : <span className="muted">未配置额外转换；仍会执行去重。</span>}</div></div>;
}

function PipelineField({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) { return <label className="form-field"><span>{label}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} /></label>; }
