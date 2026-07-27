import { useEffect, useMemo, useRef, useState } from "react";

import type { Ontology, OntologyEntity, OntologyRelationship } from "./OntologyPage";

type SelectedEntity = {
  entity: OntologyEntity;
  index: number;
};

const ENTITY_PALETTE = [
  "#0F6E56", // teal
  "#185FA5", // blue
  "#993C1D", // coral
  "#854F0B", // amber
  "#534AB7", // purple
  "#993556", // pink
  "#0F6E56",
  "#185FA5",
];

const CANVAS_WIDTH = 920;
const CANVAS_HEIGHT = 560;
const BUBBLE_DIAMETER = 88;
// 真实画布坐标系是 viewport 的 2 倍，确保缩放和平移总有空间
const WORLD_WIDTH = CANVAS_WIDTH * 2;
const WORLD_HEIGHT = CANVAS_HEIGHT * 2;

function colorForEntity(index: number): string {
  return ENTITY_PALETTE[index % ENTITY_PALETTE.length];
}

function cardinalityLabel(type: string): string {
  if (type === "one_to_many") return "一对多";
  if (type === "many_to_one") return "多对一";
  if (type === "many_to_many") return "多对多";
  if (type === "one_to_one") return "一对一";
  return type || "基数待确认";
}

function autoLayout(entities: OntologyEntity[]): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  if (entities.length === 0) return positions;
  // hub-style: middle entity at center, others on a ring (in world coordinates)
  const hub = entities[Math.floor(entities.length / 2)];
  positions[hub.name] = { x: WORLD_WIDTH / 2 - BUBBLE_DIAMETER / 2, y: WORLD_HEIGHT / 2 - BUBBLE_DIAMETER / 2 };
  const ring = entities.filter((entity) => entity.name !== hub.name);
  const cx = WORLD_WIDTH / 2 - BUBBLE_DIAMETER / 2;
  const cy = WORLD_HEIGHT / 2 - BUBBLE_DIAMETER / 2;
  const radius = Math.min(WORLD_WIDTH, WORLD_HEIGHT) * 0.30;
  ring.forEach((entity, index) => {
    const angle = -Math.PI / 2 + (index * (Math.PI * 2 / ring.length));
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    positions[entity.name] = {
      x: Math.max(8, Math.min(WORLD_WIDTH - BUBBLE_DIAMETER - 8, x)),
      y: Math.max(8, Math.min(WORLD_HEIGHT - BUBBLE_DIAMETER - 28, y)),
    };
  });
  return positions;
}

function defaultPositions(entities: OntologyEntity[]): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  entities.forEach((entity, index) => {
    if (entities.length === 1) {
      positions[entity.name] = { x: WORLD_WIDTH / 2 - BUBBLE_DIAMETER / 2, y: WORLD_HEIGHT / 2 - BUBBLE_DIAMETER / 2 };
      return;
    }
    // grid layout in world coordinates
    const cols = Math.min(3, entities.length);
    const row = Math.floor(index / cols);
    const col = index % cols;
    const cellW = (WORLD_WIDTH - 120) / cols;
    const cellH = (WORLD_HEIGHT - 120) / Math.ceil(entities.length / cols);
    const x = 60 + col * cellW + (cellW - BUBBLE_DIAMETER) / 2;
    const y = 60 + row * cellH + (cellH - BUBBLE_DIAMETER - 30) / 2;
    positions[entity.name] = { x, y };
  });
  return positions;
}

type OntologyGraphViewProps = {
  entities: OntologyEntity[];
  relationships: OntologyRelationship[];
  initialSelected?: string;
};

