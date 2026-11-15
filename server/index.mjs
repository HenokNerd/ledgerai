import './env.mjs';
import express from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PROJECTS_ROOT,
  FileSystemError,
  createProject,
  createProjectFolder,
  deleteProject,
  deleteProjectPath,
  ensureProjectsRoot,
  getProject,
  getProjectTree,
  imageAsset,
  listProjects,
  projectPath,
  editProjectFile,
  globProjectFiles,
  listProjectDirectory,
  readProjectFile,
  renameProject,
  writeProjectFile,
  writeProjectFileRecursive,
} from './filesystem.mjs';
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_FILES,
  UPLOADS_ROOT,
  deleteUpload,
  discardPartialUploads,
  ensureUploadsRoot,
  finalizeUploads,
  getUploadPreview,
  readUploadText,
  uploadMiddleware,
} from './uploads.mjs';
import { nvidiaChatCompletion, generateConversationMeta, validateNvidiaCredential } from './nvidia.mjs';
import {
  createChat,
  deleteChat,
  ensureChatsRoot,
  fallbackChatMeta,
  getChat,
  getChatIdBySlug,
  listChats,
  saveChat,
} from './chats.mjs';
import {
  TERMINAL_TOOL_NAMES,
  TERMINAL_TOOLS,
  addTerminalJobListener,
  addTerminalJobOutputListener,
  executeTerminalTool,
  getTerminalJob,
  getTerminalJobRaw,
  killTerminalJob,
  listTerminalJobs,
  terminalSettings,
} from './terminal.mjs';
import { buildSystemPrompt } from './system.mjs';

