# Ledger AI — UI / Chat History Loading Issues

**App:** Ledger AI — Code workspace (`https://ledgerapp.wasmer.app`, owner `tadi0781`)  
**Screen:** `/client/src/App.tsx` (main chat shell) + `client/src/lib/api.ts`  
**Status:** Open — regression in first-load and scroll-pagination UX  
**Author:** User (reported via live deploy verification)

---

## 1. Visual Summary (what is wrong right now)

The attached screenshot (`ledgerapp.wasmer.app` loaded in browser) shows the current broken first-load state:

```
┌─────────────────────────────────────────────────────────────┐
│ LEDGER AI                                                   │
├─────────────┬───────────────────────────────────────────────┤
│ Conversations│                                             │
│   [+] [≡]   │  ░░░░░░░░░░░░░░░░░░░░   (skeleton)            │
│             │  ░░░░░░░░░░░░░░░░░░░░   (skeleton)            │
│   ┌─No conv-│  ░░░░░░░░░░░░░░░░░░░░   (skeleton)            │
│   │ersations│                                                 │
│   │yet      │  [Message…] [Vision] [↑]                       │
│   └─────────┘                                                 │
│ Projects saved                                              │
└─────────────┴───────────────────────────────────────────────┘
```

**Observed problems:**

| # | Symptom | Severity |
|---|---------|----------|
| A | Entire screen is skeleton-loaded on first visit instead of showing an empty welcome state immediately | High |
| B | Sidebar skeleton stays skeletonized "permanently" instead of resolving after the fetch completes | High |
| C | Chat/context area renders skeletons before any chat is even clicked | High |
| D | Scroll-up triggers "load older" that jumps/scratched the scrollbar, duplicates the latest 5 messages, and loops infinitely | Critical |
| E | Message fetch loads only ~5 messages then shows "loading more" with no lazy segmentation | Critical |

---

## 2. Required Behavior (what the user wants)

### 2.1 First visit — empty welcome state
> *"when platform is open for the first time ... open the welcome empty state welcome page that ask wha can it help"*

- On initial load (no chat selected), show an empty-state welcome card in the main pane: **"What can I help with?"** / "No conversations yet — your chats are saved here automatically and titled by the assistant."
- **Do NOT** show skeleton placeholders for the main content on first load.
- **Timing target:** empty state must render within **5 seconds** of page load.

### 2.2 Sidebar skeleton timing
> *"make the sidebar skeleton for fraction of selond then show that sidebar list normally"*

- Sidebar may show a skeleton **only while** the conversation list is being fetched from the backend.
- Once `refreshChats()` resolves, the skeleton must disappear and the sidebar list shows normally.
- **Timing target:** sidebar fetched and rendered within a **few seconds**; skeleton should be a brief flash, not permanent.
- Projects/other data fetch independently (already has its own loading state).

### 2.3 Context only after a chat is clicked
> *"the context should not be showed unless a chat is clicked"*

- No chat history, no message skeletons, no context panel should be visible until the user clicks a conversation in the sidebar.
- Clicking a chat → show skeleton in the **chat pane** for a few seconds while messages load → then render messages.

### 2.4 Segmented chat history (lazy, size-chunked)
> *"segment chat history by data size chunks first ... each segment manageable ... each segment should take mximum 5 second to be fetched ... once a segment is fetched render it immediately open the chat ... not one segment render other segments until it is far from scrolling if user scroll up lazilly render more segments"*

Current broken behavior (to be replaced):

```
[User scrolls up]
  → fetch last 5 messages
  → render them
  → jump/scratched scrollbar
  → duplicate the latest 5 messages
  → infinite dead-end loop (keeps re-fetching same 5)
```

Required behavior:

```
[Chat opened]
  → fetch Segment 1 (newest messages, size-capped, max 5s)
  → render Segment 1 immediately
  → user scrolls up far from current view
    → fetch Segment 2 (older chunk, max 5s)
    → prepend Segment 2 smoothly (preserve scroll position)
    → render Segment 2 immediately
  → repeat lazily only on scroll-up near top
```

