import { motion } from "framer-motion";
import DashboardLayout from "@/components/DashboardLayout";
import { mockDevice } from "@/data/mockData";
import { Cpu, Wifi, Clock, Fingerprint, RefreshCw, Plus, RotateCcw, UploadCloud, Trash2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { databases, storage } from "@/lib/appwrite";
import { ID } from "appwrite";
import SparkMD5 from "spark-md5";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function DeviceManagement() {
  const navigate = useNavigate();
  const [syncing, setSyncing] = useState(false);
  const [adminSetupOpen, setAdminSetupOpen] = useState(false);
  const [setupStep, setSetupStep] = useState<"polling" | "success" | "error">("polling");
  const [setupStatusMsg, setSetupStatusMsg] = useState("");
  const [activeSetupCmdId, setActiveSetupCmdId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (adminSetupOpen && setupStep === "polling" && activeSetupCmdId) {
      interval = setInterval(async () => {
        try {
          const doc = await databases.getDocument(
            import.meta.env.VITE_APPWRITE_DATABASE_ID || "main_db",
            import.meta.env.VITE_APPWRITE_COLLECTION_ID_COMMANDS || "device_commands",
            activeSetupCmdId
          );
          if (doc.status === "completed") {
            setSetupStep("success");
            clearInterval(interval);
          } else if (doc.status === "failed" || doc.status === "timeout" || doc.status === "unauthorized") {
            setSetupStep("error");
            setSetupStatusMsg(doc.status);
            clearInterval(interval);
          }
        } catch (e) { /* ignore */ }
      }, 2000);
    }
    return () => clearInterval(interval);
  }, [adminSetupOpen, setupStep, activeSetupCmdId]);

  const [deviceData, setDeviceData] = useState<any>(mockDevice);

  // Poll device status every 5 seconds
  useEffect(() => {
    const fetchDevice = async () => {
      try {
        // Find device document
        const response = await databases.listDocuments(
          import.meta.env.VITE_APPWRITE_DATABASE_ID || "main_db",
          import.meta.env.VITE_APPWRITE_COLLECTION_ID_DEVICES || "devices" // fallback
        );
        if (response.documents.length > 0) {
          // Assuming the first document is the ESP32
          const doc = response.documents[0];
          const isOffline = (Date.now() - new Date(doc.$updatedAt).getTime()) > 150000;
          setDeviceData({
            deviceId: doc.deviceId || "ESP32_DEVICE_01",
            status: isOffline ? "offline" : "online",
            firmwareVersion: doc.firmwareVersion || "1.0.0",
            wifiStrength: doc.wifiStrength || 0,
            totalScansToday: doc.totalScansToday || 0,
            lastSeen: doc.$updatedAt,
          });
        }
      } catch (err) {
        console.error("Failed to fetch device status:", err);
      }
    };

    fetchDevice();
    const interval = setInterval(fetchDevice, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await databases.createDocument(
        import.meta.env.VITE_APPWRITE_DATABASE_ID || "main_db",
        import.meta.env.VITE_APPWRITE_COLLECTION_ID_COMMANDS || "device_commands",
        ID.unique(),
        {
          command: "updateDevice",
          status: "pending",
          deviceId: deviceData.deviceId
        }
      );
      toast.success("Sync command sent to device");
    } catch (err: any) {
      toast.error(err.message || "Failed to sync");
    } finally {
      setSyncing(false);
    }
  };

  const handleRestart = async () => {
    try {
      await databases.createDocument(
        import.meta.env.VITE_APPWRITE_DATABASE_ID || "main_db",
        import.meta.env.VITE_APPWRITE_COLLECTION_ID_COMMANDS || "device_commands",
        ID.unique(),
        {
          command: "restartDevice",
          status: "pending",
          deviceId: deviceData.deviceId
        }
      );
      toast.success("Restart command sent to device");
    } catch (err: any) {
      toast.error(err.message || "Failed to send restart command");
    }
  };

  const handleWipeDB = async () => {
    if (!confirm("Are you sure you want to permanently erase ALL fingerprints from the physical ESP32 scanner? This cannot be undone.")) return;

    try {
      await databases.createDocument(
        import.meta.env.VITE_APPWRITE_DATABASE_ID || "main_db",
        import.meta.env.VITE_APPWRITE_COLLECTION_ID_COMMANDS || "device_commands",
        ID.unique(),
        {
          command: "restartDevice",
          status: "pending",
          deviceId: deviceData.deviceId,
          memberName: "WIPE_DB"
        }
      );
      toast.success("Wipe command sent to device");
    } catch (err: any) {
      toast.error(err.message || "Failed to send wipe command");
    }
  };

  const handleAdminSetup = async () => {
    try {
      const response = await databases.createDocument(
        import.meta.env.VITE_APPWRITE_DATABASE_ID || "main_db",
        import.meta.env.VITE_APPWRITE_COLLECTION_ID_COMMANDS || "device_commands", // fallback
        ID.unique(),
        {
          command: "setupAdmin",
          status: "pending",
          memberName: "Super Admin",
          deviceId: deviceData.deviceId
        }
      );
      setActiveSetupCmdId(response.$id);
      setSetupStep("polling");
      setAdminSetupOpen(true);
    } catch (err: any) {
      toast.error(err.message || "Failed to send command to device");
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".bin")) {
      toast.error("Please upload a compiled .bin firmware file");
      return;
    }

    setUploading(true);
    const toastId = toast.loading("Generating MD5 verification hash...");
    
    try {
      // 0. Compute MD5 Hash
      const fileHash = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => {
          if (event.target?.result instanceof ArrayBuffer) {
            const spark = new SparkMD5.ArrayBuffer();
            spark.append(event.target.result);
            resolve(spark.end());
          } else {
            reject(new Error("Invalid file buffer"));
          }
        };
        reader.onerror = () => reject(new Error("File read error"));
        reader.readAsArrayBuffer(file);
      });

      // 1. Upload to Appwrite Storage
      toast.loading(`Uploading (MD5: ${fileHash.substring(0,6)}...)...`, { id: toastId });
      const bucketId = import.meta.env.VITE_APPWRITE_FIRMWARE_BUCKET || "firmware_updates";
      const uploadedFile = await storage.createFile(bucketId, ID.unique(), file);

      toast.loading("Dispatching secure OTA command...", { id: toastId });

      // 2. Dispatch secure command to device
      await databases.createDocument(
        import.meta.env.VITE_APPWRITE_DATABASE_ID || "main_db",
        import.meta.env.VITE_APPWRITE_COLLECTION_ID_COMMANDS || "device_commands",
        ID.unique(),
        {
          command: "updateFirmware",
          status: "pending",
          deviceId: deviceData.deviceId,
          memberName: `${uploadedFile.$id}|${fileHash}` // Append MD5 hash for ESP32 verification
        }
      );

      toast.success("Firmware uploaded! ESP32 is downloading the update.", { id: toastId });
    } catch (err: any) {
      if (err.code === 404) {
        toast.error("Bucket doesn't exist. Please create a Storage Bucket with ID 'firmware_updates' in Appwrite.", { id: toastId, duration: 8000 });
      } else {
        toast.error(err.message || "Failed to upload firmware", { id: toastId });
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const isOnline = deviceData.status === "online";

  const details = [
    { label: "Device ID", value: deviceData.deviceId, icon: Cpu },
    { label: "Status", value: deviceData.status, icon: Wifi, isStatus: true },
    { label: "Last Seen", value: new Date(deviceData.lastSeen).toLocaleString(), icon: Clock },
    { label: "Firmware", value: deviceData.firmwareVersion, icon: Cpu },
    { label: "WiFi Signal", value: `${deviceData.wifiStrength} dBm`, icon: Wifi },
    { label: "Scans Today", value: deviceData.totalScansToday, icon: Fingerprint },
  ];

  return (
    <DashboardLayout>
      <div className="mb-4">
        <Button 
          variant="ghost" 
          onClick={() => navigate('/')} 
          className="group flex items-center gap-2 font-bold text-muted-foreground hover:text-primary transition-all p-0 hover:bg-transparent"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted/50 group-hover:bg-primary/20 group-hover:text-primary transition-all">
            <ArrowLeft className="h-4 w-4" />
          </div>
          Back to Dashboard
        </Button>
      </div>

      <div className="mb-8">
        <h2 className="text-2xl font-bold text-foreground font-mono uppercase tracking-tight">Device Management</h2>
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
            <h3 className="text-lg font-semibold text-foreground">{deviceData.deviceId}</h3>
            <div className="flex items-center gap-1.5">
              <div className={cn("h-2 w-2 rounded-full", isOnline ? "bg-success animate-pulse-dot" : "bg-absent")} />
              <span className={cn("text-xs font-medium", isOnline ? "text-success" : "text-absent")}>
                {isOnline ? "Online" : "Offline"}
              </span>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">Last synced: {new Date(deviceData.lastSeen).toLocaleString()}</p>
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
          <Button variant="outline" className="gap-2" onClick={() => navigate("/members")}>
            <Plus className="h-4 w-4" />
            Enter Enrollment Mode
          </Button>
          <Button variant="outline" className="gap-2 border-primary/50 text-primary hover:bg-primary/10" onClick={handleAdminSetup}>
            <Fingerprint className="h-4 w-4" />
            Setup Admin Fingerprint
          </Button>
          <Button
            variant="outline"
            className="gap-2 border-amber-500/50 text-amber-500 hover:bg-amber-500/10"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            <UploadCloud className={cn("h-4 w-4", uploading && "animate-pulse")} />
            {uploading ? "Uploading..." : "Upload Firmware (OTA)"}
          </Button>
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept=".bin"
            onChange={handleFileUpload}
          />
          <Button variant="outline" className="gap-2 text-destructive hover:text-destructive" onClick={handleRestart}>
            <RotateCcw className="h-4 w-4" />
            Restart Device
          </Button>
          <Button variant="outline" className="gap-2 border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground dark:hover:bg-destructive dark:hover:text-destructive-foreground" onClick={handleWipeDB}>
            <Trash2 className="h-4 w-4" />
            Wipe Fingerprint DB
          </Button>
        </div>
      </motion.div>
      <Dialog open={adminSetupOpen} onOpenChange={setAdminSetupOpen}>
        <DialogContent className="bg-card border-border">
          {setupStep === "polling" ? (
            <div className="flex flex-col items-center py-8">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 animate-pulse">
                <Fingerprint className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">Waiting for Device</h3>
              <p className="mt-2 text-center text-sm text-muted-foreground">
                Place your finger on the ESP32 sensor to register as the Super Admin.<br />
                Please hold your finger steady until the device confirms.
              </p>
              <Button variant="outline" className="mt-6" onClick={() => setAdminSetupOpen(false)}>Cancel</Button>
            </div>
          ) : setupStep === "success" ? (
            <div className="flex flex-col items-center py-8">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
                <Fingerprint className="h-8 w-8 text-success" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">Setup Successful!</h3>
              <p className="mt-2 text-center text-sm text-muted-foreground">
                Super Admin fingerprint has been registered.
              </p>
              <Button className="mt-6" onClick={() => setAdminSetupOpen(false)}>Close</Button>
            </div>
          ) : (
            <div className="flex flex-col items-center py-8">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
                <Fingerprint className="h-8 w-8 text-destructive" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">Setup Failed</h3>
              <p className="mt-2 text-center text-sm text-muted-foreground">
                {setupStatusMsg === "timeout" ? "The operation timed out." :
                  "Sensor failed to capture fingerprints."}
              </p>
              <div className="mt-6 flex gap-3">
                <Button variant="outline" onClick={() => setAdminSetupOpen(false)}>Cancel</Button>
                <Button onClick={handleAdminSetup}>Try Again</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
