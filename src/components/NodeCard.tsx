import React, { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Bot,
  Cpu,
  GitBranch,
  Globe,
  ShieldCheck,
  Sparkles,
  Terminal,
} from 'lucide-react';
import { useNode } from '../hooks/useNode';
import type { Coordinates, NodePort, PortDataType } from '../types';
import { canvasDOMRegistry, NODE_WIDTH } from '../utils/canvasPhysics';
import { canConnect } from '../utils/validation';

export interface ActiveWireState {
  sourceNodeId: string;
  sourcePortId: string;
  sourcePortType: PortDataType;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

export interface HoveredTargetPort {
  nodeId: string;
  portId: string;
  portType: PortDataType;
}

export interface NodeCardProps {
  nodeId: string;
  zoomRef: React.RefObject<number>;
  activeWire: ActiveWireState | null;
  onStartWire: (
    nodeId: string,
    portId: string,
    portType: PortDataType,
    anchorX: number,
    anchorY: number,
    event: React.PointerEvent
  ) => void;
  onCompleteWire: (
    targetNodeId: string,
    targetPortId: string,
    targetPortType: PortDataType
  ) => void;
  onHoverTargetPort: (target: HoveredTargetPort | null) => void;
  onDragActivityChange?: (info: {
    nodeId: string;
    isDragging: boolean;
    liveCoords: Coordinates;
  }) => void;
}

const PORT_TYPE_COLORS: Record<PortDataType, string> = {
  message_payload: '#818cf8',
  tool_call: '#e879f9',
  json_object: '#34d399',
  string: '#38bdf8',
  number: '#fbbf24',
  boolean: '#fb7185',
  any: '#cbd5e1',
};

/**
 * NodeCard component subscribed exclusively to its own slice via `useNode(nodeId)`.
 *
 * Physics & 60 FPS Drag Architecture:
 * - High-frequency `pointermove` updates mutate `translate3d(x, y, 0)` directly on `cardRef.current`
 *   via `canvasDOMRegistry.setTransientDragPosition`, bypassing React state and Zustand completely
 *   during the drag gesture.
 * - Final `(x, y)` coordinates are committed to the global Zustand store ONLY on `pointerup` (`dragEnd`).
 */
export const NodeCard: React.FC<NodeCardProps> = memo(
  ({
    nodeId,
    zoomRef,
    activeWire,
    onStartWire,
    onCompleteWire,
    onHoverTargetPort,
    onDragActivityChange,
  }) => {
    const { node, position, isSelected, commitPosition, select } = useNode(nodeId);

    const cardRef = useRef<HTMLDivElement | null>(null);
    const liveCoordsRef = useRef<Coordinates>(position);
    const renderCountRef = useRef<number>(0);
    renderCountRef.current += 1;

    const [isDragging, setIsDragging] = useState(false);

    // Register node DOM element and port offsets for 60fps imperative edge bezier updates
    useLayoutEffect(() => {
      if (!node) return;
      canvasDOMRegistry.registerNode(nodeId, cardRef.current, position);

      node.ports.inputs.forEach((port, idx) => {
        canvasDOMRegistry.registerPortOffset(nodeId, port.id, 'input', 0, 62 + idx * 32);
      });
      node.ports.outputs.forEach((port, idx) => {
        canvasDOMRegistry.registerPortOffset(
          nodeId,
          port.id,
          'output',
          NODE_WIDTH,
          62 + idx * 32
        );
      });

      return () => {
        canvasDOMRegistry.registerNode(nodeId, null, position);
      };
    }, [nodeId, node?.ports.inputs.length, node?.ports.outputs.length]);

    // Sync committed Zustand store coordinates when updated externally (e.g. preset reset or dragEnd commit)
    useEffect(() => {
      liveCoordsRef.current = position;
      canvasDOMRegistry.syncCommittedNodePosition(nodeId, position);
    }, [nodeId, position.x, position.y]);

    if (!node) {
      return null;
    }

    const handleHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      select();

      const startClientX = e.clientX;
      const startClientY = e.clientY;
      const originX = liveCoordsRef.current.x;
      const originY = liveCoordsRef.current.y;
      let hasMoved = false;

      setIsDragging(true);
      onDragActivityChange?.({
        nodeId,
        isDragging: true,
        liveCoords: { x: originX, y: originY },
      });

      const handleWindowPointerMove = (moveEvent: PointerEvent) => {
        const currentZoom = zoomRef.current || 1;
        const deltaX = (moveEvent.clientX - startClientX) / currentZoom;
        const deltaY = (moveEvent.clientY - startClientY) / currentZoom;

        const nextX = Math.round(originX + deltaX);
        const nextY = Math.round(originY + deltaY);
        hasMoved = true;

        liveCoordsRef.current = { x: nextX, y: nextY };
        // Direct GPU-accelerated inline CSS transform (translate3d) without Zustand store commit
        canvasDOMRegistry.setTransientDragPosition(nodeId, liveCoordsRef.current);
        onDragActivityChange?.({
          nodeId,
          isDragging: true,
          liveCoords: liveCoordsRef.current,
        });
      };

      const handleWindowPointerUp = () => {
        window.removeEventListener('pointermove', handleWindowPointerMove);
        window.removeEventListener('pointerup', handleWindowPointerUp);
        setIsDragging(false);

        const finalCoords = liveCoordsRef.current;
        onDragActivityChange?.({
          nodeId,
          isDragging: false,
          liveCoords: finalCoords,
        });

        // Commit final (x, y) coordinates to global Zustand store ONLY on dragEnd
        if (hasMoved) {
          commitPosition(finalCoords);
        }
      };

      window.addEventListener('pointermove', handleWindowPointerMove);
      window.addEventListener('pointerup', handleWindowPointerUp);
    };

    const handleOutputPortPointerDown = (
      port: NodePort,
      portIndex: number,
      e: React.PointerEvent<HTMLDivElement>
    ) => {
      e.stopPropagation();
      e.preventDefault();
      select();
      const anchor = canvasDOMRegistry.getPortWorldPosition(
        nodeId,
        port.id,
        'output',
        liveCoordsRef.current,
        portIndex
      );
      onStartWire(nodeId, port.id, port.dataType, anchor.x, anchor.y, e);
    };

    const handleInputPortPointerUp = (
      port: NodePort,
      e: React.PointerEvent<HTMLDivElement>
    ) => {
      if (!activeWire) return;
      e.stopPropagation();
      onCompleteWire(nodeId, port.id, port.dataType);
    };

    const nodeTypeClass =
      node.type === 'prompt'
        ? 'node-prompt'
        : node.type === 'tool'
          ? 'node-tool'
          : 'node-router';

    return (
      <div
        ref={cardRef}
        className={`workflow-node ${nodeTypeClass} ${isSelected ? 'is-selected' : ''} ${
          isDragging ? 'is-dragging' : ''
        }`}
        style={{
          transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          select();
        }}
        data-node-id={node.id}
        data-node-type={node.type}
      >
        {/* Drag Handle Header */}
        <div className="node-header" onPointerDown={handleHeaderPointerDown}>
          <div className="node-title-row">
            <div className="node-icon-pill">
              {node.type === 'prompt' && <Sparkles size={14} />}
              {node.type === 'tool' && <Terminal size={14} />}
              {node.type === 'router' && <GitBranch size={14} />}
            </div>
            <span className="node-title-text" title={node.label}>
              {node.label}
            </span>
          </div>
          <div className="node-meta-pills">
            <span
              className="render-counter-pill"
              title="Selector isolation proof: increments ONLY when this specific node's coordinates or data change"
            >
              R:{renderCountRef.current}
            </span>
          </div>
        </div>

        {/* Input & Output Ports Section */}
        <div className="node-ports-section">
          <div className="ports-column inputs">
            {node.ports.inputs.map((port) => {
              const color = PORT_TYPE_COLORS[port.dataType];
              let compatibilityClass = '';
              if (activeWire) {
                const isCompatible = canConnect(
                  activeWire.sourceNodeId,
                  node.id,
                  activeWire.sourcePortType,
                  port.dataType
                );
                compatibilityClass = isCompatible
                  ? 'is-compatible-target'
                  : 'is-incompatible-target';
              }

              return (
                <div key={port.id} className="port-row input">
                  <div
                    className={`port-handle input ${compatibilityClass}`}
                    style={{ borderColor: color, color }}
                    title={`Input Port: ${port.name} (${port.dataType}) — Schema: ${port.schema.title}`}
                    onPointerUp={(e) => handleInputPortPointerUp(port, e)}
                    onPointerEnter={() =>
                      onHoverTargetPort({
                        nodeId: node.id,
                        portId: port.id,
                        portType: port.dataType,
                      })
                    }
                    onPointerLeave={() => onHoverTargetPort(null)}
                    data-port-id={port.id}
                    data-port-direction="input"
                    data-port-type={port.dataType}
                  />
                  <span className="port-label">{port.name}</span>
                  <span className="port-type-tag" style={{ color }}>
                    {port.dataType}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="ports-column outputs">
            {node.ports.outputs.map((port, idx) => {
              const color = PORT_TYPE_COLORS[port.dataType];
              const isSourceActive =
                activeWire?.sourceNodeId === node.id && activeWire?.sourcePortId === port.id;

              return (
                <div key={port.id} className="port-row output">
                  <div
                    className={`port-handle output ${isSourceActive ? 'is-active' : ''}`}
                    style={{ borderColor: color, color }}
                    title={`Drag to connect Output Port: ${port.name} (${port.dataType}) — Schema: ${port.schema.title}`}
                    onPointerDown={(e) => handleOutputPortPointerDown(port, idx, e)}
                    data-port-id={port.id}
                    data-port-direction="output"
                    data-port-type={port.dataType}
                  />
                  <span className="port-label">{port.name}</span>
                  <span className="port-type-tag" style={{ color }}>
                    {port.dataType}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Discriminated Union Type-Safe Body */}
        <div className="node-body">
          {node.type === 'prompt' && (
            <>
              <div className="node-field-row">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Bot size={12} /> Model
                </span>
                <span className="mono-badge">{node.model}</span>
              </div>
              <div className="node-field-row">
                <span>Temperature</span>
                <span className="mono-badge" style={{ color: '#a5b4fc' }}>
                  {node.temperature.toFixed(2)}
                </span>
              </div>
              <div className="node-snippet" title={node.systemPrompt}>
                {node.systemPrompt}
              </div>
            </>
          )}

          {node.type === 'tool' && (
            <>
              <div className="node-field-row">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Globe size={12} /> Endpoint
                </span>
                <span className="mono-badge" style={{ color: '#6ee7b7' }}>
                  {node.httpMethod}
                </span>
              </div>
              <div className="node-snippet" title={node.apiEndpoint}>
                {node.apiEndpoint}
              </div>
              <div className="node-field-row">
                <span>Schema</span>
                <span className="mono-badge">
                  {node.toolSchema.title} ({Object.keys(node.toolSchema.properties ?? {}).length}{' '}
                  props)
                </span>
              </div>
            </>
          )}

          {node.type === 'router' && (
            <>
              <div className="router-guard-banner">
                <ShieldCheck size={13} />
                <span>LOOP EXIT CONDITION GUARD</span>
              </div>
              <div className="node-field-row">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Cpu size={12} /> Max Loops
                </span>
                <span className="mono-badge" style={{ color: '#fcd34d' }}>
                  {node.maxIterations} iterations
                </span>
              </div>
              <div className="node-snippet" title={node.routingCondition}>
                if ({node.routingCondition})
              </div>
            </>
          )}
        </div>
      </div>
    );
  }
);

NodeCard.displayName = 'NodeCard';
