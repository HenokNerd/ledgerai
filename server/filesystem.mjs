import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

export const PROJECTS_ROOT = path.resolve(process.env.LEDGER_PROJECTS_ROOT || path.resolve(process.cwd(), 'Project'));
const META_FILE = '.ledger-project.json';
const MAX_FILE_BYTES = 1_500_000;
const MAX_EDIT_MATCHES = 10_000;
const MAX_EDIT_STRING_BYTES = 100_000;
const MAX_GLOB_PATTERN_CHARS = 256;
const MAX_GLOB_VISITS = 5_000;
const MAX_GLOB_RESULTS = 250;
const MAX_GLOB_DEPTH = 16;
const MAX_LS_ENTRIES = 1_000;
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
  const baseInfo = await fs.lstat(base).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (!baseInfo || !baseInfo.isDirectory() || baseInfo.isSymbolicLink()) throw new FileSystemError('Project not found.', 404);
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

export async function writeProjectFileRecursive(id, relativePath, content) {
  const { relative } = await projectPath(id, relativePath);
  const parentSegments = relative.split('/').slice(0, -1);
  let parentRelative = '';
  for (const segment of parentSegments) {
    parentRelative = parentRelative ? `${parentRelative}/${segment}` : segment;
    const { target } = await projectPath(id, parentRelative);
    const existing = await fs.lstat(target).catch((error) => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    });
    if (existing) {
      if (!existing.isDirectory() || existing.isSymbolicLink()) throw new FileSystemError('A parent path is not a safe project folder.', 403);
      continue;
    }
    try {
      await fs.mkdir(target, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const raced = await fs.lstat(target).catch(() => null);
      if (!raced?.isDirectory() || raced.isSymbolicLink()) throw new FileSystemError('A parent path is not a safe project folder.', 403);
    }
  }
  return writeProjectFile(id, relative, content);
}

export async function editProjectFile(id, relativePath, oldString, newString, replaceAll = false) {
  const oldText = String(oldString ?? '');
  const newText = String(newString ?? '');
  if (!oldText) throw new FileSystemError('The text to find cannot be empty.');
  if (typeof replaceAll !== 'boolean') throw new FileSystemError('replaceAll must be a boolean.');
  if (Buffer.byteLength(oldText, 'utf8') > MAX_EDIT_STRING_BYTES || Buffer.byteLength(newText, 'utf8') > MAX_EDIT_STRING_BYTES) {
    throw new FileSystemError('Each exact-text edit field is limited to 100 KB.', 413);
  }
  const file = await readProjectFile(id, relativePath);
  let count = 0;
  let cursor = 0;
  while ((cursor = file.content.indexOf(oldText, cursor)) !== -1) {
    count += 1;
    if ((!replaceAll && count > 1) || count > MAX_EDIT_MATCHES) break;
    cursor += oldText.length;
  }
  if (count === 0) throw new FileSystemError('oldString not found in file.');
  if (!replaceAll && count > 1) throw new FileSystemError('Multiple matches found; set replaceAll to true to edit every occurrence.');
  if (count > MAX_EDIT_MATCHES) throw new FileSystemError('This edit matches too many occurrences.', 413);

  const replacedCount = replaceAll ? count : 1;
  const expectedBytes = Buffer.byteLength(file.content, 'utf8') + replacedCount * (Buffer.byteLength(newText, 'utf8') - Buffer.byteLength(oldText, 'utf8'));
  if (expectedBytes > MAX_FILE_BYTES) throw new FileSystemError('The edited file would exceed the 1.5 MB editor limit.', 413);
  const content = replaceAll ? file.content.split(oldText).join(newText) : file.content.replace(oldText, newText);
  const result = await writeProjectFile(id, relativePath, content);
  return { ...result, replaced: replacedCount };
}

