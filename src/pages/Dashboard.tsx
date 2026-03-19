import { useState, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import StatCard from "@/components/StatCard";
import ActivityFeed from "@/components/ActivityFeed";
import AttendanceTable from "@/components/AttendanceTable";
import { Users, UserCheck, UserX, TrendingUp, Cpu } from "lucide-react";
import { databases } from "@/lib/appwrite";
import { Query } from "appwrite";

export default function Dashboard() {
  const [members, setMembers] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [device, setDevice] = useState<any>({ status: "offline" });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const dbId = import.meta.env.VITE_APPWRITE_DATABASE_ID || "main_db";

        // Fetch recent members
        const membersRes = await databases.listDocuments(dbId, import.meta.env.VITE_APPWRITE_COLLECTION_ID || "members", [Query.limit(100)]);
        setMembers(membersRes.documents);

        // Fetch today's attendance
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const attendRes = await databases.listDocuments(dbId, "attendance", [
          Query.greaterThanEqual("$createdAt", today.toISOString()),
          Query.limit(100),
          Query.orderDesc("$createdAt")
        ]);
        setAttendance(attendRes.documents);

        // Fetch recent activities
        const actRes = await databases.listDocuments(dbId, "activity_events", [
          Query.orderDesc("$createdAt"),
          Query.limit(8)
        ]);
        setEvents(actRes.documents);

        // Fetch primary device status
        const devRes = await databases.listDocuments(dbId, import.meta.env.VITE_APPWRITE_COLLECTION_ID_DEVICES || "devices", [Query.limit(1)]);
        if (devRes.documents.length > 0) {
          const doc = devRes.documents[0];
          // Device pings every ~1 minute. If no ping in 2.5 mins, it lost power.
          const isOffline = (Date.now() - new Date(doc.$updatedAt).getTime()) > 150000;
          setDevice({ ...doc, status: isOffline ? "offline" : "online" });
        }
      } catch (err) {
        console.error("Dashboard fetch error:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const nonAdmins = members.filter((m) => m.isActive !== false && m.role !== "super_admin");
  const totalMembers = nonAdmins.length;

  // Get all valid fingerprint IDs for active non-admins
  const validMemberIds = new Set(nonAdmins.map(m => String(m.fingerprintId || m.$id)));

  // Make a set of member IDs who are present today AND are valid active members, to avoid double counting
  const presentMemberIds = new Set(
    attendance
      .map(a => String(a.memberId))
      .filter(id => validMemberIds.has(id))
  );

  const presentToday = presentMemberIds.size;
  const absentToday = Math.max(0, totalMembers - presentToday);
  const attendanceRate = totalMembers > 0 ? Math.round((presentToday / totalMembers) * 100) : 0;

  // Build full attendance list (present + absent)
  const allRows = nonAdmins
    .map((m) => {
      // Find the most recent attendance record for this member
      const record = attendance.find((a) => String(a.memberId) === String(m.fingerprintId || m.$id));
      return {
        memberName: m.name,
        role: m.role || "Member",
        timestamp: record ? record.$createdAt : "",
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
          value={device.status === "online" ? "Online" : "Offline"}
          icon={Cpu}
          variant={device.status === "online" ? "success" : "danger"}
          delay={0.2}
        />
      </div>

      {/* Content */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <AttendanceTable rows={allRows} />
        </div>
        <div>
          <ActivityFeed events={events} />
        </div>
      </div>
    </DashboardLayout>
  );
}
