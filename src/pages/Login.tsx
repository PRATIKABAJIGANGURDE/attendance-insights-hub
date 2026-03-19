import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { account, databases } from "@/lib/appwrite";
import { Query } from "appwrite";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { LogIn } from "lucide-react";

export default function Login() {
    const navigate = useNavigate();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        try {
            // Aggressively attempt to clear any stuck existing sessions to prevent 401s
            try {
                await account.deleteSession("current");
            } catch (e) {
                // Ignore if no session exists or network error
            }

            const session = await account.createEmailPasswordSession(email, password);

            const dbId = import.meta.env.VITE_APPWRITE_DATABASE_ID || "main_db";
            const userDocs = await databases.listDocuments(dbId, "web_users", [
                Query.equal("userId", session.userId)
            ]);

            if (userDocs.documents.length > 0) {
                const doc = userDocs.documents[0];
                if (doc.status === "pending") {
                    await account.deleteSession("current");
                    toast.error("Your account is pending superadmin approval.");
                    setLoading(false);
                    return;
                } else if (doc.status === "rejected") {
                    await account.deleteSession("current");
                    toast.error("Your account request was rejected.");
                    setLoading(false);
                    return;
                }
                
                sessionStorage.setItem("user_role", doc.role);
                if (doc.linkedMemberId) {
                    sessionStorage.setItem("linked_member_id", doc.linkedMemberId);
                }

                if (doc.role === "user") {
                    if (!doc.linkedMemberId) {
                        await account.deleteSession("current");
                        toast.error("Account approved but no physical profile is linked yet. Contact Admin.");
                        setLoading(false);
                        return;
                    }
                    toast.success("Logged in successfully!");
                    navigate(`/members/${doc.linkedMemberId}`);
                    return;
                }
            } else if (email.toLowerCase() !== "pratikgangurde35@gmail.com") {
                await account.deleteSession("current");
                toast.error("Unrecognized account. Please register first.");
                setLoading(false);
                return;
            } else {
                sessionStorage.setItem("user_role", "superadmin");
            }

            toast.success("Logged in successfully!");
            navigate("/");
        } catch (error: any) {
            toast.error(error.message || "Failed to log in.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-background p-4 relative overflow-hidden">
            {/* Background decorations */}
            <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-background to-secondary/10 opacity-50" />
            <div className="absolute top-1/4 left-1/4 h-96 w-96 rounded-full bg-primary/20 blur-[100px] pointer-events-none" />
            <div className="absolute bottom-1/4 right-1/4 h-96 w-96 rounded-full bg-secondary/20 blur-[100px] pointer-events-none" />

            <div className="w-full max-w-md space-y-8 glass-card p-8 rounded-2xl relative z-10 border border-border/50 shadow-2xl">
                <div className="text-center space-y-2">
                    <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary mb-2">
                        <LogIn className="h-6 w-6" />
                    </div>
                    <h2 className="text-3xl font-bold tracking-tight text-foreground">Welcome Back</h2>
                    <p className="text-sm text-muted-foreground">Sign in to the Attendance Insights Hub.</p>
                </div>

                <form onSubmit={handleLogin} className="space-y-6 mt-8">
                    <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input
                            id="email"
                            type="email"
                            placeholder="admin@example.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            className="bg-surface-1 border-border/50 focus:border-primary/50 transition-colors"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="password">Password</Label>
                        <Input
                            id="password"
                            type="password"
                            placeholder="••••••••"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            className="bg-surface-1 border-border/50 focus:border-primary/50 transition-colors"
                        />
                    </div>

                    <Button type="submit" className="w-full font-semibold shadow-lg shadow-primary/25 transition-all hover:scale-[1.02]" disabled={loading}>
                        {loading ? "Signing in..." : "Sign In"}
                    </Button>

                    <p className="text-center text-sm text-muted-foreground">
                        Don't have an account?{" "}
                        <Button variant="link" className="p-0 h-auto font-semibold" onClick={() => navigate("/register")} type="button">
                            Request Access
                        </Button>
                    </p>
                </form>
            </div>
        </div>
    );
}
