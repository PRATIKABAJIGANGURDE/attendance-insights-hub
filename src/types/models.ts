export interface Member {
  id: number;
  name: string;
  role: string;
  fingerprintId: string;
  isActive: boolean;
  createdAt: string;
  attendancePercent: number;
  lastSeen: string;
}

export interface AttendanceRecord {
  id: number;
  memberId: number;
  timestamp: string;
  deviceId: string;
}

export interface ActivityEvent {
  id: string;
  type: "attendance" | "admin" | "system";
  message: string;
  time: string;
}

export interface Device {
  deviceId: string;
  lastSeen: string;
  status: "online" | "offline";
  firmwareVersion: string;
  wifiStrength: number;
  totalScansToday: number;
}
