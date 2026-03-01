import DashboardLayout from "@/components/DashboardLayout";
import StatCard from "@/components/StatCard";
import ActivityFeed from "@/components/ActivityFeed";
import AttendanceTable from "@/components/AttendanceTable";
import { Users, UserCheck, UserX, TrendingUp, Cpu } from "lucide-react";
import { mockMembers, mockTodayAttendance, mockActivityFeed, mockDevice } from "@/data/mockData";

export default function Dashboard() {
  const totalMembers = mockMembers.filter((m) => m.isActive).length;
  const presentToday = mockTodayAttendance.length;
  const absentToday = totalMembers - presentToday;
  const attendanceRate = Math.round((presentToday / totalMembers) * 100);

  // Build full attendance list (present + absent)
  const allRows = mockMembers
    .filter((m) => m.isActive)
    .map((m) => {
      const record = mockTodayAttendance.find((a) => a.memberId === m.id);
      return {
        memberName: m.name,
        role: m.role,
        timestamp: record?.timestamp || "",
        status: record ? ("present" as const) : ("absent" as const),
      };
    })
    .sort((a, b) => {
      if (a.status === "present" && b.status === "absent") return -1;
      if (a.status === "absent" && b.status === "present") return 1;
      return 0;
    });

  return (
    <DashboardLayout>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-foreground">Dashboard</h2>
        <p className="mt-1 text-sm text-muted-foreground">Welcome back, Admin. Here's today's overview.</p>
      </div>

      {/* Stats */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard title="Total Members" value={totalMembers} icon={Users} delay={0} />
        <StatCard title="Present Today" value={presentToday} icon={UserCheck} variant="success" delay={0.05} trend="+2 from yesterday" />
        <StatCard title="Absent Today" value={absentToday} icon={UserX} variant="danger" delay={0.1} />
        <StatCard title="Attendance Rate" value={`${attendanceRate}%`} icon={TrendingUp} variant="warning" delay={0.15} />
        <StatCard
          title="Device Status"
          value={mockDevice.status === "online" ? "Online" : "Offline"}
          icon={Cpu}
          variant={mockDevice.status === "online" ? "success" : "danger"}
          delay={0.2}
        />
      </div>

      {/* Content */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <AttendanceTable rows={allRows} />
        </div>
        <div>
          <ActivityFeed events={mockActivityFeed} />
        </div>
      </div>
    </DashboardLayout>
  );
}
