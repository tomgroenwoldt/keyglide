import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBackspace } from "@fortawesome/free-solid-svg-icons";

interface KeycapProps {
    input: string;
}

export function Keycap({ input }: KeycapProps) {
    let content: React.ReactNode = input;

    if (input === "\x7f") {
        content = <FontAwesomeIcon icon={faBackspace} />;
    } else if (input === "\r") {
        content = "Enter";
    } else if (input === "\t") {
        content = "Tab";
    } else if (input === "\x1b") {
        content = "ESC";
    } else if (input === " ") {
        content = "Space";

        // Arrow keys (must come before ALT handling)
    } else if (input.startsWith("\x1b[A")) {
        content = "Up";
    } else if (input.startsWith("\x1b[B")) {
        content = "Down";
    } else if (input.startsWith("\x1b[C")) {
        content = "Right";
    } else if (input.startsWith("\x1b[D")) {
        content = "Left";

        // Home and End key
    } else if (input.startsWith("\x1b[H")) {
        content = "Home";
    } else if (input.startsWith("\x1b[F")) {
        content = "End";

        // Ctrl combinations
    } else {
        const ctrlMap: Record<string, string> = {
            "\u0001": "CTRL + A",
            "\u0002": "CTRL + B",
            "\u0003": "CTRL + C",
            "\u0004": "CTRL + D",
            "\u0005": "CTRL + E",
            "\u0006": "CTRL + F",
            "\u0008": "CTRL + H",
            "\u000A": "CTRL + J",
            "\u000B": "CTRL + K",
            "\u000C": "CTRL + L",
            "\u000E": "CTRL + N",
            "\u000F": "CTRL + O",
            "\u0010": "CTRL + P",
            "\u0011": "CTRL + Q",
            "\u0012": "CTRL + R",
            "\u0013": "CTRL + S",
            "\u0014": "CTRL + T",
            "\u0015": "CTRL + U",
            "\u0016": "CTRL + V",
            "\u0017": "CTRL + W",
            "\u0018": "CTRL + X",
        };

        if (ctrlMap[input]) {
            content = ctrlMap[input];
        }
        // ALT + key (exclude known escape sequences like arrows)
        else if (input.startsWith("\x1b") && input.length === 2) {
            content = `ALT + ${input[1]}`;
        }
    }

    return (
        <kbd className="px-2 py-1.5 text-xs font-semibold border">
            {content}
        </kbd>
    );
}
