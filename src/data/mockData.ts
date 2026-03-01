import { Member, AttendanceRecord, ActivityEvent, Device } from "@/types/models";

export const mockMembers: Member[] = [
  { id: 1, name: "Rahul Sharma", role: "Member", fingerprintId: "FP-001", isActive: true, createdAt: "2024-11-01", attendancePercent: 92, lastSeen: "2026-03-01" },
  { id: 2, name: "Priya Patel", role: "Trainer", fingerprintId: "FP-002", isActive: true, createdAt: "2024-10-15", attendancePercent: 88, lastSeen: "2026-03-01" },
  { id: 3, name: "Amit Kumar", role: "Member", fingerprintId: "FP-003", isActive: true, createdAt: "2024-12-01", attendancePercent: 76, lastSeen: "2026-02-28" },
  { id: 4, name: "Sneha Reddy", role: "Member", fingerprintId: "FP-004", isActive: true, createdAt: "2025-01-10", attendancePercent: 95, lastSeen: "2026-03-01" },
  { id: 5, name: "Vikram Singh", role: "Trainer", fingerprintId: "FP-005", isActive: true, createdAt: "2024-09-20", attendancePercent: 84, lastSeen: "2026-02-27" },
  { id: 6, name: "Ananya Gupta", role: "Member", fingerprintId: "FP-006", isActive: false, createdAt: "2024-11-15", attendancePercent: 45, lastSeen: "2026-01-15" },
  { id: 7, name: "Rohan Mehta", role: "Member", fingerprintId: "FP-007", isActive: true, createdAt: "2025-02-01", attendancePercent: 70, lastSeen: "2026-03-01" },
  { id: 8, name: "Kavita Nair", role: "Member", fingerprintId: "FP-008", isActive: true, createdAt: "2025-01-20", attendancePercent: 82, lastSeen: "2026-03-01" },
];

export const mockTodayAttendance: (AttendanceRecord & { memberName: string; role: string })[] = [
  { id: 1, memberId: 1, memberName: "Rahul Sharma", role: "Member", timestamp: "2026-03-01T10:21:00", deviceId: "ESP-001" },
  { id: 2, memberId: 2, memberName: "Priya Patel", role: "Trainer", timestamp: "2026-03-01T09:45:00", deviceId: "ESP-001" },
  { id: 3, memberId: 4, memberName: "Sneha Reddy", role: "Member", timestamp: "2026-03-01T10:05:00", deviceId: "ESP-001" },
  { id: 4, memberId: 7, memberName: "Rohan Mehta", role: "Member", timestamp: "2026-03-01T10:30:00", deviceId: "ESP-001" },
  { id: 5, memberId: 8, memberName: "Kavita Nair", role: "Member", timestamp: "2026-03-01T09:55:00", deviceId: "ESP-001" },
];

export const mockActivityFeed: ActivityEvent[] = [
  { id: "1", type: "attendance", message: "Rohan Mehta marked attendance", time: "10:30 AM" },
  { id: "2", type: "attendance", message: "Rahul Sharma marked attendance", time: "10:21 AM" },
  { id: "3", type: "attendance", message: "Sneha Reddy marked attendance", time: "10:05 AM" },
  { id: "4", type: "attendance", message: "Kavita Nair marked attendance", time: "9:55 AM" },
  { id: "5", type: "attendance", message: "Priya Patel marked attendance", time: "9:45 AM" },
  { id: "6", type: "system", message: "ESP32 device synced successfully", time: "9:30 AM" },
  { id: "7", type: "admin", message: "Admin added new member: Rohan Mehta", time: "Yesterday" },
];

export const mockDevice: Device = {
  deviceId: "ESP-001",
  lastSeen: "2026-03-01T10:30:00",
  status: "online",
  firmwareVersion: "v2.4.1",
  wifiStrength: -42,
  totalScansToday: 5,
};

export const mockWeeklyAttendance = [
  { day: "Mon", rate: 82 },
  { day: "Tue", rate: 78 },
  { day: "Wed", rate: 85 },
  { day: "Thu", rate: 71 },
  { day: "Fri", rate: 90 },
  { day: "Sat", rate: 65 },
  { day: "Sun", rate: 0 },
];

export const mockMonthlyTrend = [
  { date: "Feb 1", rate: 78 },
  { date: "Feb 5", rate: 82 },
  { date: "Feb 10", rate: 75 },
  { date: "Feb 15", rate: 88 },
  { date: "Feb 20", rate: 84 },
  { date: "Feb 25", rate: 91 },
  { date: "Mar 1", rate: 74 },
];

// Generate member attendance for calendar view
export function generateMemberAttendance(memberId: number): Record<string, "present" | "absent"> {
  const data: Record<string, "present" | "absent"> = {};
  const today = new Date(2026, 2, 1); // March 1, 2026
  
  for (let i = 0; i < 60; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    if (d.getDay() === 0) continue; // Skip Sundays
    const key = d.toISOString().split("T")[0];
    data[key] = Math.random() > 0.2 ? "present" : "absent";
  }
  return data;
}
