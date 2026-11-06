import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import {
  ArrowUp, Check, ChevronDown, Code2, Command, CornerDownLeft,
  Eye, FilePlus2, Files, FolderOpen, FolderPlus, LoaderCircle, Menu, MessageSquareText,
  MoreHorizontal, PanelLeftClose, Plus, Save, Sparkles, Square, Trash2,
  X,
} from 'lucide-react';
import FileTree, { LanguageIcon, languageForPath } from './components/FileTree';
import MarkdownView from './components/MarkdownView';
import { ToolCallTile, ToolDetailsModal } from './components/ToolCallTile';
import { api, streamAgent } from './lib/api';
import type { AgentEvent, ChatMessage, FileNode, Project, ToolRun } from './types';

const id = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const imagePattern = /\.(?:png|jpe?g|gif|webp|avif|svg)(?:[?#].*)?$/i;

type DialogState = { kind: 'project'; mode: 'create' | 'rename' } | { kind: 'path'; mode: 'file' | 'folder' } | { kind: 'delete-project'; project: Project } | { kind: 'delete-path'; node: FileNode } | null;
type PendingNavigation = { kind: 'project'; project: Project | null } | { kind: 'file'; path: string };
type ImageState = { src: string; label: string } | null;

function BrandMark({ small = false }: { small?: boolean }) {
  return <span className={`brand-mark ${small ? 'small' : ''}`}><Sparkles size={small ? 16 : 18} strokeWidth={2.2} /></span>;
}

function ModalFrame({ title, description, onClose, children, wide = false }: { title: string; description: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={`dialog ${wide ? 'dialog-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="dialog-head"><div><span className="eyebrow">LEDGER AI</span><h2>{title}</h2><p>{description}</p></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close dialog"><X size={17} /></button></header>
        {children}
      </section>
    </div>
  );
}

function ImageModal({ image, onClose }: { image: ImageState; onClose: () => void }) {
  if (!image) return null;
  return (
    <div className="overlay image-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="image-dialog" role="dialog" aria-modal="true" aria-label="Image preview">
        <header className="image-dialog-head"><div><span className="eyebrow">IMAGE PREVIEW</span><strong>{image.label}</strong></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close image preview"><X size={18} /></button></header>
        <div className="image-stage"><img src={image.src} alt={image.label} /></div>
      </section>
    </div>
  );
}

function FileIconButton({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title: string }) {
  return <button type="button" className="icon-button" title={title} aria-label={title} onClick={onClick}>{children}</button>;
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [tree, setTree] = useState<FileNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'files' | 'projects'>('files');
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [activeFolder, setActiveFolder] = useState('');
  const [activePath, setActivePath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [view, setView] = useState<'chat' | 'file'>('chat');
  const [markdownPreview, setMarkdownPreview] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [image, setImage] = useState<ImageState>(null);
  const [toolDetails, setToolDetails] = useState<ToolRun | null>(null);
  const [toast, setToast] = useState('');
  const [saving, setSaving] = useState(false);
  const [createdDialogName, setCreatedDialogName] = useState('');
  const [pathDialogName, setPathDialogName] = useState('');
  const [pendingDelete, setPendingDelete] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const turnSequenceRef = useRef(0);
  const toolsByIdRef = useRef(new Map<string, ToolRun>());
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const dirty = activePath !== null && fileContent !== savedContent;
  const projectRef = useRef(project);
  projectRef.current = project;
  const editorSnapshotRef = useRef({ projectId: project?.id || null, path: activePath, dirty });
  editorSnapshotRef.current = { projectId: project?.id || null, path: activePath, dirty };

  const cancelAgentTurn = () => {
    turnSequenceRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
  };

  const refreshProjects = useCallback(async () => {
    const next = await api.projects();
    setProjects(next);
    setProject((current) => {
      const remembered = localStorage.getItem('ledger-active-project');
      const existing = current ? next.find((item) => item.id === current.id) : undefined;
      const found = existing || next.find((item) => item.id === remembered) || next[0] || null;
      if (found) localStorage.setItem('ledger-active-project', found.id);
      else localStorage.removeItem('ledger-active-project');
      return found;
    });
  }, []);

  const refreshTree = useCallback(async (projectId: string) => {
    setTreeLoading(true);
    try { setTree(await api.tree(projectId)); }
    catch (error) { setToast((error as Error).message); setTree([]); }
    finally { setTreeLoading(false); }
  }, []);

  useEffect(() => {
    void refreshProjects().catch((error) => setToast(`Could not load projects: ${(error as Error).message}`));
  }, [refreshProjects]);

  useEffect(() => {
    if (!project) { setTree([]); setActivePath(null); setView('chat'); return; }
    localStorage.setItem('ledger-active-project', project.id);
    setActivePath(null);
    setView('chat');
    setActiveFolder('');
    void refreshTree(project.id);
  }, [project?.id, refreshTree]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (projectMenuRef.current && !projectMenuRef.current.contains(event.target as Node)) setProjectMenuOpen(false);
    };
    window.addEventListener('mousedown', handleClick);
    return () => window.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    const handleKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setImage(null); setToolDetails(null); setDialog(null); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && view === 'file' && dirty) {
        event.preventDefault(); void saveActiveFile();
      }
    };
    window.addEventListener('keydown', handleKeys);
    return () => window.removeEventListener('keydown', handleKeys);
  });

  const selectProject = (next: Project | null) => {
    setProjectMenuOpen(false);
    if (project?.id === next?.id) return;
    cancelAgentTurn();
    if (dirty && activePath) {
      setPendingNavigation({ kind: 'project', project: next });
      return;
    }
    projectRef.current = next;
    setProject(next);
    setMessages([]);
  };

  const handleProjectSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      if (dialog?.kind !== 'project') return;
      if (dialog.mode === 'create') {
        cancelAgentTurn();
        const created = await api.createProject(createdDialogName);
        setProjects((current) => [...current, created]);
        if (dirty && activePath) setPendingNavigation({ kind: 'project', project: created });
        else { projectRef.current = created; setProject(created); setMessages([]); }
        setDialog(null);
        setCreatedDialogName('');
        setToast(`Created ${created.name} in Project/${created.id}`);
      } else if (project) {
        cancelAgentTurn();
        if (dirty && activePath) {
          await api.saveFile(project.id, activePath, fileContent);
          setSavedContent(fileContent);
          await refreshTree(project.id);
        }
        const renamed = await api.renameProject(project.id, createdDialogName);
        setProjects((current) => current.map((item) => item.id === project.id ? renamed : item));
        projectRef.current = renamed;
        setProject(renamed);
        setDialog(null);
        setToast(`Project renamed to ${renamed.name}`);
      }
    } catch (error) { setToast((error as Error).message); }
  };

  const handlePathSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!project || dialog?.kind !== 'path') return;
    const name = pathDialogName.trim().replace(/^\/+|\/+$/g, '');
    if (!name) return;
    const path = activeFolder ? `${activeFolder}/${name}` : name;
    try {
      if (dialog.mode === 'file') {
        await api.createFile(project.id, path, '');
        await refreshTree(project.id);
        await openFile(path);
        setToast(`Created ${path}`);
      } else {
        await api.createFolder(project.id, path);
        await refreshTree(project.id);
        setActiveFolder(path);
        setToast(`Created folder ${path}`);
      }
      setDialog(null);
      setPathDialogName('');
    } catch (error) { setToast((error as Error).message); }
  };

  const confirmDelete = async () => {
    if (!dialog || pendingDelete) return;
    cancelAgentTurn();
    setPendingDelete(true);
    try {
      if (dialog.kind === 'delete-project') {
        await api.deleteProject(dialog.project.id);
        setProjects((current) => current.filter((item) => item.id !== dialog.project.id));
        if (project?.id === dialog.project.id) {
          const next = projects.find((item) => item.id !== dialog.project.id) || null;
          projectRef.current = next;
          setProject(next);
          setMessages([]);
        }
        setToast(`Deleted ${dialog.project.name}`);
      } else if (dialog.kind === 'delete-path' && project) {
        await api.deletePath(project.id, dialog.node.path);
        if (activePath && (activePath === dialog.node.path || activePath.startsWith(`${dialog.node.path}/`))) {
          setActivePath(null); setFileContent(''); setSavedContent(''); setView('chat');
        }
        await refreshTree(project.id);
        setToast(`Deleted ${dialog.node.path}`);
      }
      setDialog(null);
    } catch (error) { setToast((error as Error).message); }
    finally { setPendingDelete(false); }
  };

  const loadFile = async (path: string) => {
    const currentProject = projectRef.current;
    if (!currentProject) return;
    if (imagePattern.test(path)) {
      setImage({ src: api.assetUrl(currentProject.id, path), label: path.split('/').pop() || path });
      return;
    }
    try {
      const file = await api.readFile(currentProject.id, path);
      if (projectRef.current?.id !== currentProject.id) return;
      setActivePath(path);
      setFileContent(file.content);
      setSavedContent(file.content);
      setMarkdownPreview(/\.mdx?$/i.test(path));
      setView('file');
    } catch (error) { setToast((error as Error).message); }
  };

  const openFile = async (path: string) => {
    if (!project) return;
    if (imagePattern.test(path)) {
      setImage({ src: api.assetUrl(project.id, path), label: path.split('/').pop() || path });
      return;
    }
    if (path === activePath) { setView('file'); return; }
    if (dirty && activePath && path !== activePath) {
      cancelAgentTurn();
      setPendingNavigation({ kind: 'file', path });
      return;
    }
    await loadFile(path);
  };

  const resolvePendingNavigation = async (saveChanges: boolean) => {
    if (!pendingNavigation) return;
    try {
      if (saveChanges && dirty && project && activePath) {
        await api.saveFile(project.id, activePath, fileContent);
        setSavedContent(fileContent);
        await refreshTree(project.id);
      }
      const navigation = pendingNavigation;
      setPendingNavigation(null);
      cancelAgentTurn();
      if (navigation.kind === 'project') {
        projectRef.current = navigation.project;
        setProject(navigation.project);
        setMessages([]);
      } else await loadFile(navigation.path);
    } catch (error) { setToast((error as Error).message); }
  };

  const saveActiveFile = useCallback(async () => {
    if (!project || !activePath || !dirty || saving) return;
    setSaving(true);
    try {
      await api.saveFile(project.id, activePath, fileContent);
      setSavedContent(fileContent);
      await refreshTree(project.id);
      setToast('Saved to the project workspace');
    } catch (error) { setToast((error as Error).message); }
    finally { setSaving(false); }
  }, [project, activePath, dirty, saving, fileContent, refreshTree]);

  const updateAfterTool = async (tool: ToolRun, result: unknown) => {
    const data = result as { project?: Project; previousId?: string; deleted?: boolean } | undefined;
    if (tool.name === 'create_project' && data?.project) {
      setProjects((current) => [...current.filter((item) => item.id !== data.project!.id), data.project!]);
      if (!projectRef.current) { projectRef.current = data.project; setProject(data.project); }
    } else if (tool.name === 'rename_project' && data?.project) {
      const previousId = data.project.previousId || String(tool.arguments.project_id || '');
      setProjects((current) => current.map((item) => item.id === previousId ? data.project! : item));
      if (projectRef.current?.id === previousId) { projectRef.current = data.project; setProject(data.project); }
    } else if (tool.name === 'delete_project' && data?.project) {
      setProjects((current) => current.filter((item) => item.id !== data.project!.id));
      if (projectRef.current?.id === data.project.id) { projectRef.current = null; setProject(null); }
    }
    const currentId = projectRef.current?.id;
    if (currentId) {
      await refreshTree(currentId);
      const editor = editorSnapshotRef.current;
      const toolPath = typeof tool.arguments.path === 'string' ? tool.arguments.path : '';
      if (tool.name === 'delete_path' && editor.projectId === currentId && editor.path && (editor.path === toolPath || editor.path.startsWith(`${toolPath}/`))) {
        setActivePath(null); setFileContent(''); setSavedContent(''); setView('chat');
      } else if (editor.projectId === currentId && editor.path && ['create_file', 'update_file'].includes(tool.name) && toolPath === editor.path) {
        if (editorSnapshotRef.current.dirty) setToast('Ledger changed this file on disk. Your unsaved editor draft was kept.');
        else {
          const file = await api.readFile(currentId, editor.path).catch(() => null);
          if (file) { setFileContent(file.content); setSavedContent(file.content); }
        }
      }
    }
  };

  const handleAgentEvent = (event: AgentEvent) => {
    if (event.type === 'tool_start') {
      const tool: ToolRun = { ...event.tool, status: 'running' };
      toolsByIdRef.current.set(tool.id, tool);
      setMessages((current) => [...current, { id: id(), role: 'assistant', content: '', tools: [tool] }]);
    } else if (event.type === 'approval_required') {
      const previous = toolsByIdRef.current.get(event.id);
      const waiting: ToolRun = { id: event.id, name: event.name, arguments: event.arguments, ...previous, status: 'approval', approvalId: event.approvalId };
      toolsByIdRef.current.set(event.id, waiting);
      setMessages((current) => current.map((message) => ({ ...message, tools: message.tools?.map((tool) => tool.id === event.id ? waiting : tool) })));
      setToolDetails((current) => current?.id === event.id ? waiting : current);
    } else if (event.type === 'tool_result') {
      const previous = toolsByIdRef.current.get(event.id);
      const found = previous ? { ...previous, status: event.ok ? 'success' as const : 'error' as const, result: event.result, error: event.error } : undefined;
      if (found) toolsByIdRef.current.set(event.id, found);
      setMessages((current) => current.map((message) => ({
        ...message,
        tools: message.tools?.map((tool) => tool.id === event.id ? (found || tool) : tool),
      })));
      if (found) setToolDetails((current) => current?.id === event.id ? found : current);
      if (found?.status === 'success') void updateAfterTool(found, event.result);
    } else if (event.type === 'assistant') {
      setMessages((current) => [...current, { id: id(), role: 'assistant', content: event.content }]);
    } else {
      setMessages((current) => [...current, { id: id(), role: 'assistant', content: `**Agent issue**\n\n${event.message}` }]);
    }
  };

  const sendMessage = async (value = draft) => {
    const text = value.trim();
    if (!text || busy) return;
    const nextUser: ChatMessage = { id: id(), role: 'user', content: text };
    const nextMessages = [...messages, nextUser];
    setMessages(nextMessages);
    setDraft('');
    setBusy(true);
    const turnId = ++turnSequenceRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const context = nextMessages.filter((message) => message.content).map(({ role, content }) => ({ role, content })).slice(-24);
      await streamAgent(projectRef.current?.id || null, context, (event) => { if (turnSequenceRef.current === turnId) handleAgentEvent(event); }, controller.signal);
    } catch (error) {
      if (turnSequenceRef.current === turnId && (error as Error).name !== 'AbortError') setMessages((current) => [...current, { id: id(), role: 'assistant', content: `**I couldn’t finish that turn.**\n\n${(error as Error).message}\n\nYour message is still in the conversation—try again when you’re ready.` }]);
    } finally {
      if (turnSequenceRef.current === turnId) { abortRef.current = null; setBusy(false); }
    }
  };

  const respondToToolApproval = async (approved: boolean) => {
    const tool = toolDetails;
    if (!tool?.approvalId || approvalBusy) return;
    setApprovalBusy(true);
    try {
      const editor = editorSnapshotRef.current;
      const currentProject = projectRef.current;
      if (approved && tool.name === 'rename_project' && currentProject && currentProject.id === String(tool.arguments.project_id) && editor.dirty && editor.path) {
        await api.saveFile(currentProject.id, editor.path, fileContent);
        setSavedContent(fileContent);
        await refreshTree(currentProject.id);
      }
      await api.approveTool(tool.approvalId, approved);
      setToolDetails(null);
    } catch (error) { setToast((error as Error).message); }
    finally { setApprovalBusy(false); }
  };

  const createDialog = (kind: 'file' | 'folder') => {
    setPathDialogName('');
    setDialog({ kind: 'path', mode: kind });
  };

  const editorOptions = useMemo(() => ({
    minimap: { enabled: false }, fontSize: 13, lineHeight: 23, fontFamily: '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
    fontLigatures: true, padding: { top: 18, bottom: 18 }, automaticLayout: true, scrollBeyondLastLine: false,
    wordWrap: 'on' as const, tabSize: 2, smoothScrolling: true, cursorBlinking: 'smooth' as const,
    renderLineHighlight: 'gutter' as const, overviewRulerBorder: false, hideCursorInOverviewRuler: true,
    guides: { indentation: false }, scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
  }), []);
  const handleEditorMount: OnMount = (editor, monaco) => {
    monaco.editor.defineTheme('ledger-midnight', {
      base: 'vs-dark', inherit: true, rules: [], colors: {
        'editor.background': '#111216', 'editorGutter.background': '#111216', 'editorLineNumber.foreground': '#535761',
        'editorLineNumber.activeForeground': '#adb1ba', 'editorCursor.foreground': '#53c7ed',
        'editor.selectionBackground': '#1c536b66', 'editor.lineHighlightBackground': '#ffffff05',
      },
    });
    monaco.editor.setTheme('ledger-midnight');
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => { void saveActiveFile(); });
  };

  const projectName = project?.name || 'No project selected';
  const imageOpen = (src: string, label: string) => setImage({ src, label });
  const approvalPath = typeof toolDetails?.arguments.path === 'string' ? toolDetails.arguments.path : '';
  const approvalHasUnsavedEdits = Boolean(dirty && toolDetails && (
    (toolDetails.name === 'delete_project' && String(toolDetails.arguments.project_id) === project?.id) ||
    (toolDetails.name === 'delete_path' && activePath && (activePath === approvalPath || activePath.startsWith(`${approvalPath}/`)))
  ));
  const deleteDescription = dialog?.kind === 'delete-project'
    ? `This permanently deletes ${dialog.project.name} and everything in Project/${dialog.project.id}/${dirty && project?.id === dialog.project.id ? ' Your unsaved editor changes will also be discarded.' : ''}`
    : dialog?.kind === 'delete-path'
      ? `This permanently deletes ${dialog.node.path}${dialog.node.type === 'directory' ? ' and everything inside it' : ''}${dirty && activePath && (activePath === dialog.node.path || activePath.startsWith(`${dialog.node.path}/`)) ? '. Your unsaved editor changes will also be discarded' : ''}.`
      : '';

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-branding">
          <button className={`icon-button hamburger ${sidebarOpen ? 'active' : ''}`} type="button" aria-label={sidebarOpen ? 'Hide workspace sidebar' : 'Show files and projects'} onClick={() => setSidebarOpen((open) => !open)}><Menu size={19} /></button>
          <BrandMark />
          <span className="brand-word">ledger<span>AI</span></span>
          <span className="header-separator" />
          <button className={`header-view ${view === 'chat' ? 'current' : ''}`} type="button" onClick={() => setView('chat')}><MessageSquareText size={14} /> Chat</button>
          {activePath && <button className={`header-view file-view-tab ${view === 'file' ? 'current' : ''}`} type="button" onClick={() => setView('file')}><LanguageIcon path={activePath} size={14} />{activePath.split('/').pop()} {dirty && <span className="dirty-dot" />}</button>}
        </div>
        <div className="header-actions">
          <div className="project-switch-wrap" ref={projectMenuRef}>
            <button className={`project-switcher ${projectMenuOpen ? 'open' : ''}`} type="button" onClick={() => setProjectMenuOpen((open) => !open)}><span className="project-indicator" /><span className="project-switch-name">{projectName}</span><ChevronDown size={14} /></button>
            {projectMenuOpen && <div className="project-menu">
              <div className="project-menu-label">YOUR PROJECTS <span>{projects.length}</span></div>
              {projects.map((item) => <button key={item.id} className={`project-menu-item ${project?.id === item.id ? 'selected' : ''}`} type="button" onClick={() => selectProject(item)}><span className="project-mini-icon"><Code2 size={14} /></span><span>{item.name}<small>Project/{item.id}</small></span>{project?.id === item.id && <Check size={15} />}</button>)}
              {projects.length === 0 && <p className="project-menu-empty">No projects yet</p>}
              <div className="project-menu-actions"><button type="button" onClick={() => { setCreatedDialogName(''); setDialog({ kind: 'project', mode: 'create' }); setProjectMenuOpen(false); }}><Plus size={14} /> New project</button>{project && <><button type="button" onClick={() => { setCreatedDialogName(project.name); setDialog({ kind: 'project', mode: 'rename' }); setProjectMenuOpen(false); }}><MoreHorizontal size={14} /> Rename</button><button type="button" className="danger-link" onClick={() => { setDialog({ kind: 'delete-project', project }); setProjectMenuOpen(false); }}><Trash2 size={14} /> Delete</button></>}</div>
            </div>}
          </div>
          <button className="header-new-project" type="button" onClick={() => { setCreatedDialogName(''); setDialog({ kind: 'project', mode: 'create' }); }}><Plus size={15} /><span>New project</span></button>
          <span className="header-status"><span className="online-dot" /> Agent ready</span>
        </div>
      </header>

      <div className={`workspace ${sidebarOpen ? 'sidebar-visible' : ''}`}>
        {sidebarOpen && <aside className="sidebar">
          <div className="sidebar-top"><div><span className="eyebrow">WORKSPACE</span><div className="sidebar-title">{sidebarTab === 'files' ? 'Explorer' : 'Projects'}</div></div><div className="sidebar-heading-actions">{sidebarTab === 'files' && <><FileIconButton title="New file" onClick={() => createDialog('file')}><FilePlus2 size={15} /></FileIconButton><FileIconButton title="New folder" onClick={() => createDialog('folder')}><FolderPlus size={15} /></FileIconButton></>}<FileIconButton title="Hide workspace sidebar" onClick={() => setSidebarOpen(false)}><PanelLeftClose size={15} /></FileIconButton></div></div>
          <div className="sidebar-tabs" role="tablist" aria-label="Workspace sidebar">
            <button id="files-tab" type="button" role="tab" aria-selected={sidebarTab === 'files'} aria-controls="files-panel" className={`sidebar-tab ${sidebarTab === 'files' ? 'active' : ''}`} onClick={() => setSidebarTab('files')}><Files size={14} /><span>Files</span></button>
            <button id="projects-tab" type="button" role="tab" aria-selected={sidebarTab === 'projects'} aria-controls="projects-panel" className={`sidebar-tab ${sidebarTab === 'projects' ? 'active' : ''}`} onClick={() => setSidebarTab('projects')}><FolderOpen size={14} /><span>Projects</span><span className="sidebar-tab-count">{projects.length}</span></button>
          </div>
          {sidebarTab === 'files' ? <div className="sidebar-tab-panel" id="files-panel" role="tabpanel" aria-labelledby="files-tab">
            <div className="sidebar-project"><div className="sidebar-project-icon"><Code2 size={15} /></div><div className="sidebar-project-copy"><strong>{projectName}</strong><small>{project ? `Project/${project.id}` : 'Choose a project'}</small></div><button type="button" className="icon-button sidebar-project-menu" title="Project options" onClick={() => setProjectMenuOpen((open) => !open)}><MoreHorizontal size={16} /></button></div>
            <div className="tree-heading"><span>FILES</span><span className="tree-root-label">{project?.id || 'No project'}</span></div>
            <div className="tree-scroll">
              {!project ? <div className="sidebar-empty"><Files size={21} /><strong>No project open</strong><span>Create or choose a project to browse its files.</span><button type="button" onClick={() => { setDialog({ kind: 'project', mode: 'create' }); setCreatedDialogName(''); }}><Plus size={14} /> Create project</button></div> : treeLoading ? <div className="tree-loading"><LoaderCircle size={14} className="spin" /> Loading files…</div> : <FileTree nodes={tree} activePath={activePath} onOpenFile={(path) => void openFile(path)} onDelete={(node) => setDialog({ kind: 'delete-path', node })} onFolderFocus={setActiveFolder} onPreviewImage={(path) => setImage({ src: api.assetUrl(project.id, path), label: path.split('/').pop() || path })} />}
            </div>
          </div> : <div className="projects-panel" id="projects-panel" role="tabpanel" aria-labelledby="projects-tab">
            <div className="projects-panel-heading"><button className="projects-create" type="button" aria-label="Create project" title="Create project" onClick={() => { setCreatedDialogName(''); setDialog({ kind: 'project', mode: 'create' }); }}><Plus size={18} /></button><div className="projects-heading-copy"><strong>Available projects</strong><span>Select one to open its files</span></div></div>
            <div className="projects-scroll">{projects.length ? projects.map((item) => <button key={item.id} type="button" className={`project-card ${project?.id === item.id ? 'selected' : ''}`} aria-current={project?.id === item.id ? 'page' : undefined} title={`Open ${item.name}`} onClick={() => { selectProject(item); setSidebarTab('files'); }}><span className="project-card-icon"><Code2 size={18} /></span><span className="project-card-copy"><strong>{item.name}</strong><small>Project/{item.id}</small></span>{project?.id === item.id && <span className="project-card-check"><Check size={15} /></span>}</button>) : <div className="projects-empty"><FolderOpen size={22} /><strong>No projects yet</strong><span>Create a project to give it a dedicated workspace.</span></div>}</div>
          </div>}
          <div className="sidebar-footer"><span className="sandbox-lock"><Command size={13} /> Sandboxed filesystem</span><span className="sandbox-state">Project/</span></div>
        </aside>}

        <main className="main-panel">
          {view === 'chat' ? (
            <section className="chat-view">
              <div className="chat-scroll" ref={scrollRef}>
                {messages.length === 0 ? (
                  <div className="welcome-screen">
                    <div className="welcome-mark"><BrandMark /></div>
                    <span className="welcome-kicker">YOUR AI DEVELOPMENT PARTNER</span>
                    <h1>What are we<br /><em>building?</em></h1>
                    <p>Think it through, work through the code, and keep moving.<br />Ledger works directly inside your project files.</p>
                    {project ? <div className="welcome-project"><span className="project-indicator" /> Working in <strong>{project.name}</strong><button type="button" onClick={() => setSidebarOpen(true)}>Browse files</button></div> : <button className="welcome-create" type="button" onClick={() => { setCreatedDialogName(''); setDialog({ kind: 'project', mode: 'create' }); }}><Plus size={15} /> Create your first project <span>· stored in Project/</span></button>}
                    <div className="starter-prompts">
                      {(project ? ['Explore this codebase', 'Help me plan a feature', 'Create a new file'] : ['Help me plan an app', 'How does the workspace work?', 'Start a new project']).map((prompt) => <button type="button" key={prompt} onClick={() => void sendMessage(prompt)}><Sparkles size={13} />{prompt}<ArrowUp size={12} /></button>)}
                    </div>
                  </div>
                ) : <div className="conversation-list">
                  {messages.map((message) => <article key={message.id} className={`message-row ${message.role}`}>
                    {message.role === 'assistant' && <div className="assistant-avatar"><BrandMark small /></div>}
                    <div className={`message-body ${message.role === 'user' ? 'user-body' : 'assistant-body'}`}>
                      {message.content && <MarkdownView content={message.content} projectId={project?.id} onImageOpen={imageOpen} onOpenFile={(path) => void openFile(path)} />}
                      {message.tools?.map((tool) => <ToolCallTile key={tool.id} tool={tool} onClick={setToolDetails} />)}
                    </div>
                  </article>)}
                  {busy && !messages.some((message) => message.tools?.some((tool) => tool.status === 'running')) && <div className="thinking-row"><div className="assistant-avatar"><BrandMark small /></div><span className="thinking-indicator"><span /><span /><span /></span><span>Ledger is thinking</span></div>}
                  <div className="scroll-end" />
                </div>}
              </div>
              <div className="composer-wrap">
                <div className={`composer ${busy ? 'is-busy' : ''}`}>
                  <textarea ref={draftRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} placeholder="Message Ledger…" rows={1} aria-label="Message Ledger" />
                  <div className="composer-bottom"><div className="composer-context"><span className="context-icon"><Sparkles size={13} /></span><span>{project ? <>Working in <strong>{project.name}</strong></> : 'Create a project to let Ledger work with your files'}</span></div><div className="composer-controls"><span className="enter-hint"><CornerDownLeft size={12} /> to send</span>{busy ? <button className="send-button stop-button" type="button" onClick={cancelAgentTurn} aria-label="Stop agent"><Square size={13} fill="currentColor" /></button> : <button className="send-button" type="button" onClick={() => void sendMessage()} disabled={!draft.trim()} aria-label="Send message"><ArrowUp size={18} /></button>}</div></div>
                </div>
                <div className="composer-footnote">Ledger can make mistakes. Review changes before shipping.</div>
              </div>
            </section>
          ) : (
            <section className="editor-view">
              <div className="editor-toolbar">
                <div className="editor-file-label">{activePath && <><LanguageIcon path={activePath} size={15} /><span>{activePath}</span>{dirty && <span className="dirty-label">Unsaved</span>}</>}</div>
                <div className="editor-toolbar-actions">
                  {activePath && /\.mdx?$/i.test(activePath) && <div className="preview-toggle"><button type="button" className={markdownPreview ? 'selected' : ''} onClick={() => setMarkdownPreview(true)}><Eye size={13} /> Preview</button><button type="button" className={!markdownPreview ? 'selected' : ''} onClick={() => setMarkdownPreview(false)}><Code2 size={13} /> Source</button></div>}
                  <button className={`save-file-button ${dirty ? 'dirty' : ''}`} type="button" disabled={!dirty || saving} onClick={() => void saveActiveFile()}>{saving ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />}<span>{saving ? 'Saving…' : 'Save'}</span><kbd>⌘ S</kbd></button>
                </div>
              </div>
              {activePath && markdownPreview && /\.mdx?$/i.test(activePath) ? <div className="markdown-file-scroll"><div className="markdown-file-paper"><span className="file-eyebrow"><LanguageIcon path={activePath} size={13} /> MARKDOWN DOCUMENT</span><MarkdownView content={fileContent} projectId={project?.id} filePath={activePath} onImageOpen={imageOpen} onOpenFile={(path) => void openFile(path)} /></div></div> : activePath ? <div className="monaco-wrap"><Editor height="100%" width="100%" path={activePath} language={languageForPath(activePath)} theme="ledger-midnight" value={fileContent} onChange={(value) => setFileContent(value || '')} onMount={handleEditorMount} options={editorOptions} loading={<div className="editor-loading"><LoaderCircle size={17} className="spin" /> Loading editor…</div>} /></div> : <div className="no-file-open"><BrandMark /><strong>Open a file to start editing</strong><span>Choose a file from the explorer or ask Ledger to create one.</span><button type="button" onClick={() => setSidebarOpen(true)}>Open explorer</button></div>}
              <div className="editor-statusbar"><span><span className="status-dot" /> {project?.name || 'No project'}</span><span>{activePath ? languageForPath(activePath) : 'Plain text'} <b>·</b> UTF-8 <b>·</b> LF</span></div>
            </section>
          )}
        </main>
      </div>

      {dialog?.kind === 'project' && <ModalFrame title={dialog.mode === 'create' ? 'Create a project' : 'Rename project'} description={dialog.mode === 'create' ? 'Every project gets its own folder inside the sandboxed Project directory.' : `The project folder will be renamed with “${createdDialogName.trim() || project?.name}”.`} onClose={() => setDialog(null)}>
        <form className="dialog-form" onSubmit={(event) => void handleProjectSubmit(event)}><label htmlFor="project-name">Project name</label><input autoFocus id="project-name" value={createdDialogName} onChange={(event) => setCreatedDialogName(event.target.value)} placeholder="e.g. atlas-dashboard" maxLength={64} /><small>Folder names are made safe automatically. Your files stay inside Project/.</small><div className="dialog-actions"><button className="quiet-button" type="button" onClick={() => setDialog(null)}>Cancel</button><button className="primary-button" type="submit" disabled={!createdDialogName.trim()}><Plus size={15} />{dialog.mode === 'create' ? 'Create project' : 'Save name'}</button></div></form>
      </ModalFrame>}

      {dialog?.kind === 'path' && <ModalFrame title={dialog.mode === 'file' ? 'Create a file' : 'Create a folder'} description={project ? `In ${project.name}${activeFolder ? ` / ${activeFolder}` : ''}` : 'Choose a project first.'} onClose={() => setDialog(null)}>
        <form className="dialog-form" onSubmit={(event) => void handlePathSubmit(event)}><label htmlFor="path-name">{dialog.mode === 'file' ? 'File name' : 'Folder name'}</label><input autoFocus id="path-name" value={pathDialogName} onChange={(event) => setPathDialogName(event.target.value)} placeholder={dialog.mode === 'file' ? 'component.tsx' : 'components'} /><small>{dialog.mode === 'file' ? 'The file opens in the editor after it is created.' : 'New folders are created inside the selected project folder.'}</small><div className="dialog-actions"><button className="quiet-button" type="button" onClick={() => setDialog(null)}>Cancel</button><button className="primary-button" type="submit" disabled={!project || !pathDialogName.trim()}>{dialog.mode === 'file' ? <FilePlus2 size={15} /> : <FolderPlus size={15} />}{dialog.mode === 'file' ? 'Create file' : 'Create folder'}</button></div></form>
      </ModalFrame>}

      {(dialog?.kind === 'delete-project' || dialog?.kind === 'delete-path') && <ModalFrame title={dialog.kind === 'delete-project' ? 'Delete this project?' : 'Delete this item?'} description={deleteDescription} onClose={() => setDialog(null)}><div className="delete-dialog-copy"><span className="delete-warning-icon"><Trash2 size={18} /></span><div><strong>This cannot be undone</strong><span>Make sure there is nothing here you still need.</span></div></div><div className="dialog-actions"><button className="quiet-button" type="button" onClick={() => setDialog(null)}>Keep it</button><button className="danger-button" type="button" onClick={() => void confirmDelete()} disabled={pendingDelete}>{pendingDelete ? <LoaderCircle size={14} className="spin" /> : <Trash2 size={14} />}Delete permanently</button></div></ModalFrame>}

      {pendingNavigation && <ModalFrame title="Unsaved changes" description={pendingNavigation.kind === 'project' ? `Save or discard the changes in ${activePath || 'the current file'} before switching to ${pendingNavigation.project?.name || 'another project'}.` : `Save or discard the changes in ${activePath || 'the current file'} before opening ${pendingNavigation.path}.`} onClose={() => setPendingNavigation(null)}>
        <div className="dirty-dialog-copy"><span className="dirty-warning-icon"><Save size={17} /></span><div><strong>{activePath}</strong><span>Your edits are only in the editor until you save.</span></div></div>
        <div className="dialog-actions"><button className="quiet-button" type="button" onClick={() => setPendingNavigation(null)}>Stay here</button><button className="quiet-button discard-button" type="button" onClick={() => void resolvePendingNavigation(false)}>Discard and continue</button><button className="primary-button" type="button" onClick={() => void resolvePendingNavigation(true)} disabled={saving}><Save size={14} />Save and continue</button></div>
      </ModalFrame>}

      {image && <ImageModal image={image} onClose={() => setImage(null)} />}
      {toolDetails && <ToolDetailsModal tool={toolDetails} onClose={() => setToolDetails(null)} onApproval={(approved) => void respondToToolApproval(approved)} approving={approvalBusy} hasUnsavedEdits={approvalHasUnsavedEdits} />}
      {toast && <div className="toast-message" role="status"><Check size={15} />{toast}<button type="button" aria-label="Dismiss notice" onClick={() => setToast('')}><X size={14} /></button></div>}
    </div>
  );
}
