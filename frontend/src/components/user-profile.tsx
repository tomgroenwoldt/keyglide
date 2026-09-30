import { Tables } from "@/database.types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import Streak from "./streak";
import { useEffect, useState } from "react";
import { useAppStore } from "@/store";

export interface ProfileProps {
    userId?: string | null;
    onlyImage?: boolean;
}

export default function UserProfile(props: ProfileProps) {
    const { supabase } = useAppStore();
    const [profile, setProfile] = useState<Omit<
        Tables<"profiles">,
        "id"
    > | null>(null);

    useEffect(() => {
        if (props.userId) {
            supabase
                .from("profiles")
                .select("*")
                .eq("id", props.userId)
                .then((res) => {
                    const profile = res.data?.[0];
                    if (profile) {
                        setProfile(profile);
                    }
                });
        }
    }, []);
    return (
        <div className="flex items-center gap-2">
            <div className="flex gap-1">
                <Avatar className="h-8 w-8 rounded-lg">
                    <AvatarImage
                        src={profile?.avatar_url ?? ""}
                        alt={profile?.user_name}
                    />
                    <AvatarFallback className="rounded-lg">
                        {profile?.full_name?.charAt(0)}
                    </AvatarFallback>
                </Avatar>
                <div className="flex gap-1">
                    <div className="grid flex-1 text-left text-sm leading-tight">
                        <span className="truncate font-semibold flex">
                            {profile?.full_name}
                        </span>
                        <span className="truncate text-xs">
                            {profile?.user_name}
                        </span>
                    </div>
                </div>
            </div>
            {profile?.streak !== undefined && profile?.streak !== null && (
                <Streak streak={profile.streak} username={profile.user_name} />
            )}
        </div>
    );
}
