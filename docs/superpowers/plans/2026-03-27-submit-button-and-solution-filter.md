# Submit Button & Solution Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace auto-submit on challenge completion with an explicit Submit button, and add "All Solutions" / "My Solutions" filter tabs to the solution board.

**Architecture:** Add a `Submit` variant to the shared `EditorServiceMessage` enum. The backend stops auto-closing on `Progress(1.0)` and instead waits for a `Submit` message from the client. The frontend shows a Submit button enabled only at 100% progress. The solution board gets a filter toggle using the existing `ButtonGroup` component.

**Tech Stack:** Rust (common crate, Axum backend), React/TypeScript frontend, Supabase, xterm.js WebSocket

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `common/src/lib.rs` | Modify | Add `Submit` variant to `EditorServiceMessage` |
| `backend/src/routes/editor_service.rs` | Modify | Handle Submit signal, stop auto-close on Progress(1.0), add oneshot channel between tasks |
| `frontend/src/components/editor.tsx` | Modify | Expose `submitRef` callback to parent, send Submit message over WS |
| `frontend/src/routes/root.tsx` | Modify | Add Submit button, wire up submitRef, manage submitted state |
| `frontend/src/components/solution-board.tsx` | Modify | Add filter tabs with ButtonGroup, filter queries by user |

---

### Task 1: Add `Submit` variant to `EditorServiceMessage`

**Files:**
- Modify: `common/src/lib.rs:13-17`

- [ ] **Step 1: Add the Submit variant**

In `common/src/lib.rs`, add `Submit` to the enum:

```rust
#[derive(Serialize, Deserialize)]
pub enum EditorServiceMessage {
    Progress(f64),
    Key(String),
    Submit,
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /home/tom/keyglide-rewrite && cargo check -p common`
Expected: compiles with no errors

- [ ] **Step 3: Commit**

```bash
git add common/src/lib.rs
git commit -m "feat: add Submit variant to EditorServiceMessage"
```

---

### Task 2: Backend — Stop auto-closing on `Progress(1.0)` and handle `Submit`

**Files:**
- Modify: `backend/src/routes/editor_service.rs`

The key change: `server_to_client` no longer calls `handle_finish` on `Progress(1.0)`. Instead, `client_to_server` detects the `Submit` JSON message from the browser, signals `server_to_client` via a `tokio::sync::oneshot` channel, and `server_to_client` then runs `handle_finish`.

- [ ] **Step 1: Add oneshot channel to `handle_editor_service_ws`**

In `handle_editor_service_ws`, create a oneshot channel and pass it to both tasks. Add `use tokio::sync::oneshot;` to the imports at the top of the file.

Replace the spawning section (lines ~140-154):

```rust
    let (submit_tx, submit_rx) = oneshot::channel::<()>();

    let mut futures = FuturesUnordered::new();
    futures.push(tokio::spawn(client_to_server(
        client_rx,
        upstream_tx,
        submit_tx,
    )));
    futures.push(tokio::spawn(server_to_client(
        upstream_rx,
        client_tx,
        state,
        challenge,
        params.token,
        submit_rx,
    )));
```

- [ ] **Step 2: Update `client_to_server` to intercept Submit**

Replace the `client_to_server` function:

```rust
pub async fn client_to_server(
    mut client_rx: SplitStream<WebSocket>,
    mut upstream_tx: SplitSink<WebSocketStream<MaybeTlsStream<TcpStream>>, Message>,
    submit_tx: oneshot::Sender<()>,
) {
    let mut submit_tx = Some(submit_tx);
    while let Some(Ok(msg)) = client_rx.next().await {
        let msg = match msg {
            Message::Text(text) => {
                // Do not forward mouse events.
                if text.starts_with("\x1b[M") || text.starts_with("\x1b[<") {
                    continue;
                }
                // Intercept Submit messages from the frontend.
                if let Ok(EditorServiceMessage::Submit) =
                    serde_json::from_str::<EditorServiceMessage>(&text)
                {
                    if let Some(tx) = submit_tx.take() {
                        let _ = tx.send(());
                    }
                    continue;
                }
                Message::text(text)
            }
            msg => msg,
        };
        if upstream_tx.send(msg).await.is_err() {
            break;
        }
    }
}
```

