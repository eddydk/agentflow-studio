import { create } from 'zustand';
import {
  CanvasEdge,
  CanvasNode,
  ConnectionValidationResult,
  Coordinates,
  NodeKind,
  PortDataType,
  PromptNode,
  RouterNode,
  ToolNode,
  ValidationAlert,
  ViewportState,
} from '../types';
import { detectCycleDFS, validateConnection } from '../utils/validation';

/**
 * Initial 5-node agentic workflow demonstrating:
 * - PromptNode (`prompt-planner`, `prompt-reasoner`)
 * - ToolNode (`tool-search`, `tool-executor`)
 * - RouterNode (`router-guard`)
 * - Multiple port types (`message_payload`, `tool_call`, `json_object`, `number`, `boolean`, `string`)
 *   so users can immediately test valid connections, incompatible port rejections,
 *   unguarded cycle rejections, and Router-guarded loop connections.
 */
function createInitialNodes(): Record<string, CanvasNode> {
  const planner: PromptNode = {
    id: 'prompt-planner',
    type: 'prompt',
    label: 'Planner Agent',
    position: { x: 80, y: 140 },
    selected: true,
    model: 'gemini-2.5-pro',
    temperature: 0.2,
    maxTokens: 4096,
    systemPrompt:
      'You are an orchestrator planner. Decompose the user objective into structured tool queries and reasoning steps.',
    ports: {
      inputs: [
        {
          id: 'planner-in-context',
          name: 'context_in',
          direction: 'input',
          dataType: 'message_payload',
          schema: {
            title: 'AgentContextEnvelope',
            type: 'object',
            properties: {
              role: { type: 'string', description: 'Sender role' },
              content: { type: 'string', description: 'Message content' },
            },
            required: ['content'],
            additionalProperties: true,
          },
        },
      ],
      outputs: [
        {
          id: 'planner-out-tool',
          name: 'tool_invocation',
          direction: 'output',
          dataType: 'tool_call',
          schema: {
            title: 'ToolCallInvocation',
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query string' },
              topK: { type: 'number', description: 'Max results' },
            },
            required: ['query'],
            additionalProperties: true,
          },
        },
        {
          id: 'planner-out-message',
          name: 'plan_payload',
          direction: 'output',
          dataType: 'message_payload',
          schema: {
            title: 'PlanMessagePayload',
            type: 'object',
            properties: {
              role: { type: 'string' },
              content: { type: 'string' },
            },
            required: ['content'],
            additionalProperties: true,
          },
        },
        {
          id: 'planner-out-tokens',
          name: 'token_count',
          direction: 'output',
          dataType: 'number',
          schema: {
            title: 'TokenUsageCount',
            type: 'number',
          },
        },
      ],
    },
  };

  const searchTool: ToolNode = {
    id: 'tool-search',
    type: 'tool',
    label: 'Vector Search Tool',
    position: { x: 450, y: 60 },
    selected: false,
    apiEndpoint: 'https://api.internal.agent/v1/vector-search',
    httpMethod: 'POST',
    timeoutMs: 5000,
    toolSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'VectorSearchRequest',
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Semantic query text' },
        topK: { type: 'number', description: 'Number of chunks to retrieve' },
      },
      required: ['query'],
      additionalProperties: true,
    },
    ports: {
      inputs: [
        {
          id: 'search-in-call',
          name: 'tool_call_in',
          direction: 'input',
          dataType: 'tool_call',
          schema: {
            title: 'VectorSearchRequest',
            type: 'object',
            properties: {
              query: { type: 'string' },
              topK: { type: 'number' },
            },
            required: ['query'],
            additionalProperties: true,
          },
        },
      ],
      outputs: [
        {
          id: 'search-out-json',
          name: 'retrieved_docs',
          direction: 'output',
          dataType: 'json_object',
          schema: {
            title: 'SearchDocumentPayload',
            type: 'object',
            properties: {
              content: { type: 'string' },
              documents: { type: 'array' },
            },
            required: ['content'],
            additionalProperties: true,
          },
        },
        {
          id: 'search-out-latency',
          name: 'latency_ms',
          direction: 'output',
          dataType: 'number',
          schema: {
            title: 'LatencyMilliseconds',
            type: 'number',
          },
        },
      ],
    },
  };

  const reasoner: PromptNode = {
    id: 'prompt-reasoner',
    type: 'prompt',
    label: 'Synthesizer LLM',
    position: { x: 820, y: 140 },
    selected: false,
    model: 'gemini-2.5-flash',
    temperature: 0.4,
    maxTokens: 2048,
    systemPrompt:
      'Synthesize the retrieved context and evaluate whether confidence threshold >= 0.85 is met.',
    ports: {
      inputs: [
        {
          id: 'reasoner-in-docs',
          name: 'docs_payload',
          direction: 'input',
          dataType: 'message_payload',
          schema: {
            title: 'ReasonerInputEnvelope',
            type: 'object',
            properties: {
              content: { type: 'string' },
            },
            required: ['content'],
            additionalProperties: true,
          },
        },
      ],
      outputs: [
        {
          id: 'reasoner-out-message',
          name: 'synthesis_out',
          direction: 'output',
          dataType: 'message_payload',
          schema: {
            title: 'SynthesisMessagePayload',
            type: 'object',
            properties: {
              content: { type: 'string' },
              confidence: { type: 'number' },
            },
            required: ['content'],
            additionalProperties: true,
          },
        },
        {
          id: 'reasoner-out-confidence',
          name: 'confidence_score',
          direction: 'output',
          dataType: 'number',
          schema: {
            title: 'ConfidenceMetric',
            type: 'number',
          },
        },
      ],
    },
  };

  const routerGuard: RouterNode = {
    id: 'router-guard',
    type: 'router',
    label: 'Quality Exit Router',
    position: { x: 820, y: 420 },
    selected: false,
    routingCondition: 'payload.confidence >= 0.85 || iteration >= maxIterations',
    maxIterations: 4,
    fallbackRoute: 'refine_loop',
    routes: [
      {
        id: 'route-commit',
        label: 'Commit Action',
        expression: 'payload.confidence >= 0.85',
      },
      {
        id: 'route-loop',
        label: 'Refine Plan Loop',
        expression: 'payload.confidence < 0.85 && iteration < 4',
      },
    ],
    ports: {
      inputs: [
        {
          id: 'router-in-payload',
          name: 'eval_payload',
          direction: 'input',
          dataType: 'message_payload',
          schema: {
            title: 'RouterEvalInput',
            type: 'object',
            properties: {
              content: { type: 'string' },
              confidence: { type: 'number' },
            },
            required: ['content'],
            additionalProperties: true,
          },
        },
      ],
      outputs: [
        {
          id: 'router-out-dispatch',
          name: 'commit_tool_call',
          direction: 'output',
          dataType: 'tool_call',
          schema: {
            title: 'CommitActionInvocation',
            type: 'object',
            properties: {
              action: { type: 'string' },
              content: { type: 'string' },
            },
            required: ['content'],
            additionalProperties: true,
          },
        },
        {
          id: 'router-out-loop',
          name: 'retry_feedback',
          direction: 'output',
          dataType: 'message_payload',
          schema: {
            title: 'RetryFeedbackPayload',
            type: 'object',
            properties: {
              content: { type: 'string' },
            },
            required: ['content'],
            additionalProperties: true,
          },
        },
        {
          id: 'router-out-halted',
          name: 'is_terminated',
          direction: 'output',
          dataType: 'boolean',
          schema: {
            title: 'RouterHaltedFlag',
            type: 'boolean',
          },
        },
      ],
    },
  };

  const executorTool: ToolNode = {
    id: 'tool-executor',
    type: 'tool',
    label: 'Webhook Dispatcher',
    position: { x: 1190, y: 390 },
    selected: false,
    apiEndpoint: 'https://api.internal.agent/v1/dispatch-result',
    httpMethod: 'POST',
    timeoutMs: 8000,
    toolSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'WebhookDispatchSchema',
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Final verified response payload' },
        channel: { type: 'string', description: 'Destination webhook channel' },
      },
      required: ['content'],
      additionalProperties: true,
    },
    ports: {
      inputs: [
        {
          id: 'executor-in-call',
          name: 'execute_call',
          direction: 'input',
          dataType: 'tool_call',
          schema: {
            title: 'WebhookDispatchSchema',
            type: 'object',
            properties: {
              content: { type: 'string' },
            },
            required: ['content'],
            additionalProperties: true,
          },
        },
      ],
      outputs: [
        {
          id: 'executor-out-response',
          name: 'webhook_ack',
          direction: 'output',
          dataType: 'json_object',
          schema: {
            title: 'WebhookAckObject',
            type: 'object',
            properties: {
              status: { type: 'string' },
              content: { type: 'string' },
            },
            required: ['content'],
            additionalProperties: true,
          },
        },
      ],
    },
  };

  return {
    [planner.id]: planner,
    [searchTool.id]: searchTool,
    [reasoner.id]: reasoner,
    [routerGuard.id]: routerGuard,
    [executorTool.id]: executorTool,
  };
}

