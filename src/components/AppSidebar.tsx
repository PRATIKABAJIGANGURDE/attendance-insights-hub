import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard, Users, BarChart3, Cpu, Fingerprint, Menu, LogOut, CheckSquare } from "lucide-react";
import { account, databases } from "@/lib/appwrite";
import { Query } from "appwrite";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

// Navigation items are now generated dynamically per role

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(() => {
    const cached = sessionStorage.getItem("user_info");
    return cached ? JSON.parse(cached) : null;
  });
  const [role, setRole] = useState<string>(() => {
    return sessionStorage.getItem("user_role") || "user";
  });
  const [linkedId, setLinkedId] = useState<string | null>(() => {
    return sessionStorage.getItem("linked_member_id");
  });

  useEffect(() => {
    account.get()
      .then(async (u) => {
        setUser(u);
        sessionStorage.setItem("user_info", JSON.stringify(u));
        try {
          const dbId = import.meta.env.VITE_APPWRITE_DATABASE_ID || "main_db";
          const docs = await databases.listDocuments(dbId, "web_users", [
            Query.equal("userId", u.$id)
          ]);
          let fetchedRole = "user";
          if (docs.documents.length > 0) {
            fetchedRole = docs.documents[0].role;
            if (docs.documents[0].linkedMemberId) {
              setLinkedId(docs.documents[0].linkedMemberId);
              sessionStorage.setItem("linked_member_id", docs.documents[0].linkedMemberId);
            }
          } else if (u.email.toLowerCase() === "pratikgangurde35@gmail.com") {
            fetchedRole = "superadmin";
          }
          setRole(fetchedRole);
          sessionStorage.setItem("user_role", fetchedRole);
        } catch (e) {}
      })
      .catch(() => {
          sessionStorage.removeItem("user_info");
          sessionStorage.removeItem("user_role");
          sessionStorage.removeItem("linked_member_id");
      });
  }, []);

  const handleLogout = async () => {
    try {
      await account.deleteSession("current");
      sessionStorage.removeItem("user_info");
      sessionStorage.removeItem("user_role");
      sessionStorage.removeItem("linked_member_id");
      navigate("/login");
    } catch (e) {}
  };

  let items: any[] = [];
  if (role === "superadmin") {
    items = [
      { to: "/", icon: LayoutDashboard, label: "Dashboard" },
      { to: "/members", icon: Users, label: "Members" },
      { to: "/analytics", icon: BarChart3, label: "Analytics" },
      { to: "/device", icon: Cpu, label: "Device" },
      { to: "/approvals", icon: CheckSquare, label: "Approvals" }
    ];
  } else if (role === "user" && linkedId) {
    items = [
      { to: `/members/${linkedId}`, icon: Fingerprint, label: "My Profile" }
    ];
  }

  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 border-b border-border px-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary glow-primary">
          <Fingerprint className="h-5 w-5 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-sm font-semibold text-foreground">ASGS Dashboard</h1>
          <p className="text-[10px] text-muted-foreground">Atharva Satellite Ground Station</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 px-3 py-4">
        {items.map((item) => {
          const isActive = location.pathname === item.to ||
            (item.to !== "/" && location.pathname.startsWith(item.to));
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <item.icon className={cn("h-4 w-4", isActive && "text-primary")} />
              {item.label}
            </NavLink>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="border-t border-border p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-primary uppercase">
              {user ? user.name[0] : "A"}
            </div>
            <div className="overflow-hidden">
              <p className="text-xs font-medium text-foreground truncate max-w-[120px]">{user ? user.name : "Loading..."}</p>
              <p className="text-[10px] text-muted-foreground truncate max-w-[120px]">{user ? user.email : ""}</p>
            </div>
          </div>
          <button 
            onClick={handleLogout}
            className="p-2 text-muted-foreground hover:bg-accent hover:text-foreground rounded-md transition-colors"
            title="Logout"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function MobileHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-border bg-sidebar px-4 lg:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <button className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground">
            <Menu className="h-5 w-5" />
          </button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 bg-sidebar p-0 border-border">
          <SidebarContent onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="flex items-center gap-2">
        <Fingerprint className="h-5 w-5 text-primary" />
        <span className="text-sm font-semibold text-foreground">ASGS</span>
      </div>
    </header>
  );
}

export default function AppSidebar() {
  return (
    <aside className="fixed left-0 top-0 z-40 hidden h-screen w-64 flex-col border-r border-border bg-sidebar lg:flex">
      <SidebarContent />
    </aside>
  );
}
