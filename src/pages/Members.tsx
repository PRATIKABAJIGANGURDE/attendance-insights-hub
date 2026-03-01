import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import DashboardLayout from "@/components/DashboardLayout";
import { mockMembers } from "@/data/mockData";
import { cn } from "@/lib/utils";
import { Search, Plus, MoreVertical, Fingerprint } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

export default function Members() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enrollStep, setEnrollStep] = useState<"form" | "waiting">("form");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("Member");

  const filtered = mockMembers.filter(
    (m) =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.fingerprintId.toLowerCase().includes(search.toLowerCase()) ||
      m.role.toLowerCase().includes(search.toLowerCase())
  );

  const handleEnroll = () => {
    setEnrollStep("waiting");
    // Simulated — in real app, this sends command to ESP32
  };

  return (
    <DashboardLayout>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Members</h2>
          <p className="mt-1 text-sm text-muted-foreground">{mockMembers.length} registered members</p>
        </div>
        <Button onClick={() => { setEnrollOpen(true); setEnrollStep("form"); setNewName(""); }} className="gap-2">
          <Plus className="h-4 w-4" />
          Add Member
        </Button>
      </div>

      {/* Search */}
      <div className="mb-6 relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by name, ID, or role..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10 bg-surface-1 border-border"
        />
      </div>

      {/* Table */}
      <div className="glass-card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border/50">
              {["Name", "Role", "Fingerprint ID", "Attendance %", "Last Seen", "Status", ""].map((h) => (
                <th key={h} className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((m, i) => (
              <motion.tr
                key={m.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.03 }}
                className="border-b border-border/30 transition-colors hover:bg-accent/50 cursor-pointer"
                onClick={() => navigate(`/members/${m.id}`)}
              >
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      {m.name.split(" ").map((n) => n[0]).join("")}
                    </div>
                    <span className="text-sm font-medium text-foreground">{m.name}</span>
                  </div>
                </td>
                <td className="px-5 py-3"><Badge variant="outline" className="text-[10px]">{m.role}</Badge></td>
                <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{m.fingerprintId}</td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-16 rounded-full bg-surface-3">
                      <div
                        className={cn("h-1.5 rounded-full", m.attendancePercent >= 80 ? "bg-success" : m.attendancePercent >= 60 ? "bg-warning" : "bg-absent")}
                        style={{ width: `${m.attendancePercent}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground">{m.attendancePercent}%</span>
                  </div>
                </td>
                <td className="px-5 py-3 text-xs text-muted-foreground">{m.lastSeen}</td>
                <td className="px-5 py-3">
                  <span className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold",
                    m.isActive ? "status-present" : "status-absent"
                  )}>
                    {m.isActive ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-5 py-3" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => navigate(`/members/${m.id}`)}>View Profile</DropdownMenuItem>
                      <DropdownMenuItem>Edit</DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive">Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Enroll Dialog */}
      <Dialog open={enrollOpen} onOpenChange={setEnrollOpen}>
        <DialogContent className="bg-card border-border">
          {enrollStep === "form" ? (
            <>
              <DialogHeader>
                <DialogTitle>Add New Member</DialogTitle>
                <DialogDescription>Enter member details. The device will enter enrollment mode.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Member name" className="bg-surface-1" />
                </div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Input value={newRole} onChange={(e) => setNewRole(e.target.value)} placeholder="Member / Trainer" className="bg-surface-1" />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEnrollOpen(false)}>Cancel</Button>
                <Button onClick={handleEnroll} disabled={!newName.trim()}>Start Enrollment</Button>
              </DialogFooter>
            </>
          ) : (
            <div className="flex flex-col items-center py-8">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 animate-pulse">
                <Fingerprint className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">Waiting for Device</h3>
              <p className="mt-2 text-center text-sm text-muted-foreground">
                Place the member's finger on the ESP32 sensor.<br />
                Admin verification required first.
              </p>
              <Button variant="outline" className="mt-6" onClick={() => setEnrollOpen(false)}>Cancel</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
