import './env.mjs';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import { FileSystemError, projectPath } from './filesystem.mjs';

// Load child_process lazily so a runtime without process support (some hosted
// Wasmer environments) can still boot the app and report terminal as disabled.
let spawn = null;
try {
  const childProcess = await import('node:child_process');
  spawn = typeof childProcess.spawn === 'function' ? childProcess.spawn : null;
} catch {
  spawn = null;
}

const TERMINAL_ENABLED = process.env.LEDGER_TERMINAL_ENABLED === 'true';
const APPROVAL_REQUIRED = process.env.LEDGER_TERMINAL_APPROVAL !== 'false';

const CAPTURE_BYTES = 128 * 1024;
const MODEL_STDOUT_BYTES = 28 * 1024;
const MODEL_STDERR_BYTES = 14 * 1024;
const MAX_JOBS = 24;
const MAX_RUNNING = 6;
const JOB_TTL_MS = 60 * 60 * 1000;
const DEFAULT_FOREGROUND_TIMEOUT_MS = 120_000;
const DEFAULT_BACKGROUND_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_TIMEOUT_MS = 60 * 60 * 1000;
const KILL_GRACE_MS = 3_000;
const MAX_COMMAND_CHARS = 16_384;
const MAX_ARGUMENTS = 128;
const MAX_ARGUMENT_CHARS = 4_096;
const MAX_STDIN_BYTES = 64 * 1024;
const MAX_ENV_KEYS = 64;

const jobs = new Map();
let runningCount = 0;

const SECRET_NAME_PATTERN = /(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|NVIDIA|PRIVATE)/i;
const secretValues = Object.entries(process.env)
  .filter(([name, value]) => typeof value === 'string' && value.length >= 8 && SECRET_NAME_PATTERN.test(name))
  .map(([, value]) => value)
  .sort((left, right) => right.length - left.length);

function redactSecrets(value) {
  let text = String(value ?? '');
  for (const secret of secretValues) {
    if (text.includes(secret)) text = text.split(secret).join('[redacted]');
  }
  return text;
}

let shellResolution;

function resolveShell() {
  if (shellResolution !== undefined) return shellResolution;
  if (process.platform === 'win32') {
    const command = process.env.ComSpec || process.env.COMSPEC || 'cmd.exe';
    shellResolution = { path: command, args: ['/d', '/s', '/c'] };
    return shellResolution;
  }
  const candidates = [
    process.env.SHELL,
    '/bin/bash',
    '/usr/bin/bash',
    '/usr/local/bin/bash',
    '/bin/sh',
    '/usr/bin/sh',
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      shellResolution = { path: candidate, args: ['-c'] };
      return shellResolution;
    } catch {
      // Try the next known shell.
    }
  }
  shellResolution = null;
  return shellResolution;
}

export function terminalSettings() {
  return {
    enabled: TERMINAL_ENABLED && Boolean(spawn),
    approvalRequired: APPROVAL_REQUIRED,
    shellAvailable: Boolean(resolveShell()),
    shell: resolveShell()?.path || null,
    platform: process.platform,
    maxRunning: MAX_RUNNING,
    maxOutputBytes: CAPTURE_BYTES,
  };
}

