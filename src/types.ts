/**
 * JSON Schema primitive & structural types for port compatibility validation.
 */
export type PortDataType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'json_object'
  | 'message_payload'
  | 'tool_call'
  | 'any';

export interface JSONSchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  required?: boolean;
}

export interface JSONSchemaDefinition {
  $schema?: string;
  title: string;
  type: 'object' | 'string' | 'number' | 'boolean' | 'array' | 'any';
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

/**
 * Port representation on a CanvasNode.
 * Can be passed either as a PortDataType or full PortSchemaDescriptor to `canConnect`.
 */
export type PortSchemaType = PortDataType | JSONSchemaDefinition;

export interface NodePort {
  id: string;
  name: string;
  direction: 'input' | 'output';
  dataType: PortDataType;
  schema: JSONSchemaDefinition;
}

export interface Coordinates {
  x: number;
  y: number;
}

/**
 * Shared base structure required by all workflow nodes.
 */
export interface BaseNode {
  id: string;
  position: Coordinates;
  selected: boolean;
  label: string;
  ports: {
    inputs: NodePort[];
    outputs: NodePort[];
  };
}

/**
 * 1. PromptNode — LLM / System Prompt execution agent node.
 * Requires `systemPrompt` and `temperature`.
 */
export interface PromptNode extends BaseNode {
  type: 'prompt';
  systemPrompt: string;
  temperature: number;
  model: 'gemini-2.5-pro' | 'gemini-2.5-flash' | 'claude-3-7-sonnet' | 'gpt-4o';
  maxTokens: number;
}

/**
 * 2. ToolNode — External API / Function Calling tool node.
 * Requires `toolSchema` and `apiEndpoint`.
 */
export interface ToolNode extends BaseNode {
  type: 'tool';
  toolSchema: JSONSchemaDefinition;
  apiEndpoint: string;
  httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE';
  timeoutMs: number;
}

/**
 * 3. RouterNode — Conditional branching & loop exit guard node.
 * Represents an exit condition that makes cycles valid in the workflow graph.
 */
export interface RouterNode extends BaseNode {
  type: 'router';
  routingCondition: string;
  maxIterations: number;
  fallbackRoute: string;
  routes: Array<{
    id: string;
    label: string;
    expression: string;
  }>;
}

/**
 * Discriminated Union of all Canvas Nodes.
 */
export type CanvasNode = PromptNode | ToolNode | RouterNode;

export type NodeKind = CanvasNode['type'];

/**
 * Directed Edge connecting a source node output port to a target node input port.
 */
export interface CanvasEdge {
  id: string;
  sourceNodeId: string;
  sourcePortId: string;
  sourcePortType: PortDataType;
  targetNodeId: string;
  targetPortId: string;
  targetPortType: PortDataType;
  isLoopEdge?: boolean;
  label?: string;
}

/**
 * Viewport transformation state for pan and zoom.
 */
export interface ViewportState {
  x: number;
  y: number;
  zoom: number;
}

/**
 * Result of DFS cycle and port validation when attempting to connect two nodes.
 */
export interface ConnectionValidationResult {
  valid: boolean;
  portCompatible: boolean;
  hasCycle: boolean;
  hasValidRouterExit: boolean;
  cyclePath: string[];
  reason: string;
  severity: 'ok' | 'loop_valid' | 'port_mismatch' | 'invalid_cycle' | 'self_loop' | 'duplicate';
}

/**
 * Validation alert displayed to the user when an invalid connection or cycle is detected.
 */
export interface ValidationAlert {
  id: string;
  timestamp: number;
  title: string;
  message: string;
  severity: 'error' | 'warning' | 'success' | 'info';
  cyclePath?: string[];
}