function createInitialPositions(nodes: Record<string, CanvasNode>): Record<string, Coordinates> {
  const positions: Record<string, Coordinates> = {};
  for (const id of Object.keys(nodes)) {
    positions[id] = { x: nodes[id].position.x, y: nodes[id].position.y };
  }
  return positions;
}

function createInitialEdges(): CanvasEdge[] {
  return [
    {
      id: 'edge-planner-to-search',
      sourceNodeId: 'prompt-planner',
      sourcePortId: 'planner-out-tool',
      sourcePortType: 'tool_call',
      targetNodeId: 'tool-search',
      targetPortId: 'search-in-call',
      targetPortType: 'tool_call',
      isLoopEdge: false,
    },
    {
      id: 'edge-search-to-reasoner',
      sourceNodeId: 'tool-search',
      sourcePortId: 'search-out-json',
      sourcePortType: 'json_object',
      targetNodeId: 'prompt-reasoner',
      targetPortId: 'reasoner-in-docs',
      targetPortType: 'message_payload',
      isLoopEdge: false,
    },
    {
      id: 'edge-reasoner-to-router',
      sourceNodeId: 'prompt-reasoner',
      sourcePortId: 'reasoner-out-message',
      sourcePortType: 'message_payload',
      targetNodeId: 'router-guard',
      targetPortId: 'router-in-payload',
      targetPortType: 'message_payload',
      isLoopEdge: false,
    },
    {
      id: 'edge-router-to-executor',
      sourceNodeId: 'router-guard',
      sourcePortId: 'router-out-dispatch',
      sourcePortType: 'tool_call',
      targetNodeId: 'tool-executor',
      targetPortId: 'executor-in-call',
      targetPortType: 'tool_call',
      isLoopEdge: false,
    },
  ];
}

