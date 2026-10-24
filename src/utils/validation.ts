import {
  CanvasEdge,
  CanvasNode,
  ConnectionValidationResult,
  JSONSchemaDefinition,
  PortDataType,
  PortSchemaType,
} from '../types';

/**
 * Helper to determine if a PortSchemaType is a full JSONSchemaDefinition object
 * rather than a primitive PortDataType string.
 */
function isJSONSchemaDefinition(schema: PortSchemaType): schema is JSONSchemaDefinition {
  return typeof schema === 'object' && schema !== null && 'type' in schema && 'title' in schema;
}

/**
 * Checks whether an output JSONSchemaDefinition is structurally compatible
 * with a target input JSONSchemaDefinition.
 */
export function areSchemasCompatible(
  sourceSchema: JSONSchemaDefinition,
  targetSchema: JSONSchemaDefinition
): { compatible: boolean; reason: string } {
  if (sourceSchema.type === 'any' || targetSchema.type === 'any') {
    return { compatible: true, reason: 'Wildcard schema accepts any payload' };
  }

  if (sourceSchema.type !== targetSchema.type) {
    return {
      compatible: false,
      reason: `Schema root type mismatch: cannot pipe '${sourceSchema.type}' into '${targetSchema.type}'`,
    };
  }

  // If both are object schemas and target has required properties, verify source provides them
  if (sourceSchema.type === 'object' && targetSchema.type === 'object' && targetSchema.required) {
    const sourceProps = sourceSchema.properties ?? {};
    const targetProps = targetSchema.properties ?? {};

    for (const reqKey of targetSchema.required) {
      if (!(reqKey in sourceProps) && !sourceSchema.additionalProperties) {
        return {
          compatible: false,
          reason: `Missing required property '${reqKey}' expected by '${targetSchema.title}'`,
        };
      }

      const srcProp = sourceProps[reqKey];
      const tgtProp = targetProps[reqKey];
      if (srcProp && tgtProp && srcProp.type !== tgtProp.type) {
        return {
          compatible: false,
          reason: `Property '${reqKey}' type mismatch: '${srcProp.type}' vs expected '${tgtProp.type}'`,
        };
      }
    }
  }

  return { compatible: true, reason: 'JSON Schemas are compatible' };
}

/**
 * Maps a PortSchemaType to a normalized PortDataType for port-level type checking.
 */
function normalizePortType(portType: PortSchemaType): PortDataType {
  if (!isJSONSchemaDefinition(portType)) {
    return portType;
  }
  switch (portType.type) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'object':
    case 'array':
      return 'json_object';
    case 'any':
      return 'any';
  }
}

/**
 * Strictly typed port compatibility checker.
 *
 * Signature matches required `canConnect(sourceNodeId, targetNodeId, sourcePortType, targetPortType)`
 * and optionally accepts `nodesMap` + port IDs when full node schema lookup is desired.
 *
 * Prevents invalid connections (e.g., connecting a `number` or `boolean` output
 * directly into a `tool_call` or `json_object` input, or self-connecting a node).
 */
