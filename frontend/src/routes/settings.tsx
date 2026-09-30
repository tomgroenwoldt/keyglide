import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "@/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export default function Settings() {
    const { user, supabase } = useAppStore();
    const navigate = useNavigate();
    const [relativeLineNumbers, setRelativeLineNumbers] = useState(false);
    const [loading, setLoading] = useState(true);

    // Redirect unauthenticated users
    useEffect(() => {
        if (!user) {
            navigate("/login");
        }
    }, [user, navigate]);

    // Fetch current settings
    useEffect(() => {
        if (!user) return;

        supabase
            .from("user_settings")
            .select("line_number")
            .eq("user_id", user.id)
            .maybeSingle()
            .then(({ data }) => {
                if (data) {
                    setRelativeLineNumbers(data.line_number === "relative");
                }
                setLoading(false);
            });
    }, [user, supabase]);

    const handleToggle = async (checked: boolean) => {
        if (!user) return;

        setRelativeLineNumbers(checked);
        const lineNumber = checked ? "relative" : "absolute";

        await supabase
            .from("user_settings")
            .upsert(
                { user_id: user.id, line_number: lineNumber },
                { onConflict: "user_id" },
            );
    };

    if (!user) return null;

    return (
        <div className="container-wrapper flex-auto">
            <div className="container py-6">
                <h1 className="text-2xl font-bold leading-tight tracking-tighter md:text-3xl lg:leading-[1.1]">
                    {"Settings"}
                </h1>
                <p className="max-w-2xl pt-2 pb-4 text-foreground">
                    {
                        "Customize your editor experience. Changes apply to your next editor session."
                    }
                </p>
                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                            {"Editor"}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                                <Label htmlFor="relative-line-numbers">
                                    {"Relative line numbers"}
                                </Label>
                                <p className="text-sm text-muted-foreground">
                                    {
                                        "Show line numbers relative to the cursor position"
                                    }
                                </p>
                            </div>
                            <Switch
                                id="relative-line-numbers"
                                checked={relativeLineNumbers}
                                onCheckedChange={handleToggle}
                                disabled={loading}
                            />
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