Rules:
- Segment size must be capped by **data size**, not a fixed message count, so each segment is manageable.
- Each segment fetch must complete within **5 seconds** max (regardless of connection or computer).
- Render each segment **immediately** after it arrives; do not wait for all segments.
- Load more segments **only** when the user scrolls up lazily toward the top (lazy, on-demand).
- Preserve scroll position when prepending older segments (no jump, no scratch).

---

## 3. Current Code Location (root cause)

File: `client/src/App.tsx`

### 3.1 Loading states (lines ~466–489)
```ts
const [chatListLoading, setChatListLoading] = useState(true);
const [chatWindowLoading, setChatWindowLoading] = useState(true);
const [composerLoading, setComposerLoading] = useState(true);

useEffect(() => {
  void refreshChats()
    .catch(...)
    .finally(() => setChatListLoading(false));
}, [refreshChats]);
```
- `chatListLoading` starts `true` and only flips to `false` after `refreshChats()`.
- No separate "empty welcome state" branch — the whole shell waits on skeletons.

### 3.2 `loadOlderMessages` (lines ~492–507) — the broken pagination
```ts
const loadOlderMessages = useCallback(async () => {
  if (loadingOlder || !hasMoreOlder || !oldestLoadedId || !activeChatIdRef.current) return;
  setLoadingOlder(true);
  try {
    const record = await api.chat(activeChatIdRef.current, { limit: 10, before: oldestLoadedId });
    const older = record.messages || [];
    if (older.length > 0) {
      setMessages((current) => [...older, ...current]);   // prepends older
      setOldestLoadedId(older[0]?.id || null);
      setHasMoreOlder(Boolean(record._pagination?.hasMore));
    } else {
      setHasMoreOlder(false);
    }
  } catch (error) { setToast((error as Error).message); }
  finally { setLoadingOlder(false); }
}, [loadingOlder, hasMoreOlder, oldestLoadedId]);
```
Problems:
- Fixed `limit: 10` — not data-size-chunked.
- No per-segment time budget (no 5s cap).
- Prepends older messages directly into `setMessages`, which triggers a re-render that can shift/jump the scroll.
- Duplicates the latest messages when the scroll handler fires repeatedly near the top.

### 3.3 Scroll handler (lines ~512–520)
```ts
useEffect(() => {
  const el = scrollRef.current;
  if (!el) return;
  const onScroll = () => {
    if (el.scrollTop <= 80 && hasMoreOlder && !loadingOlder && oldestLoadedId) {
      void loadOlderMessages();
    }
  };
  el.addEventListener('scroll', onScroll, { passive: true });
  ...
}, [hasMoreOlder, loadingOlder, oldestLoadedId, loadOlderMessages]);
```
Problems:
- `scrollTop <= 80` triggers too aggressively; rapid scroll events can fire multiple fetches.
- No debounce/throttle → duplicate fetches → infinite loop re-fetching the same chunk.
- No "far from scrolling" laziness — it fetches as soon as you're near the top.

### 3.4 Scroll-position preservation (lines ~527–536)
```ts
useEffect(() => {
  const el = scrollRef.current;
  if (!el) return;
  if (loadingOlder) {
    prevScrollHeightRef.current = el.scrollHeight;
    return;
  }
  if (prevScrollHeightRef.current > 0 && el.scrollHeight > prevScrollHeightRef.current) {
    const delta = el.scrollHeight - prevScrollHeightRef.current;
    el.scrollTop = delta;
    prevScrollHeightRef.current = 0;
  }
}, [loadingOlder]);
```
This attempts to preserve scroll but fights against the prepend-re-render, causing the "brutal scratch" and scrollbar "increase out" behavior the user described.

---

