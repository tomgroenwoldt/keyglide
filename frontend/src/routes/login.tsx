import LoginForm from "@/components/login-form";
import { useSession } from "@/hooks/use-session";
import { useNavigate } from "react-router-dom";

export default function Login() {
    const navigate = useNavigate();
    const { session } = useSession();

    if (session) {
        navigate("/");
    }

    return (
        <div className="h-screen w-screen flex justify-center items-center">
            <div className="relative flex flex-col items-center">
                <div className="w-full">
                    <LoginForm />
                </div>
            </div>
        </div>
    );
}