export type NodeDataPatch =
  | Partial<Omit<PromptNode, 'id' | 'type' | 'position'>>
  | Partial<Omit<ToolNode, 'id' | 'type' | 'position'>>
  | Partial<Omit<RouterNode, 'id' | 'type' | 'position'>>;

export interface WorkflowStoreState {
  /**
   * Ordered list of node IDs so the canvas container only re-renders when nodes are added or removed.
   */
  nodeIds: string[];
  /**
   * Node configurations keyed by ID. Updating `nodes[id]` via `updateNodeData` only notifies
   * subscribers of that specific node's configuration slice.
   */
  nodes: Record<string, CanvasNode>;
  /**
   * Decoupled node coordinates keyed by ID. Updated only on `dragEnd` (`commitNodePosition`)
   * or node creation/deletion.
   */
  positions: Record<string, Coordinates>;
  /**
   * Directed graph edges.
   */
  edges: CanvasEdge[];
  /**
   * Currently selected node ID for the Property Inspector.
   */
  selectedNodeId: string | null;
  /**
   * Canvas pan & zoom transform state.
   */
  viewport: ViewportState;
  /**
   * Recent validation & cycle diagnostics alerts.
   */
  alerts: ValidationAlert[];

  /**
   * Commits a node's coordinates on dragEnd without mutating any other node in the store.
   */
  commitNodePosition: (nodeId: string, position: Coordinates) => void;

