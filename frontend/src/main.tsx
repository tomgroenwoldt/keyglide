// Keyglide — a daily keybinding puzzle for Helix.
// Copyright (C) 2026 Tom Groenwoldt
//
// This program is free software: you can redistribute it and/or modify it
// under the terms of the GNU Affero General Public License as published by the
// Free Software Foundation, either version 3 of the License, or (at your
// option) any later version.
//
// This program is distributed in the hope that it will be useful, but WITHOUT
// ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
// FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License
// for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.

import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { ThemeProvider } from "./components/theme-provider.tsx";
import "./index.css";
import { setupAnalytics } from "./lib/analytics.ts";
import { Navigate } from "react-router-dom";
import Login from "./routes/login.tsx";
import Root from "./routes/root.tsx";
import { LeaderBoard } from "./routes/leaderboard.tsx";
import Layout from "./layout.tsx";
import Settings from "./routes/settings.tsx";
import { Browse } from "./routes/browse.tsx";
import { Challenge } from "./routes/challenge.tsx";
import { ChallengeByDate } from "./routes/challenge-by-date.tsx";
import { Submit } from "./routes/submit.tsx";
import { Mine } from "./routes/mine.tsx";

setupAnalytics();

const router = createBrowserRouter([
    {
        element: <Layout />,
        children: [
            { path: "/", element: <Root /> },
            { path: "/browse", element: <Browse /> },
            { path: "/c/:id", element: <Challenge /> },
            { path: "/submit", element: <Submit /> },
            { path: "/mine", element: <Mine /> },
            { path: "/leaderboard", element: <LeaderBoard /> },
            { path: "/settings", element: <Settings /> },
            { path: "/login", element: <Login /> },

            // Paths from before challenges and submissions were one thing.
            // Kept so existing links and bookmarks still resolve.
            {
                path: "/challenges",
                element: <Navigate to="/browse" replace />,
            },
            {
                path: "/user-challenges",
                element: <Navigate to="/browse" replace />,
            },
            {
                path: "/user-challenges/new",
                element: <Navigate to="/submit" replace />,
            },
            {
                path: "/user-challenges/mine",
                element: <Navigate to="/mine" replace />,
            },
            { path: "/user-challenge/:id", element: <Challenge /> },

            // `/:date` is last so it cannot shadow the named routes above.
            { path: "/:date", element: <ChallengeByDate /> },
        ],
    },
]);

createRoot(document.getElementById("root")!).render(
    <ThemeProvider>
        <RouterProvider router={router} />
    </ThemeProvider>,
);
