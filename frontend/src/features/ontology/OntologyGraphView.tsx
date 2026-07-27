import { useEffect, useMemo, useRef, useState } from "react";

import type { OntologyEntity, OntologyRelationship } from "./OntologyPage";

type Position = { x: number; y: number };
type SelectedEntity = { entity: OntologyEntity; index: number };
type EntityInstance = { entity_key: string; properties: Record<string, unknown>; evidence: { dataset_id: string; mapping_id: string; pipeline_run_id: string } };

const WORLD = { width: 1360, height: 800 };
const NODE = { width: 144, height: 76 };
const ZOOM = { min: 0.45, max: 1.35, step: 0.1 };

const semanticPositions: Array<{ match: RegExp; position: Position }> = [
  { match: /customer|客户/i, position: { x: 105, y: 340 } },
  { match: /sales.?order|销售订单/i, position: { x: 345, y: 340 } },
  { match: /inventory|库存批次/i, position: { x: 625, y: 145 } },
  { match: /production.?plan|生产计划|生产工单/i, position: { x: 625, y: 540 } },
  { match: /product|产品$/i, position: { x: 625, y: 340 } },
  { match: /bom|清单/i, position: { x: 895, y: 340 } },
  { match: /material|物料/i, position: { x: 1165, y: 340 } },
  { match: /supplier|供应商/i, position: { x: 1165, y: 610 } },
];

function findSemanticPosition(entity: OntologyEntity): Position | undefined {
  const signature = `${entity.name} ${entity.label}`;
  return semanticPositions.find((item) => item.match.test(signature))?.position;
}

function initialLayout(entities: OntologyEntity[]): Record<string, Position> {
  const positions: Record<string, Position> = {};
  const fallback = entities.filter((entity) => !findSemanticPosition(entity));
  entities.forEach((entity) => {
    const position = findSemanticPosition(entity);
    if (position) positions[entity.name] = position;
  });
  fallback.forEach((entity, index) => {
    const columns = Math.max(2, Math.ceil(Math.sqrt(fallback.length)));
    positions[entity.name] = { x: 140 + (index % columns) * 230, y: 130 + Math.floor(index / columns) * 175 };
  });
  return positions;
}

function cardinalityLabel(type: string) {
  return ({ one_to_many: "一对多", many_to_one: "多对一", many_to_many: "多对多", one_to_one: "一对一" } as Record<string, string>)[type] ?? (type || "待确认");
}

function pointOnCard(from: Position, toward: Position): Position {
  const center = { x: from.x + NODE.width / 2, y: from.y + NODE.height / 2 };
  const target = { x: toward.x + NODE.width / 2, y: toward.y + NODE.height / 2 };
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  const factor = 1 / Math.max(Math.abs(dx) / (NODE.width / 2), Math.abs(dy) / (NODE.height / 2));
  return { x: center.x + dx * factor, y: center.y + dy * factor };
}

function isPrimaryRelationship(_relationship: OntologyRelationship) {
  return true;
}

function hideFromManufacturingFlow(relationship: OntologyRelationship) {
  const isSalesOrder = /^(sales.?order|销售订单)$/i.test(relationship.from_entity.trim());
  const isProduct = /^(product|产品)$/i.test(relationship.to_entity.trim());
  return isSalesOrder && isProduct && /订购|order.*product/i.test(relationship.name);
}

function relationshipLabel(relationship: OntologyRelationship) {
  const signature = `${relationship.name} ${relationship.from_entity} ${relationship.to_entity}`.toLowerCase();
  if (/customer.*sales.?order|客户.*销售订单/.test(signature)) return "下达订单";
  if (/sales.?order.*inventory|销售订单.*库存/.test(signature)) return "库存履约";
  if (/sales.?order.*production|销售订单.*生产/.test(signature)) return "库存不足时触发";
  if (/product.*inventory|产品.*库存|material.*inventory|物料.*库存/.test(signature)) return "库存对应";
  if (/production.*product|生产.*产品/.test(signature)) return "生产产品";
  if (/product.*bom|产品.*bom/.test(signature)) return "由 BOM 定义";
  if (/bom.*material|bom.*物料/.test(signature)) return "使用物料";
  if (/supplier.*material|供应商.*物料/.test(signature)) return "供应物料";
  const conciseDescription = relationship.description.split(/[。；，]/)[0].trim();
  return /[\u4e00-\u9fff]/.test(conciseDescription) && conciseDescription.length <= 12 ? conciseDescription : "业务关联";
}