The `common::EditorServiceMessage` type is already imported in this file via the `use common::{Challenge, EditorServiceMessage};` statement. No new import needed for it. However, `serde_json` is already imported too. The only new import is `tokio::sync::oneshot` (added in Step 1).

- [ ] **Step 3: Update `server_to_client` to wait for Submit instead of auto-closing**

Replace the `server_to_client` function:

```rust
pub async fn server_to_client(
    mut upstream_rx: SplitStream<WebSocketStream<MaybeTlsStream<TcpStream>>>,
    mut client_tx: SplitSink<WebSocket, Message>,
    state: AppState,
    challenge: Challenge,
    token: Option<String>,
    submit_rx: oneshot::Receiver<()>,
) {
    let mut keys = Vec::new();
    let mut start_time = Utc::now();
    let mut current_progress = 0.0_f64;
    let mut submit_rx = Some(submit_rx);

    loop {
        // If we have a pending submit receiver, select between upstream messages and submit signal.
        // Otherwise just process upstream messages.
        let msg = if let Some(ref mut rx) = submit_rx {
            tokio::select! {
                msg = upstream_rx.next() => msg,
                Ok(()) = rx => {
                    submit_rx = None;
                    if current_progress == 1.0 {
                        let close_message = handle_finish(
                            &mut keys, &state, &challenge, &token, &mut start_time,
                        ).await;
                        let _ = client_tx.send(close_message).await;
                    }
                    break;
                }
            }
        } else {
            upstream_rx.next().await
        };

        let Some(Ok(msg)) = msg else { break };

        let (processed_msg, _) = match msg {
            Message::Text(ref text) => {
                handle_text_message(
                    text,
                    &mut keys,
                    &mut start_time,
                    &mut current_progress,
                    &state,
                    &challenge,
                    &token,
                )
                .await
            }
            msg => (msg, None),
        };

        if client_tx.send(processed_msg).await.is_err() {
            break;
        }
    }
}
```

- [ ] **Step 4: Update `handle_text_message` to track progress without closing**

Replace `handle_text_message`:

```rust
pub async fn handle_text_message(
    text: &str,
    keys: &mut Vec<String>,
    start_time: &mut DateTime<Utc>,
    current_progress: &mut f64,
    state: &AppState,
    challenge: &Challenge,
    token: &Option<String>,
) -> (Message, Option<Message>) {
    let message = serde_json::from_slice::<EditorServiceMessage>(text.as_bytes()).unwrap();

    match message {
        EditorServiceMessage::Key(key) => {
            if keys.is_empty() {
                *start_time = Utc::now();
            }

            keys.push(key);

            let count = Info {
                keystroke_count: keys.len(),
            };

            (
                Message::Text(Utf8Bytes::from(serde_json::to_string(&count).unwrap())),
                None,
            )
        }
        EditorServiceMessage::Progress(progress) => {
            *current_progress = progress;
            (Message::Text(text.into()), None)
        }
        EditorServiceMessage::Submit => {
            // Submit from editor-service is unexpected; ignore.
            (Message::Text(text.into()), None)
        }
    }
}
```

- [ ] **Step 5: Verify it compiles**

