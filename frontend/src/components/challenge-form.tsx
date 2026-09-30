import Editor from "@monaco-editor/react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAppStore } from "@/store";
import { Database } from "@/database.types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { EXT_TO_LANGUAGE } from "./challenge-preview";

type Extension = Database["public"]["Enums"]["prog_extension"];

const MAX_FILE_BYTES = 1024;
const MAX_LINES = 50;
const MAX_LINE_CHARS = 200;
const MAX_TITLE_CHARS = 80;
const MAX_DESCRIPTION_CHARS = 500;

const ALLOWED_EXTENSIONS: Extension[] = [
    "js",
    "ts",
    "py",
    "cpp",
    "java",
    "rb",
    "go",
    "rs",
    "php",
    "swift",
];

type FieldKey =
    | "startFile"
    | "goalFile"
    | "extension"
    | "title"
    | "description";

type FormErrors = Partial<Record<FieldKey, string>>;

function byteLength(s: string): number {
    return new TextEncoder().encode(s).length;
}

function validateFile(content: string): string | null {
    if (byteLength(content) > MAX_FILE_BYTES) return "File exceeds 1KB";
    if (content.trim().length === 0)
        return "File cannot be empty or whitespace only";
    const lines = content.split("\n");
    if (lines.length > MAX_LINES) return `File exceeds ${MAX_LINES} lines`;
    if (lines.some((line) => Array.from(line).length > MAX_LINE_CHARS))
        return `Some line exceeds ${MAX_LINE_CHARS} characters`;
    return null;
}

interface ChallengeFormProps {
    onSuccess?: (id: number) => void;
}

export function ChallengeForm({ onSuccess }: ChallengeFormProps) {
    const { supabase } = useAppStore();
    const navigate = useNavigate();

    const [startContent, setStartContent] = useState("");
    const [goalContent, setGoalContent] = useState("");
    const [extension, setExtension] = useState<Extension>("js");
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");

    const [errors, setErrors] = useState<FormErrors>({});
    const [submitting, setSubmitting] = useState(false);
    const [topLevelError, setTopLevelError] = useState<string | null>(null);

    const language = EXT_TO_LANGUAGE[extension] ?? "plaintext";

    const localValid = useMemo<FormErrors>(() => {
        const errs: FormErrors = {};
        const startErr = validateFile(startContent);
        if (startErr) errs.startFile = startErr;
        const goalErr = validateFile(goalContent);
        if (goalErr) errs.goalFile = goalErr;
        if (!errs.startFile && !errs.goalFile && startContent === goalContent) {
            errs.goalFile = "Start and goal must be different";
        }
        if (title.length > MAX_TITLE_CHARS)
            errs.title = `Title exceeds ${MAX_TITLE_CHARS} characters`;
        if (description.length > MAX_DESCRIPTION_CHARS)
            errs.description = `Description exceeds ${MAX_DESCRIPTION_CHARS} characters`;
        return errs;
    }, [startContent, goalContent, title, description]);

    const isValid =
        Object.keys(localValid).length === 0 &&
        startContent.length > 0 &&
        goalContent.length > 0;

    const handleSubmit = async () => {
        if (!isValid || submitting) return;
        setSubmitting(true);
        setErrors({});
        setTopLevelError(null);

        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token;
        if (!token) {
            navigate("/login");
            return;
        }

        const fd = new FormData();
        fd.append(
            "startFile",
            new Blob([startContent], { type: "text/plain" }),
            "start",
        );
        fd.append(
            "goalFile",
            new Blob([goalContent], { type: "text/plain" }),
            "goal",
        );
        fd.append("extension", extension);
        if (title.trim()) fd.append("title", title.trim());
        if (description.trim()) fd.append("description", description.trim());

        try {
            const res = await fetch("/api/challenges", {
                method: "POST",
                body: fd,
                headers: { Authorization: `Bearer ${token}` },
            });

            if (res.status === 201) {
                const body: { id: number } = await res.json();
                onSuccess?.(body.id);
                navigate("/mine");
                return;
            }

            if (res.status === 401) {
                navigate("/login");
                return;
            }

            try {
                const body: { error: string; message: string; field: string } =
                    await res.json();
                const fieldKey = body.field as FieldKey;
                if (fieldKey) {
                    setErrors({ [fieldKey]: body.message });
                } else {
                    setTopLevelError(body.message);
                }
            } catch {
                setTopLevelError("Server error — please try again.");
            }
        } catch {
            setTopLevelError("Network error — please try again.");
        } finally {
            setSubmitting(false);
        }
    };

    const startErr = errors.startFile ?? localValid.startFile;
    const goalErr = errors.goalFile ?? localValid.goalFile;
    const titleErr = errors.title ?? localValid.title;
    const descriptionErr = errors.description ?? localValid.description;
    const extensionErr = errors.extension;

    return (
        <div className="flex flex-col gap-4">
            {topLevelError && (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {topLevelError}
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium">
                        {"Title (optional)"}
                    </label>
                    <Input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        maxLength={MAX_TITLE_CHARS + 20}
                        placeholder="e.g. Refactor this for-loop"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{titleErr ?? ""}</span>
                        <span>{`${title.length}/${MAX_TITLE_CHARS}`}</span>
                    </div>
                </div>

                <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium">{"Extension"}</label>
                    <Select
                        value={extension}
                        onValueChange={(v) => setExtension(v as Extension)}
                    >
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {ALLOWED_EXTENSIONS.map((e) => (
                                <SelectItem key={e} value={e}>
                                    {e}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {extensionErr && (
                        <span className="text-xs text-destructive">
                            {extensionErr}
                        </span>
                    )}
                </div>
            </div>

            <div className="flex flex-col gap-1">
                <label className="text-sm font-medium">
                    {"Description (optional)"}
                </label>
                <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={MAX_DESCRIPTION_CHARS + 50}
                    placeholder="What should the player learn or practice?"
                    className="resize-none"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{descriptionErr ?? ""}</span>
                    <span>{`${description.length}/${MAX_DESCRIPTION_CHARS}`}</span>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 h-[400px]">
                <div className="flex flex-col border rounded-md overflow-hidden">
                    <div className="px-3 py-2 text-sm font-medium border-b bg-muted">
                        {"Start file"}
                    </div>
                    <Editor
                        height="100%"
                        language={language}
                        value={startContent}
                        onChange={(v) => setStartContent(v ?? "")}
                        theme="vs-dark"
                        options={{
                            minimap: { enabled: false },
                            fontSize: 14,
                            scrollBeyondLastLine: false,
                        }}
                    />
                </div>
                <div className="flex flex-col border rounded-md overflow-hidden">
                    <div className="px-3 py-2 text-sm font-medium border-b bg-muted">
                        {"Goal file"}
                    </div>
                    <Editor
                        height="100%"
                        language={language}
                        value={goalContent}
                        onChange={(v) => setGoalContent(v ?? "")}
                        theme="vs-dark"
                        options={{
                            minimap: { enabled: false },
                            fontSize: 14,
                            scrollBeyondLastLine: false,
                        }}
                    />
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="text-destructive">{startErr}</div>
                <div className="text-destructive">{goalErr}</div>
            </div>

            <div className="flex justify-end">
                <Button
                    onClick={handleSubmit}
                    disabled={!isValid || submitting}
                >
                    {submitting ? "Submitting…" : "Submit challenge"}
                </Button>
            </div>
        </div>
    );
}
