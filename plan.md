# Ledger AI Implementation Plan

## Implementation approach

Keep the existing React/Vite client and Express server. The client remains chat-first, with expandable full-screen filesystem-tool details, Monaco editing, Markdown rendering, project/file CRUD, and the established Files/Projects sidebar. Use the server filesystem module for sandboxed CRUD under `Project/`; do not add a terminal. Use `server/uploads.mjs` for unrestricted multipart uploads, with per-file size/count limits and generated opaque IDs under Wasmer's persistent `Upload/` folder. Pass those IDs with user turns to the server agent. Keep the NVIDIA credential on the server; use the standard configured model by default and select the vision-capable route only while the neutral Vision control is on. Do not show model/provider names. Treat image links as private app-relative previews, and keep destructive filesystem operations behind the existing approval gate.

`app.yaml` mounts the persistent volume at `/data`, with `Project/` and `Upload/` as sibling directories. The server listens on the supplied `PORT` (default 3000), and the production container serves the Vite build. Do not require login. Preserve the current user-configured Wasmer secret and verify AI availability from the server without ever exposing its value.

## Project structure

- `client/src/App.tsx`: chat-first workspace, projects/sidebar, composer, attachment queue, Vision control, tool/action modals, and theme state.
- `client/src/components/`: file tree, language icons, Markdown renderer, and expandable tool-call details.
- `client/src/lib/api.ts` and `client/src/types.ts`: typed project/filesystem, upload, and streaming-chat contracts.
- `client/src/styles.css`: responsive dark and Blanche Diamond light visual system.
- `server/index.mjs`: Express routes, filesystem agent loop, approvals, upload endpoints, and static serving.
- `server/filesystem.mjs`: validated project-scoped filesystem operations under `Project/`.
- `server/uploads.mjs`: unrestricted attachment storage, metadata, bounded text reads, image previews, and cleanup under sibling `Upload/`.
- `server/nvidia.mjs`: server-side credential validation and default/vision chat routing.
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