type Props = { ontologyId?: string; entities: OntologyEntity[]; relationships: OntologyRelationship[]; initialSelected?: string };

export function OntologyGraphView({ ontologyId, entities, relationships, initialSelected }: Props) {
  const computedLayout = useMemo(() => initialLayout(entities), [entities]);
  const [positions, setPositions] = useState<Record<string, Position>>(computedLayout);
  const [selectedName, setSelectedName] = useState(initialSelected || entities[0]?.name || "");
  const [search, setSearch] = useState("");
  const [sideTab, setSideTab] = useState<"struct" | "rows" | "rels">("struct");
  const [instances, setInstances] = useState<{ total: number; items: EntityInstance[] } | null>(null);
  const [instancesError, setInstancesError] = useState("");
  const [zoom, setZoom] = useState(0.62);
  const [pan, setPan] = useState<Position>({ x: 24, y: 10 });
  const [spacePressed, setSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const nodeDrag = useRef<{ name: string; origin: Position; pointer: Position } | null>(null);
  const canvasDrag = useRef<{ origin: Position; pointer: Position } | null>(null);

  useEffect(() => {
    setPositions(computedLayout);
    setSelectedName(initialSelected || entities[0]?.name || "");
    setZoom(0.62);
    setPan({ x: 24, y: 10 });
  }, [computedLayout, entities, initialSelected]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Space" && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        setSpacePressed(true);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => { if (event.code === "Space") setSpacePressed(false); };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); };
  }, []);

  const selected = useMemo<SelectedEntity | null>(() => {
    const index = entities.findIndex((entity) => entity.name === selectedName);
    return index >= 0 ? { entity: entities[index], index } : (entities[0] ? { entity: entities[0], index: 0 } : null);
  }, [entities, selectedName]);
  const visibleRelationships = useMemo(() => relationships.filter((relationship) => !hideFromManufacturingFlow(relationship)), [relationships]);
  const related = useMemo(() => selected ? visibleRelationships.filter((relationship) => relationship.from_entity === selected.entity.name || relationship.to_entity === selected.entity.name) : [], [selected, visibleRelationships]);
  const filteredEntities = entities.filter((entity) => `${entity.name} ${entity.label}`.toLowerCase().includes(search.toLowerCase()));

  useEffect(() => {
    if (sideTab !== "rows" || !ontologyId || !selected?.entity.name) return;
    let active = true;
    setInstances(null); setInstancesError("");
    void (async () => {
      try {
        const response = await fetch(`/api/ontologies/${ontologyId}/entities/${selected.entity.name}/instances`);
        const body = await response.json() as { total?: number; items?: EntityInstance[]; detail?: string };
        if (!response.ok) throw new Error(body.detail || "无法读取实体数据");
        if (active) setInstances({ total: body.total ?? 0, items: body.items ?? [] });
      } catch (error) {
        if (active) setInstancesError(error instanceof Error ? error.message : "无法读取实体数据");
      }
    })();
    return () => { active = false; };
  }, [ontologyId, selected?.entity.name, sideTab]);

  function setZoomAt(next: number, clientX?: number, clientY?: number) {
    const bounded = Math.max(ZOOM.min, Math.min(ZOOM.max, next));
    if (!canvasRef.current || clientX === undefined || clientY === undefined) { setZoom(bounded); return; }
    const rect = canvasRef.current.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    setPan((current) => ({ x: px - ((px - current.x) / zoom) * bounded, y: py - ((py - current.y) / zoom) * bounded }));
    setZoom(bounded);
  }

  function onNodeDown(event: React.MouseEvent<HTMLButtonElement>, name: string) {
    const origin = positions[name];
    if (!origin) return;
    nodeDrag.current = { name, origin, pointer: { x: event.clientX, y: event.clientY } };
    event.preventDefault();
    event.stopPropagation();
  }
  function onCanvasDown(event: React.MouseEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest(".oo-graph-node, .oo-graph-toolbar")) return;
    if (!spacePressed) return;
    canvasDrag.current = { origin: pan, pointer: { x: event.clientX, y: event.clientY } };
    setIsPanning(true);
    event.preventDefault();
  }
  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (nodeDrag.current) {
        const { name, origin, pointer } = nodeDrag.current;
        setPositions((current) => ({ ...current, [name]: { x: origin.x + (event.clientX - pointer.x) / zoom, y: origin.y + (event.clientY - pointer.y) / zoom } }));
      } else if (canvasDrag.current) {
        const { origin, pointer } = canvasDrag.current;
        setPan({ x: origin.x + event.clientX - pointer.x, y: origin.y + event.clientY - pointer.y });
      }
    };
    const onUp = () => { nodeDrag.current = null; canvasDrag.current = null; setIsPanning(false); };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  }, [zoom]);

  if (!entities.length) return <div className="oo-graph-view oo-graph-empty"><i className="ph ph-graph" /><strong>暂无可视化的实体</strong><span>先补充实体定义，本体图谱会自动渲染。</span></div>;

  return (
    <div className="oo-graph-view">
      <aside className="oo-graph-rail" aria-label="实体列表">
        <div className="oo-graph-rail-head"><div><strong>实体类型</strong><span>{entities.length} 个</span></div><label className="oo-graph-search"><i className="ph ph-magnifying-glass" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索实体" /></label></div>
        <div className="oo-graph-entity-list">{filteredEntities.map((entity) => <button key={entity.name} type="button" className={selected?.entity.name === entity.name ? "oo-graph-entity is-active" : "oo-graph-entity"} onClick={() => setSelectedName(entity.name)}><span className="oo-graph-entity-glyph"><i className="ph ph-cube" /></span><span><b>{entity.label || entity.name}</b><small>{entity.name}</small></span><em>{entity.properties.length}</em></button>)}</div>
        <p className="oo-graph-rail-foot">实体来自已分析的数据资料，发布前需完成候选审核与版本校验。</p>
      </aside>

      <section className="oo-graph-stage">
        <header className="oo-graph-stage-head"><span><i className="ph ph-share-network" />订单履约与产品结构</span><div className="oo-graph-legend"><span><i className="is-solid" />实体关系</span></div><div className="oo-graph-toolbar" role="toolbar" aria-label="图谱工具栏"><button type="button" title="缩小" onClick={() => setZoomAt(zoom - ZOOM.step)}><i className="ph ph-minus" /></button><span>{Math.round(zoom * 100)}%</span><button type="button" title="放大" onClick={() => setZoomAt(zoom + ZOOM.step)}><i className="ph ph-plus" /></button><button type="button" title="适应视图" onClick={() => { setZoom(0.62); setPan({ x: 24, y: 10 }); }}><i className="ph ph-corners-out" /></button></div></header>
        <div className={`oo-graph-canvas${spacePressed ? " is-pan-ready" : ""}${isPanning ? " is-panning" : ""}`} ref={canvasRef} role="region" aria-label="本体图谱画布" onMouseDown={onCanvasDown} onWheel={(event) => { if (event.ctrlKey || event.metaKey) { event.preventDefault(); setZoomAt(zoom + (event.deltaY < 0 ? ZOOM.step : -ZOOM.step), event.clientX, event.clientY); } }}>
          <div className="oo-graph-world" style={{ width: WORLD.width, height: WORLD.height, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
            <svg className="oo-graph-svg" width={WORLD.width} height={WORLD.height} viewBox={`0 0 ${WORLD.width} ${WORLD.height}`} aria-hidden="true">
              <defs><marker id="oo-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>
              {visibleRelationships.map((relationship) => {
                const from = positions[relationship.from_entity]; const to = positions[relationship.to_entity];
                if (!from || !to) return null;
                const start = pointOnCard(from, to); const end = pointOnCard(to, from); const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }; const strong = isPrimaryRelationship(relationship);
                return <g key={`${relationship.name}-${relationship.from_entity}-${relationship.to_entity}`}><line data-testid={`graph-edge-${relationship.from_entity}-${relationship.to_entity}`} className={strong ? "is-strong" : ""} x1={start.x} y1={start.y} x2={end.x} y2={end.y} markerEnd="url(#oo-arrow)" /><g className="oo-graph-edge-label"><text x={mid.x} y={mid.y - 8} textAnchor="middle">{relationshipLabel(relationship)}</text></g></g>;
              })}
            </svg>
            {entities.map((entity) => { const position = positions[entity.name]; if (!position) return null; const active = selected?.entity.name === entity.name; return <button key={entity.name} type="button" aria-label={`移动实体 ${entity.label || entity.name}`} className={active ? "oo-graph-node is-active" : "oo-graph-node"} style={{ left: position.x, top: position.y }} onMouseDown={(event) => onNodeDown(event, entity.name)} onClick={(event) => { event.stopPropagation(); setSelectedName(entity.name); }}><span className="oo-graph-node-icon"><i className="ph ph-cube" /></span><strong>{entity.label || entity.name}</strong><small>{entity.name}</small><em>{entity.properties.length} 个属性</em></button>; })}
          </div>
          <div className="oo-graph-tip">按住空格拖拽平移 · 拖动实体卡片重排 · <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + 滚轮缩放</div>
        </div>
      </section>

      <aside className="oo-graph-side" aria-label="实体详情">{selected ? <><header className="oo-graph-side-head"><span><i className="ph ph-cube" />实体类型</span><h2>{selected.entity.label || selected.entity.name}</h2><small>{selected.entity.name} · {selected.entity.source_file || "未映射数据源"}</small><p>{selected.entity.description || "尚未补充业务定义。"}</p></header><div className="oo-graph-side-stats"><div><b>{selected.entity.properties.length}</b><span>属性</span></div><div><b>{selected.entity.properties.filter((property) => property.is_key).length}</b><span>主键</span></div><div><b>{related.length}</b><span>关联关系</span></div></div><nav className="oo-graph-side-tabs"><button className={sideTab === "struct" ? "is-active" : ""} onClick={() => setSideTab("struct")}>结构</button><button className={sideTab === "rows" ? "is-active" : ""} onClick={() => setSideTab("rows")}>实体数据</button><button className={sideTab === "rels" ? "is-active" : ""} onClick={() => setSideTab("rels")}>相关关系</button></nav><div className="oo-graph-side-body">{sideTab === "struct" ? <><div className="oo-graph-properties-title"><span>属性</span><span>{selected.entity.properties.length} 项</span></div><div className="oo-graph-property-header"><span>字段</span><span>类型</span><span>解释</span></div>{selected.entity.properties.map((property) => <div className="oo-graph-property" key={property.name}><code>{property.is_key ? <b>PK</b> : null}{property.name}</code><span>{property.type}</span><small>{property.description || "未补充字段解释"}</small></div>)}<div className="oo-graph-evidence"><small>数据证据</small><b><i className="ph ph-file-csv" />{selected.entity.source_file || "待映射数据源"}</b></div></> : null}{sideTab === "rels" ? <div className="oo-graph-relations">{related.length ? related.map((relationship) => <div key={`${relationship.name}-${relationship.from_entity}`}><b>{relationship.from_entity}</b><i className="ph ph-arrow-right" /><b>{relationship.to_entity}</b><small>{relationship.name} · {cardinalityLabel(relationship.type)}</small></div>) : <p>暂无相关关系</p>}</div> : null}{sideTab === "rows" ? <div className="oo-graph-instance-list">{instancesError ? <p className="oo-graph-row-note"><i className="ph ph-warning" />{instancesError}</p> : null}{!ontologyId ? <p className="oo-graph-row-note"><i className="ph ph-info" />发布本体后可查看实体数据。</p> : null}{ontologyId && !instances && !instancesError ? <p className="oo-graph-row-note">正在读取实体实例…</p> : null}{instances ? <><div className="oo-graph-properties-title"><span>实体实例</span><span>{instances.total} 条实体实例</span></div>{instances.items.length ? instances.items.map((item) => <article key={item.entity_key} className="oo-graph-instance"><b>{item.entity_key}</b>{Object.entries(item.properties).slice(0, 4).map(([field, value]) => <span key={field}><code>{field}</code>{String(value ?? "—")}</span>)}<small>数据集 {item.evidence.dataset_id} · 映射 {item.evidence.mapping_id} · 运行 {item.evidence.pipeline_run_id}</small></article>) : <p className="oo-graph-row-note"><i className="ph ph-info" />尚无已映射的实体实例。</p>}</> : null}</div> : null}</div></> : null}</aside>
    </div>
  );
}
