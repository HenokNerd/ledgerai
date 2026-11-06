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
  readProjectFile,
  renameProject,
  writeProjectFile,
} from './filesystem.mjs';

const app = express();
const port = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';
const pendingApprovals = new Map();
const tools = [
  { type: 'function', function: { name: 'list_projects', description: 'List every project in the isolated Project directory.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: 'create_project', description: 'Create a project folder and starter README.md plus src/index.ts files.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Human-friendly project name.' } }, required: ['name'], additionalProperties: false } } },
  { type: 'function', function: { name: 'rename_project', description: 'Rename a project and its dedicated folder.', parameters: { type: 'object', properties: { project_id: { type: 'string' }, name: { type: 'string' } }, required: ['project_id', 'name'], additionalProperties: false } } },
  { type: 'function', function: { name: 'delete_project', description: 'Delete a named project and all of its files. Use only when the user clearly requests this deletion.', parameters: { type: 'object', properties: { project_id: { type: 'string' } }, required: ['project_id'], additionalProperties: false } } },
  { type: 'function', function: { name: 'list_files', description: 'List the project file tree, optionally within a relative folder.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Optional relative folder path.' } }, additionalProperties: false } } },
  { type: 'function', function: { name: 'read_file', description: 'Read a UTF-8 text file from the active project.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } } },
  { type: 'function', function: { name: 'create_file', description: 'Create a new UTF-8 file inside an existing project folder.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false } } },
  { type: 'function', function: { name: 'update_file', description: 'Create or replace the contents of a UTF-8 project file. Parent folders must already exist.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false } } },
  { type: 'function', function: { name: 'create_folder', description: 'Create a nested project folder. Its parent folder must already exist.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } } },
  { type: 'function', function: { name: 'delete_path', description: 'Delete the explicitly named file or folder within the active project. Use only on clear user request; deletion cannot be undone.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } } },
];

app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
await ensureProjectsRoot();

function wrap(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

app.get('/api/health', (_request, response) => response.json({ ok: true }));
app.get('/api/projects', wrap(async (_request, response) => response.json(await listProjects())));
app.post('/api/projects', wrap(async (request, response) => response.status(201).json(await createProject(request.body?.name))));
app.patch('/api/projects/:id', wrap(async (request, response) => response.json(await renameProject(request.params.id, request.body?.name))));
app.delete('/api/projects/:id', wrap(async (request, response) => response.json(await deleteProject(request.params.id))));
app.get('/api/projects/:id/tree', wrap(async (request, response) => response.json(await getProjectTree(request.params.id, request.query.path || ''))));
app.get('/api/projects/:id/file', wrap(async (request, response) => response.json(await readProjectFile(request.params.id, request.query.path))));
app.post('/api/projects/:id/files', wrap(async (request, response) => response.status(201).json(await writeProjectFile(request.params.id, request.body?.path, request.body?.content ?? '', { createOnly: true }))));
app.put('/api/projects/:id/file', wrap(async (request, response) => response.json(await writeProjectFile(request.params.id, request.body?.path, request.body?.content))));
app.post('/api/projects/:id/folders', wrap(async (request, response) => response.status(201).json(await createProjectFolder(request.params.id, request.body?.path))));
app.delete('/api/projects/:id/path', wrap(async (request, response) => response.json(await deleteProjectPath(request.params.id, request.query.path))));
app.post('/api/chat/approvals/:approvalId', wrap(async (request, response) => {
  const approval = pendingApprovals.get(request.params.approvalId);
  if (!approval) throw new FileSystemError('This approval request has expired.', 404);
  if (typeof request.body?.approved !== 'boolean') throw new FileSystemError('Choose whether to approve this filesystem action.');
  pendingApprovals.delete(request.params.approvalId);
  clearTimeout(approval.timer);
  approval.resolve(request.body.approved);
  response.json({ ok: true });
}));
app.get('/api/projects/:id/asset', wrap(async (request, response) => {
  const asset = await imageAsset(request.params.id, request.query.path);
  response.set('Cache-Control', 'no-store');
  response.sendFile(asset);
}));

async function runTool(name, args, activeProjectId) {
  switch (name) {
    case 'list_projects': return { projects: await listProjects() };
    case 'create_project': return { project: await createProject(args.name) };
    case 'rename_project': return { project: await renameProject(args.project_id, args.name) };
    case 'delete_project': return await deleteProject(args.project_id);
    case 'list_files': {
      const projectId = activeProjectId;
      if (!projectId) throw new FileSystemError('Create or select a project before listing its files.', 409);
      return { project: await getProject(projectId), path: args.path || '', files: await getProjectTree(projectId, args.path || '') };
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
    default: throw new FileSystemError(`Unknown filesystem tool: ${name}`, 400);
  }
}

function sendEvent(response, type, value) {
  response.write(`data: ${JSON.stringify({ type, ...value })}\n\n`);
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

app.post('/api/chat', async (request, response, next) => {
  if (process.env.LEDGER_AGENT_ENABLED === 'false') {
    response.status(503).json({ error: 'The AI agent is disabled for this deployment.' });
    return;
  }
  response.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  response.flushHeaders();
  let clientGone = false;
  const heartbeat = setInterval(() => { if (!response.writableEnded) response.write(': keepalive\n\n'); }, 15_000);
  response.on('close', () => {
    clientGone = true;
    clearInterval(heartbeat);
    for (const [approvalId, approval] of pendingApprovals) {
      if (approval.response !== response) continue;
      pendingApprovals.delete(approvalId);
      clearTimeout(approval.timer);
      approval.resolve(false);
    }
  });

  try {
    const serviceUrl = process.env.MANUS_API_URL;
    const serviceKey = process.env.MANUS_API_KEY;
    if (!serviceUrl || !serviceKey) throw new FileSystemError('The managed AI service is not configured for this workspace.', 503);

    let activeProjectId = request.body?.projectId || null;
    const activeProject = activeProjectId ? await getProject(activeProjectId) : null;
    const history = Array.isArray(request.body?.messages)
      ? request.body.messages.filter((item) => ['user', 'assistant'].includes(item?.role) && typeof item?.content === 'string').slice(-30).map((item) => ({ role: item.role, content: item.content.slice(0, 12_000) }))
      : [];
    if (history.length === 0 || history.at(-1)?.role !== 'user') throw new FileSystemError('Send a message to start a conversation.');

    const system = [
      'You are Ledger, a careful AI coding agent inside a minimalist development workspace.',
      'Use only the declared filesystem tools for project operations. Never suggest or simulate a terminal, shell, or process runner; this workspace has no terminal.',
      'You may inspect, create, edit, and delete project files only through the tools. Project paths are relative to the active project. Do not claim a change succeeded until its tool returned successfully.',
      'Explain important changes briefly in clear Markdown. If asked to make a code change, inspect the relevant files first and use the filesystem tools, then summarize the files changed.',
      'Only delete a specific file, folder, or project when the user clearly asks you to delete it. Before a rename or deletion executes, the workspace asks the user for explicit approval. A tool deletion is permanent.',
      activeProject ? `Active project: ${activeProject.name} (folder ${activeProject.id}). File tools target this project.` : 'No project is currently selected. You may list or create projects; project-scoped file tools will explain that a project is needed.',
    ].join('\n\n');
    const messages = [{ role: 'system', content: system }, ...history];
    let callCount = 0;

    for (let round = 0; round < 7; round += 1) {
      if (clientGone) return;
      const upstream = await fetch(`${serviceUrl.replace(/\/$/, '')}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ messages, tools, tool_choice: 'auto' }),
        signal: AbortSignal.timeout(90_000),
      });
      let payload;
      try { payload = await upstream.json(); } catch { payload = {}; }
      if (!upstream.ok || payload?.error) throw new Error(payload?.error?.message || `The AI service returned HTTP ${upstream.status}.`);
      const assistant = payload?.choices?.[0]?.message;
      if (!assistant) throw new Error('The AI service returned no response. Try again.');
      const calls = Array.isArray(assistant.tool_calls) ? assistant.tool_calls : [];
      if (calls.length === 0) {
        sendEvent(response, 'assistant', { content: typeof assistant.content === 'string' ? assistant.content : 'I could not produce a text response. Please try again.' });
        response.end();
        return;
      }

      messages.push({ role: 'assistant', content: assistant.content || '', tool_calls: calls });
      for (const call of calls) {
        if (clientGone) return;
        callCount += 1;
        if (callCount > 12) throw new Error('This request reached the filesystem action limit. Ask me to continue with the remaining steps.');
        const name = call.function?.name || 'unknown_tool';
        let args = {};
        try { args = JSON.parse(call.function?.arguments || '{}'); } catch { /* Surface malformed tool input as a tool result. */ }
        const id = call.id || `tool-${callCount}`;
        sendEvent(response, 'tool_start', { tool: { id, name, arguments: args } });
        let toolResult;
        try {
          if (['rename_project', 'delete_project', 'delete_path'].includes(name)) {
            const approved = await waitForApproval(response, id, name, args);
            if (clientGone) return;
            if (!approved) throw new FileSystemError('The user declined this filesystem action.', 403);
          }
          const result = await runTool(name, args, activeProjectId);
          toolResult = { ok: true, result };
          if (name === 'create_project' && !activeProjectId) activeProjectId = result.project.id;
          if (name === 'rename_project' && activeProjectId === result.project.previousId) activeProjectId = result.project.id;
          if (name === 'delete_project' && activeProjectId === result.project.id) activeProjectId = null;
        } catch (error) {
          toolResult = { ok: false, error: error.message || 'Filesystem operation failed.' };
        }
        sendEvent(response, 'tool_result', { id, ...toolResult });
        messages.push({ role: 'tool', tool_call_id: id, content: JSON.stringify(toolResult).slice(0, 40_000) });
      }
    }
    sendEvent(response, 'assistant', { content: 'I reached the action limit for this turn. Ask me to continue.' });
    response.end();
  } catch (error) {
    if (clientGone) return;
    sendEvent(response, 'error', { message: error.message || 'The agent could not complete this request.' });
    response.end();
  }
});

app.use((error, _request, response, _next) => {
  const status = error instanceof FileSystemError ? error.status : Number(error?.status) || 500;
  if (response.headersSent) {
    if (!response.writableEnded) response.end();
    return;
  }
  response.status(status).json({ error: error.message || 'Request failed.' });
});

if (isProduction) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dist = path.join(root, 'dist');
  app.use(express.static(dist, { index: false }));
  app.get('*path', (_request, response) => response.sendFile(path.join(dist, 'index.html')));
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({ configFile: path.resolve('vite.config.ts'), server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

await ensureProjectsRoot();

app.listen(port, '0.0.0.0', () => {
  console.log(`Ledger AI listening on 0.0.0.0:${port}`);
  console.log(`Sandboxed projects directory: ${PROJECTS_ROOT}`);
});
