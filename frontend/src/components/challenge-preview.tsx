import Editor from "@monaco-editor/react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Database } from "@/database.types";

type Extension = Database["public"]["Enums"]["prog_extension"];

const EXT_TO_LANGUAGE: Record<Extension, string> = {
    js: "javascript",
    ts: "typescript",
    py: "python",
    cpp: "cpp",
    java: "java",
    rb: "ruby",
    go: "go",
    rs: "rust",
    php: "php",
    swift: "swift",
    unknown: "plaintext",
};

interface ChallengePreviewProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    start: string;
    goal: string;
    extension: Extension;
    title?: string | null;
}

export function ChallengePreview(props: ChallengePreviewProps) {
    const language = EXT_TO_LANGUAGE[props.extension] ?? "plaintext";

    return (
        <Dialog open={props.open} onOpenChange={props.onOpenChange}>
            <DialogContent className="max-w-7xl">
                <DialogHeader>
                    <DialogTitle>
                        {props.title || "User challenge preview"}
                    </DialogTitle>
                    <DialogDescription>
                        {
                            "Preview the start and goal files of this user-submitted challenge."
                        }
                    </DialogDescription>
                </DialogHeader>

                <div className="grid grid-cols-2 gap-4 h-[500px]">
                    <div className="flex flex-col border rounded-md overflow-hidden">
                        <div className="px-3 py-2 text-sm font-medium border-b bg-muted">
                            {"Start"}
                        </div>
                        <Editor
                            height="100%"
                            language={language}
                            value={props.start}
                            theme="vs-dark"
                            options={{
                                readOnly: true,
                                minimap: { enabled: false },
                                fontSize: 14,
                                scrollBeyondLastLine: false,
                            }}
                        />
                    </div>
                    <div className="flex flex-col border rounded-md overflow-hidden">
                        <div className="px-3 py-2 text-sm font-medium border-b bg-muted">
                            {"Goal"}
                        </div>
                        <Editor
                            height="100%"
                            language={language}
                            value={props.goal}
                            theme="vs-dark"
                            options={{
                                readOnly: true,
                                minimap: { enabled: false },
                                fontSize: 14,
                                scrollBeyondLastLine: false,
                            }}
                        />
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

export { EXT_TO_LANGUAGE };
