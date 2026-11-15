# Terminal Skill

The terminal is a real process runner built on Node.js `node:child_process.spawn`. There is **no PTY and no terminal emulator**, so use commands the way a script or CI job would use them.

## Tools

| Tool | Purpose |
|---|---|
| `terminal` | Run a foreground command or start a background job. |
| `terminal_jobs` | List jobs or read one job's status and captured output. |
| `terminal_kill` | Stop a running job with `SIGTERM` (default), `SIGINT`, `SIGHUP`, or `SIGKILL`. |

### `terminal` parameters

- `command` — shell command string. Pipes, `&&`, `||`, redirects, and globs work through the system shell when one exists.
- `argv` — full argv array, for example `["node", "--version"]`. Bypasses the shell and is the portable path on runtimes without `/bin/sh` (including some Wasmer deployments). If both are supplied, `argv` wins.
- `cwd` — project-relative folder. Defaults to the active project root. It must stay inside the active project.
- `background` — when `true`, returns a `jobId` immediately and keeps the process alive after the turn.
- `timeout_ms` — auto-kill limit. `0` means the one-hour maximum. Foreground defaults to 120 seconds; background defaults to 30 minutes.
- `stdin` — optional string written to stdin, then stdin closes.
- `env` — optional environment overrides.

## Choosing foreground vs background

Use **foreground** for fast, finite commands:

```json
{ "command": "pnpm install" }
```

```json
{ "argv": ["node", "--version"] }
```

```json
{ "command": "pnpm typecheck", "timeout_ms": 300000 }
```

Use **background** for servers, watchers, and long builds:

```json
{ "command": "pnpm dev", "background": true }
```

Then inspect it:

```json
{ "job_id": "term_abc123", "include_output": true }
```

Stop it:

```json
{ "job_id": "term_abc123", "signal": "SIGTERM" }
```

## Live output and notifications

- Foreground output streams to the UI while the command runs.
- Background output is captured and can be read at any time with `terminal_jobs`.
- When a background job exits, the workspace shows a completion notice with its exit code and a short output tail.
- Jobs are kept in memory for about an hour, with up to 24 jobs retained. Job ids expire after a server restart.

## Status values

`running`, `completed`, `failed`, `killed`, `timed_out`.

A command that exits with a non-zero code is `failed`. A command stopped with `terminal_kill` is `killed`. A command stopped by its timeout is `timed_out`.

## Best practices

1. **Prefer `argv` when portability matters.** It avoids shell quoting and works where no shell is installed.
2. **Pass non-interactive flags.** There is no keyboard. Use `--yes`, `--no-pager`, `--no-color`, `--frozen-lockfile`, `CI=1`, or the equivalent for the tool.
3. **Never run full-screen interactive programs.** `vim`, `nano`, `less`, `more`, `top`, `htop`, `watch`, and curses UIs will not work. Use `cat`, `head`, `tail`, `sed -n`, or `--no-pager` instead.
4. **Do not wait for prompts.** Commands that ask a question will see EOF on stdin and may fail. Put the answer in `stdin` or pass a flag.
5. **Use `cwd` instead of `cd`.** Every command starts a fresh process, so `cd` does not persist. Set `cwd` on each call.
6. **Use `background: true` for anything that does not exit.** A dev server run in the foreground will hit the timeout.
7. **Read before you claim.** After a build, test, or install, check `exitCode` and `stderr` before summarizing the result.
8. **Keep output small.** Prefer `--quiet`, `--silent`, `grep`, `head`, or `tail -n 200`. Output is capped at 128 KB per stream; older output is dropped from the middle.
9. **Stop what you start.** If a background job is no longer needed, call `terminal_kill`.
10. **Do not leak secrets.** Output is redacted for known credential values, but never echo `.env` files or tokens on purpose.

## Path and security rules

- The working directory is validated against the active project and symlinks are rejected.
- Commands still run with the server's operating-system privileges; treat terminal access as privileged.
- If `LEDGER_TERMINAL_APPROVAL` is not `false`, every `terminal` command waits for the user's approval before it starts.
- If the terminal is disabled, the tools are not offered. The server flag is `LEDGER_TERMINAL_ENABLED=true`.

## Common recipes

Install dependencies:

```json
{ "command": "pnpm install --frozen-lockfile", "timeout_ms": 300000 }
```

Run tests once:

```json
{ "command": "pnpm test -- --run", "timeout_ms": 300000 }
```

Start a dev server and keep it alive:

```json
{ "command": "pnpm dev", "background": true }
```

Check the last 120 lines of a log:

```json
{ "command": "tail -n 120 /tmp/build.log" }
```

Run a program without a shell:

```json
{ "argv": ["node", "scripts/check.mjs"], "timeout_ms": 60000 }
```

Send input to a command:

```json
{ "argv": ["npm", "init", "-y"], "stdin": "" }
```

Stop a runaway job:

```json
{ "job_id": "term_abc123", "signal": "SIGKILL" }
```

## Failure handling

- `No system shell is available` — retry with `argv`.
- `terminal is disabled` — the server has not enabled the feature; use filesystem tools or ask the user to enable it.
- `already running N terminal jobs` — stop an old job with `terminal_kill` before starting another.
- `timed_out` — increase `timeout_ms` or move the work to `background: true`.
- `ENOENT` — the program is missing. Check spelling, install dependencies, or use an absolute path inside the project.
- `EACCES` — the file is not executable. Run it through its interpreter, for example `node script.mjs`, or `chmod +x` it first.