export async function listProjectDirectory(id, relativePath = '') {
  const { target } = await projectPath(id, relativePath, true);
  const info = await fs.lstat(target).catch(() => null);
  if (!info || !info.isDirectory() || info.isSymbolicLink()) throw new FileSystemError('Folder not found.', 404);
  const directory = await fs.opendir(target);
  const items = [];
  let scanned = 0;
  let truncated = false;
  try {
    for await (const entry of directory) {
      if (scanned >= MAX_LS_ENTRIES) { truncated = true; break; }
      scanned += 1;
      if (!visibleEntry(entry)) continue;
      items.push({ name: entry.name, type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other' });
    }
  } finally {
    await directory.close().catch(() => {});
  }
  items.sort((left, right) => left.type !== right.type ? (left.type === 'directory' ? -1 : 1) : left.name.localeCompare(right.name));
  return { items, truncated };
}

function globSegmentMatches(pattern, value) {
  let patternIndex = 0;
  let valueIndex = 0;
  let lastStar = -1;
  let retryIndex = 0;
  while (valueIndex < value.length) {
    if (patternIndex < pattern.length && (pattern[patternIndex] === '?' || pattern[patternIndex] === value[valueIndex])) {
      patternIndex += 1;
      valueIndex += 1;
    } else if (pattern[patternIndex] === '*') {
      lastStar = patternIndex;
      patternIndex += 1;
      retryIndex = valueIndex;
    } else if (lastStar >= 0) {
      patternIndex = lastStar + 1;
      valueIndex = ++retryIndex;
    } else return false;
  }
  while (pattern[patternIndex] === '*') patternIndex += 1;
  return patternIndex === pattern.length;
}

function globMatches(patternSegments, fileSegments) {
  const memo = new Map();
  const match = (patternIndex, fileIndex) => {
    const key = `${patternIndex}:${fileIndex}`;
    if (memo.has(key)) return memo.get(key);
    let result;
    if (patternIndex === patternSegments.length) result = fileIndex === fileSegments.length;
    else if (patternSegments[patternIndex] === '**') {
      result = match(patternIndex + 1, fileIndex) || (fileIndex < fileSegments.length && match(patternIndex, fileIndex + 1));
    } else {
      result = fileIndex < fileSegments.length
        && globSegmentMatches(patternSegments[patternIndex], fileSegments[fileIndex])
        && match(patternIndex + 1, fileIndex + 1);
    }
    memo.set(key, result);
    return result;
  };
  return match(0, 0);
}

export async function globProjectFiles(id, pattern, cwd = '') {
  const rawPattern = String(pattern ?? '').replaceAll('\\', '/');
  if (!rawPattern || rawPattern.length > MAX_GLOB_PATTERN_CHARS || rawPattern.startsWith('/') || rawPattern.includes('\0')) {
    throw new FileSystemError('Enter a relative glob pattern up to 256 characters.');
  }
  const patternSegments = rawPattern.split('/').filter((segment) => segment && segment !== '.');
  if (patternSegments.some((segment) => segment === '..' || ['.git', 'node_modules', '.ledger-project.json'].includes(segment))) {
    throw new FileSystemError('The glob pattern must stay inside the selected project.');
  }
  const normalizedPattern = patternSegments.join('/');
  if (!normalizedPattern) throw new FileSystemError('Enter a relative glob pattern.');
  const rawCwd = String(cwd ?? '').replaceAll('\\', '/');
  if (rawCwd.startsWith('/') || rawCwd.includes('\0') || rawCwd.split('/').some((segment) => segment === '..')) {
    throw new FileSystemError('The glob base directory must stay inside the selected project.');
  }
  const safeCwd = rawCwd.split('/').filter((segment) => segment && segment !== '.').join('/');
  const { target: base } = await projectPath(id, safeCwd, true);
  const baseInfo = await fs.lstat(base).catch(() => null);
  if (!baseInfo || !baseInfo.isDirectory() || baseInfo.isSymbolicLink()) throw new FileSystemError('Folder not found.', 404);
  const files = [];
  let visited = 0;
  let truncated = false;

  const walk = async (directory, relative = '', depth = 0) => {
    if (depth > MAX_GLOB_DEPTH) { truncated = true; return; }
    const handle = await fs.opendir(directory);
    try {
      for await (const entry of handle) {
        if (visited >= MAX_GLOB_VISITS) { truncated = true; break; }
        visited += 1;
        if (!visibleEntry(entry)) continue;
        const nextRelative = relative ? `${relative}/${entry.name}` : entry.name;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (depth >= MAX_GLOB_DEPTH) { truncated = true; break; }
          await walk(absolute, nextRelative, depth + 1);
          if (truncated) break;
        } else if (entry.isFile() && globMatches(patternSegments, nextRelative.split('/'))) {
          if (files.length >= MAX_GLOB_RESULTS) { truncated = true; break; }
          files.push(nextRelative);
        }
      }
    } finally {
      await handle.close().catch(() => {});
    }
  };

  await walk(base);
  return { files: files.sort(), visited, truncated };
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