Run: `cd /home/tom/keyglide-rewrite && cargo check -p backend`
Expected: compiles with no errors (there may be unused import warnings for `CloseFrame` in `handle_text_message` context — that's fine since `handle_finish` still uses it)

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/editor_service.rs
git commit -m "feat: handle Submit message, stop auto-close on progress 1.0"
```

---

### Task 3: Frontend — Expose `submitRef` from Editor component

**Files:**
- Modify: `frontend/src/components/editor.tsx`

The Editor component creates the WebSocket internally. We need to expose a submit function to the parent via a ref so that Root can trigger the Submit message.

- [ ] **Step 1: Add `submitRef` prop and wire it up**

Replace the full `editor.tsx` file:

```tsx
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

import { AttachAddon } from "@/lib/AttachAddon";

export type EditorProps = {
    retry: boolean;
    date: Date;
    accessToken?: string;
    setProgress: (progress: number) => void;
    setKeystrokeCount: React.Dispatch<React.SetStateAction<number>>;
    submitRef?: React.MutableRefObject<(() => void) | null>;
};

export function formatDate(d: Date): string {
    const month = `${d.getMonth() + 1}`.padStart(2, "0");
    const day = `${d.getDate()}`.padStart(2, "0");
    return [d.getFullYear(), month, day].join("-");
}

export default function Editor(props: EditorProps) {
    const termRef = useRef<Terminal | null>(null);

    useEffect(() => {
        // --- Terminal setup ---
        const term = new Terminal({
            fontFamily: "monospace",
            fontSize: 16,
            macOptionIsMeta: true,
        });
        termRef.current = term;

        const fitAddon = new FitAddon();
        const webglAddon = new WebglAddon();
        term.loadAddon(fitAddon);
        term.loadAddon(webglAddon);

        // --- Determine WebSocket URL ---
        const queryParams = new URLSearchParams();
        let wsUrl = "";

        queryParams.append("date", formatDate(props.date));
        if (props.accessToken) queryParams.append("token", props.accessToken);
        wsUrl = `/api/editor_service/edit?${queryParams}`;

        const ws = new WebSocket(wsUrl);
        const encoder = new TextEncoder();

        // --- Expose submit function via ref ---
        if (props.submitRef) {
            props.submitRef.current = () => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ Submit: null }));
                }
            };
        }

        // --- Fit terminal on resize ---
        const handleResize = () => fitAddon.fit();
        window.addEventListener("resize", handleResize);

        ws.addEventListener("open", () => {
            term.onResize((data) =>
                ws.send(encoder.encode(JSON.stringify(data))),
            );
            term.loadAddon(new AttachAddon(ws));

            const container = document.getElementById("editor");
            if (container) {
                term.open(container);
                fitAddon.fit();
                term.focus();
            }
        });

        const handleMessage = (message: MessageEvent) => {
            const data = message.data;
            if (typeof data !== "string") return;

            const parsed = JSON.parse(data);

            if (typeof parsed === "object" && parsed !== null) {
                handleEditorMessage(parsed, props);
            }
        };

        ws.addEventListener("message", handleMessage);

        ws.addEventListener("close", (event) => {
            term.reset();
            term.writeln(event.reason);
        });

        term.attachCustomKeyEventHandler((ev) => {
            if (ev.type === "keydown") {
                if (ev.altKey && ev.key === "-") {
                    ws.send("\x1b-");
                    return true;
                }
                if (ev.altKey && ev.key === "_") {
                    ws.send("\x1b_");
                    return true;
                }
            }
            return true;
        });

        // --- Cleanup ---
        return () => {
            if (props.submitRef) {
                props.submitRef.current = null;
            }
            ws.close();
            term.dispose();
            window.removeEventListener("resize", handleResize);
        };
    }, [props.date, props.retry, props.accessToken]);

    return <div id="editor" />;
}

/** Single-player editor messages */
function handleEditorMessage(
    parsed: any,
    props: Extract<EditorProps, { date: Date }>,
) {
    if ("Progress" in parsed && typeof parsed.Progress === "number") {
        props.setProgress(parsed.Progress * 100);
    }
    if ("keystroke_count" in parsed) {
        props.setKeystrokeCount(parsed.keystroke_count);
    }
}
```

- [ ] **Step 2: Verify frontend compiles**

Run: `cd /home/tom/keyglide-rewrite/frontend && npx tsc --noEmit`
Expected: no type errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/editor.tsx
git commit -m "feat: expose submitRef from Editor component for explicit submission"
```

---

### Task 4: Frontend — Add Submit button to Root

**Files:**
- Modify: `frontend/src/routes/root.tsx`

- [ ] **Step 1: Add Submit button state and ref, wire to Editor**

Add the following imports at the top of `root.tsx` (merge with existing imports):

```tsx
import { Check, Maximize, MessageSquare, Minimize, Repeat } from "lucide-react";
```

Add new state and ref inside the `Root` component, after the existing state declarations:

