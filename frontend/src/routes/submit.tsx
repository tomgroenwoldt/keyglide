import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { useAppStore } from "@/store";
import { ChallengeForm } from "@/components/challenge-form";

export function Submit() {
    const { user, authLoaded } = useAppStore();
    const navigate = useNavigate();

    useEffect(() => {
        if (!authLoaded) return;
        if (user === null) {
            navigate("/login");
        }
    }, [user, authLoaded, navigate]);

    if (!authLoaded) return null;
    if (user === null) return null;

    return (
        <div className="container-wrapper flex-auto">
            <div className="container py-6 flex flex-col gap-4">
                <div>
                    <h1 className="text-2xl font-bold leading-tight tracking-tighter md:text-3xl lg:leading-[1.1]">
                        {"Submit a challenge"}
                    </h1>
                    <p className="max-w-2xl pt-2 pb-2 text-foreground">
                        {
                            "Create a start and goal file. The community votes; the highest-voted entry becomes the next day's daily challenge."
                        }
                    </p>
                </div>
                <ChallengeForm />
            </div>
        </div>
    );
}
