import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

import { AttachAddon } from "@/lib/AttachAddon";

export type EditorProps = {
    retry: boolean;
    challengeId: number;
    accessToken?: string;
    setProgress: (progress: number) => void;
    setKeystrokeCount: React.Dispatch<React.SetStateAction<number>>;
    submitRef?: React.MutableRefObject<(() => void) | null>;
};

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
        const queryParams = new URLSearchParams({
            challenge_id: String(props.challengeId),
        });
        if (props.accessToken) queryParams.append("token", props.accessToken);
        const wsUrl = `/api/editor_service/edit?${queryParams}`;

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
                if (ev.altKey && ev.key === ";") {
                    ws.send("\x1b;");
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
    }, [props.challengeId, props.retry, props.accessToken]);

    return <div id="editor" />;
}

/** Single-player editor messages */
function handleEditorMessage(parsed: object, props: EditorProps) {
    if ("Progress" in parsed && typeof parsed.Progress === "number") {
        props.setProgress(parsed.Progress * 100);
    }
    if (
        "keystroke_count" in parsed &&
        typeof parsed.keystroke_count === "number"
    ) {
        props.setKeystrokeCount(parsed.keystroke_count);
    }
}
