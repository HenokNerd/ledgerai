import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

export const PROJECTS_ROOT = path.resolve(process.cwd(), 'Project');
const META_FILE = '.ledger-project.json';
const MAX_FILE_BYTES = 1_500_000;
const IMAGE_TYPES = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg']);

export class FileSystemError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function slugifyProjectName(value) {
  const slug = String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56)
    .replace(/-+$/g, '');
  if (!slug || slug === 'project') throw new FileSystemError('Choose a project name with at least one letter or number.');
  return slug;
}

function validateProjectId(id) {
  if (typeof id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id === 'project') {
    throw new FileSystemError('That project name is not valid.');
  }
  return id;
}

function assertSafeProjectsRoot() {
  try {
    const info = fsSync.lstatSync(PROJECTS_ROOT);
    if (!info.isDirectory() || info.isSymbolicLink() || fsSync.realpathSync(PROJECTS_ROOT) !== PROJECTS_ROOT) {
      throw new FileSystemError('The sandbox Project/ root must be a real directory, not a symlink.', 403);
    }
  } catch (error) {
    if (error instanceof FileSystemError) throw error;
    throw new FileSystemError('The sandbox Project/ root could not be verified.', 500);
  }
}

export async function ensureProjectsRoot() {
  try {
    await fs.mkdir(PROJECTS_ROOT, { recursive: false, mode: 0o700 });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }
  assertSafeProjectsRoot();
  await fs.chmod(PROJECTS_ROOT, 0o700);
  assertSafeProjectsRoot();
}

function projectDirectory(id) {
  assertSafeProjectsRoot();
  const validId = validateProjectId(id);
  const directory = path.resolve(PROJECTS_ROOT, validId);
  if (!directory.startsWith(`${PROJECTS_ROOT}${path.sep}`)) throw new FileSystemError('Project path is outside the workspace.', 403);
  return directory;
}

function assertProjectRelativePath(relativePath, allowRoot = false) {
  const supplied = String(relativePath ?? '').replaceAll('\\', '/');
  if (!supplied && allowRoot) return '';
  if (!supplied || supplied.startsWith('/') || supplied.includes('\0')) throw new FileSystemError('A relative project path is required.');
  const segments = supplied.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) throw new FileSystemError('The path must stay inside the selected project.');
  if (segments.some((segment) => segment === META_FILE || segment === '.git' || segment === 'node_modules')) {
    throw new FileSystemError('Workspace metadata and dependency folders are not editable here.', 403);
  }
  return segments.join('/');
}

export async function getProject(id) {
  const directory = projectDirectory(id);
  const info = await fs.lstat(directory).catch(() => null);
  if (!info || !info.isDirectory() || info.isSymbolicLink()) throw new FileSystemError('Project not found.', 404);
  let metadata;
  try {
    metadata = JSON.parse(await fs.readFile(path.join(directory, META_FILE), 'utf8'));
  } catch {
    metadata = { id, name: id, createdAt: info.birthtime.toISOString() };
  }
  return { id, name: metadata.name || id, createdAt: metadata.createdAt || info.birthtime.toISOString(), updatedAt: info.mtime.toISOString() };
}

async function writeMetadata(directory, metadata) {
  await fs.writeFile(path.join(directory, META_FILE), JSON.stringify(metadata, null, 2), 'utf8');
}

export async function listProjects() {
  await ensureProjectsRoot();
  const entries = await fs.readdir(PROJECTS_ROOT, { withFileTypes: true });
  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
    try {
      projects.push(await getProject(entry.name));
    } catch {
      // Ignore directories outside the application's project format.
    }
  }
  return projects.sort((left, right) => left.name.localeCompare(right.name));
}

export async function createProject(name) {
  const displayName = String(name ?? '').trim();
  if (!displayName || displayName.length > 64) throw new FileSystemError('Enter a project name up to 64 characters.');
  const id = slugifyProjectName(displayName);
  const directory = projectDirectory(id);
  try {
    await fs.mkdir(directory, { recursive: false });
  } catch (error) {
    if (error?.code === 'EEXIST') throw new FileSystemError('A project with that folder name already exists.', 409);
    throw error;
  }
  const now = new Date().toISOString();
  await writeMetadata(directory, { id, name: displayName, createdAt: now });
  await fs.mkdir(path.join(directory, 'src'), { recursive: true });
  await fs.writeFile(path.join(directory, 'README.md'), `# ${displayName}\n\nYour project lives in the sandboxed Project/${id}/ folder.\n\nAsk Ledger to inspect the codebase, plan a change, or create a file.`, 'utf8');
  await fs.writeFile(path.join(directory, 'src', 'index.ts'), `export function hello() {\n  return 'Hello from ${id}';\n}\n`, 'utf8');
  return getProject(id);
}

export async function renameProject(id, nextName) {
  const oldId = validateProjectId(id);
  const oldDirectory = projectDirectory(oldId);
  const current = await getProject(oldId);
  const displayName = String(nextName ?? '').trim();
  if (!displayName || displayName.length > 64) throw new FileSystemError('Enter a project name up to 64 characters.');
  const newId = slugifyProjectName(displayName);
  const newDirectory = projectDirectory(newId);
  if (oldId !== newId) {
    try {
      await fs.lstat(newDirectory);
      throw new FileSystemError('Another project already uses that folder name.', 409);
    } catch (error) {
      if (error instanceof FileSystemError) throw error;
      if (error?.code !== 'ENOENT') throw error;
    }
    await fs.rename(oldDirectory, newDirectory);
  }
  await writeMetadata(newDirectory, { id: newId, name: displayName, createdAt: current.createdAt });
  return { ...await getProject(newId), previousId: oldId };
}