const app = express();
const port = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';
const pendingApprovals = new Map();
const receiveUploads = uploadMiddleware.array('files', MAX_UPLOAD_FILES);
const terminal = terminalSettings();
const APPROVAL_TOOLS = new Set([
  'rename_project',
  'delete_project',
  'delete_path',
  ...(terminal.enabled && terminal.approvalRequired ? ['terminal'] : []),
]);
const tools = [
  { type: 'function', function: { name: 'list_projects', description: 'List every project in the isolated Project directory.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: 'create_project', description: 'Create a project folder and starter README.md plus src/index.ts files.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Human-friendly project name.' } }, required: ['name'], additionalProperties: false } } },
  { type: 'function', function: { name: 'select_project', description: 'Select an existing project as the active project for this conversation, so subsequent file and terminal operations run in it. Use this to navigate to a newly created project or switch projects.', parameters: { type: 'object', properties: { project_id: { type: 'string', description: 'Project id to select.' } }, required: ['project_id'], additionalProperties: false } } },
  { type: 'function', function: { name: 'unselect_project', description: 'Clear the active project for this conversation so no project is selected.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: 'rename_project', description: 'Rename a project and its dedicated folder.', parameters: { type: 'object', properties: { project_id: { type: 'string' }, name: { type: 'string' } }, required: ['project_id', 'name'], additionalProperties: false } } },
  { type: 'function', function: { name: 'delete_project', description: 'Delete a named project and all of its files. Use only when the user clearly requests this deletion.', parameters: { type: 'object', properties: { project_id: { type: 'string' } }, required: ['project_id'], additionalProperties: false } } },
  { type: 'function', function: { name: 'list_files', description: 'List the project file tree, optionally within a relative folder.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Optional relative folder path.' } }, additionalProperties: false } } },
  { type: 'function', function: { name: 'read', description: 'Read a UTF-8 file in the active project. offset is 0-indexed; limit is the number of lines. If limit is omitted or 0, read through the end of the file.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path relative to the active project.' }, offset: { type: 'integer', minimum: 0, description: 'Starting line, 0-indexed.' }, limit: { type: 'integer', minimum: 0, description: 'Maximum lines to return.' } }, required: ['path'], additionalProperties: false } } },
  { type: 'function', function: { name: 'write', description: 'Create or overwrite a UTF-8 file in the active project, creating safe parent folders when needed. Files are limited to 1.5 MB.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path relative to the active project.' }, content: { type: 'string', description: 'Full UTF-8 file content.' } }, required: ['path', 'content'], additionalProperties: false } } },
  { type: 'function', function: { name: 'edit', description: 'Replace exact text in a UTF-8 project file. oldString must exist; by default it must match once. Set replaceAll to true to replace every non-overlapping match.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path relative to the active project.' }, oldString: { type: 'string', description: 'Exact text to replace.' }, newString: { type: 'string', description: 'Replacement text.' }, replaceAll: { type: 'boolean', description: 'Replace every occurrence instead of requiring one unique match.' } }, required: ['path', 'oldString', 'newString'], additionalProperties: false } } },
  { type: 'function', function: { name: 'ls', description: 'List up to 1,000 immediate entries in a project directory as name/type pairs. The result includes truncated=true when more entries remain. Symlinks and protected directories are not exposed.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Directory path relative to the active project; use an empty string for the root.' } }, required: ['path'], additionalProperties: false } } },
  { type: 'function', function: { name: 'cat', description: 'Read a UTF-8 project file; alias for read without line-range options.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path relative to the active project.' } }, required: ['path'], additionalProperties: false } } },
  { type: 'function', function: { name: 'glob', description: 'Find project files by a relative pattern using *, **, and ?. Optionally set cwd to a project-relative base folder. Search is bounded and skips symlinks, dependencies, and protected metadata.', parameters: { type: 'object', properties: { pattern: { type: 'string', description: 'Relative pattern, such as **/*.ts.' }, cwd: { type: 'string', description: 'Optional relative base directory within the project.' } }, required: ['pattern'], additionalProperties: false } } },
  { type: 'function', function: { name: 'read_file', description: 'Read a UTF-8 text file from the active project.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } } },
  { type: 'function', function: { name: 'create_file', description: 'Create a new UTF-8 file inside an existing project folder.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false } } },
  { type: 'function', function: { name: 'update_file', description: 'Create or replace the contents of a UTF-8 project file. Parent folders must already exist.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false } } },
  { type: 'function', function: { name: 'create_folder', description: 'Create a nested project folder. Its parent folder must already exist.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } } },
  { type: 'function', function: { name: 'delete_path', description: 'Delete the explicitly named file or folder within the active project. Use only on clear user request; deletion cannot be undone.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } } },
  { type: 'function', function: { name: 'read_attachment', description: 'Read an uploaded UTF-8 text attachment by its UUID. Binary files cannot be read as text; images are sent directly only when Vision is enabled.', parameters: { type: 'object', properties: { attachment_id: { type: 'string' } }, required: ['attachment_id'], additionalProperties: false } } },
  ...(terminal.enabled ? TERMINAL_TOOLS : []),
];

app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
await ensureProjectsRoot();
await ensureUploadsRoot();
await ensureChatsRoot();

const terminalSkill = terminal.enabled
  ? await fs.readFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'terminal.md'), 'utf8')
    .then((text) => text.slice(0, 18_000))
    .catch(() => '')
  : '';

function requireTerminal() {
  if (!terminal.enabled) {
    throw new FileSystemError('The terminal is disabled in this workspace. Set LEDGER_TERMINAL_ENABLED=true to enable it.', 403);
  }
}

function wrap(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

app.get('/api/health', wrap(async (_request, response) => {
  const credential = await validateNvidiaCredential();
  response.set('Cache-Control', 'no-store');
  response.json({
    ok: true,
    agentEnabled: credential.valid,
    agentError: credential.valid ? null : credential.error,
    terminalEnabled: terminal.enabled,
  });
}));

app.get('/api/terminal/capabilities', wrap(async (_request, response) => {
  response.set('Cache-Control', 'no-store');
  response.json(terminal);
}));

app.get('/api/terminal/jobs', wrap(async (request, response) => {
  requireTerminal();
  const ids = typeof request.query.ids === 'string'
    ? request.query.ids.split(',').map((value) => value.trim()).filter(Boolean).slice(0, 24)
    : undefined;
  const includeOutput = request.query.output === 'true' || request.query.include_output === 'true';
  const activeOnly = request.query.active === 'true' || request.query.active_only === 'true';
  response.set('Cache-Control', 'no-store');
  response.json({ jobs: listTerminalJobs({ ids, includeOutput, activeOnly }) });
}));

app.get('/api/terminal/jobs/:id', wrap(async (request, response) => {
  requireTerminal();
  const includeOutput = request.query.output !== 'false';
  response.set('Cache-Control', 'no-store');
  response.json({ job: getTerminalJob(request.params.id, { includeOutput }) });
}));

app.get('/api/terminal/jobs/:id/stream', (request, response, next) => {
  try {
    requireTerminal();
    const job = getTerminalJobRaw(request.params.id);
    response.status(200);
    response.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    if (typeof response.flushHeaders === 'function') response.flushHeaders();

    const send = (type, value) => {
      if (response.writableEnded) return;
      response.write(`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`);
    };

    send('snapshot', {
      jobId: job.id,
      command: job.displayCommand,
      status: job.status,
      exitCode: job.exitCode,
      signal: job.signal,
      stdout: job.stdout.toString(),
      stderr: job.stderr.toString(),
    });

    if (job.finalized) {
      send('exit', getTerminalJob(job.id, { includeOutput: true }));
      response.end();
      return;
    }

    const removeOutput = addTerminalJobOutputListener(job.id, (stream, chunk) => send('output', { stream, chunk }));
    const removeExit = addTerminalJobListener(job.id, (summary) => {
      send('exit', summary);
      cleanup();
      response.end();
    });

    let heartbeat;
    const cleanup = () => {
      if (heartbeat) clearInterval(heartbeat);
      removeOutput();
      removeExit();
      request.off('close', cleanup);
    };
    heartbeat = setInterval(() => {
      if (!response.writableEnded) response.write(': keepalive\n\n');
    }, 15_000);
    heartbeat.unref?.();

    request.on('close', cleanup);
  } catch (error) {
    next(error);
  }
});

app.post('/api/terminal/jobs/:id/kill', wrap(async (request, response) => {
  requireTerminal();
  const signal = typeof request.body?.signal === 'string' ? request.body.signal : 'SIGTERM';
  response.json({ job: killTerminalJob(request.params.id, signal) });
}));
app.get('/api/projects', wrap(async (_request, response) => response.json(await listProjects())));app.post('/api/projects', wrap(async (request, response) => response.status(201).json(await createProject(request.body?.name))));
app.patch('/api/projects/:id', wrap(async (request, response) => response.json(await renameProject(request.params.id, request.body?.name))));
app.delete('/api/projects/:id', wrap(async (request, response) => response.json(await deleteProject(request.params.id))));
app.get('/api/projects/:id/tree', wrap(async (request, response) => response.json(await getProjectTree(request.params.id, request.query.path || ''))));
app.get('/api/projects/:id/file', wrap(async (request, response) => response.json(await readProjectFile(request.params.id, request.query.path))));
app.post('/api/projects/:id/files', wrap(async (request, response) => response.status(201).json(await writeProjectFile(request.params.id, request.body?.path, request.body?.content ?? '', { createOnly: true }))));
app.put('/api/projects/:id/file', wrap(async (request, response) => response.json(await writeProjectFile(request.params.id, request.body?.path, request.body?.content))));
app.post('/api/projects/:id/folders', wrap(async (request, response) => response.status(201).json(await createProjectFolder(request.params.id, request.body?.path))));
app.delete('/api/projects/:id/path', wrap(async (request, response) => response.json(await deleteProjectPath(request.params.id, request.query.path))));
app.get('/api/projects/:id/asset', wrap(async (request, response) => {
  const asset = await imageAsset(request.params.id, request.query.path);
  response.set('Cache-Control', 'no-store');
  response.sendFile(asset);
}));

app.get('/api/chats', wrap(async (_request, response) => response.json(await listChats())));
app.get('/api/chats/slug/:slug', wrap(async (request, response) => {
  const chatId = await getChatIdBySlug(request.params.slug);
  const chat = await getChat(chatId);
  response.json(chat);
}));
app.post('/api/chats', wrap(async (request, response) => response.status(201).json(await createChat(request.body || {}))));
app.post('/api/chats/meta', wrap(async (request, response) => {
  const text = String(request.body?.text ?? '').slice(0, 4_000);
  const firstPrompt = String(request.body?.firstPrompt ?? text ?? '').slice(0, 4_000);
  if (!firstPrompt.trim() && !text.trim()) throw new FileSystemError('A first message is required to title a conversation.');
  const projectName = typeof request.body?.projectName === 'string' ? request.body.projectName.slice(0, 120) : '';
  const firstResponse = typeof request.body?.firstResponse === 'string' ? request.body.firstResponse.slice(0, 6_000) : '';
  const secondPrompt = typeof request.body?.secondPrompt === 'string' ? request.body.secondPrompt.slice(0, 4_000) : '';
  const currentTitle = typeof request.body?.currentTitle === 'string' ? request.body.currentTitle.slice(0, 120) : '';
  const currentIcon = typeof request.body?.currentIcon === 'string' ? request.body.currentIcon.slice(0, 80) : '';
  const generated = await generateConversationMeta({ text, projectName, firstPrompt, firstResponse, secondPrompt, currentTitle, currentIcon });
  response.set('Cache-Control', 'no-store');
  response.json(generated || fallbackChatMeta(firstPrompt || text));
}));
app.get('/api/chats/:id', wrap(async (request, response) => {
  const limit = Math.min(Math.max(Number(request.query.limit) || 5, 1), 200);
  const before = typeof request.query.before === 'string' ? request.query.before : undefined;
  response.json(await getChat(request.params.id, { limit, before }));
}));
app.put('/api/chats/:id', wrap(async (request, response) => response.json(await saveChat(request.params.id, request.body || {}))));
app.delete('/api/chats/:id', wrap(async (request, response) => response.json(await deleteChat(request.params.id))));

app.post('/api/uploads', (request, response, next) => {
  receiveUploads(request, response, async (uploadError) => {
    const files = Array.isArray(request.files) ? request.files : [];
    if (uploadError) {
      await discardPartialUploads(files);
      if (uploadError.code === 'LIMIT_FILE_SIZE') return next(new FileSystemError('Each attachment must be 10 MB or smaller.', 413));
      if (['LIMIT_FILE_COUNT', 'LIMIT_PART_COUNT', 'LIMIT_UNEXPECTED_FILE'].includes(uploadError.code)) {
        return next(new FileSystemError('Attach up to 50 files at a time.', 413));
      }
      return next(new FileSystemError('The selected files could not be uploaded.', Number(uploadError.status) || 400));
    }
    if (!files.length) return next(new FileSystemError('Choose at least one file to upload.', 400));
    try {
      const saved = await finalizeUploads(files);
      response.status(201).json({ files: saved });
    } catch (error) {
      await discardPartialUploads(files);
      next(error);
    }
  });
});
app.delete('/api/uploads/:id', wrap(async (request, response) => response.json(await deleteUpload(request.params.id))));
app.get('/api/uploads/:id/preview', wrap(async (request, response) => {
  const asset = await getUploadPreview(request.params.id);
  response.set({
    'Content-Type': asset.mimeType,
    'Content-Disposition': 'inline',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  });
  response.send(asset.buffer);
}));

app.post('/api/chat/approvals/:approvalId', wrap(async (request, response) => {
  const approval = pendingApprovals.get(request.params.approvalId);
  if (!approval) throw new FileSystemError('This approval request has expired.', 404);
  if (typeof request.body?.approved !== 'boolean') throw new FileSystemError('Choose whether to approve this filesystem action.');
  pendingApprovals.delete(request.params.approvalId);
  clearTimeout(approval.timer);
  approval.resolve(request.body.approved);
  response.json({ ok: true });
}));

async function runTool(name, args, activeProjectId, context = {}) {
  if (TERMINAL_TOOL_NAMES.has(name)) {
    return executeTerminalTool(name, args, { ...context, projectId: activeProjectId });
  }
  switch (name) {
    case 'list_projects': return { projects: await listProjects() };
    case 'create_project': return { project: await createProject(args.name) };
    case 'select_project': return { project: await getProject(args.project_id), selected: true };
    case 'unselect_project': return { project: null, selected: false };
    case 'rename_project': return { project: await renameProject(args.project_id, args.name) };
    case 'delete_project': return await deleteProject(args.project_id);
    case 'list_files': {
      if (!activeProjectId) throw new FileSystemError('Create or select a project before listing its files.', 409);
      return { project: await getProject(activeProjectId), path: args.path || '', files: await getProjectTree(activeProjectId, args.path || '') };
    }
    case 'read': {
      if (!activeProjectId) throw new FileSystemError('Create or select a project before reading files.', 409);
      const file = await readProjectFile(activeProjectId, args.path);
      const offset = args.offset === undefined ? 0 : args.offset;
      const limit = args.limit === undefined ? 0 : args.limit;
      if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 0) throw new FileSystemError('offset and limit must be non-negative integers.');
      const lines = file.content.split('\n');
      const selected = limit > 0 ? lines.slice(offset, offset + limit) : lines.slice(offset);
      return { path: file.path, content: selected.join('\n'), offset, returnedLines: selected.length, totalLines: lines.length };
    }
    case 'cat': {
      if (!activeProjectId) throw new FileSystemError('Create or select a project before reading files.', 409);
      return await readProjectFile(activeProjectId, args.path);
    }
    case 'write': {
      if (!activeProjectId) throw new FileSystemError('Create or select a project before writing files.', 409);
      return await writeProjectFileRecursive(activeProjectId, args.path, args.content);
    }
    case 'edit': {
      if (!activeProjectId) throw new FileSystemError('Create or select a project before editing files.', 409);
      return await editProjectFile(activeProjectId, args.path, args.oldString, args.newString, args.replaceAll ?? false);
    }
    case 'ls': {
      if (!activeProjectId) throw new FileSystemError('Create or select a project before listing files.', 409);
      return { path: args.path || '', ...await listProjectDirectory(activeProjectId, args.path || '') };
    }
    case 'glob': {
      if (!activeProjectId) throw new FileSystemError('Create or select a project before searching its files.', 409);
      const result = await globProjectFiles(activeProjectId, args.pattern, args.cwd || '');
      return { cwd: args.cwd || '', pattern: args.pattern, ...result };
    }
    case 'read_file': {
      if (!activeProjectId) throw new FileSystemError('Create or select a project before reading files.', 409);
      return await readProjectFile(activeProjectId, args.path);
    }
    case 'create_file': {
      if (!activeProjectId) throw new FileSystemError('Create or select a project before creating files.', 409);
      return await writeProjectFile(activeProjectId, args.path, args.content, { createOnly: true });
    }
    case 'update_file': {
      if (!activeProjectId) throw new FileSystemError('Create or select a project before editing files.', 409);
      return await writeProjectFile(activeProjectId, args.path, args.content);
    }
    case 'create_folder': {
      if (!activeProjectId) throw new FileSystemError('Create or select a project before creating folders.', 409);
      return await createProjectFolder(activeProjectId, args.path);
    }
    case 'delete_path': {
      if (!activeProjectId) throw new FileSystemError('Create or select a project before deleting files.', 409);
      return await deleteProjectPath(activeProjectId, args.path);
    }
    case 'read_attachment': return await readUploadText(args.attachment_id);
    default: throw new FileSystemError('Unknown filesystem tool.', 400);
  }
}

function sendEvent(response, type, value) {
  response.write(`data: ${JSON.stringify({ type, ...value })}\n\n`);
}

function contentChars(content) {
  if (typeof content === 'string') return content.length;
  if (Array.isArray(content)) {
    return content.reduce((sum, part) => {
      if (!part || typeof part !== 'object') return sum;
      if (part.type === 'text' && typeof part.text === 'string') return sum + part.text.length;
      if (part.type === 'image_url') return sum + 1_500; // rough image payload overhead
      return sum + JSON.stringify(part).length;
    }, 0);
  }
  return content == null ? 0 : JSON.stringify(content).length;
}

function measureContext(messages) {
  let systemChars = 0;
  let historyChars = 0;
  let historyMessages = 0;
  let toolMessages = 0;
  for (const message of messages) {
    const chars = contentChars(message?.content) + (Array.isArray(message?.tool_calls) ? JSON.stringify(message.tool_calls).length : 0);
    if (message?.role === 'system') systemChars += chars;
    else {
      historyMessages += 1;
      historyChars += chars;
      if (message?.role === 'tool' || Array.isArray(message?.tool_calls)) toolMessages += 1;
    }
  }
  const totalChars = systemChars + historyChars;
  return {
    systemChars,
    historyMessages,
    historyChars,
    toolMessages,
    totalChars,
    approxTokens: Math.ceil(totalChars / 4),
  };
}

function waitForApproval(response, id, name, args) {
  const approvalId = randomUUID();
  const result = new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingApprovals.delete(approvalId);
      resolve(false);
    }, 120_000);
    pendingApprovals.set(approvalId, { resolve, timer, response });
  });
  sendEvent(response, 'approval_required', { id, approvalId, name, arguments: args });
  return result;
}

app.post('/api/chat', async (request, response) => {
  response.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  response.flushHeaders();
  let clientGone = false;
  const turnController = new AbortController();
  const heartbeat = setInterval(() => { if (!response.writableEnded) response.write(': keepalive\n\n'); }, 15_000);
  response.on('close', () => {
    clientGone = true;
    turnController.abort();
    clearInterval(heartbeat);
    for (const [approvalId, approval] of pendingApprovals) {
      if (approval.response !== response) continue;
      pendingApprovals.delete(approvalId);
      clearTimeout(approval.timer);
      approval.resolve(false);
    }
  });

  try {
    const credential = await validateNvidiaCredential();
    if (!credential.valid) throw new FileSystemError(credential.error || 'The AI service is unavailable.', 503);

    let activeProjectId = request.body?.projectId || null;
    const activeProject = activeProjectId ? await getProject(activeProjectId) : null;
    const rawHistory = Array.isArray(request.body?.messages) ? request.body.messages : [];
    const filteredHistory = rawHistory.filter((item) => {
      if (!item || typeof item !== 'object') return false;
      if (item.role === 'tool') return typeof item.tool_call_id === 'string' && (typeof item.content === 'string' || item.content == null);
      if (!['user', 'assistant', 'system'].includes(item.role)) return false;
      return typeof item.content === 'string' || Array.isArray(item.content) || Array.isArray(item.tool_calls);
    });
    const HISTORY_LIMIT = 80;
    const droppedMessages = Math.max(0, filteredHistory.length - HISTORY_LIMIT);
    const history = filteredHistory
      .slice(-HISTORY_LIMIT)
      .map((item) => {
        const content = typeof item.content === 'string'
          ? item.content.slice(0, 12_000)
          : Array.isArray(item.content)
            ? item.content
            : '';
        const mapped = { role: item.role, content };
        if (item.role === 'user' && Array.isArray(item.attachmentIds)) {
          mapped.attachmentIds = item.attachmentIds.filter((id) => typeof id === 'string').slice(0, MAX_UPLOAD_FILES);
        }
        if (item.role === 'system' && item.meta && typeof item.meta === 'object') {
          mapped.meta = item.meta;
        }
        if (item.role === 'assistant' && Array.isArray(item.tool_calls)) {
          mapped.tool_calls = item.tool_calls
            .filter((call) => call && typeof call === 'object' && typeof call.id === 'string')
            .slice(0, 50)
            .map((call) => ({
              id: call.id,
              type: call.type || 'function',
              function: {
                name: String(call.function?.name || ''),
                arguments: typeof call.function?.arguments === 'string' ? call.function.arguments.slice(0, 20_000) : JSON.stringify(call.function?.arguments ?? {}),
              },
            }));
        }
        if (item.role === 'tool' && typeof item.tool_call_id === 'string') {
          mapped.tool_call_id = item.tool_call_id;
          mapped.content = typeof item.content === 'string' ? item.content.slice(0, 40_000) : '';
        }
        return mapped;
      });
    if (history.length === 0 || !['user', 'system'].includes(history.at(-1)?.role)) throw new FileSystemError('Send a message to start a conversation.');
    const vision = request.body?.vision === true;
    const imageOrigin = typeof request.body?.imageOrigin === 'string' ? request.body.imageOrigin : '';

    const system = await buildSystemPrompt({
      activeProject,
      terminal,
      vision,
      terminalSkill,
    });
    const messages = [{ role: 'system', content: system }, ...history];
    sendEvent(response, 'context', {
      stats: {
        ...measureContext(messages),
        stage: 'start',
        receivedMessages: rawHistory.length,
        filteredMessages: filteredHistory.length,
        usedMessages: history.length,
        droppedMessages,
      },
    });
    let callCount = 0;

    let completionModel;
    for (;;) {
      if (clientGone) return;
      let payload = await nvidiaChatCompletion(messages, { vision, imageOrigin, model: completionModel }, tools);
      let assistant = payload?.choices?.[0]?.message;
      if (!assistant) throw new Error('The AI service returned no response. Try again.');
      let calls = Array.isArray(assistant.tool_calls) ? assistant.tool_calls : [];
      let content = typeof assistant.content === 'string' ? assistant.content : Array.isArray(assistant.content)
        ? assistant.content.filter((part) => part?.type === 'text').map((part) => part.text).join('\n')
        : '';
      if (calls.length === 0 && !String(content || '').trim() && !completionModel) {
        const primaryModel = vision
          ? (process.env.LEDGER_VISION_MODEL?.trim() || 'nvidia/nemotron-3.5-super-vl-120b-a12b')
          : (process.env.LEDGER_STANDARD_MODEL?.trim() || 'nvidia/nemotron-3-ultra-550b-a55b');
        const fallbackModel = process.env.LEDGER_FALLBACK_MODEL?.trim()
          || (primaryModel.includes('550b') ? 'nvidia/nemotron-3.5-super-vl-120b-a12b' : 'nvidia/nemotron-3-ultra-550b-a55b');
        completionModel = fallbackModel;
        console.warn(`[ledger-agent] empty completion from primary model ${primaryModel}; retrying once with Nemotron fallback ${fallbackModel}`);
        payload = await nvidiaChatCompletion(messages, { vision, imageOrigin, model: fallbackModel }, tools);
        assistant = payload?.choices?.[0]?.message;
        if (!assistant) throw new Error('The AI service returned no response. Try again.');
        calls = Array.isArray(assistant.tool_calls) ? assistant.tool_calls : [];
        content = typeof assistant.content === 'string' ? assistant.content : Array.isArray(assistant.content)
          ? assistant.content.filter((part) => part?.type === 'text').map((part) => part.text).join('\n')
          : '';
      }
      if (calls.length === 0) {
        sendEvent(response, 'assistant', { content: String(content || '').trim() || 'I could not produce a text response. Please try again.' });
        response.end();
        return;
      }

      messages.push({ role: 'assistant', content: typeof assistant.content === 'string' ? assistant.content : '', tool_calls: calls });
      for (const call of calls) {
        if (clientGone) return;
        callCount += 1;
        const name = call.function?.name || 'unknown_tool';
        let args = {};
        try { args = JSON.parse(call.function?.arguments || '{}'); } catch { /* Malformed tool input becomes a tool result. */ }
        const id = call.id || `tool-${callCount}`;
        sendEvent(response, 'tool_start', { tool: { id, name, arguments: args } });
        let toolResult;
        try {
          if (APPROVAL_TOOLS.has(name)) {
            const approved = await waitForApproval(response, id, name, args);
            if (clientGone) return;
            if (!approved) throw new FileSystemError(name === 'terminal' ? 'The user declined this terminal command.' : 'The user declined this filesystem action.', 403);
          }
          const result = await runTool(name, args, activeProjectId, {
            toolId: id,
            signal: turnController.signal,
            onOutput: (toolId, stream, chunk, jobId) => {
              if (!clientGone && !response.writableEnded) sendEvent(response, 'tool_output', { id: toolId, jobId, stream, chunk });
            },
            onExit: (toolId, summary) => {
              if (!clientGone && !response.writableEnded) sendEvent(response, 'terminal_exit', { id: toolId, ...summary });
            },
          });
          toolResult = { ok: true, result };
          if (name === 'create_project' && !activeProjectId) activeProjectId = result.project.id;
          if (name === 'select_project' && result?.project?.id) activeProjectId = result.project.id;
          if (name === 'unselect_project') activeProjectId = null;
          if (name === 'rename_project' && activeProjectId === result.project.previousId) activeProjectId = result.project.id;
          if (name === 'delete_project' && activeProjectId === result.project.id) activeProjectId = null;
        } catch (error) {
          toolResult = { ok: false, error: error.message || 'Filesystem operation failed.' };
        }
        sendEvent(response, 'tool_result', { id, ...toolResult });
        messages.push({ role: 'tool', tool_call_id: id, content: JSON.stringify(toolResult).slice(0, 40_000) });
      }
      sendEvent(response, 'context', { stats: { ...measureContext(messages), stage: 'loop' } });
    }
  } catch (error) {
    if (clientGone) return;
    const message = error instanceof FileSystemError ? error.message : 'The AI service could not complete this request. Check the connection or attachments and try again.';
    sendEvent(response, 'error', { message });
    response.end();
  } finally {
    clearInterval(heartbeat);
  }
});

app.use((error, _request, response, _next) => {
  const status = error instanceof FileSystemError ? error.status : Number(error?.status) || 500;
  if (response.headersSent) {
    if (!response.writableEnded) response.end();
    return;
  }
  const message = status >= 500 && !(error instanceof FileSystemError) ? 'Request failed. Please try again.' : error.message || 'Request failed.';
  response.status(status).json({ error: message });
});

if (isProduction) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dist = path.join(root, 'dist');
  // Long-cache hashed assets; never cache index.html.
  app.use(express.static(dist, {
    index: false,
    maxAge: '1y',
    immutable: true,
    setHeaders: (response, filePath) => {
      if (filePath.endsWith('.html')) {
        response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
    },
  }));
  app.get('*path', (_request, response) => {
    response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    response.sendFile(path.join(dist, 'index.html'));
  });
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({ configFile: path.resolve('vite.config.ts'), server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

app.listen(port, '0.0.0.0', () => {
  console.log(`Workspace listening on 0.0.0.0:${port}`);
  console.log(`Projects directory: ${PROJECTS_ROOT}`);
  console.log(`Uploads directory: ${UPLOADS_ROOT}`);
});
