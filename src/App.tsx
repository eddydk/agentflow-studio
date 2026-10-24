import React from 'react';
import {
  GitBranch,
  RotateCcw,
  Sparkles,
  Terminal,
  Trash2,
  Workflow,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { CanvasViewport } from './components/CanvasViewport';
import { PropertyInspector } from './components/PropertyInspector';
import { useWorkflowStore } from './store/useWorkflowStore';

export const App: React.FC = () => {
  const { addNode, resetToPreset, dismissAlert, nodeCount, edgeCount } =
    useWorkflowStore(
      useShallow((state) => ({
        addNode: state.addNode,
        resetToPreset: state.resetToPreset,
        dismissAlert: state.dismissAlert,
        nodeCount: state.nodeIds.length,
        edgeCount: state.edges.length,
      }))
    );

  return (
    <div className="app-shell">
      {/* Top Toolbar */}
      <header className="top-navbar">
        <div className="brand-cluster">
          <div className="brand-logo">
            <Workflow size={19} />
          </div>
          <div>
            <div className="brand-title">
              <span>AgentFlow Studio</span>
              <span className="brand-badge">ZUSTAND SELECTOR + 60FPS</span>
            </div>
            <div className="brand-subtitle">
              Discriminated Union Node Architecture • Port Schema & DFS Cycle Validator
            </div>
          </div>
        </div>

        <div className="navbar-actions">
          <span
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 11,
              color: '#94a3b8',
              marginRight: 6,
            }}
          >
            Nodes: <strong style={{ color: '#f8fafc' }}>{nodeCount}</strong> | Edges:{' '}
            <strong style={{ color: '#f8fafc' }}>{edgeCount}</strong>
          </span>

          <div className="divider-v" />

          <button
            type="button"
            className="btn btn-prompt"
            onClick={() => addNode('prompt')}
          >
            <Sparkles size={13} />
            <span>+ PromptNode</span>
          </button>

          <button
            type="button"
            className="btn btn-tool"
            onClick={() => addNode('tool')}
          >
            <Terminal size={13} />
            <span>+ ToolNode</span>
          </button>

          <button
            type="button"
            className="btn btn-router"
            onClick={() => addNode('router')}
          >
            <GitBranch size={13} />
            <span>+ RouterNode</span>
          </button>

          <div className="divider-v" />

          <button
            type="button"
            className="btn"
            onClick={() => dismissAlert()}
            title="Clear all alerts"
          >
            <Trash2 size={13} />
            <span>Clear Alerts</span>
          </button>

          <button
            type="button"
            className="btn"
            onClick={resetToPreset}
            title="Reset workflow graph to default 5-node preset"
          >
            <RotateCcw size={13} />
            <span>Reset Graph</span>
          </button>
        </div>
      </header>

      {/* Main Canvas + Inspector Workspace */}
      <main className="workspace-body">
        <CanvasViewport />
        <PropertyInspector />
      </main>
    </div>
  );
};

export default App;