export function canConnect(
  sourceNodeId: string,
  targetNodeId: string,
  sourcePortType: PortSchemaType,
  targetPortType: PortSchemaType,
  nodesMap?: Record<string, CanvasNode>,
  sourcePortId?: string,
  targetPortId?: string
): boolean {
  // 1. Disallow self-loops
  if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) {
    return false;
  }

  // 2. If full JSONSchemaDefinitions are passed directly, validate both normalized port types and JSON schemas
  if (isJSONSchemaDefinition(sourcePortType) && isJSONSchemaDefinition(targetPortType)) {
    const schemaCheck = areSchemasCompatible(sourcePortType, targetPortType);
    if (!schemaCheck.compatible) {
      return false;
    }
  }

  // 3. Normalize to PortDataType
  const srcType: PortDataType = normalizePortType(sourcePortType);
  const tgtType: PortDataType = normalizePortType(targetPortType);

  // 4. Check PortDataType compatibility matrix
  const isPrimitiveCompatible = checkPortDataTypeCompatibility(srcType, tgtType);
  if (!isPrimitiveCompatible) {
    return false;
  }

  // 5. If nodesMap and port IDs are supplied, also verify the underlying JSONSchemaDefinitions on the ports
  if (nodesMap && sourcePortId && targetPortId) {
    const sourceNode = nodesMap[sourceNodeId];
    const targetNode = nodesMap[targetNodeId];
    if (!sourceNode || !targetNode) {
      return false;
    }

    const srcPort = sourceNode.ports.outputs.find((p) => p.id === sourcePortId);
    const tgtPort = targetNode.ports.inputs.find((p) => p.id === targetPortId);

    if (srcPort && tgtPort) {
      const schemaResult = areSchemasCompatible(srcPort.schema, tgtPort.schema);
      if (!schemaResult.compatible) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Compatibility rules between PortDataTypes:
 * - `'any'` connects with anything
 * - Identical types always connect (`string -> string`, `tool_call -> tool_call`, etc.)
 * - `'message_payload'` (structured LLM output) can feed `'json_object'` or `'tool_call'`
 * - `'json_object'` (e.g. tool response payload) can feed `'message_payload'`
 * - Incompatible primitives like `'number' -> 'tool_call'`, `'boolean' -> 'json_object'`,
 *   `'string' -> 'number'`, `'boolean' -> 'tool_call'` are strictly rejected.
 */
function checkPortDataTypeCompatibility(
  sourceType: PortDataType,
  targetType: PortDataType
): boolean {
  if (sourceType === 'any' || targetType === 'any') {
    return true;
  }

  if (sourceType === targetType) {
    return true;
  }

  // LLM message payload (structured JSON envelope) can invoke a tool_call or pass as json_object
  if (sourceType === 'message_payload' && (targetType === 'json_object' || targetType === 'tool_call')) {
    return true;
  }

  // A structured json_object (such as a tool execution output) can be fed into an LLM message_payload input
  if (sourceType === 'json_object' && targetType === 'message_payload') {
    return true;
  }

  return false;
}

/**
 * Depth-First Search (DFS) cycle detector.
 *
 * Determines if adding a directed edge `sourceNodeId -> targetNodeId` creates a cycle in the graph.
 * Because `sourceNodeId -> targetNodeId` is being proposed, a cycle is formed if and only if
 * there is already a directed path from `targetNodeId` to `sourceNodeId` in the existing graph.
 *
 * Cycle validity rule:
 * - A cycle is ONLY valid if every cycle created by `sourceNodeId -> targetNodeId` contains
 *   at least one `RouterNode` (`node.type === 'router'`), which acts as a conditional loop exit guard.
 * - If any cycle exists without a `RouterNode`, the cycle is flagged as an invalid infinite loop.
 */
export function detectCycleDFS(
  sourceNodeId: string,
  targetNodeId: string,
  nodes: Record<string, CanvasNode>,
  edges: CanvasEdge[]
): {
  hasCycle: boolean;
  hasValidRouterExit: boolean;
  cyclePath: string[];
} {
  if (sourceNodeId === targetNodeId) {
    const isRouter = nodes[sourceNodeId]?.type === 'router';
    return {
      hasCycle: true,
      hasValidRouterExit: isRouter,
      cyclePath: [sourceNodeId, targetNodeId],
    };
  }

  // Build adjacency list from existing edges
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.sourceNodeId);
    if (list) {
      list.push(edge.targetNodeId);
    } else {
      adjacency.set(edge.sourceNodeId, [edge.targetNodeId]);
    }
  }

  const allCyclePaths: string[][] = [];
  const currentPath: string[] = [targetNodeId];
  const onPath = new Set<string>([targetNodeId]);

  function dfs(currentNodeId: string): void {
    if (currentNodeId === sourceNodeId) {
      // Complete cycle: sourceNodeId -> targetNodeId -> ... -> sourceNodeId
      allCyclePaths.push([sourceNodeId, ...currentPath]);
      return;
    }

    const neighbors = adjacency.get(currentNodeId) ?? [];
    for (const nextNodeId of neighbors) {
      if (!onPath.has(nextNodeId)) {
        onPath.add(nextNodeId);
        currentPath.push(nextNodeId);
        dfs(nextNodeId);
        currentPath.pop();
        onPath.delete(nextNodeId);
      }
    }
  }

  dfs(targetNodeId);

  if (allCyclePaths.length === 0) {
    return {
      hasCycle: false,
      hasValidRouterExit: false,
      cyclePath: [],
    };
  }

  // Check if every newly formed cycle contains at least one 'router' node
  let invalidCyclePath: string[] | null = null;
  for (const path of allCyclePaths) {
    const containsRouter = path.some((nodeId) => nodes[nodeId]?.type === 'router');
    if (!containsRouter) {
      invalidCyclePath = path;
      break;
    }
  }

  if (invalidCyclePath !== null) {
    return {
      hasCycle: true,
      hasValidRouterExit: false,
      cyclePath: invalidCyclePath,
    };
  }

  return {
    hasCycle: true,
    hasValidRouterExit: true,
    cyclePath: allCyclePaths[0],
  };
}

