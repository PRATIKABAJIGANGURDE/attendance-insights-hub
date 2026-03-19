import { useState, useEffect } from "react";
import { databases } from "@/lib/appwrite";
import { ID, Query } from "appwrite";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Check, X, UserCog, Fingerprint, RefreshCcw } from "lucide-react";
import { motion } from "framer-motion";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function Approvals() {
  const [pendingUsers, setPendingUsers] = useState<any[]>([]);
  const [activeMembers, setActiveMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog states
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [selectedPendingUser, setSelectedPendingUser] = useState<any>(null);
  
  // Link configuration
  const [linkMode, setLinkMode] = useState<"existing" | "new">("existing");
  const [selectedMemberId, setSelectedMemberId] = useState<string>("");

  // Live enrollment states
  const [enrollStep, setEnrollStep] = useState<"idle" | "polling" | "success" | "error">("idle");
  const [enrollStatusMsg, setEnrollStatusMsg] = useState("");
  const [activeCommandId, setActiveCommandId] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      const dbId = import.meta.env.VITE_APPWRITE_DATABASE_ID || "main_db";
      const [usersRes, membersRes] = await Promise.all([
        databases.listDocuments(dbId, "web_users", [
          Query.equal("status", "pending"),
          Query.orderDesc("$createdAt")
        ]),
        databases.listDocuments(dbId, import.meta.env.VITE_APPWRITE_COLLECTION_ID || "members", [
          Query.orderDesc("$createdAt"),
          Query.limit(500)
        ])
      ]);
      setPendingUsers(usersRes.documents);
      setActiveMembers(membersRes.documents.filter((m: any) => m.isActive !== false && m.role !== "super_admin"));
    } catch (err) {
      console.error("Failed to load data", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Polling for device command
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
            // Refresh members to get the newly created one!
            const dbId = import.meta.env.VITE_APPWRITE_DATABASE_ID || "main_db";
            const membersRes = await databases.listDocuments(dbId, import.meta.env.VITE_APPWRITE_COLLECTION_ID || "members", [
              Query.orderDesc("$createdAt"),
              Query.limit(10)
            ]);
            const newMembers = membersRes.documents.filter((m: any) => m.isActive !== false && m.role !== "super_admin");
            setActiveMembers(newMembers);
            // Auto-select the newest member
            if (newMembers.length > 0) {
              setSelectedMemberId(newMembers[0].$id);
            }
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

  const handleStartEnrollment = async () => {
    if (!selectedPendingUser) return;
    try {
      setEnrollStep("polling");
      const nameGuess = selectedPendingUser.email.split("@")[0]; // Use email prefix as temp name
      const response = await databases.createDocument(
        import.meta.env.VITE_APPWRITE_DATABASE_ID || "main_db",
        import.meta.env.VITE_APPWRITE_COLLECTION_ID_COMMANDS || "device_commands",
        ID.unique(),
        {
          command: "addMember",
          status: "pending",
          memberName: nameGuess,
          deviceId: "ESP32_DEVICE_01"
        }
      );
      setActiveCommandId(response.$id);
      setEnrollStatusMsg("");
      toast.success("Enrollment command sent to device. Place finger on scanner.");
    } catch (err: any) {
      setEnrollStep("error");
      toast.error(err.message || "Failed to send command to device");
    }
  };

  const handleConfirmApproval = async () => {
    if (!selectedPendingUser) return;
    if (!selectedMemberId) {
      toast.error("Please select a physical fingerprint record to link this account to.");
      return;
    }

    setIsUpdating(true);
    try {
      const dbId = import.meta.env.VITE_APPWRITE_DATABASE_ID || "main_db";
      const memberDoc = activeMembers.find(m => m.$id === selectedMemberId);
      
      await databases.updateDocument(dbId, "web_users", selectedPendingUser.$id, {
        status: "approved",
        linkedMemberId: selectedMemberId,
        linkedMemberName: memberDoc?.name || ""
      });
      
      toast.success(`User ${selectedPendingUser.email} has been approved and linked.`);
      setPendingUsers(pendingUsers.filter(u => u.$id !== selectedPendingUser.$id));
      setApproveDialogOpen(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to approve user.");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleReject = async (docId: string) => {
    if (!window.confirm("Are you sure you want to reject this request?")) return;
    try {
      const dbId = import.meta.env.VITE_APPWRITE_DATABASE_ID || "main_db";
      await databases.updateDocument(dbId, "web_users", docId, {
        status: "rejected"
      });
      toast.success(`Request rejected.`);
      setPendingUsers(pendingUsers.filter(u => u.$id !== docId));
    } catch (err: any) {
      toast.error(err.message || "Failed to reject request");
    }
  };

  const openApprovalDialog = (user: any) => {
    setSelectedPendingUser(user);
    setLinkMode("existing");
    setSelectedMemberId("");
    setEnrollStep("idle");
    setApproveDialogOpen(true);
  };

  return (
    <DashboardLayout>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-foreground">Web App Approvals</h2>
        <p className="mt-1 text-sm text-muted-foreground">Manage and link registration requests to physical fingerprints.</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : pendingUsers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center glass-card">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-surface-2 text-muted-foreground">
            <UserCog className="h-8 w-8" />
          </div>
          <h3 className="text-lg font-medium text-foreground">No Pending Approvals</h3>
          <p className="mt-2 text-sm text-muted-foreground">All user registration requests have been resolved.</p>
        </div>
      ) : (
        <div className="glass-card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/50">
                <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Email</th>
                <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Requested On</th>
                <th className="px-5 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pendingUsers.map((user, i) => (
                <motion.tr
                  key={user.$id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.05 }}
                  className="border-b border-border/30 transition-colors hover:bg-accent/50"
                >
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary uppercase">
                        {user.email[0]}
                      </div>
                      <span className="text-sm font-medium text-foreground">{user.email}</span>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-xs text-muted-foreground">
                    {new Date(user.$createdAt).toLocaleString()}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" className="h-8 px-3 text-success hover:bg-success/20 hover:text-success border-success/30 flex items-center gap-1" onClick={() => openApprovalDialog(user)}>
                        <Check className="h-3 w-3" /> Approve
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 w-8 p-0 text-destructive hover:bg-destructive/20 hover:text-destructive border-destructive/30" onClick={() => handleReject(user.$id)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Approval & Link Dialog */}
      <Dialog open={approveDialogOpen} onOpenChange={setApproveDialogOpen}>
        <DialogContent className="bg-card border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Approve & Link Profile</DialogTitle>
            <DialogDescription>
              Associate the web account <strong className="text-foreground">{selectedPendingUser?.email}</strong> with a biometric fingerprint profile.
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4 space-y-4">
            <div className="flex rounded-md bg-surface-1 p-1">
              <button
                className={`flex-1 rounded-sm py-1.5 text-xs font-medium transition-all ${linkMode === "existing" ? "bg-card text-foreground shadow" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setLinkMode("existing")}
              >
                Existing Fingerprint
              </button>
              <button
                className={`flex-1 rounded-sm py-1.5 text-xs font-medium transition-all ${linkMode === "new" ? "bg-card text-foreground shadow" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setLinkMode("new")}
              >
                Scan New Hardware
              </button>
            </div>

            {linkMode === "existing" ? (
              <div className="space-y-3 pt-2">
                <label className="text-sm font-medium text-foreground">Select Member Profile</label>
                <select 
                  className="w-full flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  value={selectedMemberId}
                  onChange={(e) => setSelectedMemberId(e.target.value)}
                >
                  <option value="" disabled>-- Choose an enrolled member --</option>
                  {activeMembers.map(m => (
                    <option key={m.$id} value={m.$id}>
                      {m.name} (ID: {m.fingerprintId})
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="pt-2">
                {enrollStep === "idle" || enrollStep === "error" ? (
                  <div className="flex flex-col items-center py-4 space-y-3">
                    <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                      <Fingerprint className="h-6 w-6" />
                    </div>
                    {enrollStep === "error" && (
                      <p className="text-xs text-destructive text-center mb-2">Hardware capture failed: {enrollStatusMsg}. Try again.</p>
                    )}
                    <Button onClick={handleStartEnrollment} className="w-full" variant="secondary">
                      Start ESP32 Scan Process
                    </Button>
                  </div>
                ) : enrollStep === "polling" ? (
                  <div className="flex flex-col items-center py-6 space-y-4">
                     <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 animate-pulse">
                        <Fingerprint className="h-8 w-8 text-primary" />
                     </div>
                     <p className="text-sm font-semibold text-foreground animate-pulse">Waiting for Device...</p>
                     <p className="text-xs text-muted-foreground text-center">Place finger on scanner 5 times.</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center py-6 space-y-4">
                     <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
                        <Check className="h-8 w-8 text-success" />
                     </div>
                     <p className="text-sm font-semibold text-success">Capture Successful!</p>
                     <p className="text-xs text-muted-foreground text-center">
                       New member mapped. Click "Confirm Approval" below.
                     </p>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="flex gap-2 sm:justify-between border-t border-border pt-4">
            <Button variant="ghost" onClick={() => setApproveDialogOpen(false)}>Cancel</Button>
            <Button 
                onClick={handleConfirmApproval} 
                className="font-semibold" 
                disabled={isUpdating || !selectedMemberId || (linkMode === "new" && enrollStep !== "success")}
            >
              {isUpdating ? "Approving..." : "Confirm Approval"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
