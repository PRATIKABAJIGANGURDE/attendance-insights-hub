import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import DashboardLayout from "@/components/DashboardLayout";
import AttendanceCalendar from "@/components/AttendanceCalendar";
import { ArrowLeft, Fingerprint, TrendingUp, Clock, Calendar, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { databases } from "@/lib/appwrite";
import { Query } from "appwrite";
import { cn } from "@/lib/utils";

export default function MemberProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isAdmin = sessionStorage.getItem("user_role") === "superadmin";

  const [member, setMember] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "tasks">("overview");
  const [attendanceData, setAttendanceData] = useState<Record<string, "present" | "absent">>({});
  const [tasks, setTasks] = useState<any[]>([]);

  useEffect(() => {
    const fetchProfile = async () => {
      if (!id) return;
      try {
        const dbId = import.meta.env.VITE_APPWRITE_DATABASE_ID || "main_db";
        // 1. Fetch Member Doc
        const m = await databases.getDocument(dbId, import.meta.env.VITE_APPWRITE_COLLECTION_ID || "members", id);
        setMember(m);

        // 2. Fetch Recent Attendance for this Fingerprint ID
        const logsPromise = databases.listDocuments(dbId, "attendance", [
          Query.equal("memberId", String(m.fingerprintId)),
          Query.orderDesc("$createdAt"),
          Query.limit(365) // get up to a year of data
        ]);

        // 3. Fetch Active Club Tasks
        const tasksPromise = databases.listDocuments(dbId, "club_tasks", [
          Query.notEqual("status", "done"),
          Query.orderDesc("$createdAt"),
          Query.limit(50)
        ]);

        const [logs, activeTasks] = await Promise.all([logsPromise, tasksPromise]);
        
        setTasks(activeTasks.documents);

        // Transform into the { "YYYY-MM-DD": "present" } format expected by the calendar
        const attMap: Record<string, "present" | "absent"> = {};
        logs.documents.forEach(doc => {
          const d = new Date(doc.$createdAt);
          const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          attMap[dateStr] = "present";
        });

        // Compute absent days from registration date to today
        const joinDate = new Date(m.$createdAt);
        joinDate.setHours(0, 0, 0, 0);
        const todayD = new Date();
        todayD.setHours(0, 0, 0, 0);

        for (let d = new Date(joinDate); d <= todayD; d.setDate(d.getDate() + 1)) {
          const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          if (!attMap[dateStr]) {
            attMap[dateStr] = "absent";
          }
        }

        setAttendanceData(attMap);

      } catch (err) {
        console.error("Failed to load profile", err);
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, [id]);

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      </DashboardLayout>
    );
  }

  if (!member) {
    return (
      <DashboardLayout>
        <p className="text-muted-foreground">Member not found.</p>
      </DashboardLayout>
    );
  }

  // Calculate live stats
  const presentDays = Object.values(attendanceData).filter((v) => v === "present").length;
  const totalDays = Object.keys(attendanceData).length || 1; // avoid divide by zero
  const calculatedPercent = Math.round((presentDays / totalDays) * 100);
  const attendancePercent = calculatedPercent; // Ignore backend, which defaults to 100
  const absentStreak = 0; // Requires complex date math, skipping for now
  const avgArrival = "—";

  const stats = [
    { label: "Attendance Rate", value: `${attendancePercent}%`, icon: TrendingUp, color: "text-success" },
    { label: "Present Days", value: presentDays, icon: Calendar, color: "text-primary" },
    { label: "Absent Streak", value: `${absentStreak} days`, icon: Clock, color: "text-absent" },
    { label: "Avg. Arrival", value: avgArrival, icon: Clock, color: "text-warning" },
  ];

  const handleCompleteTask = async (taskId: string) => {
    try {
      const dbId = import.meta.env.VITE_APPWRITE_DATABASE_ID || "main_db";
      await databases.updateDocument(dbId, "club_tasks", taskId, { status: "done" });
      setTasks(tasks.filter(t => t.$id !== taskId));
    } catch (err: any) {
      console.error("Failed to complete task:", err);
    }
  };

  const userTasks = tasks.filter(t => t.assigneeId === member.$id || (t.assigneeIds && t.assigneeIds.split(',').includes(member.$id)));
  const otherTasks = tasks.filter(t => t.assigneeId !== member.$id && !(t.assigneeIds && t.assigneeIds.split(',').includes(member.$id)));

  return (
    <DashboardLayout>
      {/* Back Button - Only for Admins */}
      {isAdmin && (
        <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="mb-4">
          <Button 
            variant="ghost" 
            onClick={() => navigate('/members')} 
            className="group flex items-center gap-2 font-bold text-muted-foreground hover:text-primary transition-all p-0 hover:bg-transparent"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted/50 group-hover:bg-primary/20 group-hover:text-primary transition-all">
              <ArrowLeft className="h-4 w-4" />
            </div>
            Back to Members
          </Button>
        </motion.div>
      )}

      {/* Profile Header & Tabs (Integrated) */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="glass-card mb-6 overflow-hidden">
        {/* Top Info Row */}
        <div className="p-6 pb-5 flex items-center gap-5">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-xl font-bold text-primary">
            {member.name.split(" ").map((n: string) => n[0]).join("")}
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground">{member.name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <span>{member.role}</span>
              <span>•</span>
              <span className="flex items-center gap-1 font-mono text-xs">
                <Fingerprint className="h-3 w-3" /> {member.fingerprintId}
              </span>
              <span>•</span>
              <span className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
              )}>
                {member.isActive !== false ? "Active" : "Inactive"}
              </span>
            </div>
          </div>
        </div>

        {/* Bottom Tab Row */}
        <div className="flex gap-6 px-6 border-t border-border/50 bg-background/30 backdrop-blur-md">
          <button 
            onClick={() => setActiveTab('overview')} 
            className={cn("px-2 py-3 font-bold text-sm tracking-wide uppercase transition-colors relative", activeTab === 'overview' ? "text-primary" : "text-muted-foreground hover:text-foreground")}
          >
            Performance
            {activeTab === 'overview' && <motion.div layoutId="activetab" className="absolute bottom-0 left-0 right-0 h-[3px] rounded-t bg-primary shadow-[0_-2px_8px_rgba(var(--primary),0.8)]" />}
          </button>
          <button 
            onClick={() => setActiveTab('tasks')} 
            className={cn("px-2 py-3 font-bold text-sm tracking-wide uppercase transition-colors relative flex items-center gap-2", activeTab === 'tasks' ? "text-primary" : "text-muted-foreground hover:text-foreground")}
          >
            Club Tasks
            {userTasks.length > 0 && (
              <span className="bg-primary text-primary-foreground text-[10px] px-2 py-0.5 rounded-full">{userTasks.length}</span>
            )}
            {activeTab === 'tasks' && <motion.div layoutId="activetab" className="absolute bottom-0 left-0 right-0 h-[3px] rounded-t bg-primary shadow-[0_-2px_8px_rgba(var(--primary),0.8)]" />}
          </button>
        </div>
      </motion.div>

      {activeTab === 'overview' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          {/* Stats */}
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {stats.map((s, i) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="glass-card p-4"
              >
                <div className="flex items-center gap-2">
                  <s.icon className={cn("h-4 w-4", s.color)} />
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{s.label}</span>
                </div>
                <p className="mt-2 text-2xl font-bold text-foreground">{s.value}</p>
              </motion.div>
            ))}
          </div>

          {/* Calendar */}
          <AttendanceCalendar data={attendanceData} />
        </motion.div>
      )}

      {activeTab === 'tasks' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            
            {/* User's Assigned Tasks (Highlighted) */}
            {userTasks.map((t) => (
              <motion.div 
                key={t.$id} 
                initial={{ scale: 0.95, opacity: 0 }} 
                animate={{ scale: 1, opacity: 1 }}
                className="glass-card flex flex-col justify-between p-5 border-2 border-primary shadow-[0_0_20px_rgba(var(--primary),0.15)] relative overflow-hidden"
              >
                <div className="absolute top-0 right-0 bg-primary px-3 py-1 rounded-bl-lg text-[10px] font-black uppercase text-primary-foreground tracking-widest">
                  Your Mission
                </div>
                <div>
                  <h4 className="text-lg font-bold text-foreground pr-24 line-clamp-2">{t.title}</h4>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold">
                    <span className="bg-amber-500/10 text-amber-500 px-2 py-1 rounded border border-amber-500/20">{t.points || 10} XP Bounty</span>
                    {t.deadline && new Date(t.deadline) < new Date() ? (
                      <span className="bg-rose-500/10 text-rose-500 px-2 py-1 rounded border border-rose-500/20 animate-pulse">Overdue</span>
                    ) : t.deadline ? (
                      <span className="bg-primary/10 text-primary px-2 py-1 rounded border border-primary/20">Due: {new Date(t.deadline).toLocaleDateString()}</span>
                    ) : null}
                  </div>
                </div>
                <Button 
                  onClick={() => handleCompleteTask(t.$id)} 
                  className="mt-6 w-full font-bold uppercase tracking-widest gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-[0_4px_15px_rgba(16,185,129,0.2)] hover:shadow-[0_6px_20px_rgba(16,185,129,0.3)] transition-all duration-300 active:scale-95"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Mark as Completed
                </Button>
              </motion.div>
            ))}

            {/* Other Club Tasks */}
            {otherTasks.map((t) => (
              <div key={t.$id} className="glass-card flex flex-col justify-between p-5 border border-border/50 opacity-75 hover:opacity-100 transition-opacity">
                <div>
                  <h4 className="text-base font-semibold text-foreground line-clamp-2 mb-2">{t.title}</h4>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {t.assigneeNames ? (
                      t.assigneeNames.split(',').map((name: string, i: number) => (
                        <span key={i} className="text-[10px] font-bold uppercase tracking-wider bg-primary/10 text-primary px-2 py-0.5 rounded-full border border-primary/20">
                          {name.trim()}
                        </span>
                      ))
                    ) : (
                      <span className="text-[10px] font-bold uppercase tracking-wider bg-primary/10 text-primary px-2 py-0.5 rounded-full border border-primary/20">
                        {t.assigneeName}
                      </span>
                    )}
                  </div>
                </div>
                <div className="mt-4 flex gap-2 text-xs font-medium">
                  <span className="bg-secondary text-secondary-foreground px-2 py-1 rounded border border-border/50">{t.points || 10} XP</span>
                  <span className="bg-secondary text-secondary-foreground px-2 py-1 rounded border border-border/50">{t.status === 'in_progress' ? 'Working' : 'To-Do'}</span>
                </div>
              </div>
            ))}

            {tasks.length === 0 && (
              <div className="col-span-full py-12 text-center text-muted-foreground border-2 border-dashed border-border/50 rounded-xl">
                No active club tasks right now. Take a break!
              </div>
            )}
          </div>
        </motion.div>
      )}
    </DashboardLayout>
  );
}
