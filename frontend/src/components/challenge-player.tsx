import { useEffect, useRef, useState } from "react";
import { Check, Maximize, MessageSquare, Minimize, Repeat } from "lucide-react";
import { useBoolean } from "usehooks-ts";

import { useSession } from "@/hooks/use-session";
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import Editor from "@/components/editor";
import Viewer from "@/components/viewer";
import { ChallengeLikes } from "@/components/challenge-likes";
import { ChallengeComments } from "@/components/challenge-comments";
import { SolutionBoard } from "@/components/solution-board";

export interface ChallengePlayerProps {
    challengeId: number;
    title?: string | null;
    description?: string | null;
}

export function ChallengePlayer(props: ChallengePlayerProps) {
    const { accessToken, ready: authReady } = useSession();

    const [progress, setProgress] = useState(0);
    const [keystrokeCount, setKeystrokeCount] = useState(0);
    const { value: retry, toggle: toggleRetry } = useBoolean(false);
    const [submitted, setSubmitted] = useState(false);
    const submitRef = useRef<(() => void) | null>(null);

    const [isExpanded, setIsExpanded] = useState(false);
    const [commentsOpen, setCommentsOpen] = useState(false);
    const [commentCount, setCommentCount] = useState(0);

    useEffect(() => {
        window.dispatchEvent(new Event("resize"));
    }, [isExpanded]);

    useEffect(() => {
        setProgress(0);
        setKeystrokeCount(0);
        setSubmitted(false);
        setCommentsOpen(false);
        setCommentCount(0);
    }, [props.challengeId]);

    return (
        <>
            {(props.title || props.description) && (
                <section className="border-grid border-b">
                    <div className="container-wrapper">
                        <div className="container py-6 flex flex-col gap-2">
                            {props.title && (
                                <h2 className="text-xl font-bold leading-tight tracking-tighter md:text-2xl">
                                    {props.title}
                                </h2>
                            )}
                            {props.description && (
                                <p className="max-w-3xl text-foreground whitespace-pre-wrap">
                                    {props.description}
                                </p>
                            )}
                        </div>
                    </div>
                </section>
            )}
            <section className="border-grid border-b">
                <div className="container-wrapper">
                    <div className="container py-6">
                        <div
                            className={
                                isExpanded
                                    ? "fixed inset-0 z-50 bg-background"
                                    : ""
                            }
                        >
                            <Card
                                className={
                                    isExpanded
                                        ? "w-full h-full rounded-none"
                                        : ""
                                }
                            >
                                <CardHeader>
                                    <CardTitle>{"Match the goal"}</CardTitle>
                                    <CardDescription className="flex justify-between items-center">
                                        <span>
                                            {`Click on the left editor and begin
                                            modifying the file to match the goal file on the right.`}
                                        </span>
                                        <div className="flex gap-2">
                                            <Button variant="ghost" size="sm">
                                                {`${keystrokeCount} Keystrokes`}
                                            </Button>
                                            <Button
                                                variant="default"
                                                size="sm"
                                                disabled={
                                                    progress < 100 || submitted
                                                }
                                                onClick={() => {
                                                    if (submitRef.current) {
                                                        submitRef.current();
                                                        setSubmitted(true);
                                                    }
                                                }}
                                            >
                                                <Check className="h-4 w-4" />
                                                {submitted
                                                    ? "Submitted"
                                                    : "Submit"}
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
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="flex flex-col gap-4 items-center">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
                                            {authReady && (
                                                <Editor
                                                    key="editor"
                                                    challengeId={
                                                        props.challengeId
                                                    }
                                                    retry={retry}
                                                    setProgress={setProgress}
                                                    setKeystrokeCount={
                                                        setKeystrokeCount
                                                    }
                                                    accessToken={accessToken}
                                                    submitRef={submitRef}
                                                />
                                            )}
                                            <Viewer
                                                key="viewer"
                                                challengeId={props.challengeId}
                                            />
                                        </div>
                                        <Progress
                                            value={progress}
                                            className="w-[60%]"
                                        />
                                    </div>
                                </CardContent>
                                <CardFooter className="flex justify-end items-center gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() =>
                                            setCommentsOpen(!commentsOpen)
                                        }
                                    >
                                        <MessageSquare className="h-4 w-4" />
                                        {`Comments (${commentCount})`}
                                    </Button>
                                    <ChallengeLikes
                                        challengeId={props.challengeId}
                                    />
                                </CardFooter>
                            </Card>
                        </div>
                    </div>
                </div>
            </section>
            <ChallengeComments
                challengeId={props.challengeId}
                isOpen={commentsOpen}
                onToggle={() => setCommentsOpen(!commentsOpen)}
                onCommentCountChange={setCommentCount}
            />
            <div className="container-wrapper flex-auto">
                <div className="container py-6">
                    <SolutionBoard challengeId={props.challengeId} />
                </div>
            </div>
        </>
    );
}
