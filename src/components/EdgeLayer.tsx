import React, { useLayoutEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useWorkflowStore } from '../store/useWorkflowStore';
import type { CanvasEdge, Coordinates, PortDataType } from '../types';
import { canvasDOMRegistry, computeEdgeBezier } from '../utils/canvasPhysics';
import type { ActiveWireState, HoveredTargetPort } from './NodeCard';
import { validateConnection } from '../utils/validation';

const EDGE_PORT_COLORS: Record<PortDataType, string> = {
  message_payload: '#818cf8',
  tool_call: '#e879f9',
  json_object: '#34d399',
  string: '#38bdf8',
  number: '#fbbf24',
  boolean: '#fb7185',
  any: '#cbd5e1',
};

interface SingleEdgeItemProps {
  edge: CanvasEdge;
  sourcePos: Coordinates;
  targetPos: Coordinates;
  sourcePortIndex: number;
  targetPortIndex: number;
  onRemoveEdge: (edgeId: string) => void;
}

const SingleEdgeItem: React.FC<SingleEdgeItemProps> = React.memo(
  ({ edge, sourcePos, targetPos, sourcePortIndex, targetPortIndex, onRemoveEdge }) => {
    const mainPathRef = useRef<SVGPathElement | null>(null);
    const glowPathRef = useRef<SVGPathElement | null>(null);
    const flowPathRef = useRef<SVGPathElement | null>(null);
    const badgeGroupRef = useRef<SVGGElement | null>(null);

    const sourceAnchor = canvasDOMRegistry.getPortWorldPosition(
      edge.sourceNodeId,
      edge.sourcePortId,
      'output',
      sourcePos,
      sourcePortIndex
    );
    const targetAnchor = canvasDOMRegistry.getPortWorldPosition(
      edge.targetNodeId,
      edge.targetPortId,
      'input',
      targetPos,
      targetPortIndex
    );

    const { path, midX, midY } = computeEdgeBezier(
      sourceAnchor.x,
      sourceAnchor.y,
      targetAnchor.x,
      targetAnchor.y,
      Boolean(edge.isLoopEdge)
    );

    useLayoutEffect(() => {
      canvasDOMRegistry.registerEdge({
        edgeId: edge.id,
        sourceNodeId: edge.sourceNodeId,
        sourcePortId: edge.sourcePortId,
        targetNodeId: edge.targetNodeId,
        targetPortId: edge.targetPortId,
        isLoopEdge: Boolean(edge.isLoopEdge),
        mainPathEl: mainPathRef.current,
        glowPathEl: glowPathRef.current,
        flowPathEl: flowPathRef.current,
        badgeGroupEl: badgeGroupRef.current,
      });

      return () => {
        canvasDOMRegistry.unregisterEdge(edge.id);
      };
    }, [
      edge.id,
      edge.sourceNodeId,
      edge.sourcePortId,
      edge.targetNodeId,
      edge.targetPortId,
      edge.isLoopEdge,
    ]);

    const strokeColor = edge.isLoopEdge
      ? '#fbbf24'
      : EDGE_PORT_COLORS[edge.sourcePortType] ?? '#818cf8';

    return (
      <g className="edge-group" data-edge-id={edge.id}>
        {/* Invisible wide stroke for easy click-to-delete */}
        <path
          d={path}
          className="edge-hit-area"
          onClick={(e) => {
            e.stopPropagation();
            onRemoveEdge(edge.id);
          }}
        >
          <title>Click to remove connection ({edge.sourcePortType} → {edge.targetPortType})</title>
        </path>

        {/* Ambient outer glow */}
        <path
          ref={glowPathRef}
          d={path}
          className="edge-glow-path"
          stroke={strokeColor}
        />

        {/* Base bezier line */}
        <path
          ref={mainPathRef}
          d={path}
          className="edge-main-path"
          stroke={strokeColor}
          strokeOpacity={0.75}
        />

        {/* Animated data-flow pulse overlay */}
        <path
          ref={flowPathRef}
          d={path}
          className="edge-flow-overlay"
          stroke={strokeColor}
        />

        {/* Midpoint pill badge showing Port Type or Router-Guarded Loop */}
        <g
          ref={badgeGroupRef}
          className="edge-badge-group"
          transform={`translate(${midX}, ${midY})`}
          onClick={(e) => {
            e.stopPropagation();
            onRemoveEdge(edge.id);
          }}
        >
          <rect
            x={edge.isLoopEdge ? -68 : -48}
            y={-10}
            width={edge.isLoopEdge ? 136 : 96}
            height={20}
            rx={6}
            fill="#0b101e"
            stroke={strokeColor}
            strokeWidth={1.2}
          />
          <text
            x={0}
            y={3.5}
            textAnchor="middle"
            fill={edge.isLoopEdge ? '#fde68a' : '#e2e8f0'}
            fontSize={9.5}
            fontFamily="JetBrains Mono, monospace"
            fontWeight={600}
          >
            {edge.isLoopEdge ? '↻ ROUTER LOOP' : `${edge.sourcePortType} ×`}
          </text>
        </g>
      </g>
    );
  }
);