function assertEnabled() {
  if (!TERMINAL_ENABLED) {
    throw new FileSystemError('The terminal is disabled in this workspace. Set LEDGER_TERMINAL_ENABLED=true to enable it.', 403);
  }
  if (!spawn) {
    throw new FileSystemError('This runtime does not provide process spawning, so the terminal is unavailable.', 501);
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

class Capture {
  constructor(maxBytes) {
    this.maxBytes = maxBytes;
    this.headBytes = Math.floor(maxBytes * 0.35);
    this.head = '';
    this.tail = '';
    this.totalBytes = 0;
    this.droppedBytes = 0;
  }

  push(value) {
    let text = String(value ?? '');
    if (!text) return;
    this.totalBytes += Buffer.byteLength(text);
    if (Buffer.byteLength(this.head) < this.headBytes) {
      const take = text.slice(0, Math.max(0, this.headBytes - Buffer.byteLength(this.head)));
      this.head += take;
      text = text.slice(take.length);
      if (!text) return;
    }
    this.tail += text;
    const tailLimit = this.maxBytes - Buffer.byteLength(this.head);
    const tailBytes = Buffer.byteLength(this.tail);
    if (tailBytes > tailLimit) {
      const buffer = Buffer.from(this.tail, 'utf8');
      const cut = Math.min(buffer.length, tailBytes - tailLimit);
      this.tail = buffer.subarray(cut).toString('utf8');
      this.droppedBytes += cut;
    }
  }

  get truncated() {
    return this.droppedBytes > 0;
  }

  toString() {
    if (!this.droppedBytes) return this.head + this.tail;
    return `${this.head}\n… ${formatBytes(this.droppedBytes)} truncated …\n${this.tail}`;
  }
}

function trimForModel(text, limit) {
  if (typeof text !== 'string' || !text) return '';
  if (Buffer.byteLength(text) <= limit) return text;
  const buffer = Buffer.from(text, 'utf8');
  return `… output shortened …\n${buffer.subarray(buffer.length - limit).toString('utf8')}`;
}

function pruneJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.status !== 'running' && job.endedAt && now - job.endedAt > JOB_TTL_MS) jobs.delete(id);
  }
  if (jobs.size <= MAX_JOBS) return;
  const finished = [...jobs.values()]
    .filter((job) => job.status !== 'running')
    .sort((left, right) => (left.endedAt || 0) - (right.endedAt || 0));
  while (jobs.size > MAX_JOBS && finished.length) jobs.delete(finished.shift().id);
}

function validateCwdArgument(cwd) {
  if (cwd === undefined || cwd === null) return '';
  if (typeof cwd !== 'string') throw new FileSystemError('cwd must be a project-relative directory path.');
  return cwd.trim().replace(/^\.\/+/, '');
}

function normalizeCommandArg(command) {
  if (command === undefined || command === null) return '';
  if (typeof command !== 'string') throw new FileSystemError('command must be a string.');
  const value = command.trim();
  if (value.length > MAX_COMMAND_CHARS) throw new FileSystemError('This command is too long to run.', 413);
  return value;
}

function normalizeArgv(raw) {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw) || raw.length === 0) throw new FileSystemError('argv must be a non-empty array of strings.');
  if (raw.length > MAX_ARGUMENTS) throw new FileSystemError('This command has too many arguments.', 413);
  const argv = raw.map((item) => {
    if (typeof item !== 'string') throw new FileSystemError('Every argv entry must be a string.');
    if (item.length > MAX_ARGUMENT_CHARS) throw new FileSystemError('One command argument is too long.', 413);
    return item;
  });
  if (!argv[0].trim()) throw new FileSystemError('argv[0] must name a program to run.');
  return argv;
}

function normalizeEnv(raw) {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new FileSystemError('env must be an object of string values.');
  const entries = Object.entries(raw);
  if (entries.length > MAX_ENV_KEYS) throw new FileSystemError('Too many environment overrides were supplied.', 413);
  const result = {};
  for (const [name, value] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new FileSystemError(`Invalid environment variable name: ${name}`);
    if (typeof value !== 'string') throw new FileSystemError(`Environment variable ${name} must be a string.`);
    if (Buffer.byteLength(value) > 8_192) throw new FileSystemError(`Environment variable ${name} is too large.`, 413);
    result[name] = value;
  }
  return result;
}

function normalizeTimeout(raw, background) {
  const fallback = background ? DEFAULT_BACKGROUND_TIMEOUT_MS : DEFAULT_FOREGROUND_TIMEOUT_MS;
  if (raw === undefined || raw === null) return fallback;
  if (!Number.isFinite(raw) || raw < 0) throw new FileSystemError('timeout_ms must be a non-negative number.');
  if (raw === 0) return MAX_TIMEOUT_MS;
  return Math.min(Math.round(raw), MAX_TIMEOUT_MS);
}

