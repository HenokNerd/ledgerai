import { memo, useEffect, useRef, useState } from 'react';
import {
  Bell, BookOpen, Check, ChevronRight, CircleDashed, Clock3, FilePlus2, FileText, Folder,
  FolderPlus, Folders, LoaderCircle, PencilLine, Search, Terminal, Trash2, X,
} from 'lucide-react';
import type { ToolRun } from '../types';

const labels: Record<string, string> = {
  list_projects: 'Listed projects', create_project: 'Created project', rename_project: 'Renamed project',
  delete_project: 'Deleted project', list_files: 'Inspected files', read_file: 'Read file',
  create_file: 'Created file', update_file: 'Updated file', create_folder: 'Created folder', delete_path: 'Deleted item',
  read: 'Read file', write: 'Wrote file', edit: 'Edited file', ls: 'Listed directory', cat: 'Read file', glob: 'Found files',
  terminal: 'Ran command', terminal_jobs: 'Checked terminal jobs', terminal_kill: 'Stopped terminal job',
  notification: 'Notification',
};

function ToolIcon({ name, size = 15 }: { name: string; size?: number }) {
  if (name === 'notification') return <Bell size={size} />;
  if (name.startsWith('terminal')) return <Terminal size={size} />;
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

function commandLabel(tool: ToolRun) {
  const command = tool.arguments.command;
  if (typeof command === 'string' && command.trim()) return command;
  const argv = tool.arguments.argv;
  if (Array.isArray(argv)) return argv.filter((item) => typeof item === 'string').join(' ');
  return '';
}

function targetLabel(tool: ToolRun) {
  const command = commandLabel(tool);
  if (command) return command;
  const job = tool.arguments.job_id;
  if (typeof job === 'string' && job) return job;
  const value = tool.arguments.path || tool.arguments.pattern || tool.arguments.name || tool.arguments.project_id || tool.arguments.id;
  return typeof value === 'string' ? value : tool.name.replaceAll('_', ' ');
}

function ToolCallTileInner({ tool, onClick }: { tool: ToolRun; onClick: (tool: ToolRun) => void }) {
  const result = tool.result as { command?: string; background?: boolean; status?: string; exitCode?: number | null; signal?: string | null; detail?: string } | undefined;
  const isNotification = tool.name === 'notification';
  const notificationArgs = tool.arguments as { title?: string; command?: string; subtitle?: string; detail?: string; lines?: string[]; kind?: string } | undefined;
  const notificationLines = Array.isArray(notificationArgs?.lines)
    ? notificationArgs.lines.filter((line): line is string => typeof line === 'string' && line.trim().length > 0)
    : [notificationArgs?.command || notificationArgs?.subtitle, notificationArgs?.detail || result?.detail].filter((line): line is string => typeof line === 'string' && line.trim().length > 0);
  const backgroundDone = tool.name === 'terminal' && result?.background === true && typeof result.status === 'string' && result.status !== 'running';
  const command = result?.command || commandLabel(tool) || targetLabel(tool);
  const detail = result?.signal || (result && result.exitCode !== undefined && result.exitCode !== null ? `exit ${result.exitCode}` : result?.detail || '');
  const title = tool.status === 'approval'
    ? 'Waiting for your approval'
    : isNotification
      ? (notificationArgs?.title || labels.notification)
      : backgroundDone
        ? `Background command ${result!.status}`
        : tool.name === 'terminal' && tool.status === 'running'
          ? (result?.background ? 'Running in background' : 'Running command')
          : labels[tool.name] || tool.name.replaceAll('_', ' ');

  const line1 = isNotification ? (notificationLines[0] || '') : command;
  const line2 = isNotification ? (notificationLines[1] || '') : (backgroundDone ? detail : '');

  return (
    <button className={`tool-tile ${tool.status}${backgroundDone || isNotification ? ' terminal-finished' : ''}${isNotification ? ' notification-tile' : ''}`} type="button" onClick={() => onClick(tool)}>
      <span className={`tool-icon ${tool.status}`}><ToolIcon name={tool.name} /></span>
      <span className="tool-copy">
        <strong>{title}</strong>
        {line1 ? <small className="tool-command">{line1}</small> : null}
        {line2 ? <small className="tool-detail-line">{line2}</small> : null}
      </span>
      <span className={`tool-state ${tool.status}`}>{tool.status === 'running' ? <LoaderCircle size={14} className="spin" /> : tool.status === 'approval' ? <Clock3 size={14} /> : tool.status === 'success' ? <Check size={14} /> : <X size={14} />}</span>
      <ChevronRight size={14} className="tool-open-icon" />
    </button>
  );
}

export const ToolCallTile = memo(ToolCallTileInner);

export function ToolDetailsModal({
  tool, onClose, onApproval, approving = false, hasUnsavedEdits = false, onJobUpdate,
}: {
  tool: ToolRun;
  onClose: () => void;
  onApproval?: (approved: boolean) => void;
  approving?: boolean;
  hasUnsavedEdits?: boolean;
  onJobUpdate?: (jobId: string, update: { stdout?: string; stderr?: string; status?: string; exitCode?: number | null; signal?: string | null }) => void;
}) {
  const [tab, setTab] = useState<'result' | 'input'>('result');
  const [streamOutput, setStreamOutput] = useState<{ stdout: string; stderr: string } | null>(null);
  const outputRef = useRef({ stdout: '', stderr: '' });

  const jobId = (tool.result as { jobId?: string } | undefined)?.jobId;
  const isRunningBackgroundTerminal = tool.name === 'terminal' && tool.status === 'running' && (tool.result as { background?: boolean } | undefined)?.background === true && typeof jobId === 'string';

  useEffect(() => {
    setStreamOutput(null);
    outputRef.current = { stdout: '', stderr: '' };
  }, [tool.id]);

  useEffect(() => {
    if (!isRunningBackgroundTerminal || !jobId) return;
    const source = new EventSource(`/api/terminal/jobs/${encodeURIComponent(jobId)}/stream`);
    const onSnapshot = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as { stdout?: string; stderr?: string; status?: string };
        outputRef.current = { stdout: data.stdout || '', stderr: data.stderr || '' };
        setStreamOutput({ ...outputRef.current });
      } catch { /* ignore */ }
    };
    const onOutput = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as { stream: 'stdout' | 'stderr'; chunk: string };
        outputRef.current = { ...outputRef.current, [data.stream]: (outputRef.current[data.stream] + data.chunk).slice(-160_000) };
        setStreamOutput({ ...outputRef.current });
      } catch { /* ignore */ }
    };
    const onExit = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as { stdout?: string; stderr?: string; status?: string; exitCode?: number | null; signal?: string | null };
        if (data.stdout !== undefined || data.stderr !== undefined) {
          outputRef.current = { stdout: data.stdout || outputRef.current.stdout, stderr: data.stderr || outputRef.current.stderr };
          setStreamOutput({ ...outputRef.current });
        }
        onJobUpdate?.(jobId, data);
      } catch { /* ignore */ }
      source.close();
    };
    source.addEventListener('snapshot', onSnapshot as EventListener);
    source.addEventListener('output', onOutput as EventListener);
    source.addEventListener('exit', onExit as EventListener);
    source.onerror = () => { /* Polling/fallback will still update; keep modal usable. */ };
    return () => {
      source.removeEventListener('snapshot', onSnapshot as EventListener);
      source.removeEventListener('output', onOutput as EventListener);
      source.removeEventListener('exit', onExit as EventListener);
      source.close();
    };
  }, [isRunningBackgroundTerminal, jobId, onJobUpdate]);
  const result = tool.result as {
    stdout?: string; stderr?: string; jobId?: string; command?: string; cwd?: string;
    status?: string; background?: boolean; exitCode?: number | null; signal?: string | null; message?: string; detail?: string;
  } | undefined;
  const isNotification = tool.name === 'notification';
  const notificationArgs = tool.arguments as { title?: string; kind?: string } | undefined;
  const isTerminal = tool.name === 'terminal';
  const isTerminalTool = tool.name.startsWith('terminal') || isNotification;
  const backgroundRunning = isTerminal && result?.background === true && result?.status === 'running';
  const command = commandLabel(tool);
  const liveStdout = streamOutput?.stdout;
  const liveStderr = streamOutput?.stderr;
  const terminalText = [liveStdout ?? tool.output?.stdout ?? result?.stdout, liveStderr ?? tool.output?.stderr ?? result?.stderr].filter(Boolean).join('\n');
  const terminalDisplay = terminalText
    || (tool.status === 'error' ? tool.error || 'The command failed.' : tool.status === 'running' ? 'Waiting for output…' : 'No output captured.');
  const outcome = tool.status === 'error'
    ? { error: tool.error }
    : tool.status === 'approval'
      ? { status: isTerminal ? 'Waiting for your approval before this command runs.' : 'Waiting for your approval before this filesystem action runs.' }
      : tool.result ?? { status: 'Waiting for result' };
  const isDelete = tool.name.includes('delete');
  return (
    <div className="overlay overlay-full" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="tool-detail-screen" role="dialog" aria-modal="true" aria-label="Agent tool call details">
        <header className="tool-detail-header">
          <div className="tool-detail-brand"><span className={`tool-icon large ${tool.status}`}><ToolIcon name={tool.name} size={18} /></span><div><span className="eyebrow">{isNotification ? 'NOTIFICATION' : 'AGENT ACTION'}</span><h2>{isNotification ? (notificationArgs?.title || 'Notification') : (labels[tool.name] || tool.name.replaceAll('_', ' '))}</h2></div></div>
          <button className="icon-button dismiss-button" type="button" onClick={onClose} aria-label="Close tool details"><X size={18} /></button>
        </header>
        <div className="tool-detail-subhead"><span>{targetLabel(tool)}</span><span className={`state-label ${tool.status}`}>{tool.status === 'running' ? <><LoaderCircle size={13} className="spin" /> {result?.background ? 'Running in background' : 'Running'}</> : tool.status === 'approval' ? <><Clock3 size={13} /> Approval required</> : backgroundRunning ? <><LoaderCircle size={13} className="spin" /> Running in background</> : tool.status === 'success' ? <><Check size={13} /> Complete</> : <><X size={13} /> Failed</>}</span></div>
        <div className="tool-detail-body">
          <div className="detail-tabs"><button type="button" className={tab === 'result' ? 'selected' : ''} onClick={() => setTab('result')}>Result</button><button type="button" className={tab === 'input' ? 'selected' : ''} onClick={() => setTab('input')}>Input</button></div>
          {tab === 'result' && (isTerminal || isNotification) ? (
            <div className="tool-terminal">
              <div className="tool-terminal-bar"><span><Terminal size={12} /> {result?.jobId || 'terminal'}</span><span>{tool.status === 'running' ? 'streaming…' : backgroundRunning ? 'running in background' : result?.status || 'done'}</span></div>
              <pre className="tool-terminal-output">{terminalDisplay}</pre>
              {backgroundRunning
                ? <div className="tool-terminal-meta">{result?.message || `Command moved to the background (job ID: ${result?.jobId}). Output is streaming in the UI and can be inspected with terminal_jobs. You will be notified automatically when the command finishes.`}</div>
                : result?.exitCode !== undefined && result?.exitCode !== null
                  ? <div className="tool-terminal-meta">exit {result.exitCode}{result.signal ? ` · ${result.signal}` : ''}{result.cwd ? ` · ${result.cwd}` : ''}</div>
                  : result?.message
                    ? <div className="tool-terminal-meta">{result.message}</div>
                    : null}
            </div>
          ) : <pre className="tool-json">{JSON.stringify(tab === 'input' ? tool.arguments : outcome, null, 2)}</pre>}
          {tool.status === 'approval' && <div className="tool-approval-panel">
            <div>
              <strong>{isTerminal ? 'This command will run on the server.' : isDelete ? 'This action permanently deletes data.' : 'This action changes your project.'}</strong>
              <p>{isTerminal ? <><code className="terminal-command">{command || 'Command'}</code> starts in the active project with the server's process permissions.</> : isDelete ? 'The agent will not continue until you approve or decline.' : 'The agent will not continue until you approve or decline this rename.'}</p>
              {hasUnsavedEdits && <p className="approval-unsaved">There are unsaved editor changes in this project. Deleting it will also discard those changes.</p>}
            </div>
            <div className="approval-actions"><button className="quiet-button" type="button" onClick={() => onApproval?.(false)} disabled={approving}>Decline</button><button className={isDelete ? 'danger-button' : 'primary-button'} type="button" onClick={() => onApproval?.(true)} disabled={approving}>{approving ? <LoaderCircle size={14} className="spin" /> : isTerminal ? <Terminal size={14} /> : isDelete ? <Trash2 size={14} /> : <Check size={14} />}{approving ? 'Sending…' : isTerminal ? 'Run command' : isDelete ? 'Approve deletion' : 'Approve rename'}</button></div>
          </div>}
        </div>
        <footer className="tool-detail-footer">{isNotification ? <><span>Notification</span><span>System event</span></> : isTerminalTool ? <><span>Terminal operation</span><span>spawn · Project sandbox</span></> : <><span>Filesystem operation</span><span>Project sandbox</span></>}</footer>
      </section>
    </div>
  );
}
