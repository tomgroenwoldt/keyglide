import { Button } from "./ui/button";
import { Icons } from "./ui/icons";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "./ui/card";
import { Link } from "react-router-dom";
import KeyglideLogo from "./keyglide-logo";
import { useAppStore } from "@/store";

export default function LoginForm() {
    const { supabase } = useAppStore();

    return (
        <Card className="w-[350px]">
            <CardHeader>
                <div className="flex w-full justify-center">
                    <div className="max-w-[30%]">
                        <KeyglideLogo />
                    </div>
                </div>
                <CardTitle>{"Log in"}</CardTitle>
                <CardDescription>
                    {"Log in to keyglide. Elevate your editing skills!"}
                </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
                <a
                    onClick={async () => {
                        await supabase.auth.signInWithOAuth({
                            provider: "github",
                        });
                    }}
                >
                    <Button className="w-full" type="button">
                        <>
                            <Icons.gitHub />
                            {"Log in via GitHub"}
                        </>
                    </Button>
                </a>
                <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-card px-2 text-muted-foreground">
                            {"Or"}
                        </span>
                    </div>
                </div>
                <Link to="/">
                    <Button className="w-full" variant="outline" type="button">
                        {"Continue as guest"}
                    </Button>
                </Link>
            </CardContent>
        </Card>
    );
}
