import type { Coordinates, ViewportState } from '../types';

export const MIN_ZOOM = 0.35;
export const MAX_ZOOM = 2.25;
export const NODE_WIDTH = 290;

/**
 * Clamps zoom level within safe bounds.
 */
export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(zoom.toFixed(3))));
}

/**
 * Converts client (screen) pointer coordinates into canvas world coordinates,
 * accounting for the canvas container offset and viewport pan/zoom.
 */
export function screenToCanvas(
  clientX: number,
  clientY: number,
  canvasRect: DOMRect,
  viewport: ViewportState
): Coordinates {
  const x = (clientX - canvasRect.left - viewport.x) / viewport.zoom;
  const y = (clientY - canvasRect.top - viewport.y) / viewport.zoom;
  return {
    x: Math.round(x),
    y: Math.round(y),
  };
}

/**
 * Computes a smooth horizontal cubic bezier SVG path between a source output port
 * and a target input port, plus the midpoint coordinates for the edge badge.
 */
export function computeEdgeBezier(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  isLoopEdge = false
): {
  path: string;
  midX: number;
  midY: number;
} {
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;

  // If this edge is a backward feedback loop (or target is to the left of source),
  // route a clean arch so the feedback loop is visually distinct and readable.
  if (isLoopEdge || dx < -40) {
    const loopOffset = Math.max(110, Math.min(220, Math.abs(dx) * 0.35));
    const verticalLift = dy >= 0 ? -130 : 130;
    const c1x = sourceX + loopOffset;
    const c1y = sourceY + verticalLift;
    const c2x = targetX - loopOffset;
    const c2y = targetY + verticalLift;

    const midX = 0.125 * sourceX + 0.375 * c1x + 0.375 * c2x + 0.125 * targetX;
    const midY = 0.125 * sourceY + 0.375 * c1y + 0.375 * c2y + 0.125 * targetY;

    return {
      path: `M ${sourceX} ${sourceY} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${targetX} ${targetY}`,
      midX,
      midY,
    };
  }

  const curvature = Math.max(70, Math.min(200, Math.abs(dx) * 0.48));
  const c1x = sourceX + curvature;
  const c1y = sourceY;
  const c2x = targetX - curvature;
  const c2y = targetY;

  const midX = (sourceX + targetX) / 2;
  const midY = (sourceY + targetY) / 2;

  return {
    path: `M ${sourceX} ${sourceY} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${targetX} ${targetY}`,
    midX,
    midY,
  };
}

/**
 * Imperative DOM registry for 60 FPS transient drag rendering without triggering
 * React state updates or Zustand store re-renders during pointermove.
 */
interface RegisteredPortAnchor {
  nodeId: string;
  portId: string;
  direction: 'input' | 'output';
  offsetX: number;
  offsetY: number;
}

interface RegisteredEdgeElements {
  edgeId: string;
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
  isLoopEdge: boolean;
  mainPathEl: SVGPathElement | null;
  glowPathEl: SVGPathElement | null;
  flowPathEl: SVGPathElement | null;
  badgeGroupEl: SVGGElement | null;
}

class ImperativeCanvasDOMRegistry {
  private nodeElements = new Map<string, HTMLElement>();
  private livePositions = new Map<string, Coordinates>();
  private portOffsets = new Map<string, RegisteredPortAnchor>();
  private edgeElements = new Map<string, RegisteredEdgeElements>();

  public registerNode(nodeId: string, element: HTMLElement | null, initialPosition: Coordinates): void {
    if (!element) {
      this.nodeElements.delete(nodeId);
      return;
    }
    this.nodeElements.set(nodeId, element);
    this.livePositions.set(nodeId, initialPosition);
    element.style.transform = `translate3d(${initialPosition.x}px, ${initialPosition.y}px, 0)`;
  }

  public syncCommittedNodePosition(nodeId: string, position: Coordinates): void {
    this.livePositions.set(nodeId, position);
    const el = this.nodeElements.get(nodeId);
    if (el) {
      el.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
    }
    this.refreshConnectedEdges(nodeId);
  }

  public registerPortOffset(
    nodeId: string,
    portId: string,
    direction: 'input' | 'output',
    offsetX: number,
    offsetY: number
  ): void {
    const key = `${nodeId}:${direction}:${portId}`;
    this.portOffsets.set(key, {
      nodeId,
      portId,
      direction,
      offsetX,
      offsetY,
    });
  }

  public getPortWorldPosition(
    nodeId: string,
    portId: string,
    direction: 'input' | 'output',
    fallbackNodePos?: Coordinates,
    portIndex = 0
  ): Coordinates {
    const nodePos = this.livePositions.get(nodeId) ?? fallbackNodePos ?? { x: 0, y: 0 };
    const key = `${nodeId}:${direction}:${portId}`;
    const registered = this.portOffsets.get(key);

    if (registered) {
      return {
        x: nodePos.x + registered.offsetX,
        y: nodePos.y + registered.offsetY,
      };
    }

    // Fallback deterministic port coordinates relative to node card top-left
    const defaultOffsetX = direction === 'output' ? NODE_WIDTH : 0;
    const defaultOffsetY = 92 + portIndex * 38;
    return {
      x: nodePos.x + defaultOffsetX,
      y: nodePos.y + defaultOffsetY,
    };
  }

  public registerEdge(config: RegisteredEdgeElements): void {
    this.edgeElements.set(config.edgeId, config);
  }

  public unregisterEdge(edgeId: string): void {
    this.edgeElements.delete(edgeId);
  }

  /**
   * High-frequency 60 FPS update called during pointermove.
   * Mutates only inline CSS `translate3d(x, y, 0)` on the node ref and connected SVG `<path>`
   * attributes — zero React re-renders and zero Zustand store commits until `dragEnd`.
   */
  public setTransientDragPosition(nodeId: string, position: Coordinates): void {
    this.livePositions.set(nodeId, position);
    const nodeEl = this.nodeElements.get(nodeId);
    if (nodeEl) {
      nodeEl.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
    }
    this.refreshConnectedEdges(nodeId);
  }

  public refreshConnectedEdges(nodeId: string): void {
    for (const edge of this.edgeElements.values()) {
      if (edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId) {
        continue;
      }
      const sourceCoords = this.getPortWorldPosition(edge.sourceNodeId, edge.sourcePortId, 'output');
      const targetCoords = this.getPortWorldPosition(edge.targetNodeId, edge.targetPortId, 'input');
      const { path, midX, midY } = computeEdgeBezier(
        sourceCoords.x,
        sourceCoords.y,
        targetCoords.x,
        targetCoords.y,
        edge.isLoopEdge
      );

      if (edge.mainPathEl) {
        edge.mainPathEl.setAttribute('d', path);
      }
      if (edge.glowPathEl) {
        edge.glowPathEl.setAttribute('d', path);
      }
      if (edge.flowPathEl) {
        edge.flowPathEl.setAttribute('d', path);
      }
      if (edge.badgeGroupEl) {
        edge.badgeGroupEl.setAttribute('transform', `translate(${midX}, ${midY})`);
      }
    }
  }
}

export const canvasDOMRegistry = new ImperativeCanvasDOMRegistry();
