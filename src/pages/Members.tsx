import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import DashboardLayout from "@/components/DashboardLayout";
import { databases } from "@/lib/appwrite";
import { ID, Query } from "appwrite";
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
import { toast } from "sonner";

export default function Members() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enrollStep, setEnrollStep] = useState<"form" | "polling" | "success" | "error">("form");
  const [enrollStatusMsg, setEnrollStatusMsg] = useState("");
  const [activeCommandId, setActiveCommandId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("Member");

  const [membersList, setMembersList] = useState<any[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);

  // Fetch real members from Appwrite
  const fetchMembers = async () => {
    try {
      const dbId = import.meta.env.VITE_APPWRITE_DATABASE_ID || "main_db";
      const colId = import.meta.env.VITE_APPWRITE_COLLECTION_ID || "members";
      const response = await databases.listDocuments(dbId, colId, [
        Query.orderDesc("$createdAt")
      ]);

      // Fetch recent attendance to map true last seen
      const attendRes = await databases.listDocuments(dbId, "attendance", [
        Query.orderDesc("$createdAt"),
        Query.limit(500)
      ]);
      const attMap: Record<string, string> = {};
      const presentCounts: Record<string, Set<string>> = {};
      
      attendRes.documents.forEach(doc => {
        const mId = doc.memberId;
        if (!attMap[mId]) attMap[mId] = doc.$createdAt;
        
        const d = new Date(doc.$createdAt);
        const dateStr = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        if (!presentCounts[mId]) presentCounts[mId] = new Set();
        presentCounts[mId].add(dateStr);
      });

      const today = new Date();
      today.setHours(0,0,0,0);

      const mapped = response.documents.map(m => {
        const joinDate = new Date(m.$createdAt);
        joinDate.setHours(0,0,0,0);
        let daysSinceJoin = Math.floor((today.getTime() - joinDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        if (daysSinceJoin < 1) daysSinceJoin = 1;
        
        const presents = presentCounts[m.fingerprintId || m.$id]?.size || 0;
        const calcPercent = Math.round((presents / daysSinceJoin) * 100);

        return {
          ...m,
          realLastSeen: attMap[m.fingerprintId || m.$id] || m.$updatedAt,
          computedAttendance: calcPercent
        };
      });

      setMembersList(mapped);
    } catch (err) {
      console.error("Failed to load members", err);
    } finally {
      setLoadingMembers(false);
    }
  };

  useEffect(() => {
    fetchMembers();
  }, []);

  const filtered = membersList.filter(
    (m) =>
      m.role !== "super_admin" &&
      (m.name?.toLowerCase().includes(search.toLowerCase()) ||
        String(m.fingerprintId || "").toLowerCase().includes(search.toLowerCase()) ||
        m.role?.toLowerCase().includes(search.toLowerCase()))
  );

  const [loading, setLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editMember, setEditMember] = useState<any>(null);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (enrollStep === "polling" && activeCommandId) {
      interval = setInterval(async () => {
        try {
          const doc = await databases.getDocument(
            import.meta.env.VITE_APPWRITE_DATABASE_ID || "main_db",
            import.meta.env.VITE_APPWRITE_COLLECTION_ID_COMMANDS || "device_commands",
            activeCommandId
          );
          if (doc.status === "completed") {
            setEnrollStep("success");
            clearInterval(interval);
          } else if (doc.status === "failed" || doc.status === "timeout" || doc.status === "unauthorized") {
            setEnrollStep("error");
            setEnrollStatusMsg(doc.status);
            clearInterval(interval);
          }
        } catch (e) { /* ignore */ }
      }, 2000);
    }
    return () => clearInterval(interval);
  }, [enrollStep, activeCommandId]);

  const handleEnroll = async () => {
    if (!newName.trim()) return;

    setLoading(true);
    try {
      const response = await databases.createDocument(
        import.meta.env.VITE_APPWRITE_DATABASE_ID || "main_db",
        import.meta.env.VITE_APPWRITE_COLLECTION_ID_COMMANDS || "device_commands",
        ID.unique(),
        {
          command: "addMember",
          status: "pending",
          memberName: newName,
          deviceId: "ESP32_DEVICE_01" // In a real app, this would be selected from a dropdown
        }
      );

      setActiveCommandId(response.$id);
      setEnrollStep("polling");
      setEnrollStatusMsg("");
      toast.success("Enrollment command sent to device!");
    } catch (err: any) {
      toast.error(err.message || "Failed to send command to device");
    } finally {
      setLoading(false);
    }
  };

  const handleEditOpen = (member: any) => {
    setEditMember({ ...member });
    setEditOpen(true);
  };

  const handleUpdate = async () => {
    if (!editMember || !editMember.name.trim()) return;
    try {
      await databases.updateDocument(
        import.meta.env.VITE_APPWRITE_DATABASE_ID || "main_db",
        import.meta.env.VITE_APPWRITE_COLLECTION_ID || "members",
        editMember.$id,
        {
          name: editMember.name,
          role: editMember.role,
        }
      );
      toast.success("Member updated successfully!");
      setEditOpen(false);
      setMembersList(membersList.map(m => m.$id === editMember.$id ? { ...m, name: editMember.name, role: editMember.role } : m));
    } catch (err: any) {
      toast.error(err.message || "Failed to update member");
    }
  };

  const handleDelete = async (memberId: string) => {
    if (!window.confirm("Are you sure you want to delete this member?")) return;
    try {
      await databases.deleteDocument(
        import.meta.env.VITE_APPWRITE_DATABASE_ID || "main_db",
        import.meta.env.VITE_APPWRITE_COLLECTION_ID || "members",
        memberId
      );
      toast.success("Member deleted successfully!");
      setMembersList(membersList.filter((m) => m.$id !== memberId));
    } catch (err: any) {
      toast.error(err.message || "Failed to delete member");
    }
  };

  return (
    <DashboardLayout>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Members</h2>
          <p className="mt-1 text-sm text-muted-foreground">{membersList.filter(m => m.role !== "super_admin").length} registered members</p>
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
                key={m.$id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.03 }}
                className="border-b border-border/30 transition-colors hover:bg-accent/50 cursor-pointer"
                onClick={() => navigate(`/members/${m.$id}`)}
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
                        className={cn("h-1.5 rounded-full", (m.computedAttendance ?? 0) >= 80 ? "bg-success" : (m.computedAttendance ?? 0) >= 60 ? "bg-warning" : "bg-absent")}
                        style={{ width: `${m.computedAttendance ?? 0}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground">{m.computedAttendance ?? 0}%</span>
                  </div>
                </td>
                <td className="px-5 py-3 text-xs text-muted-foreground">
                  {new Date(m.realLastSeen || m.$updatedAt).toLocaleString()}
                </td>
                <td className="px-5 py-3">
                  <span className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold",
                    m.isActive !== false ? "status-present" : "status-absent"
                  )}>
                    {m.isActive !== false ? "Active" : "Inactive"}
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
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); navigate(`/members/${m.$id}`); }}>View Profile</DropdownMenuItem>
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleEditOpen(m); }}>Edit</DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); handleDelete(m.$id); }}>Delete</DropdownMenuItem>
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
                <Button onClick={handleEnroll} disabled={!newName.trim() || loading}>
                  {loading ? "Saving..." : "Start Enrollment"}
                </Button>
              </DialogFooter>
            </>
          ) : enrollStep === "polling" ? (
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
          ) : enrollStep === "success" ? (
            <div className="flex flex-col items-center py-8">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
                <Fingerprint className="h-8 w-8 text-success" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">Enrollment Successful!</h3>
              <p className="mt-2 text-center text-sm text-muted-foreground">
                The member has been added to the system.
              </p>
              <Button className="mt-6" onClick={() => {
                setEnrollOpen(false);
                setEnrollStep("form");
                setNewName("");
                fetchMembers(); // refresh the list with the newly created member!
              }}>Close</Button>
            </div>
          ) : (
            <div className="flex flex-col items-center py-8">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
                <Fingerprint className="h-8 w-8 text-destructive" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">Enrollment Failed</h3>
              <p className="mt-2 text-center text-sm text-muted-foreground">
                {enrollStatusMsg === "timeout" ? "The operation timed out." :
                  enrollStatusMsg === "unauthorized" ? "Admin verification failed." :
                    "Sensor failed to capture fingerprints."}
              </p>
              <div className="mt-6 flex gap-3">
                <Button variant="outline" onClick={() => setEnrollOpen(false)}>Cancel</Button>
                <Button onClick={handleEnroll}>Try Again</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle>Edit Member</DialogTitle>
            <DialogDescription>Update the member's details.</DialogDescription>
          </DialogHeader>
          {editMember && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={editMember.name} onChange={(e) => setEditMember({ ...editMember, name: e.target.value })} className="bg-surface-1" />
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Input value={editMember.role} onChange={(e) => setEditMember({ ...editMember, role: e.target.value })} className="bg-surface-1" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleUpdate}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