export async function deleteProject(id) {
  const project = await getProject(id);
  await fs.rm(projectDirectory(id), { recursive: true, force: false });
  return { deleted: true, project };
}

export async function projectPath(id, relativePath = '', allowRoot = false) {
  const base = projectDirectory(id);
  const safeRelative = assertProjectRelativePath(relativePath, allowRoot);
  const target = safeRelative ? path.resolve(base, ...safeRelative.split('/')) : base;
  const relative = path.relative(base, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new FileSystemError('Path traversal is not allowed.', 403);
  let cursor = base;
  for (const segment of relative ? relative.split(path.sep) : []) {
    cursor = path.join(cursor, segment);
    try {
      const stat = await fs.lstat(cursor);
      if (stat.isSymbolicLink()) throw new FileSystemError('Symbolic links are disabled in the project sandbox.', 403);
    } catch (error) {
      if (error instanceof FileSystemError) throw error;
      if (error?.code !== 'ENOENT') throw error;
      break;
    }
  }
  return { base, target, relative: safeRelative };
}

async function touchProject(id) {
  const directory = projectDirectory(id);
  const metaPath = path.join(directory, META_FILE);
  try {
    const metadata = JSON.parse(await fs.readFile(metaPath, 'utf8'));
    await writeMetadata(directory, { ...metadata, updatedAt: new Date().toISOString() });
  } catch (error) {
    if (error instanceof FileSystemError) throw error;
  }
}

function visibleEntry(entry) {
  return entry.name !== META_FILE && entry.name !== '.git' && entry.name !== 'node_modules' && !entry.isSymbolicLink();
}

export async function getProjectTree(id, directory = '') {
  const { target } = await projectPath(id, directory, true);
  const stat = await fs.lstat(target).catch(() => null);
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) throw new FileSystemError('Folder not found.', 404);
  const entries = await fs.readdir(target, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    if (!visibleEntry(entry)) continue;
    const relative = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push({ name: entry.name, path: relative, type: 'directory', children: await getProjectTree(id, relative) });
    } else if (entry.isFile()) {
      results.push({ name: entry.name, path: relative, type: 'file', size: (await fs.stat(path.join(target, entry.name))).size });
    }
  }
  return results.sort((a, b) => a.type !== b.type ? (a.type === 'directory' ? -1 : 1) : a.name.localeCompare(b.name));
}

export async function readProjectFile(id, relativePath) {
  const { target } = await projectPath(id, relativePath);
  const info = await fs.lstat(target).catch(() => null);
  if (!info || !info.isFile() || info.isSymbolicLink()) throw new FileSystemError('File not found.', 404);
  if (info.size > MAX_FILE_BYTES) throw new FileSystemError('This file is larger than the 1.5 MB editor limit.', 413);
  const buffer = await fs.readFile(target);
  if (buffer.includes(0)) throw new FileSystemError('This looks like a binary file. Open images with the image preview instead.');
  return { path: String(relativePath).replaceAll('\\', '/'), content: buffer.toString('utf8'), size: info.size, updatedAt: info.mtime.toISOString() };
}

export async function writeProjectFile(id, relativePath, content, { createOnly = false } = {}) {
  const { target, relative } = await projectPath(id, relativePath);
  const text = String(content ?? '');
  if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) throw new FileSystemError('Files are limited to 1.5 MB.');
  const current = await fs.lstat(target).catch(() => null);
  if (current?.isSymbolicLink() || (current && !current.isFile())) throw new FileSystemError('That path is not a file.');
  if (createOnly && current) throw new FileSystemError('A file already exists at that path.', 409);
  if (!current) {
    const parent = path.dirname(target);
    const parentInfo = await fs.lstat(parent).catch(() => null);
    if (!parentInfo?.isDirectory() || parentInfo.isSymbolicLink()) throw new FileSystemError('Create the parent folder first.', 404);
  }
  await fs.writeFile(target, text, 'utf8');
  await touchProject(id);
  return { path: relative, bytes: Buffer.byteLength(text, 'utf8'), created: !current };
}

export async function createProjectFolder(id, relativePath) {
  const { target, relative } = await projectPath(id, relativePath);
  try {
    await fs.mkdir(target, { recursive: false });
  } catch (error) {
    if (error?.code === 'EEXIST') throw new FileSystemError('A folder or file already exists at that path.', 409);
    if (error?.code === 'ENOENT') throw new FileSystemError('Create the parent folder first.', 404);
    throw error;
  }
  await touchProject(id);
  return { path: relative, created: true };
}

export async function deleteProjectPath(id, relativePath) {
  const { target, relative } = await projectPath(id, relativePath);
  const info = await fs.lstat(target).catch(() => null);
  if (!info || info.isSymbolicLink()) throw new FileSystemError('File or folder not found.', 404);
  if (info.isDirectory()) await fs.rm(target, { recursive: true, force: false });
  else await fs.unlink(target);
  await touchProject(id);
  return { path: relative, deleted: true, type: info.isDirectory() ? 'directory' : 'file' };
}

export async function imageAsset(id, relativePath) {
  const { target } = await projectPath(id, relativePath);
  const info = await fs.lstat(target).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink() || !IMAGE_TYPES.has(path.extname(target).toLowerCase())) throw new FileSystemError('Image not found.', 404);
  return target;
}