```tsx
    const [submitted, setSubmitted] = useState(false);
    const submitRef = useRef<(() => void) | null>(null);
```

Add `useRef` to the existing `import { useEffect, useState } from "react"` import:

```tsx
import { useEffect, useRef, useState } from "react";
```

- [ ] **Step 2: Reset `submitted` on retry and date change**

In the existing retry button's `onClick`, add `setSubmitted(false)`:

```tsx
<Button
    variant="default"
    size="sm"
    onClick={() => {
        toggleRetry();
        setProgress(0);
        setKeystrokeCount(0);
        setSubmitted(false);
    }}
>
```

In the `useEffect` that navigates on `selectedDate` change (the one with `navigate`), add a reset:

```tsx
    useEffect(() => {
        if (!authReady) return;
        const dateParam = formatDate(selectedDate, "yyyy-MM-dd");
        navigate(`/${dateParam}`);
        setSubmitted(false);
        setProgress(0);
    }, [selectedDate, authReady]);
```

- [ ] **Step 3: Add the Submit button to the button group**

In the `CardDescription` div that contains the buttons, add the Submit button before the Retry button:

```tsx
<div className="flex gap-2">
    <Button variant="ghost" size="sm">
        {`${keystrokeCount} Keystrokes`}
    </Button>
    <Button
        variant="default"
        size="sm"
        disabled={progress < 100 || submitted}
        onClick={() => {
            if (submitRef.current) {
                submitRef.current();
                setSubmitted(true);
            }
        }}
    >
        <Check className="h-4 w-4" />
        {submitted ? "Submitted" : "Submit"}
    </Button>
    <Button
        variant="default"
        size="sm"
        onClick={() => {
            toggleRetry();
            setProgress(0);
            setKeystrokeCount(0);
            setSubmitted(false);
        }}
    >
        <Repeat />
        {"Retry"}
    </Button>
    <Button
        variant="default"
        size="sm"
        onClick={() =>
            setIsExpanded(!isExpanded)
        }
    >
        {isExpanded ? (
            <Minimize className="h-4 w-4" />
        ) : (
            <Maximize className="h-4 w-4" />
        )}
    </Button>
</div>
```

- [ ] **Step 4: Pass `submitRef` to Editor component**

Update the `<Editor>` component in the JSX to include the new prop:

```tsx
<Editor
    key="editor"
    date={selectedDate}
    retry={retry}
    setProgress={setProgress}
    setKeystrokeCount={
        setKeystrokeCount
    }
    accessToken={accessToken}
    submitRef={submitRef}
/>
```

- [ ] **Step 5: Verify frontend compiles**

Run: `cd /home/tom/keyglide-rewrite/frontend && npx tsc --noEmit`
Expected: no type errors

- [ ] **Step 6: Commit**

```bash
git add frontend/src/routes/root.tsx
git commit -m "feat: add Submit button with progress-gated enable/disable"
```

---

### Task 5: Solution Board — Add filter tabs

**Files:**
- Modify: `frontend/src/components/solution-board.tsx`

- [ ] **Step 1: Add filter state and ButtonGroup import**

Add to imports:

```tsx
import { ButtonGroup } from "./ui/button-group";
```

Inside `SolutionBoard`, add filter state after the existing `currentPage` state:

```tsx
const [filter, setFilter] = useState<"all" | "mine">("all");
```

- [ ] **Step 2: Apply filter to queries**

Replace the query definitions with filter-aware versions. Change the existing `solutionQuery` and `solutionCountQuery`:

```tsx
    const baseSolutionQuery = () => {
        let query = supabase
            .from("ranked_solutions")
            .select("*")
            .eq("date", formatDate(props.selectedDate, "yyyy-MM-dd"));
        if (filter === "mine" && user) {
            query = query.eq("user_id", user.id);
        }
        return query;
    };

    const solutionQuery = baseSolutionQuery().range(
        5 * (currentPage - 1),
        5 * currentPage - 1,
    );
    const solutionCountQuery = baseSolutionQuery().select("*", {
        count: "exact",
        head: true,
    });
    type SolutionQuery = QueryData<typeof solutionQuery>;
```

