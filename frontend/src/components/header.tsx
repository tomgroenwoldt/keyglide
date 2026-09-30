import { ModeSwitcher } from "./mode-switcher";
import KeyglideLogo from "./keyglide-logo";
import {
    Coffee,
    Lightbulb,
    LogOut,
    Settings,
    Library,
    Upload,
} from "lucide-react";
import { useAppStore } from "@/store";
import { DropdownMenu } from "@radix-ui/react-dropdown-menu";
import {
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { useNavigate } from "react-router-dom";
import { Button } from "./ui/button";
import { useEffect } from "react";
import UserProfile from "./user-profile";

export function Header() {
    const { user, setUser, setAuthLoaded, supabase } = useAppStore();

    const navigate = useNavigate();

    useEffect(() => {
        supabase.auth.getUser().then((response) => {
            if (response.data.user) {
                setUser(response.data.user);
            }
            setAuthLoaded(true);
        });
    }, []);

    return (
        <header className="border-grid sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="container-wrapper">
                <div className="container flex h-14 items-center">
                    <a
                        className="flex items-center gap-2 lg:mr-6 cursor-pointer"
                        onClick={() => navigate("/")}
                    >
                        <div className="h-6 w-6">
                            <KeyglideLogo />
                        </div>
                        <span className="font-bold lg:inline-block">
                            {"keyglide"}
                        </span>
                    </a>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate("/")}
                    >
                        {"Today"}
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate("/browse")}
                    >
                        {"Browse"}
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate("/leaderboard")}
                    >
                        {"Leaderboard"}
                    </Button>
                    <div className="flex flex-1 items-center justify-between gap-2 md:justify-end">
                        <div className="w-full flex-1 md:w-auto md:flex-none"></div>
                        <nav className="flex items-center gap-2">
                            <a
                                target="_blank"
                                rel="noreferrer"
                                href="https://ko-fi.com/tomgroenwoldt"
                            >
                                <Button variant="outline" size="sm">
                                    <Coffee />
                                    {"Buy me a coffee"}
                                </Button>
                            </a>
                            <a
                                target="_blank"
                                rel="noreferrer"
                                href="https://github.com/tomgroenwoldt/keyglide/issues"
                            >
                                <Button variant="outline" size="sm">
                                    <Lightbulb />
                                    {"Share feedback"}
                                </Button>
                            </a>
                            <ModeSwitcher />
                            {user ? (
                                <DropdownMenu>
                                    <DropdownMenuTrigger>
                                        <UserProfile userId={user.id} />
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent
                                        className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
                                        align="end"
                                        sideOffset={4}
                                    >
                                        <DropdownMenuLabel className="p-0 font-normal">
                                            <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                                                <UserProfile userId={user.id} />
                                            </div>
                                        </DropdownMenuLabel>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                            onClick={() => navigate("/submit")}
                                        >
                                            <Upload />
                                            {"Submit a challenge"}
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                            onClick={() => navigate("/mine")}
                                        >
                                            <Library />
                                            {"My challenges"}
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                            onClick={() =>
                                                navigate("/settings")
                                            }
                                        >
                                            <Settings />
                                            {"Settings"}
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                            onClick={async () => {
                                                await supabase.auth.signOut();
                                                navigate("/login");
                                                setUser(null);
                                            }}
                                        >
                                            <LogOut />
                                            {"Log out"}
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            ) : (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                        navigate("/login");
                                    }}
                                >
                                    {"Login"}
                                </Button>
                            )}
                        </nav>
                    </div>
                </div>
            </div>
        </header>
    );
}
