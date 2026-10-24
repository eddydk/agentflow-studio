import { useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { NodeDataPatch, useWorkflowStore } from '../store/useWorkflowStore';
import { CanvasNode, Coordinates } from '../types';

export interface UseNodeResult {
  node: CanvasNode | undefined;
  position: Coordinates;
  isSelected: boolean;
  commitPosition: (position: Coordinates) => void;
  updateData: (patch: NodeDataPatch) => void;
  select: () => void;
}

const DEFAULT_COORDINATES: Coordinates = { x: 0, y: 0 };

/**
 * Custom selector hook `useNode(nodeId)` powered by Zustand `useShallow`.
 *
 * Performance Architecture:
 * - Subscribes exclusively to `state.nodes[nodeId]` and `state.positions[nodeId]`.
 * - Updating another node's position or data in the store will NOT trigger a re-render
 *   in this component because `state.nodes[nodeId]` and `state.positions[nodeId]`
 *   remain referentially identical.
 */
export function useNode(nodeId: string): UseNodeResult {
  const { node, position, commitNodePosition, updateNodeData, selectNode } =
    useWorkflowStore(
      useShallow((state) => ({
        node: state.nodes[nodeId],
        position: state.positions[nodeId] ?? DEFAULT_COORDINATES,
        commitNodePosition: state.commitNodePosition,
        updateNodeData: state.updateNodeData,
        selectNode: state.selectNode,
      }))
    );

  const commitPosition = useCallback(
    (nextPos: Coordinates) => {
      commitNodePosition(nodeId, nextPos);
    },
    [commitNodePosition, nodeId]
  );

  const updateData = useCallback(
    (patch: NodeDataPatch) => {
      updateNodeData(nodeId, patch);
    },
    [updateNodeData, nodeId]
  );

  const select = useCallback(() => {
    selectNode(nodeId);
  }, [selectNode, nodeId]);

  return {
    node,
    position,
    isSelected: Boolean(node?.selected),
    commitPosition,
    updateData,
    select,
  };
}
