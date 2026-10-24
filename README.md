# AgentFlow Studio — AI Agent Workflow Canvas

A high-performance visual workflow editor canvas for orchestrating AI agents, built with **React 18**, **TypeScript 5**, **Zustand 5**, and **Vite 6**.

---

## Key Architecture Highlights

### 1. Selector-Isolated Zustand State Management (Zero React Context)
- **No React Context**: All workflow state lives in [`src/store/useWorkflowStore.ts`](./src/store/useWorkflowStore.ts), eliminating global provider re-renders.
- **Strict State Separation**: Dynamic node coordinates (`positions: Record<string, Coordinates>`) are decoupled from static node configurations (`nodes: Record<string, CanvasNode>`).
  - `commitNodePosition(nodeId, position)` updates only `positions[nodeId]` on `dragEnd` without cloning `nodes[nodeId]`.
  - `updateNodeData(nodeId, patch)` updates only `nodes[nodeId]` without mutating `positions`.
- **Atomic `useNode(nodeId)` Selector Hook**: [`src/hooks/useNode.ts`](./src/hooks/useNode.ts) uses `useShallow` so each node card component re-renders **only** when its own coordinates or private configuration properties change. Each card displays a live `R:<count>` render badge to prove selector isolation.

### 2. 60 FPS Imperative `translate3d` Canvas Physics
- **Zoomable & Pannable Viewport**: [`src/components/CanvasViewport.tsx`](./src/components/CanvasViewport.tsx) provides cursor-centered wheel zooming (`0.35x` – `2.25x`), click-and-drag background panning, and a zoom-reactive dot grid backdrop.
- **Hardware-Accelerated Dragging**: During `pointermove`, [`src/components/NodeCard.tsx`](./src/components/NodeCard.tsx) and [`src/utils/canvasPhysics.ts`](./src/utils/canvasPhysics.ts) mutate `element.style.transform = translate3d(x, y, 0)` and connected SVG cubic bezier `<path>` attributes directly via DOM refs at 60 FPS—triggering **zero** React state updates or Zustand commits until `pointerup` (`dragEnd`).

### 3. TypeScript Discriminated Union Node Models
Defined in [`src/types.ts`](./src/types.ts):
```ts
export type CanvasNode = PromptNode | ToolNode | RouterNode;
```
Every node shares [`BaseNode`](./src/types.ts) (`id`, `position`, `selected`, `label`, `ports`) and narrows via its discriminated `type` property:
- **`PromptNode` (`type: 'prompt'`)**: `systemPrompt`, `temperature`, `model`, `maxTokens`
- **`ToolNode` (`type: 'tool'`)**: `toolSchema` (`JSONSchemaDefinition`), `apiEndpoint`, `httpMethod`, `timeoutMs`
- **`RouterNode` (`type: 'router'`)**: `routingCondition`, `maxIterations`, `fallbackRoute`, `routes`

### 4. Port JSON Schema Compatibility & DFS Cycle Validation
Implemented in [`src/utils/validation.ts`](./src/utils/validation.ts):
- **`canConnect(sourceNodeId, targetNodeId, sourcePortType, targetPortType)`**: Verifies port data types (`message_payload`, `tool_call`, `json_object`, `string`, `number`, `boolean`, `any`) and structural `JSONSchemaDefinition` compatibility (`areSchemasCompatible`) before snapping an edge.
- **`detectCycleDFS(sourceNodeId, targetNodeId, nodes, edges)`**: Uses Depth-First Search (DFS) to detect directed cycles when connecting nodes:
  - Cycles containing at least one **`RouterNode`** (representing a bounded conditional exit guard) are allowed and rendered as gold `↻ ROUTER LOOP` feedback arches.
  - Cycles without a `RouterNode` are blocked as unbounded infinite loops and trigger an interactive **Infinite Cycle Blocked (DFS)** warning banner.

---

## Project Structure

```text
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── src/
    ├── types.ts                        # Discriminated Union Node, Port, Schema & Edge types
    ├── hooks/
    │   └── useNode.ts                  # Selector-isolated useNode(nodeId) hook
    ├── store/
    │   └── useWorkflowStore.ts         # Zustand store separating positions and node data
    ├── utils/
    │   ├── canvasPhysics.ts            # 60 FPS imperative DOM & SVG bezier registry
    │   └── validation.ts               # canConnect (JSON Schema) & detectCycleDFS
    └── components/
        ├── CanvasViewport.tsx          # Pan/zoom viewport, alerts & telemetry HUD
        ├── EdgeLayer.tsx               # Cubic bezier SVG edges & live wire preview
        ├── NodeCard.tsx                # Hardware-accelerated draggable node card
        └── PropertyInspector.tsx       # Type-narrowed inspector & Port/DFS Cycle Lab
```

---

## Getting Started

### Prerequisites
- **Node.js** `>= 18`
- **npm** `>= 9`

### Installation & Development

```bash
# Install dependencies
npm install

# Start the development server
npm run dev

# Type-check and build for production
npm run build

# Preview production build
npm run preview
```