  /**
   * Updates a single node's configuration data without touching `positions` or other nodes.
   */
  updateNodeData: (nodeId: string, patch: NodeDataPatch) => void;

  /**
   * Selects or deselects a node.
   */
  selectNode: (nodeId: string | null) => void;

  /**
   * Attempts to connect two ports; runs `canConnect` and `detectCycleDFS` via `validateConnection`.
   */
  tryConnect: (
    sourceNodeId: string,
    sourcePortId: string,
    sourcePortType: PortDataType,
    targetNodeId: string,
    targetPortId: string,
    targetPortType: PortDataType
  ) => ConnectionValidationResult;

  /**
   * Adds a new node of the specified kind (`prompt`, `tool`, `router`) at the given canvas position.
   */
  addNode: (kind: NodeKind, position?: Coordinates) => string;

  /**
   * Removes a node and all incident edges.
   */
  removeNode: (nodeId: string) => void;

  /**
   * Removes an edge by ID.
   */
  removeEdge: (edgeId: string) => void;

  /**
   * Updates the viewport pan/zoom state.
   */
  setViewport: (viewport: ViewportState | ((prev: ViewportState) => ViewportState)) => void;

  /**
   * Pushes a validation or diagnostic alert.
   */
  addAlert: (alert: Omit<ValidationAlert, 'id' | 'timestamp'>) => void;

  /**
   * Dismisses an alert by ID (or clears all if omitted).
   */
  dismissAlert: (alertId?: string) => void;

  /**
   * Resets the workflow graph to the initial 5-node preset.
   */
  resetToPreset: () => void;
}

const initialNodesMap = createInitialNodes();
const initialPositionsMap = createInitialPositions(initialNodesMap);
const initialEdgesList = createInitialEdges();

let nodeCounter = 6;

