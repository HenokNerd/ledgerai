# Ledger AI Implementation Plan

## Implementation approach

Keep the existing React/Vite client and Express server. The client remains chat-first, with expandable full-screen tool details, Monaco editing, Markdown rendering, project/file CRUD, the Files/Projects sidebar, and neutral Vision control. Keep all file operations inside the selected project under the persistent `Project/` root, and keep attachments in the sibling persistent `Upload/` root. Preserve the public no-login app, server-only AI credential, existing per-file upload limits, and provider/model-neutral UI.

For this pass, map the Ergon `server/tools/filesystem.ts` interface into Ledger AI's existing files—do not add a new runtime module, package dependency, setup step, terminal, or general process runner. Expose the source tool names `read`, `write`, `edit`, `ls`, `cat`, and `glob` through the current tool-calling loop. Reuse Ledger's validated project path resolver instead of the source's string-prefix path check. Preserve the existing 1.5 MB editor limit, reject traversal and symlinks, skip `.git`, `node_modules`, and Ledger metadata, and bound directory/glob work. `cat` aliases `read`; the UI continues to show each call as an inspectable tile.

The repository also contains separate patch, content-search, skills, Git, shell/process, MCP, and scheduling components. This round implements only the filesystem module; the other capabilities remain distinct and unenabled. Keep the already prepared privileged-capability proposal in `PRIVILEGED_TOOL_DESIGN.md`; do not expose Git, shell/process, MCP, or scheduling in the public no-login app until their authentication, isolation, safety controls, and product approval gates are resolved. No source code is copied verbatim.

`app.yaml` mounts the persistent volume at `/data`, with `Project/` and `Upload/` as sibling directories. The server listens on the supplied `PORT` (default 3000), and the production container serves the Vite build. Do not require login. Preserve the current user-configured server secret and verify AI availability from the server without ever exposing its value.

## Project structure

- `client/src/App.tsx`: chat-first workspace, projects/sidebar, composer, attachment queue, Vision control, tool/action modals, and theme state.
- `client/src/components/`: file tree, language icons, Markdown renderer, and expandable tool-call details with filesystem-tool labels.
- `client/src/lib/api.ts` and `client/src/types.ts`: typed project/filesystem, upload, and streaming-chat contracts.
- `client/src/styles.css`: responsive dark and Blanche Diamond light visual system.
- `server/index.mjs`: Express routes, filesystem agent loop, approvals, upload endpoints, and static serving.
- `server/filesystem.mjs`: validated Project-scoped read/write/edit/list/glob operations, with no new runtime module.
- `server/uploads.mjs`: unrestricted attachment storage, metadata, bounded text reads, image previews, and cleanup under sibling `Upload/`.
- `server/nvidia.mjs`: server-side credential validation, default/vision chat routing, and preservation of provider tool-call linkage across multi-step turns.
- `PRIVILEGED_TOOL_DESIGN.md`: design-only gates for Git, shell/process, MCP, and scheduling; no production routes or credentials.
- `ERGO_TOOL_REVIEW.md`: source-to-product disposition and rationale for reviewed Ergon components.
- `app.yaml`: Wasmer runtime settings, secret injection, and persistent `/data` mount.

## Design direction

- **Design movement:** A restrained developer-workbench interpretation of VS Code, softened with editorial spacing and warm parchment light mode.
- **Core principles:** Chat first; tools stay inspectable but out of the way; familiar file navigation; clear, reversible interactions.
- **Color philosophy:** Balanced blue-green charcoal in dark mode; Blanche Diamond cream, ink black, and muted teal in light mode for comfortable contrast.
- **Layout paradigm:** A spacious central conversation/composer with an optional left workspace rail; editor and tool details take the full working surface only when opened.
- **Signature elements:** The existing abstract cyan mark; compact bordered action tiles; warm parchment surfaces paired with ink-dark controls.
- **Interaction philosophy:** Keep file actions explicit, approvals legible, image previews modal, and Vision a clear on/off state beside Send.
- **Animation:** Short, quiet transitions for sidebar, messages, menus, and modals; respect reduced-motion settings.
- **Typography system:** DM Sans for interface hierarchy and JetBrains Mono for code, paths, and compact technical details.
- **Brand essence:** A calm coding workspace for people who want to work by conversation and inspect every file change; clear, restrained, capable.
- **Brand voice:** Direct, concise, and non-technical where possible. Example lines: “What are we building?” and “Open files”.
- **Wordmark and logo:** Preserve the existing custom abstract SVG mark and compact wordmark; never substitute a generic symbol or default-font logo.
- **Signature brand color:** Muted cyan/teal, balanced against charcoal and Blanche Diamond.