/**
 * Full connection validator combining duplicate detection, port type & JSON Schema compatibility,
 * and DFS cycle detection with RouterNode exit guard validation.
 */
export function validateConnection(
  sourceNodeId: string,
  sourcePortId: string,
  sourcePortType: PortDataType,
  targetNodeId: string,
  targetPortId: string,
  targetPortType: PortDataType,
  nodes: Record<string, CanvasNode>,
  edges: CanvasEdge[]
): ConnectionValidationResult {
  // 1. Self-loop check
  if (sourceNodeId === targetNodeId) {
    return {
      valid: false,
      portCompatible: false,
      hasCycle: true,
      hasValidRouterExit: false,
      cyclePath: [sourceNodeId, targetNodeId],
      reason: 'Self-connection is not allowed: a node cannot connect directly to itself.',
      severity: 'self_loop',
    };
  }

  // 2. Duplicate edge check
  const isDuplicate = edges.some(
    (e) =>
      e.sourceNodeId === sourceNodeId &&
      e.sourcePortId === sourcePortId &&
      e.targetNodeId === targetNodeId &&
      e.targetPortId === targetPortId
  );

  if (isDuplicate) {
    return {
      valid: false,
      portCompatible: true,
      hasCycle: false,
      hasValidRouterExit: false,
      cyclePath: [],
      reason: 'Connection already exists between these exact ports.',
      severity: 'duplicate',
    };
  }

  // 3. Port & JSON Schema compatibility check via `canConnect`
  const portCompatible = canConnect(
    sourceNodeId,
    targetNodeId,
    sourcePortType,
    targetPortType,
    nodes,
    sourcePortId,
    targetPortId
  );

  if (!portCompatible) {
    const sourceNode = nodes[sourceNodeId];
    const targetNode = nodes[targetNodeId];
    const srcPort = sourceNode?.ports.outputs.find((p) => p.id === sourcePortId);
    const tgtPort = targetNode?.ports.inputs.find((p) => p.id === targetPortId);

    let detailReason = `Incompatible port types: cannot connect output '${sourcePortType}' to input '${targetPortType}'.`;
    if (srcPort && tgtPort) {
      const schemaComparison = areSchemasCompatible(srcPort.schema, tgtPort.schema);
      if (!schemaComparison.compatible) {
        detailReason = `Port & Schema Mismatch (${srcPort.name} -> ${tgtPort.name}): ${schemaComparison.reason}`;
      }
    }

    return {
      valid: false,
      portCompatible: false,
      hasCycle: false,
      hasValidRouterExit: false,
      cyclePath: [],
      reason: detailReason,
      severity: 'port_mismatch',
    };
  }

  // 4. DFS Cycle detection
  const cycleResult = detectCycleDFS(sourceNodeId, targetNodeId, nodes, edges);

  if (cycleResult.hasCycle && !cycleResult.hasValidRouterExit) {
    const readablePath = cycleResult.cyclePath
      .map((id) => nodes[id]?.label ?? id)
      .join(' → ');
    return {
      valid: false,
      portCompatible: true,
      hasCycle: true,
      hasValidRouterExit: false,
      cyclePath: cycleResult.cyclePath,
      reason: `Unbounded cycle detected (${readablePath}). Cycles must include at least one RouterNode to provide a conditional loop exit.`,
      severity: 'invalid_cycle',
    };
  }

  if (cycleResult.hasCycle && cycleResult.hasValidRouterExit) {
    const readablePath = cycleResult.cyclePath
      .map((id) => nodes[id]?.label ?? id)
      .join(' → ');
    return {
      valid: true,
      portCompatible: true,
      hasCycle: true,
      hasValidRouterExit: true,
      cyclePath: cycleResult.cyclePath,
      reason: `Valid agentic loop created (${readablePath}) guarded by a RouterNode exit condition.`,
      severity: 'loop_valid',
    };
  }

  return {
    valid: true,
    portCompatible: true,
    hasCycle: false,
    hasValidRouterExit: false,
    cyclePath: [],
    reason: 'Connection is valid.',
    severity: 'ok',
  };
}
