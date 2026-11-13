# Ergon tool and skill review

**Reviewed:** 2026-11-13. **Reference:** the [Ergon server source][1]. **Code reuse:** none; behavior is being mapped into Ledger AI's existing server. GitHub currently reports no license metadata for the repository. The inspected code was treated as untrusted input and no repository scripts were executed.

Ledger AI is publicly reachable without login and stores project files in the persistent `Project/` tree. The original product boundary is filesystem-only, with explicit approvals for project renames and deletions. The current request narrows this pass to the Ergon filesystem module; the other components remain separate and are not being implemented in this change.

| Ergon component | Current disposition | Reason |
|---|---|---|
| `artifact.ts` | Retain existing project and upload storage; no process-global artifact map. | A global in-memory map would be shared across unauthenticated visitors, unbounded, non-persistent, and redundant with project files and bounded attachments. |
| `filesystem.ts` | Implement its `read`, `write`, `edit`, `ls`, `cat`, and `glob` contract inside Ledger AI's existing server modules. | This is the current requested scope. Ledger's project-root resolver, size limits, symlink rejection, and ignored-path rules remain in force. |
| `git.ts` | Design only; not enabled. | It performs repository mutation and remote network operations. See the separate gated design. |
| `mcp.ts` | Defer; no route or connection added. | The reviewed module assumes a local HTTP service and has no user isolation or safe server allowlist. A future integration needs authenticated ownership and strict egress controls. |
| `patch.ts` | Review only; not part of this filesystem-module pass. | This is a separate patch/diff component. It is not enabled by the current change. |
| `schedule.ts` | Design only; not enabled. | Its timer is process-local and only logs; reliable unattended work needs an owned durable queue and explicit user consent. |
| `search.ts` | Review only; not part of this filesystem-module pass. | This is a separate content-search component. It is not enabled by the current change. |
| `shell.ts` | Excluded from the public build; no shell or process runner. | Arbitrary command execution conflicts with the no-terminal boundary and would expose the shared server's filesystem, environment, and network authority. See the gated design. |
| `skill.ts` | Review only; not part of this filesystem-module pass. | Workspace-global skill loading and mutation need a separate project-local trust design. |
| `task.ts` | Defer. | Adds an external model request, cost/abuse surface, and potential data forwarding without providing actual parallel filesystem work. |
| `todo.ts` | Defer. | Its process-local session map has no reliable user/session identity in this public application. Project files can already hold durable plans. |
| `server/skills/skill-creator` | Review only; no activation/evaluation workflow added. | Skill content can alter agent behavior; the bundle assumes additional tools, model calls, shell execution, and packaging that are outside this pass. |

The source filesystem module defines reading with optional 0-indexed line ranges, file creation/overwrite, exact string replacement, flat directory listing, a `cat` read alias, and pattern-based path discovery [1]. Ledger AI maps these operations to the active project only. It keeps its own boundary checks rather than using the source module's string-prefix path check. File updates stay below the existing editor size limit; `ls` streams at most 1,000 entries and reports truncation; glob streams and caps all entries visited (including directories) as well as depth/results. No terminal or external service is used.

The separate design-only proposal for privileged capabilities is in [PRIVILEGED_TOOL_DESIGN.md](PRIVILEGED_TOOL_DESIGN.md).

## References

[1]: https://github.com/nexuss0781/Ergon/tree/main/server "Ergon server source"
