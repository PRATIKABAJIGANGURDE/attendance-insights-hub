import { Member, AttendanceRecord, ActivityEvent, Device } from "@/types/models";

export const mockMembers: Member[] = [];

export const mockTodayAttendance: (AttendanceRecord & { memberName: string; role: string })[] = [];

export const mockActivityFeed: ActivityEvent[] = [];

export const mockDevice: Device = {
  $id: "000000",
  deviceId: "ESP-000",
  lastSeen: new Date().toISOString(),
  status: "offline",
  firmwareVersion: "v0.0.0",
  wifiStrength: 0,
  totalScansToday: 0,
  $createdAt: new Date().toISOString(),
  $updatedAt: new Date().toISOString(),
};

export const mockWeeklyAttendance = [
  { day: "Mon", rate: 0 },
  { day: "Tue", rate: 0 },
  { day: "Wed", rate: 0 },
  { day: "Thu", rate: 0 },
  { day: "Fri", rate: 0 },
  { day: "Sat", rate: 0 },
  { day: "Sun", rate: 0 },
];

export const mockMonthlyTrend = [
  { date: "Feb 1", rate: 0 },
  { date: "Feb 5", rate: 0 },
  { date: "Feb 10", rate: 0 },
  { date: "Feb 15", rate: 0 },
  { date: "Feb 20", rate: 0 },
  { date: "Feb 25", rate: 0 },
  { date: "Mar 1", rate: 0 },
];

export function generateMemberAttendance(memberId: string): Record<string, "present" | "absent"> {
  return {};
}
