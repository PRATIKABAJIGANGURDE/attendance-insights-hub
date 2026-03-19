import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, Users, BarChart3, Cpu, Fingerprint, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/members", icon: Users, label: "Members" },
  { to: "/analytics", icon: BarChart3, label: "Analytics" },
  { to: "/device", icon: Cpu, label: "Device" },
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const location = useLocation();

  return (
    <>
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
        {navItems.map((item) => {
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
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-primary">
            A
          </div>
          <div>
            <p className="text-xs font-medium text-foreground">Admin</p>
            <p className="text-[10px] text-muted-foreground">admin@club.com</p>
          </div>
        </div>
      </div>
    </>
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
          <div className="flex h-full flex-col">
            <SidebarContent onNavigate={() => setOpen(false)} />
          </div>
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
