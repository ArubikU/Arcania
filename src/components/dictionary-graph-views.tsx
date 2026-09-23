"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { DictionaryGraph } from "@/types";

type GraphProps = {
  graph: DictionaryGraph;
  selectedNodeId: number | null;
  highlightedNodeIds: Set<number>;
  onSelectNode: (nodeId: number) => void;
};

function getNodePosition(value: number, min: number, max: number) {
  return min + value * (max - min);
}

function getSourceClassName(source: string) {
  if (source.includes("override")) {
    return "is-override";
  }

  if (source === "manual") {
    return "is-manual";
  }

  if (source === "runtime-ai") {
    return "is-runtime";
  }

  return "is-seed";
}

export function DictionaryMap2D({ graph, selectedNodeId, highlightedNodeIds, onSelectNode }: GraphProps) {
  const width = 1200;
  const height = 620;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    }

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const transformStyle = useMemo(
    () => ({ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }),
    [offset.x, offset.y, scale]
  );

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    dragStartRef.current = { x: event.clientX - offset.x, y: event.clientY - offset.y };
    setIsDragging(true);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!isDragging || !dragStartRef.current) {
      return;
    }

    setOffset({
      x: event.clientX - dragStartRef.current.x,
      y: event.clientY - dragStartRef.current.y
    });
  }

  function handlePointerUp() {
    dragStartRef.current = null;
    setIsDragging(false);
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault();

    const nextScale = Math.max(0.45, Math.min(2.8, scale + (event.deltaY < 0 ? 0.12 : -0.12)));

    if (!containerRef.current) {
      setScale(nextScale);
      return;
    }

    const rect = containerRef.current.getBoundingClientRect();
    const originX = event.clientX - rect.left - rect.width / 2;
    const originY = event.clientY - rect.top - rect.height / 2;
    const ratio = nextScale / scale;

    setOffset((current) => ({
      x: current.x - originX * (ratio - 1),
      y: current.y - originY * (ratio - 1)
    }));
    setScale(nextScale);
  }

  function resetView() {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }

  async function toggleFullscreen() {
    if (!containerRef.current) {
      return;
    }

    if (document.fullscreenElement === containerRef.current) {
      await document.exitFullscreen().catch(() => undefined);
      return;
    }

    await containerRef.current.requestFullscreen().catch(() => undefined);
  }

  return (
    <div
      ref={containerRef}
      className={`graph-surface graph-surface-map ${isDragging ? "is-grabbing" : ""} ${isFullscreen ? "is-fullscreen" : ""}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onWheel={handleWheel}
    >
      <div className="graph-controls" onPointerDown={(event) => event.stopPropagation()}>
        <button type="button" className="ghost-button" onClick={() => setScale((value) => Math.min(2.8, value + 0.12))}>
          +
        </button>
        <button type="button" className="ghost-button" onClick={() => setScale((value) => Math.max(0.45, value - 0.12))}>
          -
        </button>
        <button type="button" className="ghost-button" onClick={resetView}>
          Reset
        </button>
        <button type="button" className="ghost-button" onClick={() => void toggleFullscreen()}>
          {isFullscreen ? "Salir pantalla completa" : "Fullscreen"}
        </button>
        <span className="graph-controls-meta">zoom {(scale * 100).toFixed(0)}%</span>
      </div>

      <div className="graph-panzoom-layer" style={transformStyle}>
      <svg className="graph-canvas" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        {graph.edges.map((edge) => {
          const source = graph.nodes.find((node) => node.id === edge.sourceId);
          const target = graph.nodes.find((node) => node.id === edge.targetId);

          if (!source || !target) {
            return null;
          }

          const x1 = getNodePosition(source.x, 70, width - 70);
          const y1 = getNodePosition(source.y, 60, height - 60);
          const x2 = getNodePosition(target.x, 70, width - 70);
          const y2 = getNodePosition(target.y, 60, height - 60);
          const isHighlighted =
            selectedNodeId === null ||
            edge.sourceId === selectedNodeId ||
            edge.targetId === selectedNodeId ||
            (highlightedNodeIds.has(edge.sourceId) && highlightedNodeIds.has(edge.targetId));

          return (
            <line
              key={`${edge.kind}-${edge.sourceId}-${edge.targetId}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              className={`graph-edge graph-edge-${edge.kind} ${isHighlighted ? "is-highlighted" : "is-muted"}`}
              style={{ opacity: isHighlighted ? Math.max(0.18, edge.weight) : 0.08 }}
            />
          );
        })}
      </svg>

      <div className="graph-node-layer">
        {graph.nodes.map((node) => {
          const left = `${getNodePosition(node.x, 8, 92)}%`;
          const top = `${getNodePosition(node.y, 8, 92)}%`;
          const isSelected = node.id === selectedNodeId;
          const isHighlighted = selectedNodeId === null || highlightedNodeIds.has(node.id);

          return (
            <button
              key={node.id}
              type="button"
              className={`graph-node-card ${getSourceClassName(node.source)} ${isSelected ? "is-selected" : ""} ${isHighlighted ? "is-highlighted" : "is-muted"}`}
              style={{ left, top }}
              title={`${node.spanish} -> ${node.arcano}`}
              onClick={(event) => {
                event.stopPropagation();
                onSelectNode(node.id);
              }}
            >
              <strong>{node.spanish}</strong>
              <span>{node.arcano}</span>
              <small>{node.category} · {node.source}</small>
            </button>
          );
        })}
      </div>
      </div>
    </div>
  );
}