Note: The `baseSolutionQuery` returns a fresh query builder each time, avoiding reuse issues with the Supabase client. The `solutionCountQuery` overrides the `select("*")` from `baseSolutionQuery` — Supabase's `.select()` replaces prior selects, so this works correctly.

Wait — that won't work cleanly because chaining `.select()` twice doesn't override. Instead, define them separately:

```tsx
    let solutionQuery = supabase
        .from("ranked_solutions")
        .select("*")
        .eq("date", formatDate(props.selectedDate, "yyyy-MM-dd"));
    let solutionCountQuery = supabase
        .from("ranked_solutions")
        .select("*", { count: "exact", head: true })
        .eq("date", formatDate(props.selectedDate, "yyyy-MM-dd"));

    if (filter === "mine" && user) {
        solutionQuery = solutionQuery.eq("user_id", user.id);
        solutionCountQuery = solutionCountQuery.eq("user_id", user.id);
    }

    solutionQuery = solutionQuery.range(
        5 * (currentPage - 1),
        5 * currentPage - 1,
    );
    type SolutionQuery = QueryData<typeof solutionQuery>;
```

- [ ] **Step 3: Reset pagination on filter change**

Add to the existing `useEffect` that resets `currentPage` on date change, or add a new one:

```tsx
    useEffect(() => {
        setCurrentPage(1);
    }, [props.selectedDate, filter]);
```

This replaces the existing `useEffect` that only depends on `props.selectedDate`.

Also add `filter` to the dependency array of the main data-fetching `useEffect`:

```tsx
    }, [props.selectedDate, currentPage, filter]);
```

And reset filter on date change. Add to the existing date-change effect or create a new one:

```tsx
    useEffect(() => {
        setFilter("all");
    }, [props.selectedDate]);
```

- [ ] **Step 4: Add filter UI between header and table**

Between the closing `</div>` of the header section and the `<Table>` component, add:

```tsx
{user && (
    <ButtonGroup className="mb-2">
        <Button
            variant={filter === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("all")}
        >
            {"All Solutions"}
        </Button>
        <Button
            variant={filter === "mine" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("mine")}
        >
            {"My Solutions"}
        </Button>
    </ButtonGroup>
)}
```

- [ ] **Step 5: Remove empty useEffect**

Remove the empty `useEffect` on line 112 that does nothing:

```tsx
    // Remove this:
    useEffect(() => {}, []);
```

- [ ] **Step 6: Verify frontend compiles**

Run: `cd /home/tom/keyglide-rewrite/frontend && npx tsc --noEmit`
Expected: no type errors

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/solution-board.tsx
git commit -m "feat: add All Solutions / My Solutions filter tabs to solution board"
```

---

### Task 6: Manual End-to-End Verification

- [ ] **Step 1: Start the dev environment**

Start the backend, editor-service, and frontend dev server as usual for the project.

- [ ] **Step 2: Test Submit button flow**

1. Open a challenge in the browser
2. Edit the start file to match the goal
3. Verify the Submit button becomes enabled when progress reaches 100%
4. Continue editing (break the match) — verify Submit becomes disabled
5. Re-match the goal — verify Submit re-enables
6. Click Submit — verify the WebSocket closes with a score message
7. Verify the solution appears on the solution board

- [ ] **Step 3: Test Retry after submission**

1. After submitting, click Retry
2. Verify the Submit button resets to enabled-when-matching state
3. Solve again and submit — verify a new score is recorded

- [ ] **Step 4: Test solution filter**

1. Verify "All Solutions" / "My Solutions" tabs appear when logged in
2. Verify tabs do NOT appear when logged out
3. Click "My Solutions" — verify only your solutions are shown
4. Click "All Solutions" — verify all solutions are shown
5. Change the challenge date — verify filter resets to "All Solutions"

- [ ] **Step 5: Test guest behavior**

1. Log out
2. Solve a challenge — verify Submit button still works (sends Submit over WS)
3. Verify the close message displays the guest message

- [ ] **Step 6: Commit any fixes**

If any issues were found and fixed during testing, commit them.
