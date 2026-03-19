export interface Member {
  $id: string;
  name: string;
  role: string;
  fingerprintId?: string;
  isActive: boolean;
  attendancePercent?: number;
  lastSeen?: string;
  membershipLevel?: string;
  $createdAt: string;
  $updatedAt: string;
}

export interface AttendanceRecord {
  $id: string;
  memberId: string;
  deviceId: string;
  timestamp: string;
  attendanceStatus?: string;
  sessionDuration?: number;
  location?: string;
  remarks?: string;
  $createdAt: string;
  $updatedAt: string;
}

export interface ActivityEvent {
  $id: string;
  eventType: "attendance" | "admin" | "system" | string;
  message: string;
  eventTime: string;
  deviceId?: string;
  memberId?: number;
  severity?: string;
  location?: string;
  $createdAt: string;
  $updatedAt: string;
}

export interface Device {
  $id: string;
  deviceId: string;
  status?: string;
  firmwareVersion?: string;
  wifiStrength?: number;
  totalScansToday?: number;
  lastSeen?: string;
  $createdAt: string;
  $updatedAt: string;
}
