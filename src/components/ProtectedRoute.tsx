import { Navigate, Outlet } from "react-router-dom";
import { useEffect, useState } from "react";
import { account } from "@/lib/appwrite";

interface ProtectedRouteProps {
  adminOnly?: boolean;
}

export default function ProtectedRoute({ adminOnly = false }: ProtectedRouteProps) {
  const [isChecking, setIsChecking] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [hasRole, setHasRole] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        await account.get();
        setIsAuthenticated(true);
        
        const cachedRole = sessionStorage.getItem("user_role");
        const linkedId = sessionStorage.getItem("linked_member_id");

        if (adminOnly) {
          if (cachedRole === "superadmin") {
            setHasRole(true);
          } else {
            // They are authenticated but not admin. Kick to their profile.
            setHasRole(false);
          }
        } else {
          // If not adminOnly, it means it's for anyone authenticated (e.g. MemberProfile)
          setHasRole(true);
        }
      } catch (e) {
        setIsAuthenticated(false);
      } finally {
        setIsChecking(false);
      }
    };
    checkAuth();
  }, [adminOnly]);

  if (isChecking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!hasRole) {
    const linkedId = sessionStorage.getItem("linked_member_id");
    if (linkedId) {
      return <Navigate to={`/members/${linkedId}`} replace />;
    }
    // Fallback if somehow no linkedId but authenticated (shouldn't happen with our updated login flow)
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
