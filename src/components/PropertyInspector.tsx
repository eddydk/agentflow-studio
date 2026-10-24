import React from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Code2,
  GitBranch,
  Layers,
  ShieldAlert,
  Sliders,
  Trash2,
  Wrench,
} from 'lucide-react';
import { useNode } from '../hooks/useNode';
import { useWorkflowStore } from '../store/useWorkflowStore';
import { PromptNode, ToolNode } from '../types';

/**
 * Inner inspector panel rendered when a node ID is selected.
 * Uses `useNode(nodeId)` with `useShallow` so editing properties or dragging
 * other nodes never triggers unnecessary re-renders.
 */
const SelectedNodeInspector: React.FC<{ nodeId: string }> = ({ nodeId }) => {
  const { node, position, updateData } = useNode(nodeId);
  const removeNode = useWorkflowStore((s) => s.removeNode);

  if (!node) {
    return (
      <div className="inspector-empty">
        <Layers size={28} />
        <p>Select a node on the canvas to inspect its configuration and port JSON schemas.</p>
      </div>
    );
  }

  return (
    <div className="inspector-node-section">
      <div className="inspector-node-header">
        <div className={`node-kind-pill kind-${node.type}`}>
          {node.type === 'prompt' && <Bot size={14} />}
          {node.type === 'tool' && <Wrench size={14} />}
          {node.type === 'router' && <GitBranch size={14} />}
          <span>{node.type.toUpperCase()} NODE</span>
        </div>
        <button
          type="button"
          className="btn-delete-node"
          onClick={() => removeNode(node.id)}
          title="Delete selected node"
        >
          <Trash2 size={14} />
          <span>Delete</span>
        </button>
      </div>

      {/* Common BaseNode Metadata */}
      <div className="inspector-field">
        <label htmlFor="node-label-input">Node Label</label>
        <input
          id="node-label-input"
          type="text"
          value={node.label}
          onChange={(e) => updateData({ label: e.target.value })}
        />
      </div>

      <div className="inspector-coords-row">
        <div className="coord-chip">
          <span>ID</span>
          <code>{node.id}</code>
        </div>
        <div className="coord-chip">
          <span>X</span>
          <code>{Math.round(position.x)}px</code>
        </div>
        <div className="coord-chip">
          <span>Y</span>
          <code>{Math.round(position.y)}px</code>
        </div>
      </div>

      {/* Discriminated Union Narrowing by `node.type` */}
      {node.type === 'prompt' && (
        <div className="inspector-type-fields">
          <div className="inspector-field">
            <label htmlFor="prompt-model-select">LLM Model</label>
            <select
              id="prompt-model-select"
              value={node.model}
              onChange={(e) =>
                updateData({
                  model: e.target.value as PromptNode['model'],
                })
              }
            >
              <option value="gemini-2.5-pro">gemini-2.5-pro</option>
              <option value="gemini-2.5-flash">gemini-2.5-flash</option>
              <option value="claude-3-7-sonnet">claude-3-7-sonnet</option>
              <option value="gpt-4o">gpt-4o</option>
            </select>
          </div>

          <div className="inspector-field">
            <div className="field-label-row">
              <label htmlFor="prompt-temp-range">Temperature</label>
              <span className="field-value-badge">{node.temperature.toFixed(2)}</span>
            </div>
            <input
              id="prompt-temp-range"
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={node.temperature}
              onChange={(e) => updateData({ temperature: parseFloat(e.target.value) })}
            />
          </div>

          <div className="inspector-field">
            <label htmlFor="prompt-max-tokens">Max Output Tokens</label>
            <input
              id="prompt-max-tokens"
              type="number"
              min={128}
              max={32768}
              step={128}
              value={node.maxTokens}
              onChange={(e) =>
                updateData({ maxTokens: Math.max(128, Number(e.target.value) || 1024) })
              }
            />
          </div>

          <div className="inspector-field">
            <label htmlFor="prompt-system-prompt">System Prompt</label>
            <textarea
              id="prompt-system-prompt"
              rows={4}
              value={node.systemPrompt}
              onChange={(e) => updateData({ systemPrompt: e.target.value })}
            />
          </div>
        </div>
      )}

      {node.type === 'tool' && (
        <div className="inspector-type-fields">
          <div className="inspector-field-grid">
            <div className="inspector-field">
              <label htmlFor="tool-method-select">HTTP Method</label>
              <select
                id="tool-method-select"
                value={node.httpMethod}
                onChange={(e) =>
                  updateData({
                    httpMethod: e.target.value as ToolNode['httpMethod'],
                  })
                }
              >
                <option value="POST">POST</option>
                <option value="GET">GET</option>
                <option value="PUT">PUT</option>
                <option value="DELETE">DELETE</option>
              </select>
            </div>

            <div className="inspector-field">
              <label htmlFor="tool-timeout-input">Timeout (ms)</label>
              <input
                id="tool-timeout-input"
                type="number"
                min={500}
                max={60000}
                step={500}
                value={node.timeoutMs}
                onChange={(e) =>
                  updateData({ timeoutMs: Math.max(500, Number(e.target.value) || 5000) })
                }
              />
            </div>
          </div>

          <div className="inspector-field">
            <label htmlFor="tool-endpoint-input">API Endpoint</label>
            <input
              id="tool-endpoint-input"
              type="text"
              value={node.apiEndpoint}
              onChange={(e) => updateData({ apiEndpoint: e.target.value })}
            />
          </div>

          <div className="inspector-field">
            <div className="field-label-row">
              <label>Tool JSON Schema ({node.toolSchema.title})</label>
              <Code2 size={13} />
            </div>
            <pre className="schema-code-block">
              {JSON.stringify(node.toolSchema, null, 2)}
            </pre>
          </div>
        </div>
      )}

      {node.type === 'router' && (
        <div className="inspector-type-fields">
          <div className="router-guard-callout">
            <GitBranch size={15} />
            <div>
              <strong>DFS Loop Exit Guard</strong>
              <p>
                Cycles passing through this RouterNode are permitted by{' '}
                <code>detectCycleDFS</code> because it enforces a bounded exit condition.
              </p>
            </div>
          </div>

          <div className="inspector-field">
            <label htmlFor="router-condition-input">Routing Exit Expression</label>
            <textarea
              id="router-condition-input"
              rows={2}
              value={node.routingCondition}
              onChange={(e) => updateData({ routingCondition: e.target.value })}
            />
          </div>

          <div className="inspector-field-grid">
            <div className="inspector-field">
              <label htmlFor="router-max-iter">Max Loop Iterations</label>
              <input
                id="router-max-iter"
                type="number"
                min={1}
                max={25}
                value={node.maxIterations}
                onChange={(e) =>
                  updateData({ maxIterations: Math.max(1, Number(e.target.value) || 1) })
                }
              />
            </div>

            <div className="inspector-field">
              <label htmlFor="router-fallback">Fallback Route</label>
              <input
                id="router-fallback"
                type="text"
                value={node.fallbackRoute}
                onChange={(e) => updateData({ fallbackRoute: e.target.value })}
              />
            </div>
          </div>

          <div className="inspector-field">
            <label>Conditional Branches</label>
            <div className="router-routes-list">
              {node.routes.map((route) => (
                <div key={route.id} className="router-route-card">
                  <span className="route-title">{route.label}</span>
                  <code>{route.expression}</code>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Port Schema Table */}
      <div className="inspector-ports-summary">
        <h4>Typed I/O Ports</h4>
        <div className="ports-summary-group">
          {node.ports.inputs.map((port) => (
            <div key={port.id} className="port-summary-item">
              <span className="port-dir-tag dir-in">IN</span>
              <span className="port-summary-name">{port.name}</span>
              <code className={`port-dtype dtype-${port.dataType}`}>{port.dataType}</code>
            </div>
          ))}
          {node.ports.outputs.map((port) => (
            <div key={port.id} className="port-summary-item">
              <span className="port-dir-tag dir-out">OUT</span>
              <span className="port-summary-name">{port.name}</span>
              <code className={`port-dtype dtype-${port.dataType}`}>{port.dataType}</code>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export const PropertyInspector: React.FC = () => {
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const tryConnect = useWorkflowStore((s) => s.tryConnect);

  return (
    <aside className="property-inspector">
      <div className="inspector-header">
        <Sliders size={16} />
        <h2>Node Inspector</h2>
      </div>

      <div className="inspector-scroll-body">
        {selectedNodeId ? (
          <SelectedNodeInspector nodeId={selectedNodeId} />
        ) : (
          <div className="inspector-empty">
            <Layers size={28} />
            <p>Click any node on the canvas to inspect and edit its typed properties.</p>
          </div>
        )}

        {/* Interactive Validation & DFS Cycle Quick-Tester */}
        <div className="inspector-tester-card">
          <div className="tester-header">
            <ShieldAlert size={15} />
            <h3>Port &amp; DFS Cycle Lab</h3>
          </div>
          <p className="tester-subtitle">
            One-click verification of <code>canConnect</code> &amp; <code>detectCycleDFS</code> (or drag
            wires directly between ports on the canvas):
          </p>

          <div className="tester-actions">
            <button
              type="button"
              className="tester-btn tester-btn-valid"
              onClick={() =>
                tryConnect(
                  'router-guard',
                  'router-out-loop',
                  'message_payload',
                  'prompt-planner',
                  'planner-in-context',
                  'message_payload'
                )
              }
            >
              <CheckCircle2 size={14} />
              <div>
                <strong>1. Connect Valid Router Loop</strong>
                <span>Router (retry_feedback) → Planner (context_in)</span>
              </div>
            </button>

            <button
              type="button"
              className="tester-btn tester-btn-cycle"
              onClick={() =>
                tryConnect(
                  'prompt-reasoner',
                  'reasoner-out-message',
                  'message_payload',
                  'prompt-planner',
                  'planner-in-context',
                  'message_payload'
                )
              }
            >
              <AlertTriangle size={14} />
              <div>
                <strong>2. Test Invalid Cycle (No Router)</strong>
                <span>Synthesizer LLM → Planner Agent (Blocked by DFS)</span>
              </div>
            </button>

            <button
              type="button"
              className="tester-btn tester-btn-mismatch"
              onClick={() =>
                tryConnect(
                  'prompt-planner',
                  'planner-out-tokens',
                  'number',
                  'tool-search',
                  'search-in-call',
                  'tool_call'
                )
              }
            >
              <ShieldAlert size={14} />
              <div>
                <strong>3. Test Port Schema Mismatch</strong>
                <span>Planner (number) → Search Tool (tool_call)</span>
              </div>
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
};