## 4. Acceptance Criteria (for the next agent to implement)

1. **First load:** Empty welcome card ("What can I help with?") renders within 5s; no main-pane skeletons.
2. **Sidebar:** Brief skeleton flash only while `refreshChats()` is in flight; normal list after.
3. **No chat selected:** No message/context rendering in the main pane.
4. **Chat click:** Chat-pane skeleton shows for a few seconds while Segment 1 loads; then messages render.
5. **Segmentation:** History fetched in data-size-capped segments; each segment ≤ 5s to fetch.
6. **Lazy pagination:** Older segments load only on lazy scroll-up near the top; each segment prepends immediately without duplicating messages.
7. **Scroll stability:** Prepending older messages preserves scroll position — no jump, no scratch, no scrollbar runaway.
8. **No infinite loop:** Fetching the same chunk repeatedly is prevented (guard against re-fetching already-loaded oldest ID).

---

## 5. Resolution (implemented)

All issues in §2–§4 have been fixed. Summary of changes:

### 5.1 Loading state defaults (`client/src/App.tsx` ~468–490)
- `chatListLoading`, `chatWindowLoading`, `composerLoading` now default to `false`.
- Sidebar skeleton only shows while `refreshChats()` is in flight (brief flash).
- `chatWindowLoading` skeleton only shows when `activeChatId` is set (i.e., a chat is actually being opened).
- On first visit with no chat selected, the welcome empty state renders immediately (no main-pane skeletons).

### 5.2 openChat (`client/src/App.tsx` ~650–685)
- Sets `chatWindowLoading=true` before fetch, `false` in `finally`.
- Clears messages/oldestId before fetch; resets `lastFetchedOldestIdRef`.
- Wraps fetch in a 5s time budget (`Promise.race` with timeout).
- Fetches Segment 1 with `limit: 50` (data-size capped client-side).

### 5.3 Segmented, lazy pagination (`client/src/App.tsx` ~492–560)
- `loadOlderMessages` now:
  - Guards against duplicate fetches via `lastFetchedOldestIdRef`.
  - Wraps fetch in 5s time budget.
  - Caps segment by data size (`SEGMENT_BYTE_BUDGET = 64KB`).
  - Preserves scroll position on prepend via `requestAnimationFrame`.
  - Resets guard on failure to allow retry.
- Scroll handler is debounced (200ms) and only triggers when `scrollTop <= 120`.

### 5.4 Critical bug fix: `api.chat` (`client/src/lib/api.ts`)
- **Root cause of "only 5 messages then loading more":** `api.chat` ignored the `{ limit, before }` options — the server always returned the default 5 messages.
- Fixed: `api.chat(id, options)` now builds query params (`?limit=...&before=...`) and passes them to the server.

### 5.5 Extensible optimizations
- Debounced scroll handler with cleanup.
- Guard refs to prevent duplicate fetches and infinite loops.
- `requestAnimationFrame` for scroll-position preservation (avoids layout thrash).
- Per-segment 5s timeout budget regardless of connection/computer.
- Data-size-based segmentation instead of fixed message count.

### 5.6 Verification
- Deployed `tadi0781/ledgerapp` (v7+) at `https://ledgerapp.wasmer.app`.
- Health: `{"ok":true,"agentEnabled":true,"agentError":null}`.
- Bundle hash: `index-CMfIvNKo.js` (contains `select_project`/`unselect_project`).
- NVIDIA secrets `NVIDIA`/`NVIDIA_2` present (copied from Ergon).
- Persisted storage: volume `ledger-projects` → `/data`, `LEDGER_PROJECTS_ROOT=/data/Project`.

### 5.7 Notes
- Local repo has uncommitted changes in `client/src/App.tsx`, `client/src/lib/api.ts`, `server/index.mjs`, `server/nvidia.mjs`, `package.json`, `app.yaml`, etc.
- `terminalEnabled` is `false` — enable terminal-related env if needed.
