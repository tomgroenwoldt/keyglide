"use client";

import * as React from "react";
import { MoonIcon, SunIcon } from "lucide-react";

import { useTheme } from "./theme-provider";
import { Button } from "./ui/button";

export function ModeSwitcher() {
    const { theme, setTheme } = useTheme();

    const toggleTheme = React.useCallback(() => {
        setTheme(theme === "dark" ? "light" : "dark");
    }, [theme, setTheme]);

    return (
        <Button
            variant="ghost"
            className="group/toggle h-8 w-8 px-0"
            onClick={toggleTheme}
        >
            <SunIcon className="hidden [html.dark_&]:block" />
            <MoonIcon className="hidden [html.light_&]:block" />
            <span className="sr-only">Toggle theme</span>
        </Button>
    );
}