export function OntologyGraphView({ entities, relationships, initialSelected }: OntologyGraphViewProps) {
  const initialPositions = useMemo(() => entities.length === 0 ? {} : defaultPositions(entities), [entities]);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>(initialPositions);
  const [selectedName, setSelectedName] = useState<string>(initialSelected ?? entities[0]?.name ?? "");
  const [sideTab, setSideTab] = useState<"struct" | "rows" | "rels">("struct");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 2.0;
  const ZOOM_STEP = 0.2;

  // Reset state when the entity list changes (loading a different ontology)
  useEffect(() => {
    setPositions(initialPositions);
    setSelectedName(initialSelected ?? entities[0]?.name ?? "");
  }, [entities, initialPositions, initialSelected]);

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ key: string; offsetX: number; offsetY: number; originX: number; originY: number } | null>(null);
  const panRef = useRef<{ startX: number; startY: number; initialPan: { x: number; y: number } } | null>(null);

  const selectedEntity = useMemo<SelectedEntity | null>(() => {
    if (entities.length === 0) return null;
    const index = entities.findIndex((entity) => entity.name === selectedName);
    if (index === -1) {
      return { entity: entities[0], index: 0 };
    }
    return { entity: entities[index], index };
  }, [entities, selectedName]);

  const colorByEntity = useMemo(() => {
    const map: Record<string, string> = {};
    entities.forEach((entity, index) => {
      map[entity.name] = colorForEntity(index);
    });
    return map;
  }, [entities]);

  const relatedEdges = useMemo(() => {
    if (!selectedEntity) return [] as OntologyRelationship[];
    const name = selectedEntity.entity.name;
    return relationships.filter((rel) => rel.from_entity === name || rel.to_entity === name);
  }, [relationships, selectedEntity]);

  function startDrag(event: React.MouseEvent, key: string) {
    if (!canvasRef.current) return;
    const pos = positions[key];
    if (!pos) return;
    dragRef.current = {
      key,
      offsetX: event.clientX,
      offsetY: event.clientY,
      originX: pos.x,
      originY: pos.y,
    };
    event.preventDefault();
    event.stopPropagation();
  }

  useEffect(() => {
    function onMove(event: MouseEvent) {
      if (!dragRef.current || !canvasRef.current) return;
      const { key, offsetX, offsetY, originX, originY } = dragRef.current;
      // screen delta divided by zoom to keep bubble glued to cursor across zoom levels
      const dx = (event.clientX - offsetX) / zoom;
      const dy = (event.clientY - offsetY) / zoom;
      const nextX = Math.max(0, Math.min(WORLD_WIDTH - BUBBLE_DIAMETER, originX + dx));
      const nextY = Math.max(0, Math.min(WORLD_HEIGHT - BUBBLE_DIAMETER - 16, originY + dy));
      setPositions((prev) => ({ ...prev, [key]: { x: nextX, y: nextY } }));
    }
    function onUp() {
      dragRef.current = null;
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [positions, zoom]);

  function resetLayout() {
    setPositions(defaultPositions(entities));
  }

  function autoArrange() {
    setPositions(autoLayout(entities));
  }

  function zoomIn() {
    setZoom((z) => {
      const next = Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2));
      clampPanForZoom(next);
      return next;
    });
  }
  function zoomOut() {
    setZoom((z) => {
      const next = Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2));
      clampPanForZoom(next);
      return next;
    });
  }
  function zoomReset() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }
  const worldTransform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
  function clampPanForZoom(currentZoom: number) {
    setPan((current) => {
      const maxX = (WORLD_WIDTH * currentZoom - CANVAS_WIDTH) / 2 + 100;
      const maxY = (WORLD_HEIGHT * currentZoom - CANVAS_HEIGHT) / 2 + 100;
      return {
        x: Math.max(-maxX, Math.min(maxX, current.x)),
        y: Math.max(-maxY, Math.min(maxY, current.y)),
      };
    });
  }
  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    if (event.deltaY < 0) zoomIn();
    else zoomOut();
  }
  function startPan(event: React.MouseEvent<HTMLDivElement>) {
    // Only pan if user clicks on canvas background (not on a bubble or toolbar)
    const target = event.target as HTMLElement;
    if (target.closest(".oo-graph-node")) return;
    if (target.closest(".oo-graph-toolbar")) return;
    if (target.closest(".oo-graph-tip")) return;
    panRef.current = { startX: event.clientX, startY: event.clientY, initialPan: { ...pan } };
    event.preventDefault();
  }
  useEffect(() => {
    function onMove(event: MouseEvent) {
      // 拖拽气泡 (drag) 优先
      if (dragRef.current) return;
      if (!panRef.current) return;
      const dx = event.clientX - panRef.current.startX;
      const dy = event.clientY - panRef.current.startY;
      const maxX = (WORLD_WIDTH * zoom - CANVAS_WIDTH) / 2 + 100;
      const maxY = (WORLD_HEIGHT * zoom - CANVAS_HEIGHT) / 2 + 100;
      setPan({
        x: Math.max(-maxX, Math.min(maxX, panRef.current.initialPan.x + dx)),
        y: Math.max(-maxY, Math.min(maxY, panRef.current.initialPan.y + dy)),
      });
    }
    function onUp() {
      panRef.current = null;
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [pan, zoom]);

  if (entities.length === 0) {
    return (
      <div className="oo-graph-view">
        <div className="oo-graph-empty">
          <i className="ph ph-graph" aria-hidden="true" />
          <strong>暂无可视化的实体</strong>
          <span>先在“实体”标签页补充实体定义，本体图谱会自动渲染。</span>
        </div>
      </div>
    );
  }

  return (
    <div className="oo-graph-view">
      {/* LEFT: 实体列表 */}
      <aside className="oo-graph-rail" aria-label="实体列表">
        <div className="oo-graph-rail-head">
          <h3>实体类型</h3>
          <div className="oo-graph-search">
            <i className="ph ph-magnifying-glass" aria-hidden="true" />
            <input type="text" placeholder="搜索实体…" />
          </div>
        </div>
        <ul>
          {entities.map((entity, index) => {
            const isActive = selectedEntity?.entity.name === entity.name;
            const color = colorForEntity(index);
            const initial = (entity.label || entity.name).slice(0, 1).toUpperCase();
            return (
              <li key={entity.name}>
                <button
                  type="button"
                  className={isActive ? "oo-graph-entity is-active" : "oo-graph-entity"}
                  style={{ ["--entity-color" as string]: color }}
                  onClick={() => setSelectedName(entity.name)}
                >
                  <span className="oo-graph-entity-dot" style={{ background: color }}>{initial}</span>
                  <span className="oo-graph-entity-info">
                    <span className="oo-graph-entity-name">{entity.label || entity.name}</span>
                    <span className="oo-graph-entity-meta">{entity.name} · {entity.properties.length} 属性</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* CENTER: 图谱画布 */}
      <div className="oo-graph-canvas-wrap">
        <div
          className="oo-graph-canvas"
          ref={canvasRef}
          role="region"
          aria-label="本体图谱画布"
          style={{ transform: worldTransform, width: WORLD_WIDTH, height: WORLD_HEIGHT, cursor: panRef.current ? "grabbing" : "grab" }}
          onWheel={handleWheel}
          onMouseDown={startPan}
        >
          <div className="oo-graph-canvas-bg" />
          <div className="oo-graph-canvas-grid" />
          {/* 连线（SVG 层） */}
          <svg
            className="oo-graph-svg"
            width={WORLD_WIDTH}
            height={WORLD_HEIGHT}
            viewBox={`0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}`}
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            {relationships.map((rel, index) => {
              const a = positions[rel.from_entity];
              const b = positions[rel.to_entity];
              if (!a || !b) return null;
              const cx1 = a.x + BUBBLE_DIAMETER / 2;
              const cy1 = a.y + BUBBLE_DIAMETER / 2;
              const cx2 = b.x + BUBBLE_DIAMETER / 2;
              const cy2 = b.y + BUBBLE_DIAMETER / 2;
              const midX = (cx1 + cx2) / 2;
              const midY = (cy1 + cy2) / 2;
              return (
                <g key={`${rel.name}-${index}`}>
                  <line
                    x1={cx1} y1={cy1} x2={cx2} y2={cy2}
                    stroke="#a8a6a1"
                    strokeWidth="1.5"
                    strokeDasharray="4 3"
                  />
                  <text
                    x={midX}
                    y={midY - 6}
                    textAnchor="middle"
                    className="oo-graph-edge-label-svg"
                  >
                    {rel.name} · {cardinalityLabel(rel.type)}
                  </text>
                  <text
                    x={midX}
                    y={midY + 8}
                    textAnchor="middle"
                    className="oo-graph-edge-desc-svg"
                  >
                    {rel.description ? rel.description.slice(0, 18) : "未补充说明"}
                  </text>
                </g>
              );
            })}
          </svg>

          {/* 气泡节点 */}
          {entities.map((entity, index) => {
            const pos = positions[entity.name];
            if (!pos) return null;
            const isActive = selectedEntity?.entity.name === entity.name;
            const color = colorForEntity(index);
            return (
              <button
                key={entity.name}
                type="button"
                className={isActive ? "oo-graph-node is-active" : "oo-graph-node"}
                style={{
                  left: pos.x,
                  top: pos.y,
                  ["--node-color" as string]: color,
                }}
                onMouseDown={(event) => startDrag(event, entity.name)}
                onClick={(event) => {
                  event.stopPropagation();
                  setSelectedName(entity.name);
                }}
              >
                <span className="oo-graph-node-bubble">
                  <strong>{entity.name}</strong>
                  <small>{entity.label || entity.name}</small>
                  <em>{entity.properties.length} 属性</em>
                </span>
                <span className="oo-graph-node-cap">{entity.source_file || "未映射数据源"}</span>
              </button>
            );
          })}

          <div className="oo-graph-toolbar" role="toolbar" aria-label="图谱工具栏">
            <button type="button" title="放大" onClick={zoomIn}>
              <i className="ph ph-plus" aria-hidden="true" />
            </button>
            <button type="button" title="缩小" onClick={zoomOut}>
              <i className="ph ph-minus" aria-hidden="true" />
            </button>
            <button type="button" title="重置缩放" onClick={zoomReset}>
              <i className="ph ph-frame-corners" aria-hidden="true" />
            </button>
            <span className="oo-graph-tool-sep" aria-hidden="true" />
            <button type="button" title="重置布局" onClick={resetLayout}>
              <i className="ph ph-arrows-clockwise" aria-hidden="true" />
            </button>
            <button type="button" title="自动布局" onClick={autoArrange}>
              <i className="ph ph-flow-arrow" aria-hidden="true" />
            </button>
            <span className="oo-graph-zoom-readout">{Math.round(zoom * 100)}%</span>
          </div>

          <div className="oo-graph-tip">
            <b>拖拽气泡</b>改变位置 · <b>空白处拖拽</b>平移画布 · <b>Ctrl/Cmd + 滚轮</b>缩放
          </div>
        </div>
      </div>

      {/* RIGHT: 实体详情 */}
      <aside className="oo-graph-side" aria-label="实体详情">
        {selectedEntity ? (
          <>
            <div className="oo-graph-side-head">
              <span className="oo-graph-side-pill" style={{ background: `${colorByEntity[selectedEntity.entity.name]}1a`, color: colorByEntity[selectedEntity.entity.name] }}>
                <i className="ph ph-cube" aria-hidden="true" /> 实体类型
              </span>
              <h2>{selectedEntity.entity.label || selectedEntity.entity.name}</h2>
              <span className="oo-graph-side-cn">{selectedEntity.entity.name} · {selectedEntity.entity.properties.length} 属性 · {selectedEntity.entity.source_file || "未映射数据源"}</span>
              <p>{selectedEntity.entity.description || "尚未补充业务定义。"}</p>
            </div>
            <div className="oo-graph-side-tabs">
              <button type="button" className={sideTab === "struct" ? "is-active" : ""} onClick={() => setSideTab("struct")}>结构</button>
              <button type="button" className={sideTab === "rows" ? "is-active" : ""} onClick={() => setSideTab("rows")}>表数据</button>
              <button type="button" className={sideTab === "rels" ? "is-active" : ""} onClick={() => setSideTab("rels")}>相关关系</button>
            </div>

            {sideTab === "struct" ? (
              <div className="oo-graph-side-section">
                <h4>属性 · {selectedEntity.entity.properties.length}</h4>
                <div className="oo-graph-field-row oo-graph-field-row-head">
                  <div>字段</div>
                  <div style={{ textAlign: "center" }}>类型</div>
                  <div>说明</div>
                </div>
                {selectedEntity.entity.properties.length > 0 ? selectedEntity.entity.properties.map((property, index) => (
                  <div className="oo-graph-field-row" key={`${property.name}-${index}`}>
                    <div className="oo-graph-field-name">
                      {property.is_key ? <span className="oo-graph-tag">PK</span> : null}
                      <code>{property.name}</code>
                    </div>
                    <div className="oo-graph-field-type">{property.type}</div>
                    <div className="oo-graph-field-desc">{property.description || "—"}</div>
                  </div>
                )) : <div className="oo-graph-empty-mini">暂无属性</div>}
              </div>
            ) : null}

            {sideTab === "rels" ? (
              <div className="oo-graph-side-section">
                <h4>相邻关系 · {relatedEdges.length}</h4>
                {relatedEdges.length > 0 ? (
                  <div className="oo-graph-rel-list">
                    {relatedEdges.map((rel, index) => (
                      <div className="oo-graph-rel-row" key={`${rel.name}-${index}`}>
                        <span className="oo-graph-rel-from">{rel.from_entity}</span>
                        <i className="ph ph-arrows-left-right" aria-hidden="true" />
                        <span className="oo-graph-rel-to">
                          {rel.to_entity}
                          <em>{cardinalityLabel(rel.type)}</em>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : <div className="oo-graph-empty-mini">暂无相邻关系</div>}
              </div>
            ) : null}

            {sideTab === "rows" ? (
              <div className="oo-graph-side-section">
                <h4>表数据预览</h4>
                <div className="oo-graph-rows-note">
                  <i className="ph ph-info" aria-hidden="true" />
                  完整表结构查看需要在「实体 → 对象映射」中接入已发布的数据集资源。
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <div className="oo-graph-side-empty">
            <i className="ph ph-cursor-click" aria-hidden="true" />
            <strong>选择一个实体</strong>
            <span>点击画布中的实体气泡，查看属性和关系。</span>
          </div>
        )}
      </aside>
    </div>
  );
}
