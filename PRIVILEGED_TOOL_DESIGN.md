# Privileged tool design — proposal only

**Status:** Design artifact only. Nothing in this document adds a route, credential, process runner, MCP connection, background job, or production capability. No terminal, Git, MCP, or scheduler tool is enabled in Ledger AI.

## Why separate gates are necessary

Ledger AI is publicly reachable without login and stores project files in the persistent `Project/` tree. An unauthenticated visitor can currently access the same workspace boundary. The original product boundary is filesystem-only, with explicit approval for destructive actions. The Ergon source repository has no license metadata, so this design is an independent security/product proposal, not copied source.

Before any privileged tool is implemented, the project needs: authenticated identities; per-user project and credential ownership; isolation across users and concurrent jobs; CSRF/abuse controls; audit events that exclude secret values; enforced resource, timeout, and output limits; explicit operation-specific approvals; and a recovery/rollback story. A feature flag alone is not a security boundary.

## Git operations

**Possible scope:** read-only status, diff, and recent history inside one selected project; branch creation/switch, commit, and push only after separate authorization.

**Required controls:** resolve and verify the real repository root beneath the selected project; reject symlinks and any path escape; invoke the Git executable with an argument array and `shell: false`; allow only enumerated subcommands and flags; bound runtime/output; redact credentials and remote URLs; allow only approved remotes/branches; never force-push; show the exact staged diff, destination remote, branch, and commit message in a confirmation screen before commit/push. Store credentials in a server-side per-user secret vault, never in browser storage or tool output. Do not expose ambient application/Git credentials to project code.

**Gate:** no Git mutation in the public no-login build. A user must approve the specific diff and destination for each commit or push after authentication and repository ownership are established.

## Shell and process execution

Arbitrary command execution is substantially more powerful than filesystem CRUD and is not safe to expose through the current shared public server. It can read deployment secrets, inspect or alter files beyond `Project/`, use network egress, install software, run unbounded processes, and create persistent or unattended side effects.

**Possible scope only after separate product approval:** a visible, user-initiated terminal/process interface in an isolated per-user disposable execution environment, separate from the web server and its credentials. Mount only the selected project through a restricted boundary; run unprivileged; deny access to host, runtime secrets, other projects, uploads, metadata, and cloud credentials; restrict network egress by default; enforce CPU, memory, disk, process-count, time, and output quotas; terminate orphaned processes; log commands/results with sensitive-output redaction; display commands and material effects clearly. A confirmation step is required before commands with external, destructive, or installation side effects. The production Wasmer web process must never become a general-purpose shell host.

**Gate:** excluded from the current application. Approval of an individual command is not a substitute for process isolation or authentication.

## MCP server access

The reviewed source is a local-HTTP simulation rather than a complete secure MCP integration. A future implementation must use a maintained MCP client and an explicit per-user server registry.

**Required controls:** allowlist server identities and approved transports; reject localhost, private/link-local, metadata, and otherwise internal network destinations; defend DNS rebinding and redirects; require explicit user consent for each server/tool; keep credentials server-side and scoped to one identity; default to read-only resources; require additional per-operation approval for mutating tools; enforce timeouts and response-size limits; sanitize tool results; show the action/result tile without provider names; prevent a connected server from escaping the selected project/upload boundaries. Do not let model-generated tool arguments create a new connection or choose an arbitrary URL.

**Gate:** no MCP endpoints or credentials in the public no-login build. Authentication, server allowlisting, egress policy, and a specific approved use case are prerequisites.

## Scheduling and unattended work

The source timer is process-local and only logs; it is not a durable or reliable job system. A future scheduler must use a platform-managed durable queue/job store, not in-process `setTimeout`.

**Required controls:** authenticated owner and project scope; clear one-time/recurring schedule, timezone, next-run time, and expiry; limits on frequency and concurrent jobs; idempotency and retries; cancellation and pause; auditable ownership; notification of outcomes; no secret values in logs; no shared global task list. Scheduled tasks may perform bounded read-only analysis. Any project mutation must either create a proposed diff for later user approval or be limited to a separately approved, narrow policy. Never schedule arbitrary shell commands or unrestricted remote tools.

**Gate:** no background or recurring work in the current application. A persistent scheduler, identity model, delivery/notification behavior, and explicit user opt-in are required.

## Activation checklist for a future proposal

1. Identify the user/owner model and migrate project storage to explicit per-user isolation.
2. Complete a threat model for the exact requested operation and target deployment environment.
3. Implement an isolated backend path with least-privilege secrets, safe path/argument validation, quotas, timeouts, and audit redaction.
4. Define exactly when approval is required and show the full consequential payload before confirmation.
5. Add focused tests for unauthenticated access, cross-user access, traversal/symlinks, abuse/rate limits, timeouts, secret leakage, restart behavior, cancellation, and rollback.
6. Keep the feature disabled until the user reviews the design and separately approves the specific production capability.

## Source context

The public reference inspected was `https://github.com/nexuss0781/Ergon/tree/main/server`. Its `git.ts`, `shell.ts`, `mcp.ts`, and `schedule.ts` modules were reviewed as untrusted source. Their behavior informed this threat model; none was copied or executed.