export function DictionaryTree3D({ graph, selectedNodeId, highlightedNodeIds, onSelectNode }: GraphProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const [viewport, setViewport] = useState({ width: 1080, height: 640 });
  const [rotationX, setRotationX] = useState(18);
  const [rotationY, setRotationY] = useState(-28);
  const [zoom, setZoom] = useState(1);
  const [pointScale, setPointScale] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const target = entries[0];

      if (!target) {
        return;
      }

      const nextWidth = Math.max(420, Math.floor(target.contentRect.width));
      const nextHeight = Math.max(420, Math.floor(target.contentRect.height));
      setViewport({ width: nextWidth, height: nextHeight });
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    }

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const projected = useMemo(() => {
    const centerX = viewport.width / 2;
    const centerY = viewport.height / 2;
    const spread = Math.min(viewport.width, viewport.height) * 0.36;
    const perspective = 900;
    const radX = (rotationX * Math.PI) / 180;
    const radY = (rotationY * Math.PI) / 180;

    return graph.nodes
      .map((node) => {
        const nx = (node.x - 0.5) * 2;
        const ny = (node.y - 0.5) * 2;
        const nz = (node.z - 0.5) * 2;

        const x1 = nx * Math.cos(radY) + nz * Math.sin(radY);
        const z1 = -nx * Math.sin(radY) + nz * Math.cos(radY);
        const y2 = ny * Math.cos(radX) - z1 * Math.sin(radX);
        const z2 = ny * Math.sin(radX) + z1 * Math.cos(radX);

        const depthFactor = (perspective * zoom) / (perspective - z2 * spread);
        const sx = centerX + x1 * spread * depthFactor;
        const sy = centerY + y2 * spread * depthFactor;
        const radius = Math.max(2, Math.min(12, (2 + node.confidence * 3.4) * pointScale * depthFactor));

        return {
          node,
          x: sx,
          y: sy,
          z: z2,
          radius,
          highlighted: selectedNodeId === null || highlightedNodeIds.has(node.id),
          selected: node.id === selectedNodeId
        };
      })
      .sort((left, right) => left.z - right.z);
  }, [graph.nodes, highlightedNodeIds, pointScale, rotationX, rotationY, selectedNodeId, viewport.height, viewport.width, zoom]);

  const projectedMap = useMemo(() => new Map(projected.map((point) => [point.node.id, point])), [projected]);

  function pickClusterColor(cluster: string) {
    let hash = 0;

    for (let index = 0; index < cluster.length; index += 1) {
      hash = (hash * 31 + cluster.charCodeAt(index)) % 360;
    }

    return `hsl(${hash}deg 68% 58%)`;
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    dragStartRef.current = { x: event.clientX, y: event.clientY };
    setIsDragging(true);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragStartRef.current) {
      return;
    }

    const deltaX = event.clientX - dragStartRef.current.x;
    const deltaY = event.clientY - dragStartRef.current.y;

    setRotationY((value) => value + deltaX * 0.26);
    setRotationX((value) => Math.max(-75, Math.min(75, value - deltaY * 0.24)));
    dragStartRef.current = { x: event.clientX, y: event.clientY };
  }

  function handlePointerUp() {
    dragStartRef.current = null;
    setIsDragging(false);
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    setZoom((value) => Math.max(0.45, Math.min(2.9, value + (event.deltaY < 0 ? 0.12 : -0.12))));
  }

  function resetCamera() {
    setRotationX(18);
    setRotationY(-28);
    setZoom(1);
    setPointScale(1);
  }

  async function toggleFullscreen() {
    if (!containerRef.current) {
      return;
    }

    if (document.fullscreenElement === containerRef.current) {
      await document.exitFullscreen().catch(() => undefined);
      return;
    }

    await containerRef.current.requestFullscreen().catch(() => undefined);
  }

  return (
    <div
      ref={containerRef}
      className={`tree3d-stage vector3d-stage ${isDragging ? "is-grabbing" : ""} ${isFullscreen ? "is-fullscreen" : ""}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onWheel={handleWheel}
    >
      <div className="graph-controls" onPointerDown={(event) => event.stopPropagation()}>
        <button type="button" className="ghost-button" onClick={() => setZoom((value) => Math.min(2.9, value + 0.12))}>
          +
        </button>
        <button type="button" className="ghost-button" onClick={() => setZoom((value) => Math.max(0.45, value - 0.12))}>
          -
        </button>
        <input
          type="range"
          min="0.55"
          max="1.8"
          step="0.05"
          value={pointScale}
          onChange={(event) => setPointScale(Number(event.target.value))}
          aria-label="Escala de punto"
        />
        <button
          type="button"
          className="ghost-button"
          onClick={resetCamera}
        >
          Reset
        </button>
        <button type="button" className="ghost-button" onClick={() => void toggleFullscreen()}>
          {isFullscreen ? "Salir pantalla completa" : "Fullscreen"}
        </button>
        <span className="graph-controls-meta">rotX {rotationX.toFixed(0)}° · rotY {rotationY.toFixed(0)}° · zoom {(zoom * 100).toFixed(0)}%</span>
      </div>
      <svg className="vector3d-canvas" viewBox={`0 0 ${viewport.width} ${viewport.height}`} preserveAspectRatio="none" aria-label="Nube vectorial 3D">
        {selectedNodeId !== null
          ? graph.edges
              .filter((edge) => edge.sourceId === selectedNodeId || edge.targetId === selectedNodeId)
              .map((edge) => {
                const from = projectedMap.get(edge.sourceId);
                const to = projectedMap.get(edge.targetId);

                if (!from || !to) {
                  return null;
                }

                return (
                  <line
                    key={`vector3d-edge-${edge.kind}-${edge.sourceId}-${edge.targetId}`}
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    className="graph-edge graph-edge-semantic is-highlighted"
                    style={{ opacity: Math.max(0.2, edge.weight) }}
                  />
                );
              })
          : null}

        {projected.map((point) => (
          <g key={point.node.id}>
            <circle
              cx={point.x}
              cy={point.y}
              r={point.radius}
              className={point.selected ? "vector3d-point is-selected" : point.highlighted ? "vector3d-point is-highlighted" : "vector3d-point is-muted"}
              style={{ fill: pickClusterColor(point.node.cluster) }}
              onClick={(event) => {
                event.stopPropagation();
                onSelectNode(point.node.id);
              }}
            />
            {(point.selected || point.highlighted) && point.radius > 4.5 ? (
              <text x={point.x + point.radius + 4} y={point.y - point.radius - 2} className="vector3d-label">
                {point.node.spanish}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
    </div>
  );
}