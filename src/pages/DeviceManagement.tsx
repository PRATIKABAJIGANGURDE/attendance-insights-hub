import { motion } from "framer-motion";
import DashboardLayout from "@/components/DashboardLayout";
import { mockDevice } from "@/data/mockData";
import { Cpu, Wifi, Clock, Fingerprint, RefreshCw, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { toast } from "sonner";

export default function DeviceManagement() {
  const [syncing, setSyncing] = useState(false);

  const handleSync = () => {
    setSyncing(true);
    setTimeout(() => {
      setSyncing(false);
      toast.success("Device synced successfully");
    }, 2000);
  };

  const isOnline = mockDevice.status === "online";

  const details = [
    { label: "Device ID", value: mockDevice.deviceId, icon: Cpu },
    { label: "Status", value: mockDevice.status, icon: Wifi, isStatus: true },
    { label: "Last Seen", value: new Date(mockDevice.lastSeen).toLocaleString(), icon: Clock },
    { label: "Firmware", value: mockDevice.firmwareVersion, icon: Cpu },
    { label: "WiFi Signal", value: `${mockDevice.wifiStrength} dBm`, icon: Wifi },
    { label: "Scans Today", value: mockDevice.totalScansToday, icon: Fingerprint },
  ];

  return (
    <DashboardLayout>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-foreground">Device Management</h2>
        <p className="mt-1 text-sm text-muted-foreground">Monitor and control your ESP32 biometric device.</p>
      </div>

      {/* Status Banner */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          "glass-card mb-6 flex items-center gap-4 p-5",
          isOnline ? "border-success/20" : "border-absent/20"
        )}
      >
        <div className={cn(
          "flex h-12 w-12 items-center justify-center rounded-xl",
          isOnline ? "bg-success-muted" : "bg-absent-muted"
        )}>
          <Cpu className={cn("h-6 w-6", isOnline ? "text-success" : "text-absent")} />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-foreground">{mockDevice.deviceId}</h3>
            <div className="flex items-center gap-1.5">
              <div className={cn("h-2 w-2 rounded-full", isOnline ? "bg-success animate-pulse-dot" : "bg-absent")} />
              <span className={cn("text-xs font-medium", isOnline ? "text-success" : "text-absent")}>
                {isOnline ? "Online" : "Offline"}
              </span>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">Last synced: {new Date(mockDevice.lastSeen).toLocaleString()}</p>
        </div>
      </motion.div>

      {/* Details Grid */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
        {details.map((d, i) => (
          <motion.div
            key={d.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="glass-card p-4"
          >
            <div className="flex items-center gap-2 text-muted-foreground">
              <d.icon className="h-3.5 w-3.5" />
              <span className="text-[10px] font-medium uppercase tracking-wider">{d.label}</span>
            </div>
            <p className={cn(
              "mt-2 text-lg font-semibold",
              d.isStatus ? (isOnline ? "text-success" : "text-absent") : "text-foreground"
            )}>
              {d.isStatus ? (isOnline ? "Online" : "Offline") : d.value}
            </p>
          </motion.div>
        ))}
      </div>

      {/* Actions */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="glass-card p-5">
        <h3 className="mb-4 text-sm font-semibold text-foreground">Device Actions</h3>
        <div className="flex flex-wrap gap-3">
          <Button onClick={handleSync} disabled={syncing} className="gap-2">
            <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
            {syncing ? "Syncing..." : "Sync Members"}
          </Button>
          <Button variant="outline" className="gap-2">
            <Plus className="h-4 w-4" />
            Enter Enrollment Mode
          </Button>
          <Button variant="outline" className="gap-2 text-destructive hover:text-destructive">
            <RotateCcw className="h-4 w-4" />
            Restart Device
          </Button>
        </div>
      </motion.div>
    </DashboardLayout>
  );
}