SingleEdgeItem.displayName = 'SingleEdgeItem';

interface EdgeLayerProps {
  activeWire: ActiveWireState | null;
  hoveredTargetPort: HoveredTargetPort | null;
}

export const EdgeLayer: React.FC<EdgeLayerProps> = ({ activeWire, hoveredTargetPort }) => {
  const { edges, positions, nodes, removeEdge } = useWorkflowStore(
    useShallow((state) => ({
      edges: state.edges,
      positions: state.positions,
      nodes: state.nodes,
      removeEdge: state.removeEdge,
    }))
  );

  // Live preview wire validation when hovering over a target port
  let previewColor = '#818cf8';
  let previewLabel = activeWire ? `Dragging ${activeWire.sourcePortType}...` : '';

  if (activeWire && hoveredTargetPort) {
    const check = validateConnection(
      activeWire.sourceNodeId,
      activeWire.sourcePortId,
      activeWire.sourcePortType,
      hoveredTargetPort.nodeId,
      hoveredTargetPort.portId,
      hoveredTargetPort.portType,
      nodes,
      edges
    );

    if (!check.valid) {
      previewColor = '#f43f5e';
      previewLabel =
        check.severity === 'invalid_cycle'
          ? '✗ Invalid Cycle (Missing RouterNode)'
          : check.severity === 'port_mismatch'
            ? `✗ Incompatible (${activeWire.sourcePortType} → ${hoveredTargetPort.portType})`
            : '✗ Invalid Connection';
    } else if (check.hasCycle && check.hasValidRouterExit) {
      previewColor = '#fbbf24';
      previewLabel = '✓ Valid Loop (Guarded by RouterNode)';
    } else {
      previewColor = '#10b981';
      previewLabel = `✓ Compatible (${activeWire.sourcePortType} → ${hoveredTargetPort.portType})`;
    }
  }

  const activeWireBezier = activeWire
    ? computeEdgeBezier(
        activeWire.startX,
        activeWire.startY,
        activeWire.currentX,
        activeWire.currentY,
        false
      )
    : null;

  return (
    <svg className="canvas-edges-svg">
      {edges.map((edge) => {
        const srcNode = nodes[edge.sourceNodeId];
        const tgtNode = nodes[edge.targetNodeId];
        if (!srcNode || !tgtNode) return null;

        const sourcePos = positions[edge.sourceNodeId] ?? srcNode.position;
        const targetPos = positions[edge.targetNodeId] ?? tgtNode.position;

        const srcPortIdx = Math.max(
          0,
          srcNode.ports.outputs.findIndex((p) => p.id === edge.sourcePortId)
        );
        const tgtPortIdx = Math.max(
          0,
          tgtNode.ports.inputs.findIndex((p) => p.id === edge.targetPortId)
        );

        return (
          <SingleEdgeItem
            key={edge.id}
            edge={edge}
            sourcePos={sourcePos}
            targetPos={targetPos}
            sourcePortIndex={srcPortIdx}
            targetPortIndex={tgtPortIdx}
            onRemoveEdge={removeEdge}
          />
        );
      })}

      {/* Live interactive connection wire while dragging from an output port */}
      {activeWire && activeWireBezier && (
        <g pointerEvents="none">
          <path
            d={activeWireBezier.path}
            fill="none"
            stroke={previewColor}
            strokeWidth={6}
            strokeOpacity={0.22}
          />
          <path
            d={activeWireBezier.path}
            fill="none"
            stroke={previewColor}
            strokeWidth={2.5}
            strokeDasharray="6 5"
          />
          <circle
            cx={activeWire.currentX}
            cy={activeWire.currentY}
            r={5}
            fill={previewColor}
          />
          <g transform={`translate(${activeWireBezier.midX}, ${activeWireBezier.midY - 16})`}>
            <rect
              x={-125}
              y={-12}
              width={250}
              height={22}
              rx={6}
              fill="rgba(9, 13, 24, 0.94)"
              stroke={previewColor}
              strokeWidth={1.2}
            />
            <text
              x={0}
              y={3}
              textAnchor="middle"
              fill="#f8fafc"
              fontSize={10}
              fontFamily="JetBrains Mono, monospace"
              fontWeight={600}
            >
              {previewLabel}
            </text>
          </g>
        </g>
      )}
    </svg>
  );
};