function normalizeStdin(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') throw new FileSystemError('stdin must be a string.');
  if (Buffer.byteLength(raw) > MAX_STDIN_BYTES) throw new FileSystemError('stdin is limited to 64 KB.', 413);
  return raw;
}

function signalChild(child, signal) {
  if (!child || typeof child.pid !== 'number') return;
  if (process.platform === 'win32') {
    try {
      if (spawn) spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
      else child.kill(signal);
    } catch {
      try { child.kill(signal); } catch { /* The process may already have exited. */ }
    }
    return;
  }
  try {
    process.kill(-child.pid, signal);
    return;
  } catch {
    // Fall back to killing the direct child when process groups are unavailable.
  }
  try { child.kill(signal); } catch { /* The process may already have exited. */ }
}

function createJob({ command, argv, cwd, cwdRelative, projectId, background, timeoutMs }) {
  const id = `term_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const job = {
    id,
    command,
    argv,
    displayCommand: argv ? argv.join(' ') : command,
    cwd,
    cwdRelative,
    projectId,
    background,
    status: 'running',
    pid: null,
    startedAt: Date.now(),
    endedAt: null,
    exitCode: null,
    signal: null,
    timedOut: false,
    killedByUser: false,
    aborted: false,
    stdout: new Capture(CAPTURE_BYTES),
    stderr: new Capture(CAPTURE_BYTES),
    child: null,
    timeoutTimer: null,
    killTimer: null,
    exitListeners: new Set(),
    outputListeners: new Set(),
    finalized: false,
  };
  jobs.set(id, job);
  return job;
}

function summarize(job, { includeOutput = true } = {}) {
  const summary = {
    jobId: job.id,
    command: job.displayCommand,
    cwd: job.cwdRelative || '.',
    background: job.background,
    status: job.status,
    pid: job.pid,
    exitCode: job.exitCode,
    signal: job.signal,
    timedOut: job.timedOut,
    killed: job.killedByUser,
    startedAt: new Date(job.startedAt).toISOString(),
    endedAt: job.endedAt ? new Date(job.endedAt).toISOString() : null,
    durationMs: (job.endedAt || Date.now()) - job.startedAt,
    truncated: { stdout: job.stdout.truncated, stderr: job.stderr.truncated },
  };
  if (includeOutput) {
    summary.stdout = trimForModel(job.stdout.toString(), MODEL_STDOUT_BYTES);
    summary.stderr = trimForModel(job.stderr.toString(), MODEL_STDERR_BYTES);
  }
  return summary;
}

function finalizeJob(job, code, signal) {
  if (job.finalized) return;
  job.finalized = true;
  if (job.timeoutTimer) clearTimeout(job.timeoutTimer);
  if (job.killTimer) clearTimeout(job.killTimer);
  job.timeoutTimer = null;
  job.killTimer = null;
  job.exitCode = typeof code === 'number' ? code : null;
  job.signal = signal || null;
  job.endedAt = Date.now();
  job.status = job.timedOut ? 'timed_out' : job.killedByUser || job.aborted ? 'killed' : job.exitCode === 0 ? 'completed' : 'failed';
  runningCount = Math.max(0, runningCount - 1);
  const summary = summarize(job);
  for (const listener of job.exitListeners) {
    try { listener(summary); } catch { /* A notification listener cannot break job cleanup. */ }
  }
  job.exitListeners.clear();
  job.outputListeners.clear();
  if (job.resolve) job.resolve(summary);
  logJob(job);
}

function logJob(job) {
  const label = job.status === 'completed' ? 'finished' : job.status;
  const code = job.exitCode === null ? job.signal || 'no exit code' : `exit ${job.exitCode}`;
  console.log(`[ledger-terminal] ${job.id} ${label} (${code}) after ${Date.now() - job.startedAt} ms: ${redactSecrets(job.displayCommand).slice(0, 200)}`);
}

export async function startTerminalCommand(options = {}, hooks = {}) {
  assertEnabled();
  pruneJobs();
  const projectId = options.projectId;
  if (!projectId) throw new FileSystemError('Select a project before running terminal commands.', 409);

  const background = options.background === true;
  const command = normalizeCommandArg(options.command);
  const argv = normalizeArgv(options.argv);
  if (!command && !argv) throw new FileSystemError('Provide a command string or an argv array to run.');
  const cwdRelative = validateCwdArgument(options.cwd);
  const stdin = normalizeStdin(options.stdin);
  const envOverrides = normalizeEnv(options.env);
  const timeoutMs = normalizeTimeout(options.timeoutMs, background);

  const target = await projectPath(projectId, cwdRelative, true);
  const info = await fsp.lstat(target.target).catch(() => null);
  if (!info || !info.isDirectory() || info.isSymbolicLink()) {
    throw new FileSystemError('The terminal working directory must be an existing folder inside the active project.', 404);
  }
  if (runningCount >= MAX_RUNNING) {
    throw new FileSystemError(`The workspace is already running ${MAX_RUNNING} terminal jobs. Wait for one to finish or stop one with terminal_kill.`, 429);
  }

  const shell = argv ? null : resolveShell();
  if (!argv && !shell) {
    throw new FileSystemError('No system shell is available in this runtime. Use the argv form instead, for example {"argv":["node","-v"]}.', 501);
  }

  const job = createJob({
    command,
    argv,
    cwd: target.target,
    cwdRelative,
    projectId,
    background,
    timeoutMs,
  });

  const childEnv = {
    ...process.env,
    TERM: process.env.TERM || 'dumb',
    NO_COLOR: process.env.NO_COLOR || '1',
    ...envOverrides,
  };

  let child;
  try {
    child = argv
      ? spawn(argv[0], argv.slice(1), {
        cwd: target.target,
        env: childEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        windowsHide: true,
      })
      : spawn(shell.path, [...shell.args, command], {
        cwd: target.target,
        env: childEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        windowsHide: true,
      });
  } catch (error) {
    job.finalized = true;
    job.status = 'failed';
    job.endedAt = Date.now();
    job.stderr.push(redactSecrets(error?.message || 'The command could not be started.'));
    throw new FileSystemError('The command could not be started.', 500);
  }

  job.child = child;
  job.pid = typeof child.pid === 'number' ? child.pid : null;
  runningCount += 1;

  const stdoutDecoder = new StringDecoder('utf8');
  const stderrDecoder = new StringDecoder('utf8');

  const emit = (stream, text) => {
    if (!text) return;
    const safe = redactSecrets(text);
    if (!safe) return;
    if (stream === 'stdout') job.stdout.push(safe);
    else job.stderr.push(safe);
    try { hooks.onOutput?.(stream, safe, job); } catch { /* Streaming must not break the child process. */ }
    for (const listener of job.outputListeners) {
      try { listener(stream, safe, job); } catch { /* Output listeners must not break the child process. */ }
    }
  };

  child.stdout?.on('data', (chunk) => emit('stdout', stdoutDecoder.write(chunk)));
  child.stderr?.on('data', (chunk) => emit('stderr', stderrDecoder.write(chunk)));
  child.on('error', (error) => {
    emit('stderr', redactSecrets(error?.message || 'The command failed to start.'));
    if (job.status === 'running') {
      job.killedByUser = false;
      finalizeJob(job, 1, null);
    }
  });
  child.on('close', (code, signal) => {
    emit('stdout', stdoutDecoder.end());
    emit('stderr', stderrDecoder.end());
    finalizeJob(job, code, signal);
  });

  if (stdin !== null) {
    child.stdin?.end(stdin);
  } else {
    child.stdin?.end();
  }
  child.stdin?.on('error', () => { /* A closed stdin is not a command failure. */ });

  job.timeoutTimer = setTimeout(() => {
    if (job.status !== 'running') return;
    job.timedOut = true;
    signalChild(child, 'SIGTERM');
    job.killTimer = setTimeout(() => {
      if (job.status === 'running') signalChild(child, 'SIGKILL');
    }, KILL_GRACE_MS);
  }, timeoutMs);
  job.timeoutTimer.unref?.();

  const onAbort = () => {
    if (job.status !== 'running') return;
    job.aborted = true;
    killTerminalJob(job.id, 'SIGTERM', { byUser: false });
  };
  if (options.signal) {
    if (options.signal.aborted) onAbort();
    else options.signal.addEventListener('abort', onAbort, { once: true });
  }
  job.removeAbortListener = () => options.signal?.removeEventListener('abort', onAbort);

  if (!background) {
    return new Promise((resolve) => {
      job.resolve = (summary) => {
        job.removeAbortListener?.();
        job.removeAbortListener = null;
        resolve(summary);
      };
      // The process may have already exited before the promise was installed.
      if (job.finalized) job.resolve(summarize(job));
    });
  }

  const started = summarize(job, { includeOutput: false });
  return {
    ...started,
    message: [
      `Command moved to the background (job ID: ${started.jobId}).`,
      'Output is streaming in the UI and can be inspected with terminal_jobs.',
      'You will be notified automatically when the command finishes. The notification will include the command\'s output/status.',
      'Unless the user explicitly asks otherwise, DO NOT poll for completion. Repeatedly checking terminal_jobs while waiting is polling, not useful work.',
      'Keep working on anything that does not depend on the result. If you have nothing else to do, end your response; you will be resumed automatically when the command finishes.',
    ].join('\n'),
  };
}

export function addTerminalJobListener(jobId, listener) {
  const job = jobs.get(jobId);
  if (!job) return () => {};
  if (job.finalized) {
    listener(summarize(job));
    return () => {};
  }
  job.exitListeners.add(listener);
  return () => job.exitListeners.delete(listener);
}

export function addTerminalJobOutputListener(jobId, listener) {
  const job = jobs.get(jobId);
  if (!job) return () => {};
  job.outputListeners.add(listener);
  return () => job.outputListeners.delete(listener);
}

export function getTerminalJobRaw(jobId) {
  const job = jobs.get(jobId);
  if (!job) throw new FileSystemError('Terminal job not found. It may have expired.', 404);
  return job;
}

export function getTerminalJob(jobId, { includeOutput = true } = {}) {
  const job = jobs.get(jobId);
  if (!job) throw new FileSystemError('Terminal job not found. It may have expired.', 404);
  return summarize(job, { includeOutput });
}

export function listTerminalJobs({ ids, activeOnly = false, includeOutput = false } = {}) {
  const wanted = Array.isArray(ids) && ids.length ? new Set(ids) : null;
  return [...jobs.values()]
    .filter((job) => !wanted || wanted.has(job.id))
    .filter((job) => !activeOnly || job.status === 'running')
    .sort((left, right) => right.startedAt - left.startedAt)
    .slice(0, MAX_JOBS)
    .map((job) => summarize(job, { includeOutput }));
}

export function killTerminalJob(jobId, signal = 'SIGTERM', { byUser = true } = {}) {
  assertEnabled();
  const job = jobs.get(jobId);
  if (!job) throw new FileSystemError('Terminal job not found. It may have expired.', 404);
  if (job.status !== 'running') return summarize(job, { includeOutput: false });
  const normalized = String(signal || 'SIGTERM').toUpperCase();
  if (!['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGHUP'].includes(normalized)) {
    throw new FileSystemError('Use SIGTERM, SIGKILL, SIGINT, or SIGHUP to stop a terminal job.');
  }
  if (byUser) job.killedByUser = true;
  signalChild(job.child, normalized);
  if (normalized !== 'SIGKILL') {
    job.killTimer = setTimeout(() => {
      if (job.status === 'running') signalChild(job.child, 'SIGKILL');
    }, KILL_GRACE_MS);
    job.killTimer.unref?.();
  }
  return summarize(job, { includeOutput: false });
}

export function killAllTerminalJobs() {
  for (const job of jobs.values()) {
    if (job.status === 'running') signalChild(job.child, 'SIGKILL');
  }
}

function parseBoolean(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  return String(value).toLowerCase() === 'true';
}

export const TERMINAL_TOOL_NAMES = new Set(['terminal', 'terminal_jobs', 'terminal_kill']);

export const TERMINAL_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'terminal',
      description: 'Run a command with Node.js spawn in the active project. Use command for a shell command (pipes, &&, redirects) or argv for a direct program call that works without a shell. Set background=true for long-running servers, watchers, or builds; the tool returns a jobId immediately. Long output is capped and secrets are redacted. Prefer non-interactive commands because there is no PTY.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to run. Required unless argv is supplied.' },
          argv: { type: 'array', items: { type: 'string' }, description: 'Direct program and arguments, for example ["node","--version"]. Bypasses the shell and works on runtimes without /bin/sh.' },
          cwd: { type: 'string', description: 'Optional project-relative working directory. Defaults to the project root.' },
          background: { type: 'boolean', description: 'Return a job id immediately and keep the process running in the background.' },
          timeout_ms: { type: 'integer', minimum: 0, maximum: 3600000, description: 'Kill the command after this many milliseconds. 0 uses the maximum of one hour.' },
          stdin: { type: 'string', description: 'Optional text written to the command stdin before it closes.' },
          env: { type: 'object', additionalProperties: { type: 'string' }, description: 'Optional environment variable overrides.' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'terminal_jobs',
      description: 'List terminal jobs or inspect one job. Omit job_id to list jobs. Use include_output=true to read stdout and stderr. Background jobs keep running after the agent turn ends; check them here.',
      parameters: {
        type: 'object',
        properties: {
          job_id: { type: 'string', description: 'Optional job id returned by terminal.' },
          include_output: { type: 'boolean', description: 'Include captured stdout and stderr.' },
          active_only: { type: 'boolean', description: 'Only return jobs that are still running.' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'terminal_kill',
      description: 'Stop a running terminal job. Sends SIGTERM by default and escalates to SIGKILL if it does not exit.',
      parameters: {
        type: 'object',
        properties: {
          job_id: { type: 'string', description: 'Job id returned by terminal.' },
          signal: { type: 'string', enum: ['SIGTERM', 'SIGINT', 'SIGKILL', 'SIGHUP'], description: 'Signal to send. Defaults to SIGTERM.' },
        },
        required: ['job_id'],
        additionalProperties: false,
      },
    },
  },
];

export async function executeTerminalTool(name, args = {}, context = {}) {
  if (name === 'terminal') {
    const background = args.background === true;
    const result = await startTerminalCommand({
      projectId: context.projectId,
      command: args.command,
      argv: args.argv,
      cwd: args.cwd,
      background,
      timeoutMs: args.timeout_ms,
      stdin: args.stdin,
      env: args.env,
      signal: background ? undefined : context.signal,
    }, {
      onOutput: (stream, chunk, job) => context.onOutput?.(context.toolId, stream, chunk, job.id),
    });
    if (background && result.jobId && context.onExit) {
      addTerminalJobListener(result.jobId, (summary) => context.onExit(context.toolId, summary));
    }
    return result;
  }
  if (name === 'terminal_jobs') {
    const includeOutput = parseBoolean(args.include_output, false);
    if (typeof args.job_id === 'string' && args.job_id.trim()) {
      return { job: getTerminalJob(args.job_id.trim(), { includeOutput }) };
    }
    return { jobs: listTerminalJobs({ includeOutput, activeOnly: args.active_only === true }) };
  }
  if (name === 'terminal_kill') {
    if (typeof args.job_id !== 'string' || !args.job_id.trim()) throw new FileSystemError('job_id is required to stop a terminal job.');
    return { job: killTerminalJob(args.job_id.trim(), args.signal || 'SIGTERM') };
  }
  throw new FileSystemError('Unknown terminal tool.', 400);
}

export { redactSecrets };

if (typeof process !== 'undefined') {
  process.once('exit', () => killAllTerminalJobs());
}
