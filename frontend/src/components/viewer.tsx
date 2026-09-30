import { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

import { AttachAddon } from "@/lib/AttachAddon";
import { useEffect, useRef } from "react";

export type ViewerProps = {
    challengeId: number;
};

export default function Viewer(props: ViewerProps) {
    // Keep terminal instance in a ref
    const termRef = useRef<Terminal | null>(null);

    useEffect(() => {
        // Create terminal only once
        const term = new Terminal({
            macOptionClickForcesSelection: true,
            macOptionIsMeta: true,
            fontFamily: "monospace",
            fontSize: 16,
        });

        termRef.current = term;

        const fitAddon = new FitAddon();
        const webglAddon = new WebglAddon();
        term.loadAddon(fitAddon);
        term.loadAddon(webglAddon);

        const queryParams = new URLSearchParams({
            challenge_id: String(props.challengeId),
        });
        const wsUrl = `/api/editor_service/view?${queryParams.toString()}`;

        const ws = new WebSocket(wsUrl);
        const encoder = new TextEncoder();

        // Resize terminal on window resize
        const handleResize = () => {
            fitAddon.fit();
        };
        window.addEventListener("resize", handleResize);

        ws.addEventListener("open", () => {
            term.onResize((data) => {
                ws.send(encoder.encode(JSON.stringify(data)));
            });

            const attachAddon = new AttachAddon(ws);
            term.loadAddon(attachAddon);

            // Open the terminal in the container div
            const container = document.getElementById("viewer");
            if (container) {
                term.open(container);
                fitAddon.fit();
            }
        });

        ws.addEventListener("close", (closeEvent) => {
            term.reset();
            term.writeln(closeEvent.reason);
        });

        term.attachCustomKeyEventHandler((ev) => {
            if (ev.type === "keydown") {
                if (ev.metaKey)
                    if (ev.altKey && ev.key === "-") {
                        ws.send("\x1b-");
                        return true;
                    }
            }
            return true;
        });

        // Cleanup on unmount
        return () => {
            ws.close();
            term.dispose();
            window.removeEventListener("resize", handleResize);
        };
    }, [props.challengeId]);

    return <div id={"viewer"} />;
}