export const useWorkflowStore = create<WorkflowStoreState>((set, get) => ({
  nodeIds: Object.keys(initialNodesMap),
  nodes: initialNodesMap,
  positions: initialPositionsMap,
  edges: initialEdgesList,
  selectedNodeId: 'prompt-planner',
  viewport: { x: 40, y: 40, zoom: 0.92 },
  alerts: [
    {
      id: 'welcome-alert',
      timestamp: Date.now(),
      title: 'Graph Validator Ready',
      message:
        'Try dragging from Quality Exit Router (retry_feedback) → Planner Agent (context_in) for a valid Router-guarded loop, or Synthesizer LLM (synthesis_out) → Planner Agent (context_in) to test unguarded cycle blocking.',
      severity: 'info',
    },
  ],

  commitNodePosition: (nodeId: string, position: Coordinates) => {
    set((state) => {
      if (!state.nodes[nodeId]) {
        return state;
      }
      const prevPos = state.positions[nodeId];
      if (prevPos && prevPos.x === position.x && prevPos.y === position.y) {
        return state;
      }
      return {
        positions: {
          ...state.positions,
          [nodeId]: { x: position.x, y: position.y },
        },
      };
    });
  },

  updateNodeData: (nodeId: string, patch: NodeDataPatch) => {
    set((state) => {
      const existingNode = state.nodes[nodeId];
      if (!existingNode) {
        return state;
      }

      let updatedNode: CanvasNode;
      if (existingNode.type === 'prompt') {
        updatedNode = {
          ...existingNode,
          ...(patch as Partial<Omit<PromptNode, 'id' | 'type' | 'position'>>),
          id: existingNode.id,
          type: 'prompt',
          position: existingNode.position,
        };
      } else if (existingNode.type === 'tool') {
        updatedNode = {
          ...existingNode,
          ...(patch as Partial<Omit<ToolNode, 'id' | 'type' | 'position'>>),
          id: existingNode.id,
          type: 'tool',
          position: existingNode.position,
        };
      } else {
        updatedNode = {
          ...existingNode,
          ...(patch as Partial<Omit<RouterNode, 'id' | 'type' | 'position'>>),
          id: existingNode.id,
          type: 'router',
          position: existingNode.position,
        };
      }

      return {
        nodes: {
          ...state.nodes,
          [nodeId]: updatedNode,
        },
      };
    });
  },

  selectNode: (nodeId: string | null) => {
    set((state) => {
      if (state.selectedNodeId === nodeId) {
        return state;
      }
      const nextNodes = { ...state.nodes };
      if (state.selectedNodeId && nextNodes[state.selectedNodeId]) {
        nextNodes[state.selectedNodeId] = {
          ...nextNodes[state.selectedNodeId],
          selected: false,
        };
      }
      if (nodeId && nextNodes[nodeId]) {
        nextNodes[nodeId] = {
          ...nextNodes[nodeId],
          selected: true,
        };
      }
      return {
        selectedNodeId: nodeId,
        nodes: nextNodes,
      };
    });
  },

  tryConnect: (
    sourceNodeId: string,
    sourcePortId: string,
    sourcePortType: PortDataType,
    targetNodeId: string,
    targetPortId: string,
    targetPortType: PortDataType
  ): ConnectionValidationResult => {
    const state = get();
    const validation = validateConnection(
      sourceNodeId,
      sourcePortId,
      sourcePortType,
      targetNodeId,
      targetPortId,
      targetPortType,
      state.nodes,
      state.edges
    );

    if (!validation.valid) {
      const titleMap: Record<ConnectionValidationResult['severity'], string> = {
        ok: 'Connection Added',
        loop_valid: 'Guarded Loop Created',
        port_mismatch: 'Port Schema Incompatible',
        invalid_cycle: 'Infinite Cycle Blocked (DFS)',
        self_loop: 'Self-Connection Blocked',
        duplicate: 'Duplicate Edge Ignored',
      };

      get().addAlert({
        title: titleMap[validation.severity],
        message: validation.reason,
        severity: validation.severity === 'duplicate' ? 'warning' : 'error',
        cyclePath: validation.cyclePath.length > 0 ? validation.cyclePath : undefined,
      });

      return validation;
    }

    const isLoopEdge = validation.hasCycle && validation.hasValidRouterExit;
    const newEdge: CanvasEdge = {
      id: `edge-${sourceNodeId}-${sourcePortId}-${targetNodeId}-${targetPortId}-${Date.now()}`,
      sourceNodeId,
      sourcePortId,
      sourcePortType,
      targetNodeId,
      targetPortId,
      targetPortType,
      isLoopEdge,
      label: isLoopEdge ? 'Router-Guarded Loop' : undefined,
    };

    set((prev) => ({
      edges: [...prev.edges, newEdge],
    }));

    if (isLoopEdge) {
      get().addAlert({
        title: 'Valid Agentic Loop Connected',
        message: validation.reason,
        severity: 'success',
        cyclePath: validation.cyclePath,
      });
    } else {
      const srcLabel = state.nodes[sourceNodeId]?.label ?? sourceNodeId;
      const tgtLabel = state.nodes[targetNodeId]?.label ?? targetNodeId;
      get().addAlert({
        title: 'Port Connection Established',
        message: `Connected ${srcLabel} (${sourcePortType}) → ${tgtLabel} (${targetPortType}).`,
        severity: 'success',
      });
    }

    return validation;
  },

  addNode: (kind: NodeKind, position?: Coordinates): string => {
    const idx = nodeCounter++;
    const id = `${kind}-node-${idx}`;
    const coords: Coordinates = position ?? {
      x: 240 + ((idx * 65) % 420),
      y: 180 + ((idx * 55) % 280),
    };

    let newNode: CanvasNode;

    if (kind === 'prompt') {
      newNode = {
        id,
        type: 'prompt',
        label: `Prompt Agent #${idx}`,
        position: coords,
        selected: true,
        model: 'gemini-2.5-flash',
        temperature: 0.5,
        maxTokens: 2048,
        systemPrompt: 'You are a specialized sub-agent. Process the incoming payload and respond with structured JSON.',
        ports: {
          inputs: [
            {
              id: `${id}-in-context`,
              name: 'context_in',
              direction: 'input',
              dataType: 'message_payload',
              schema: {
                title: 'AgentContextEnvelope',
                type: 'object',
                properties: {
                  content: { type: 'string' },
                },
                required: ['content'],
                additionalProperties: true,
              },
            },
          ],
          outputs: [
            {
              id: `${id}-out-message`,
              name: 'response_out',
              direction: 'output',
              dataType: 'message_payload',
              schema: {
                title: 'AgentResponsePayload',
                type: 'object',
                properties: {
                  content: { type: 'string' },
                },
                required: ['content'],
                additionalProperties: true,
              },
            },
            {
              id: `${id}-out-tool`,
              name: 'tool_call',
              direction: 'output',
              dataType: 'tool_call',
              schema: {
                title: 'DynamicToolCall',
                type: 'object',
                properties: {
                  query: { type: 'string' },
                  content: { type: 'string' },
                },
                additionalProperties: true,
              },
            },
            {
              id: `${id}-out-tokens`,
              name: 'token_count',
              direction: 'output',
              dataType: 'number',
              schema: {
                title: 'TokenCount',
                type: 'number',
              },
            },
          ],
        },
      };
    } else if (kind === 'tool') {
      newNode = {
        id,
        type: 'tool',
        label: `API Tool #${idx}`,
        position: coords,
        selected: true,
        apiEndpoint: 'https://api.internal.agent/v1/execute-tool',
        httpMethod: 'POST',
        timeoutMs: 6000,
        toolSchema: {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          title: 'ToolExecutionInput',
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Execution parameter' },
          },
          required: ['query'],
          additionalProperties: true,
        },
        ports: {
          inputs: [
            {
              id: `${id}-in-call`,
              name: 'tool_call_in',
              direction: 'input',
              dataType: 'tool_call',
              schema: {
                title: 'ToolExecutionInput',
                type: 'object',
                properties: {
                  query: { type: 'string' },
                },
                additionalProperties: true,
              },
            },
          ],
          outputs: [
            {
              id: `${id}-out-json`,
              name: 'json_result',
              direction: 'output',
              dataType: 'json_object',
              schema: {
                title: 'ToolExecutionResult',
                type: 'object',
                properties: {
                  content: { type: 'string' },
                },
                required: ['content'],
                additionalProperties: true,
              },
            },
          ],
        },
      };
    } else {
      newNode = {
        id,
        type: 'router',
        label: `Router Guard #${idx}`,
        position: coords,
        selected: true,
        routingCondition: 'payload.isComplete === true || iteration >= maxIterations',
        maxIterations: 3,
        fallbackRoute: 'retry_branch',
        routes: [
          {
            id: `${id}-route-pass`,
            label: 'Proceed',
            expression: 'payload.isComplete === true',
          },
          {
            id: `${id}-route-loop`,
            label: 'Loop Back',
            expression: 'payload.isComplete === false',
          },
        ],
        ports: {
          inputs: [
            {
              id: `${id}-in-payload`,
              name: 'eval_in',
              direction: 'input',
              dataType: 'message_payload',
              schema: {
                title: 'RouterInputEnvelope',
                type: 'object',
                properties: {
                  content: { type: 'string' },
                },
                required: ['content'],
                additionalProperties: true,
              },
            },
          ],
          outputs: [
            {
              id: `${id}-out-pass`,
              name: 'pass_out',
              direction: 'output',
              dataType: 'message_payload',
              schema: {
                title: 'RouterPassPayload',
                type: 'object',
                properties: {
                  content: { type: 'string' },
                },
                required: ['content'],
                additionalProperties: true,
              },
            },
            {
              id: `${id}-out-loop`,
              name: 'loop_feedback',
              direction: 'output',
              dataType: 'message_payload',
              schema: {
                title: 'RouterLoopPayload',
                type: 'object',
                properties: {
                  content: { type: 'string' },
                },
                required: ['content'],
                additionalProperties: true,
              },
            },
            {
              id: `${id}-out-flag`,
              name: 'exit_flag',
              direction: 'output',
              dataType: 'boolean',
              schema: {
                title: 'RouterExitBoolean',
                type: 'boolean',
              },
            },
          ],
        },
      };
    }

    set((state) => {
      const updatedNodes = { ...state.nodes };
      if (state.selectedNodeId && updatedNodes[state.selectedNodeId]) {
        updatedNodes[state.selectedNodeId] = {
          ...updatedNodes[state.selectedNodeId],
          selected: false,
        };
      }
      updatedNodes[id] = newNode;

      return {
        nodeIds: [...state.nodeIds, id],
        nodes: updatedNodes,
        positions: {
          ...state.positions,
          [id]: { x: coords.x, y: coords.y },
        },
        selectedNodeId: id,
      };
    });

    return id;
  },

  removeNode: (nodeId: string) => {
    set((state) => {
      if (!state.nodes[nodeId]) {
        return state;
      }
      const nextNodes = { ...state.nodes };
      delete nextNodes[nodeId];

      const nextPositions = { ...state.positions };
      delete nextPositions[nodeId];

      const remainingEdges = state.edges.filter(
        (e) => e.sourceNodeId !== nodeId && e.targetNodeId !== nodeId
      );

      // Re-evaluate loop flags on remaining edges
      const updatedEdges = remainingEdges.map((edge) => {
        const others = remainingEdges.filter((e) => e.id !== edge.id);
        const cycleCheck = detectCycleDFS(edge.sourceNodeId, edge.targetNodeId, nextNodes, others);
        const stillLoop = cycleCheck.hasCycle && cycleCheck.hasValidRouterExit;
        return {
          ...edge,
          isLoopEdge: stillLoop,
          label: stillLoop ? 'Router-Guarded Loop' : undefined,
        };
      });

      return {
        nodeIds: state.nodeIds.filter((id) => id !== nodeId),
        nodes: nextNodes,
        positions: nextPositions,
        edges: updatedEdges,
        selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
      };
    });
  },

  removeEdge: (edgeId: string) => {
    set((state) => ({
      edges: state.edges.filter((e) => e.id !== edgeId),
    }));
  },

  setViewport: (updater) => {
    set((state) => ({
      viewport: typeof updater === 'function' ? updater(state.viewport) : updater,
    }));
  },

  addAlert: (alert) => {
    const newAlert: ValidationAlert = {
      ...alert,
      id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
    };
    set((state) => ({
      alerts: [newAlert, ...state.alerts].slice(0, 8),
    }));
  },

  dismissAlert: (alertId?: string) => {
    set((state) => ({
      alerts: alertId ? state.alerts.filter((a) => a.id !== alertId) : [],
    }));
  },

  resetToPreset: () => {
    const freshNodes = createInitialNodes();
    const freshPositions = createInitialPositions(freshNodes);
    const freshEdges = createInitialEdges();
    set({
      nodeIds: Object.keys(freshNodes),
      nodes: freshNodes,
      positions: freshPositions,
      edges: freshEdges,
      selectedNodeId: 'prompt-planner',
      viewport: { x: 40, y: 40, zoom: 0.92 },
    });
  },
}));
