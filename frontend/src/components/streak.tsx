import { FlameIcon, SnowflakeIcon } from "lucide-react";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "./ui/tooltip";
import { AnimatePresence, motion } from "motion/react";

export interface StreakProps {
    streak: number;
    username: string;
}

export default function Streak({ streak, username }: StreakProps) {
    if (streak === 0) {
        return (
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <div className="flex items-center gap-1 bg-blue-700/10 dark:bg-blue-400/10 px-2 py-1 rounded-lg text-blue-700 dark:text-blue-400 border border-blue-700/30 dark:border-blue-400/30">
                            <SnowflakeIcon className="h-4 w-4" />
                            {streak}
                        </div>
                    </TooltipTrigger>
                    <TooltipContent>
                        <p>{`${username} has not solved today's challenge yet.`}</p>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        );
    }
    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <div className="flex items-center gap-1 bg-orange-700/10 dark:bg-orange-400/10 px-2 py-1 rounded-lg text-orange-700 dark:text-orange-400 border border-orange-700/30 dark:border-orange-400/30">
                        <FlameIcon className="h-4 w-4" />
                        <AnimatePresence mode="popLayout">
                            <motion.span
                                key={streak}
                                initial={{
                                    y: 8,
                                    opacity: 0,
                                }}
                                animate={{
                                    y: 0,
                                    opacity: 1,
                                }}
                                exit={{ y: -8, opacity: 0 }}
                                transition={{
                                    duration: 0.25,
                                }}
                                className="flex justify-end text-sm font-medium"
                            >
                                {streak}
                            </motion.span>
                        </AnimatePresence>
                    </div>
                </TooltipTrigger>
                <TooltipContent>
                    <p>{`${username} has played every challenge on its release date for ${streak} day${streak > 1 ? "s" : ""} in a row.`}</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}
