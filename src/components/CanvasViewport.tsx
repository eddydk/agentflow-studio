import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Info,
  Maximize2,
  X,
   XCircle,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useWorkflowStore } from '../store/useWorkflowStore';
import type { Coordinates, PortDataType } from '../types';
import { clampZoom, screenToCanvas } from '../utils/canvasPhysics';
import { EdgeLayer } from './EdgeLayer';
import {
  type ActiveWireState,
  type HoveredTargetPort,
  NodeCard,
} from './NodeCard';

export const CanvasViewport: React.FC = () => {
  const {
    nodeIds,
    viewport,
    alerts,
    setViewport,
    selectNode,
    tryConnect,
    dismissAlert,
  } = useWorkflowStore(
    useShallow((state) => ({
      nodeIds: state.nodeIds,
      viewport: state.viewport,
      alerts: state.alerts,
      setViewport: state.setViewport,
      selectNode: state.selectNode,
      tryConnect: state.tryConnect,
      dismissAlert: state.dismissAlert,
    }))
  );

  const viewportContainerRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef<number>(viewport.zoom);
  zoomRef.current = viewport.zoom;

  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  const [isPanning, setIsPanning] = useState(false);
  const [activeWire, setActiveWire] = useState<ActiveWireState | null>(null);
  const [hoveredTargetPort, setHoveredTargetPort] =
    useState<HoveredTargetPort | null>(null);

  const [dragTelemetry, setDragTelemetry] = useState<{
    nodeId: string;
    isDragging: boolean;
    liveCoords: Coordinates;
    commitsCount: number;
  }>({
    nodeId: 'none',
    isDragging: false,
    liveCoords: { x: 0, y: 0 },
    commitsCount: 0,
  });

  // Handle wheel zoom centered on pointer position
  useEffect(() => {
    const el = viewportContainerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const currentVp = viewportRef.current;

      const zoomFactor = e.deltaY < 0 ? 1.09 : 0.91;
      const nextZoom = clampZoom(currentVp.zoom * zoomFactor);
      if (nextZoom === currentVp.zoom) return;

      const pointerX = e.clientX - rect.left;
      const pointerY = e.clientY - rect.top;

      const worldX = (pointerX - currentVp.x) / currentVp.zoom;
      const worldY = (pointerY - currentVp.y) / currentVp.zoom;

      const nextX = Math.round(pointerX - worldX * nextZoom);
      const nextY = Math.round(pointerY - worldY * nextZoom);

      setViewport({ x: nextX, y: nextY, zoom: nextZoom });
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
    };
  }, [setViewport]);

  // Background canvas panning
  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    selectNode(null);
    setIsPanning(true);

    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const originX = viewportRef.current.x;
    const originY = viewportRef.current.y;

    const handleWindowPointerMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startClientX;
      const dy = moveEvent.clientY - startClientY;
      setViewport((prev) => ({
        ...prev,
        x: Math.round(originX + dx),
        y: Math.round(originY + dy),
      }));
    };

    const handleWindowPointerUp = () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerUp);
      setIsPanning(false);
    };

    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('pointerup', handleWindowPointerUp);
  };

  // Start dragging a wire from an output port
  const handleStartWire = useCallback(
    (
      sourceNodeId: string,
      sourcePortId: string,
      sourcePortType: PortDataType,
      anchorX: number,
      anchorY: number,
      event: React.PointerEvent
    ) => {
      const container = viewportContainerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const initialCursor = screenToCanvas(
        event.clientX,
        event.clientY,
        rect,
        viewportRef.current
      );

      setActiveWire({
        sourceNodeId,
        sourcePortId,
        sourcePortType,
        startX: anchorX,
        startY: anchorY,
        currentX: initialCursor.x,
        currentY: initialCursor.y,
      });

      const handleWirePointerMove = (moveEvt: PointerEvent) => {
        const currentRect = container.getBoundingClientRect();
        const pt = screenToCanvas(
          moveEvt.clientX,
          moveEvt.clientY,
          currentRect,
          viewportRef.current
        );
        setActiveWire((prev) =>
          prev
            ? {
                ...prev,
                currentX: pt.x,
                currentY: pt.y,
              }
            : null
        );
      };

      const handleWirePointerUp = () => {
        window.removeEventListener('pointermove', handleWirePointerMove);
        window.removeEventListener('pointerup', handleWirePointerUp);
        setActiveWire(null);
        setHoveredTargetPort(null);
      };

      window.addEventListener('pointermove', handleWirePointerMove);
      window.addEventListener('pointerup', handleWirePointerUp);
    },
    []
  );

  // Complete wire drop onto a target input port
  const handleCompleteWire = useCallback(
    (targetNodeId: string, targetPortId: string, targetPortType: PortDataType) => {
      setActiveWire((currentWire) => {
        if (currentWire) {
          tryConnect(
            currentWire.sourceNodeId,
            currentWire.sourcePortId,
            currentWire.sourcePortType,
            targetNodeId,
            targetPortId,
            targetPortType
          );
        }
        return null;
      });
      setHoveredTargetPort(null);
    },
    [tryConnect]
  );

  const handleDragActivityChange = useCallback(
    (info: { nodeId: string; isDragging: boolean; liveCoords: Coordinates }) => {
      setDragTelemetry((prev) => ({
        nodeId: info.nodeId,
        isDragging: info.isDragging,
        liveCoords: info.liveCoords,
        commitsCount: !info.isDragging && prev.isDragging ? prev.commitsCount + 1 : prev.commitsCount,
      }));
    },
    []
  );

  const gridSpacing = Math.max(12, Math.round(24 * viewport.zoom));

  return (
    <div
      ref={viewportContainerRef}
      className={`canvas-viewport ${isPanning ? 'is-panning' : ''} ${
        activeWire ? 'is-connecting' : ''
      }`}
      onPointerDown={handleCanvasPointerDown}
    >
      {/* Zoom- and Pan-Reactive Dot Grid Backdrop */}
      <div
        className="canvas-grid-backdrop"
        style={{
          backgroundSize: `${gridSpacing}px ${gridSpacing}px`,
          backgroundPosition: `${viewport.x}px ${viewport.y}px`,
        }}
      />

      {/* Validation & DFS Cycle Alert Banner Stack */}
      {alerts.length > 0 && (
        <div
          className="validation-alerts-stack"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {alerts.slice(0, 3).map((alert) => (
            <div
              key={alert.id}
              className={`validation-alert-card ${alert.severity}`}
              data-alert-severity={alert.severity}
            >
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ marginTop: 2, flexShrink: 0 }}>
                  {alert.severity === 'error' && <XCircle size={16} />}
                  {alert.severity === 'warning' && <AlertTriangle size={16} />}
                  {alert.severity === 'success' && <CheckCircle2 size={16} />}
                  {alert.severity === 'info' && <Info size={16} />}
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 2 }}>
                    {alert.title}
                  </div>
                  <div style={{ fontSize: 11.5, opacity: 0.92, lineHeight: 1.4 }}>
                    {alert.message}
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="btn"
                style={{ padding: '3px 5px', background: 'transparent', border: 'none' }}
                onClick={() => dismissAlert(alert.id)}
                title="Dismiss alert"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Hardware-Accelerated Viewport Transform Plane */}
      <div
        className="canvas-transform-layer"
        style={{
          transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.zoom})`,
        }}
      >
        <EdgeLayer
          activeWire={activeWire}
          hoveredTargetPort={hoveredTargetPort}
        />

        {nodeIds.map((id) => (
          <NodeCard
            key={id}
            nodeId={id}
            zoomRef={zoomRef}
            activeWire={activeWire}
            onStartWire={handleStartWire}
            onCompleteWire={handleCompleteWire}
            onHoverTargetPort={setHoveredTargetPort}
            onDragActivityChange={handleDragActivityChange}
          />
        ))}
      </div>

      {/* Bottom Physics Telemetry & Viewport Controls HUD */}
      <div
        className="canvas-hud-bottom"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="hud-pill-bar">
          <span className="status-dot" />
          <div className="hud-metric">
            <Activity size={13} />
            <span>Physics:</span>
            <strong>translate3d (60 FPS Ref)</strong>
          </div>
          <div className="divider-v" />
          <div className="hud-metric">
            <span>Store Commits (dragEnd):</span>
            <strong>{dragTelemetry.commitsCount}</strong>
          </div>
          <div className="divider-v" />
          <div className="hud-metric">
            <span>Status:</span>
            <strong
              style={{
                color: dragTelemetry.isDragging ? '#fbbf24' : '#34d399',
              }}
            >
              {dragTelemetry.isDragging
                ? `DRAGGING ${dragTelemetry.nodeId} (${dragTelemetry.liveCoords.x}, ${dragTelemetry.liveCoords.y})`
                : 'COMMITTED / IDLE'}
            </strong>
          </div>
        </div>

        <div className="hud-pill-bar">
          <button
            type="button"
            className="btn"
            onClick={() =>
              setViewport((prev) => ({
                ...prev,
                zoom: clampZoom(prev.zoom - 0.12),
              }))
            }
            title="Zoom Out"
          >
            <ZoomOut size={13} />
          </button>
          <span
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 11.5,
              minWidth: 46,
              textAlign: 'center',
            }}
          >
            {Math.round(viewport.zoom * 100)}%
          </span>
          <button
            type="button"
            className="btn"
            onClick={() =>
              setViewport((prev) => ({
                ...prev,
                zoom: clampZoom(prev.zoom + 0.12),
              }))
            }
            title="Zoom In"
          >
            <ZoomIn size={13} />
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setViewport({ x: 40, y: 40, zoom: 0.92 })}
            title="Reset Viewport"
          >
            <Maximize2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
};
