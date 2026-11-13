import { useState } from 'react';
import {
  BookOpen, Check, ChevronRight, CircleDashed, Clock3, FilePlus2, FileText, Folder,
  FolderPlus, Folders, LoaderCircle, PencilLine, Search, Trash2, X,
} from 'lucide-react';
import type { ToolRun } from '../types';

const labels: Record<string, string> = {
  list_projects: 'Listed projects', create_project: 'Created project', rename_project: 'Renamed project',
  delete_project: 'Deleted project', list_files: 'Inspected files', read_file: 'Read file',
  create_file: 'Created file', update_file: 'Updated file', create_folder: 'Created folder', delete_path: 'Deleted item',
  read: 'Read file', write: 'Wrote file', edit: 'Edited file', ls: 'Listed directory', cat: 'Read file', glob: 'Found files',
};

function ToolIcon({ name, size = 15 }: { name: string; size?: number }) {
  if (name.includes('project')) return <Folders size={size} />;
  if (name === 'list_files' || name === 'glob') return <Search size={size} />;
  if (name === 'read_file' || name === 'read' || name === 'cat') return <BookOpen size={size} />;
  if (name === 'ls') return <Folder size={size} />;
  if (name === 'create_folder') return <FolderPlus size={size} />;
  if (name === 'create_file' || name === 'write') return <FilePlus2 size={size} />;
  if (name === 'update_file' || name === 'edit') return <PencilLine size={size} />;
  if (name.includes('delete')) return <Trash2 size={size} />;
  if (name.includes('folder')) return <Folder size={size} />;
  return <FileText size={size} />;
}

function targetLabel(tool: ToolRun) {
  const value = tool.arguments.path || tool.arguments.pattern || tool.arguments.name || tool.arguments.project_id || tool.arguments.id;
  return typeof value === 'string' ? value : tool.name.replaceAll('_', ' ');
}

export function ToolCallTile({ tool, onClick }: { tool: ToolRun; onClick: (tool: ToolRun) => void }) {
  return (
    <button className={`tool-tile ${tool.status}`} type="button" onClick={() => onClick(tool)}>
      <span className={`tool-icon ${tool.status}`}><ToolIcon name={tool.name} /></span>
      <span className="tool-copy"><strong>{tool.status === 'approval' ? 'Waiting for your approval' : labels[tool.name] || tool.name.replaceAll('_', ' ')}</strong><small>{targetLabel(tool)}</small></span>
      <span className={`tool-state ${tool.status}`}>{tool.status === 'running' ? <LoaderCircle size={14} className="spin" /> : tool.status === 'approval' ? <Clock3 size={14} /> : tool.status === 'success' ? <Check size={14} /> : <X size={14} />}</span>
      <ChevronRight size={14} className="tool-open-icon" />
    </button>
  );
}

export function ToolDetailsModal({
  tool, onClose, onApproval, approving = false, hasUnsavedEdits = false,
}: {
  tool: ToolRun;
  onClose: () => void;
  onApproval?: (approved: boolean) => void;
  approving?: boolean;
  hasUnsavedEdits?: boolean;
}) {
  const [tab, setTab] = useState<'result' | 'input'>('result');
  const outcome = tool.status === 'error' ? { error: tool.error } : tool.status === 'approval' ? { status: 'Waiting for your approval before this filesystem action runs.' } : tool.result ?? { status: 'Waiting for result' };
  const isDelete = tool.name.includes('delete');
  return (
    <div className="overlay overlay-full" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="tool-detail-screen" role="dialog" aria-modal="true" aria-label="Agent tool call details">
        <header className="tool-detail-header">
          <div className="tool-detail-brand"><span className={`tool-icon large ${tool.status}`}><ToolIcon name={tool.name} size={18} /></span><div><span className="eyebrow">AGENT ACTION</span><h2>{labels[tool.name] || tool.name.replaceAll('_', ' ')}</h2></div></div>
          <button className="icon-button dismiss-button" type="button" onClick={onClose} aria-label="Close tool details"><X size={18} /></button>
        </header>
        <div className="tool-detail-subhead"><span>{targetLabel(tool)}</span><span className={`state-label ${tool.status}`}>{tool.status === 'running' ? <><CircleDashed size={13} /> Running</> : tool.status === 'approval' ? <><Clock3 size={13} /> Approval required</> : tool.status === 'success' ? <><Check size={13} /> Complete</> : <><X size={13} /> Failed</>}</span></div>
        <div className="tool-detail-body">
          <div className="detail-tabs"><button type="button" className={tab === 'result' ? 'selected' : ''} onClick={() => setTab('result')}>Result</button><button type="button" className={tab === 'input' ? 'selected' : ''} onClick={() => setTab('input')}>Input</button></div>
          <pre className="tool-json">{JSON.stringify(tab === 'input' ? tool.arguments : outcome, null, 2)}</pre>
          {tool.status === 'approval' && <div className="tool-approval-panel">
            <div><strong>{isDelete ? 'This action permanently deletes data.' : 'This action changes your project.'}</strong><p>{isDelete ? 'The agent will not continue until you approve or decline.' : 'The agent will not continue until you approve or decline this rename.'}</p>{hasUnsavedEdits && <p className="approval-unsaved">There are unsaved editor changes in this project. Deleting it will also discard those changes.</p>}</div>
            <div className="approval-actions"><button className="quiet-button" type="button" onClick={() => onApproval?.(false)} disabled={approving}>Decline</button><button className={isDelete ? 'danger-button' : 'primary-button'} type="button" onClick={() => onApproval?.(true)} disabled={approving}>{approving ? <LoaderCircle size={14} className="spin" /> : isDelete ? <Trash2 size={14} /> : <Check size={14} />}{approving ? 'Sending…' : isDelete ? 'Approve deletion' : 'Approve rename'}</button></div>
          </div>}
        </div>
        <footer className="tool-detail-footer"><span>Filesystem operation</span><span>Project sandbox · No terminal access</span></footer>
      </section>
    </div>
  );
}
