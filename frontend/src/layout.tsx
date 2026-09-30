import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import { Outlet } from "react-router-dom";

export default function Layout() {
    return (
        <div className="border-grid flex flex-1 flex-col">
            <Header />
            <main className="flex flex-1 flex-col">
                <Outlet />
            </main>
            <Footer />
        </div>
    );
}
