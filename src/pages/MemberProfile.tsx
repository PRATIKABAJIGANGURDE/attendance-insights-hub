import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import DashboardLayout from "@/components/DashboardLayout";
import AttendanceCalendar from "@/components/AttendanceCalendar";
import { mockMembers, generateMemberAttendance } from "@/data/mockData";
import { ArrowLeft, Fingerprint, TrendingUp, Clock, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMemo } from "react";
import { cn } from "@/lib/utils";

export default function MemberProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const member = mockMembers.find((m) => m.id === Number(id));
  const attendanceData = useMemo(() => generateMemberAttendance(Number(id)), [id]);

  if (!member) {
    return (
      <DashboardLayout>
        <p className="text-muted-foreground">Member not found.</p>
      </DashboardLayout>
    );
  }

  const presentDays = Object.values(attendanceData).filter((v) => v === "present").length;
  const totalDays = Object.keys(attendanceData).length;
  const absentStreak = 2; // mock
  const avgArrival = "10:12 AM"; // mock

  const stats = [
    { label: "Attendance Rate", value: `${Math.round((presentDays / totalDays) * 100)}%`, icon: TrendingUp, color: "text-success" },
    { label: "Present Days", value: presentDays, icon: Calendar, color: "text-primary" },
    { label: "Absent Streak", value: `${absentStreak} days`, icon: Clock, color: "text-absent" },
    { label: "Avg. Arrival", value: avgArrival, icon: Clock, color: "text-warning" },
  ];

  return (
    <DashboardLayout>
      <Button variant="ghost" onClick={() => navigate("/members")} className="mb-6 gap-2 text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Members
      </Button>

      {/* Profile Header */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="glass-card mb-6 p-6">
        <div className="flex items-center gap-5">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-xl font-bold text-primary">
            {member.name.split(" ").map((n) => n[0]).join("")}
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground">{member.name}</h2>
            <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
              <span>{member.role}</span>
              <span>•</span>
              <span className="flex items-center gap-1 font-mono text-xs">
                <Fingerprint className="h-3 w-3" /> {member.fingerprintId}
              </span>
              <span>•</span>
              <span className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold",
                member.isActive ? "status-present" : "status-absent"
              )}>
                {member.isActive ? "Active" : "Inactive"}
              </span>
            </div>
          </div>
        </div>
      </motion.div>

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
    </DashboardLayout>
  );
}
