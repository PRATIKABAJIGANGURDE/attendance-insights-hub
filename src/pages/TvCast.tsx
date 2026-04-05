import { useState, useEffect, useRef } from "react";
import { Users, ClipboardList, Moon, Sparkles, Volume2, VolumeX, Unlock, ShieldAlert, ShieldCheck, DoorOpen, Wifi, Zap, Radio, AlertCircle } from "lucide-react";
import { databases, client } from "@/lib/appwrite";
import { Query, ID } from "appwrite";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import * as SatLib from "satellite.js";

export default function TvCast() {
  const [members, setMembers] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [deviceDoc, setDeviceDoc] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Satellite Pass State
  interface SatPass {
    satName: string;
    noradId: number;
    startUTC: number;   // Unix timestamp (seconds)
    maxEl: number;      // degrees
    maxAzCompass: string;
    duration: number;   // seconds
  }
  const [satPasses, setSatPasses] = useState<SatPass[]>([]);
  const [satLoading, setSatLoading] = useState(true);
  const [satError, setSatError] = useState<string | null>(null);
  const [satLastUpdated, setSatLastUpdated] = useState<Date | null>(null);

  // Satellites to track: [NORAD ID, CelesTrak name, display name]
  const TRACKED_SATS: [number, string][] = [
    [25544, "ISS"],
    [43017, "AO-91 / Fox-1B"],
    [27607, "SO-50"],
    [7530, "AO-7"],
    [33591, "NOAA-19"],
  ];

  const LAB_LAT = parseFloat(import.meta.env.VITE_LAB_LAT || "0");
  const LAB_LNG = parseFloat(import.meta.env.VITE_LAB_LNG || "0");
  const LAB_ALT = parseFloat(import.meta.env.VITE_LAB_ALT || "0") / 1000; // km
  const SAT_CONFIGURED = LAB_LAT !== 0 || LAB_LNG !== 0;

  const azToCompass = (deg: number): string => {
    const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
    return dirs[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
  };

  const deg2rad = (deg: number) => (deg * Math.PI) / 180;
  const rad2deg = (rad: number) => (rad * 180) / Math.PI;

  // SGP4 pass prediction: iterate every 15s for 24h
  const findPasses = (tle1: string, tle2: string, minElDeg = 10): SatPass[] => {
    const satrec = SatLib.twoline2satrec(tle1, tle2);
    const obsGd = {
      longitude: deg2rad(LAB_LNG),
      latitude:  deg2rad(LAB_LAT),
      height:    LAB_ALT,
    };
    const passes: SatPass[] = [];
    const startMs = Date.now();
    const endMs   = startMs + 24 * 3600 * 1000;
    const stepMs  = 15_000;

    let inPass = false;
    let passStart = 0, passMaxEl = 0, passMaxAzDeg = 0;

    for (let t = startMs; t < endMs; t += stepMs) {
      const date = new Date(t);
      const pv = SatLib.propagate(satrec, date);
      if (!pv || typeof pv.position === "boolean" || !pv.position) continue;
      const gmst   = SatLib.gstime(date);
      const posEcf = SatLib.eciToEcf(pv.position as SatLib.EciVec3<number>, gmst);
      const look   = SatLib.ecfToLookAngles(obsGd, posEcf);
      const elDeg  = rad2deg(look.elevation);
      const azDeg  = rad2deg(look.azimuth);

      if (elDeg >= minElDeg) {
        if (!inPass) { inPass = true; passStart = t; passMaxEl = elDeg; passMaxAzDeg = azDeg; }
        else if (elDeg > passMaxEl) { passMaxEl = elDeg; passMaxAzDeg = azDeg; }
      } else {
        if (inPass) {
          passes.push({
            satName: "",   // filled by caller
            noradId: 0,
            startUTC:     Math.floor(passStart / 1000),
            maxEl:        Math.round(passMaxEl),
            maxAzCompass: azToCompass(passMaxAzDeg),
            duration:     Math.round((t - passStart) / 1000),
          });
          inPass = false;
        }
      }
    }
    return passes;
  };

  // Timer States
  const [countdown, setCountdown] = useState("00:00:00");
  const [timerMode, setTimerMode] = useState<"normal" | "warning" | "overtime" | "break">("normal");
  const [isBusinessHours, setIsBusinessHours] = useState(false);
  const [isOvertime, setIsOvertime] = useState(false);
  const [breakEndTime, setBreakEndTime] = useState<Date | null>(null);

  // Welcome Popup States
  const [welcomeMember, setWelcomeMember] = useState<{ name: string; quote: string } | null>(null);
  const [showWelcome, setShowWelcome] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(() => {
    return typeof window !== "undefined" && sessionStorage.getItem("tv_audio_enabled") === "true";
  });
  const [isMuted, setIsMuted] = useState(() => {
    return typeof window !== "undefined" && sessionStorage.getItem("tv_is_muted") === "true";
  });
  const [isUnlocking, setIsUnlocking] = useState(false);
  const welcomeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Always-fresh ref so the Appwrite subscription callback never reads stale members
  const membersRef = useRef<any[]>([]);
  // Dedup guard: prevents double-fire from React Strict Mode double-effect registration
  const lastWelcomedDocId = useRef<string>("");

  const motivationalQuotes = [
    "Let's build something amazing today!",
    "The sky is not the limit, it's the beginning.",
    "Your hard work is the fuel for our mission.",
    "Innovation starts with you.",
    "Stay curious, stay inspired.",
    "Small steps lead to giant leaps.",
    "Great things never come from comfort zones.",
    "Success is a team sport. Welcome back!",
    "Ready to push the boundaries of technology?",
    "Every line of code moves us closer to the stars.",
  ];

  const speakWelcome = async (name: string, quote: string) => {
    if (!audioEnabled || isMuted) return;
    const apiKey = import.meta.env.VITE_INWORLD_API_KEY;
    const voiceId = import.meta.env.VITE_INWORLD_VOICE_ID || "Ashley";
    if (!apiKey) return;
    try {
      const response = await fetch("https://api.inworld.ai/tts/v1/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": apiKey.startsWith("Basic ") ? apiKey : `Basic ${apiKey}` },
        body: JSON.stringify({ text: `Welcome back, ${name}. ${quote}`, voiceId, modelId: "inworld-tts-1.5-max" })
      });
      if (!response.ok) return;
      const data = await response.json();
      if (!data.audioContent) return;
      const audioBlob = await (await fetch(`data:audio/mp3;base64,${data.audioContent}`)).blob();
      const audio = new Audio(URL.createObjectURL(audioBlob));
      await audio.play();
    } catch (_) {}
  };

  const triggerWelcome = (name: string) => {
    if (welcomeTimeoutRef.current) clearTimeout(welcomeTimeoutRef.current);
    const randomQuote = motivationalQuotes[Math.floor(Math.random() * motivationalQuotes.length)];
    setWelcomeMember({ name, quote: randomQuote });
    setShowWelcome(true);
    speakWelcome(name, randomQuote);
    welcomeTimeoutRef.current = setTimeout(() => setShowWelcome(false), 8000);
  };

  // Fetch Data
  useEffect(() => {
    const fetchData = async () => {
      try {
        const dbId = import.meta.env.VITE_APPWRITE_DATABASE_ID || "main_db";
        const [membersRes, attendRes, tasksRes, deviceRes] = await Promise.all([
          databases.listDocuments(dbId, import.meta.env.VITE_APPWRITE_COLLECTION_ID || "members", [Query.limit(500)]),
          databases.listDocuments(dbId, "attendance", [
            Query.greaterThanEqual("$createdAt", new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),
            Query.limit(200), Query.orderDesc("$createdAt"),
          ]),
          databases.listDocuments(dbId, "club_tasks", [Query.orderDesc("$createdAt"), Query.limit(100)]),
          databases.listDocuments(dbId, import.meta.env.VITE_APPWRITE_COLLECTION_ID_DEVICES || "devices", [Query.limit(1)]),
        ]);
        setMembers(membersRes.documents);
        membersRef.current = membersRes.documents;  // Keep ref in sync
        setAttendance(attendRes.documents);
        setTasks(tasksRes.documents);
        if (deviceRes.documents.length > 0) setDeviceDoc(deviceRes.documents[0]);
      } catch (err) {
        console.error("Fetch error:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
    const interval = setInterval(fetchData, 10000);
    const now = new Date();
    const msUntilMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime();
    const midnightTimer = setTimeout(() => window.location.reload(), msUntilMidnight);
    return () => { clearInterval(interval); clearTimeout(midnightTimer); };
  }, []);

  // Clock
  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Satellite Pass Fetching — CelesTrak TLE + SGP4 in-browser (no CORS issues)
  useEffect(() => {
    if (!SAT_CONFIGURED) {
      setSatLoading(false);
      setSatError("Set VITE_LAB_LAT / VITE_LAB_LNG in .env.local");
      return;
    }

    const fetchPasses = async () => {
      setSatLoading(true);
      setSatError(null);
      try {
        const allPasses: SatPass[] = [];

        await Promise.all(TRACKED_SATS.map(async ([noradId, satName]) => {
          try {
            const url = `https://celestrak.org/NORAD/elements/gp.php?CATNR=${noradId}&FORMAT=tle`;
            const res = await fetch(url);
            if (!res.ok) {
              console.warn(`[SAT] ${satName} (ID: ${noradId}) fetch failed: HTTP ${res.status}`);
              return;
            }
            const text = await res.text();
            const lines = text.trim().split("\n").map(l => l.trim());
            if (lines.length < 3) return;

            const passes = findPasses(lines[1], lines[2]);
            passes.forEach(p => allPasses.push({ ...p, satName, noradId }));
          } catch (e) {
            console.error(`[SAT] Error processing ${satName}:`, e);
          }
        }));

        const now = Math.floor(Date.now() / 1000);
        const upcoming = allPasses
          .filter(p => p.startUTC > now)
          .sort((a, b) => a.startUTC - b.startUTC);

        setSatPasses(upcoming);
        setSatLastUpdated(new Date());
      } catch (err: any) {
        console.error("[SAT] Fetch failed:", err);
        setSatError(err.message || "TLE fetch failed");
      } finally {
        setSatLoading(false);
      }
    };

    fetchPasses();
    const interval = setInterval(fetchPasses, 30 * 60 * 1000); // re-compute every 30 min
    return () => clearInterval(interval);
  }, []);

  // Helpers
  const formatPassTime = (utc: number) => {
    const d = new Date(utc * 1000);
    return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  };

  const elevationColor = (el: number) => {
    if (el >= 60) return { text: "#10b981", bg: "rgba(16,185,129,0.12)", border: "rgba(16,185,129,0.25)" };
    if (el >= 30) return { text: "#f59e0b", bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.25)" };
    return { text: "#64748b", bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.07)" };
  };

  // Real-time Subscription
  useEffect(() => {
    const dbId = import.meta.env.VITE_APPWRITE_DATABASE_ID || "main_db";
    const unsubscribe = client.subscribe(`databases.${dbId}.collections.attendance.documents`, (response) => {
      if (response.events.some(e => e.includes(".create"))) {
        const newLog = response.payload as any;
        console.log("[TV] Real-time attendance event:", newLog);

        // Dedup: skip if we already handled this exact document
        const docId = newLog.$id || "";
        if (docId && docId === lastWelcomedDocId.current) {
          console.log("[TV] Duplicate event suppressed for doc:", docId);
          return;
        }
        lastWelcomedDocId.current = docId;

        // Use ref (not closure) so we always have latest members
        const currentMembers = membersRef.current;
        const potentialMatches = currentMembers.filter(m => String(m.fingerprintId || m.$id) === String(newLog.memberId));
        const preferredMember =
          potentialMatches.find(m => m.name.toLowerCase().includes("pratik")) ||
          potentialMatches.find(m => m.name.toLowerCase() !== "super admin") ||
          potentialMatches[0];

        // Fallback: if members not loaded yet or ID mismatch, use name from record directly
        const displayName = preferredMember?.name || newLog.memberName || newLog.name || "Team Member";
        console.log("[TV] Showing welcome for:", displayName);

        triggerWelcome(displayName);
        setAttendance(prev => [newLog, ...prev.slice(0, 199)]);
      }
    });
    return () => unsubscribe();
  }, []); // Empty deps — subscription never re-registers; always reads latest via membersRef

  // Countdown
  useEffect(() => {
    const calculateCountdown = () => {
      const now = new Date();
      const startOfDay = new Date(); startOfDay.setHours(9, 0, 0, 0);
      const endOfDay = new Date(); endOfDay.setHours(17, 0, 0, 0);
      const last30Mins = new Date(); last30Mins.setHours(16, 30, 0, 0);
      const outsideHours = now < startOfDay || now >= endOfDay;

      if (outsideHours && !isOvertime) { setIsBusinessHours(false); setCountdown("OFFLINE"); return; }
      setIsBusinessHours(true);

      if (outsideHours && isOvertime) {
        setTimerMode("overtime"); setCountdown("OVERTIME");
        if (breakEndTime && now >= breakEndTime) setBreakEndTime(null);
      } else if (breakEndTime && now < breakEndTime) {
        const diff = breakEndTime.getTime() - now.getTime();
        const m = Math.floor(diff / 60000); const s = Math.floor((diff % 60000) / 1000);
        setTimerMode("break"); setCountdown(`${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`);
      } else {
        const isLast30 = now >= last30Mins;
        setTimerMode(isLast30 ? "warning" : "normal");
        const diff = endOfDay.getTime() - now.getTime();
        const h = Math.floor(diff / 3600000); const m = Math.floor((diff % 3600000) / 60000); const s = Math.floor((diff % 60000) / 1000);
        setCountdown(h > 0 ? `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}` : `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`);
        if (breakEndTime) setBreakEndTime(null);
      }
    };
    calculateCountdown();
    const t = setInterval(calculateCountdown, 1000);
    return () => clearInterval(t);
  }, [breakEndTime, isOvertime]);

  const handleRemoteUnlock = async () => {
    setIsUnlocking(true);
    const toastId = toast.loading("Unlocking door...");
    try {
      await databases.createDocument(import.meta.env.VITE_APPWRITE_DATABASE_ID || "main_db", import.meta.env.VITE_APPWRITE_COLLECTION_ID_COMMANDS || "device_commands", ID.unique(), { command: "updateDevice", status: "pending", deviceId: "ESP32_DEVICE_01", memberName: "REMOTE_UNLOCK" });
      toast.success("Door Unlocked!", { id: toastId });
    } catch (err: any) { toast.error("Failed", { id: toastId, description: err.message }); }
    finally { setIsUnlocking(false); }
  };

  const handleToggleLabLock = async () => {
    if (!deviceDoc) return;
    try {
      const newLocked = !deviceDoc.labLocked;
      const res = await databases.updateDocument(import.meta.env.VITE_APPWRITE_DATABASE_ID || "main_db", import.meta.env.VITE_APPWRITE_COLLECTION_ID_DEVICES || "devices", deviceDoc.$id, { labLocked: newLocked, ...(newLocked && { eventMode: false }) });
      await databases.createDocument(import.meta.env.VITE_APPWRITE_DATABASE_ID || "main_db", import.meta.env.VITE_APPWRITE_COLLECTION_ID_COMMANDS || "device_commands", ID.unique(), { command: "updateDevice", status: "pending", deviceId: "ESP32_DEVICE_01", memberName: "SYNC_STATUS" });
      setDeviceDoc(res);
      toast.success(newLocked ? "🔒 Lab Locked" : "🔓 Lab Unlocked");
    } catch (err: any) { toast.error("Failed", { description: err.message }); }
  };

  const handleToggleEventMode = async () => {
    if (!deviceDoc) return;
    try {
      const newEventMode = !deviceDoc.eventMode;
      const res = await databases.updateDocument(import.meta.env.VITE_APPWRITE_DATABASE_ID || "main_db", import.meta.env.VITE_APPWRITE_COLLECTION_ID_DEVICES || "devices", deviceDoc.$id, { eventMode: newEventMode, ...(newEventMode && { labLocked: false }) });
      await databases.createDocument(import.meta.env.VITE_APPWRITE_DATABASE_ID || "main_db", import.meta.env.VITE_APPWRITE_COLLECTION_ID_COMMANDS || "device_commands", ID.unique(), { command: "updateDevice", status: "pending", deviceId: "ESP32_DEVICE_01", memberName: "SYNC_STATUS" });
      setDeviceDoc(res);
      toast.success(newEventMode ? "🎉 Event Mode ON" : "Event Mode OFF");
    } catch (err: any) { toast.error("Failed", { description: err.message }); }
  };

  const validMemberMaps = new Map(members.filter(m => m.isActive !== false).map(m => [String(m.fingerprintId || m.$id), m]));
  const presentMemberNames = Array.from(new Set(attendance.map(a => String(a.memberId)))).filter(id => validMemberMaps.has(id)).map(id => validMemberMaps.get(id)?.name).filter(Boolean) as string[];
  const activeTasks = tasks.filter(t => t.status !== "done");

  const timerColors = {
    normal:   { text: "#10b981", glow: "rgba(16,185,129,0.4)",  label: "Until Close" },
    warning:  { text: "#ef4444", glow: "rgba(239,68,68,0.5)",   label: "FINAL HOUR!" },
    overtime: { text: "#818cf8", glow: "rgba(129,140,248,0.5)", label: "OVERTIME MODE" },
    break:    { text: "#f59e0b", glow: "rgba(245,158,11,0.5)",  label: "ON BREAK" },
  };
  const tc = timerColors[timerMode];

  if (loading) {
    return (
      <div style={{ background: "#050810" }} className="h-screen w-screen flex flex-col items-center justify-center">
        <div className="relative h-20 w-20 mb-6">
          <div className="absolute inset-0 rounded-full border-2 border-blue-500/20 animate-ping" />
          <div className="absolute inset-2 rounded-full border-2 border-t-blue-500 border-blue-500/10 animate-spin" />
          <div className="absolute inset-5 rounded-full bg-blue-500/20" />
        </div>
        <p className="text-slate-400 font-bold tracking-[0.4em] uppercase text-sm">Initializing System</p>
      </div>
    );
  }

  if (!isBusinessHours) {
    return (
      <div style={{ background: "#020408" }} className="h-screen w-screen flex flex-col items-center justify-center select-none relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-blue-950/30 blur-[150px]" />
        </div>
        <Moon className="h-12 w-12 text-slate-700 mb-8" />
        <h1 className="text-5xl font-black tracking-[0.3em] uppercase text-slate-700 mb-3">ASGS</h1>
        <p className="text-slate-600 font-bold tracking-[0.5em] uppercase text-sm mb-16">Network Standby Mode</p>
        <button onClick={() => setIsOvertime(true)} className="px-10 py-3 rounded-full border border-slate-800 text-slate-600 font-bold uppercase tracking-widest text-sm hover:border-slate-600 hover:text-slate-400 transition-all duration-300">
          Still Working?
        </button>
        <p className="absolute bottom-10 text-slate-800 font-bold tracking-[0.4em] uppercase text-xs animate-pulse">Waking at 09:00 AM</p>
      </div>
    );
  }

  return (
    <div style={{ background: "linear-gradient(135deg, #050810 0%, #070c18 50%, #050810 100%)" }} className="h-screen w-screen overflow-hidden text-slate-200 font-sans flex flex-col select-none relative">

      {/* Subtle grid overlay */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.015]" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)", backgroundSize: "60px 60px" }} />

      {/* Ambient glow orbs */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-600/5 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 right-1/3 w-80 h-80 bg-indigo-600/5 rounded-full blur-[100px] pointer-events-none" />

      {/* ═══════════════════════════ HEADER ═══════════════════════════ */}
      <div className="shrink-0 px-8 pt-5 pb-0 flex items-center justify-between gap-4">
        {/* Left — Branding */}
        <div className="flex items-center gap-4">
          <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #3b82f6, #6366f1)", boxShadow: "0 0 30px rgba(99,102,241,0.4)" }}>
            <Zap className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-widest uppercase text-white leading-none">ASGS Control</h1>
            <p className="text-slate-500 text-xs font-bold tracking-[0.3em] uppercase mt-0.5">
              {currentTime.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            </p>
          </div>
        </div>

        {/* Center — Live clock */}
        <div className="text-3xl font-mono font-bold text-white tabular-nums tracking-widest" style={{ textShadow: "0 0 20px rgba(255,255,255,0.15)" }}>
          {currentTime.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
        </div>

        {/* Right — Controls */}
        <div className="flex items-center gap-2.5">
          {/* Live pulse */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full" style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.15)" }}>
            <div className="h-1.5 w-1.5 bg-emerald-500 rounded-full animate-pulse" />
            <span className="text-emerald-400 text-[10px] font-black tracking-[0.3em] uppercase">Live</span>
          </div>

          {/* Mute */}
          <button onClick={() => { const n = !isMuted; setIsMuted(n); sessionStorage.setItem("tv_is_muted", String(n)); }} className="h-9 w-9 rounded-xl flex items-center justify-center transition-all duration-200" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
            {isMuted ? <VolumeX className="h-4 w-4 text-slate-500" /> : <Volume2 className="h-4 w-4 text-blue-400" />}
          </button>

          {/* Event Mode */}
          <button onClick={handleToggleEventMode} className="h-9 px-3.5 rounded-xl flex items-center gap-2 font-bold text-xs tracking-widest uppercase transition-all duration-300" style={deviceDoc?.eventMode ? { background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.4)", color: "#f59e0b", boxShadow: "0 0 20px rgba(245,158,11,0.15)" } : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", color: "#64748b" }}>
            <DoorOpen className={`h-3.5 w-3.5 ${deviceDoc?.eventMode ? "animate-bounce" : ""}`} />
            {deviceDoc?.eventMode ? "Event ON" : "Event Mode"}
          </button>

          {/* Lab Lock */}
          <button onClick={handleToggleLabLock} className="h-9 px-3.5 rounded-xl flex items-center gap-2 font-bold text-xs tracking-widest uppercase transition-all duration-300" style={deviceDoc?.labLocked ? { background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.4)", color: "#ef4444", boxShadow: "0 0 20px rgba(239,68,68,0.2)" } : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", color: "#64748b" }}>
            {deviceDoc?.labLocked ? <ShieldAlert className="h-3.5 w-3.5 animate-pulse" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            {deviceDoc?.labLocked ? "LOCKED" : "Lab Active"}
          </button>

          {/* Open Door */}
          <button onClick={handleRemoteUnlock} disabled={isUnlocking} className="h-9 px-4 rounded-xl flex items-center gap-2 font-bold text-xs tracking-widest uppercase transition-all duration-300 disabled:opacity-50" style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", color: "#10b981", boxShadow: "0 0 15px rgba(16,185,129,0.1)" }}>
            <Unlock className={`h-3.5 w-3.5 ${isUnlocking ? "animate-spin" : ""}`} />
            {isUnlocking ? "Opening..." : "Open Door"}
          </button>
        </div>
      </div>

      {/* ═══════════════════════════ CONTENT ═══════════════════════════ */}
      <div className="flex-1 min-h-0 grid grid-cols-12 gap-5 p-5 pt-4">

        {/* ─── LEFT: Combined Members & Tasks ─── */}
        <div className="col-span-3 flex flex-col gap-5 min-h-0">
          
          {/* Members Panel */}
          <div className="flex-[3] flex flex-col rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)", backdropFilter: "blur(20px)" }}>
            {/* Header */}
            <div className="shrink-0 p-4 pb-3 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <div className="flex items-center gap-2.5">
                <div className="h-7 w-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.2)" }}>
                  <Users className="h-3.5 w-3.5 text-blue-400" />
                </div>
                <span className="font-black text-sm uppercase tracking-widest text-white">Present</span>
              </div>
              <div className="h-6 min-w-[24px] px-2 rounded-md flex items-center justify-center font-black text-xs" style={{ background: "rgba(59,130,246,0.2)", color: "#60a5fa" }}>
                {presentMemberNames.length}
              </div>
            </div>

            {/* Member List - Scrollable */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1.5 scrollbar-hide" style={{ scrollbarWidth: "none" }}>
              {presentMemberNames.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center gap-3 opacity-40">
                  <div className="h-12 w-12 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <Users className="h-5 w-5 text-slate-700" />
                  </div>
                  <p className="text-slate-600 text-xs font-bold tracking-widest uppercase">Nobody Here Yet</p>
                </div>
              ) : (
                presentMemberNames.map((name, i) => (
                  <motion.div key={name} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.04)" }}>
                    <div className="relative shrink-0">
                      <div className="h-7 w-7 rounded-full flex items-center justify-center font-black text-xs" style={{ background: "linear-gradient(135deg, rgba(59,130,246,0.3), rgba(99,102,241,0.3))", border: "1px solid rgba(99,102,241,0.2)" }}>
                        {name.charAt(0).toUpperCase()}
                      </div>
                      <div className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 border-2 border-[#050810]" style={{ boxShadow: "0 0 6px rgba(16,185,129,0.8)" }} />
                    </div>
                    <span className="font-semibold text-sm text-slate-200 truncate">{name}</span>
                  </motion.div>
                ))
              )}
            </div>

            {/* Attendance count */}
            <div className="shrink-0 p-3 pt-2" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
              <div className="flex items-center justify-between px-3 py-2 rounded-xl" style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.1)" }}>
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Today's Scans</span>
                <span className="text-emerald-400 font-black text-sm">{attendance.length}</span>
              </div>
            </div>
          </div>

          {/* Tasks Panel */}
          <div className="flex-[2] flex flex-col rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)", backdropFilter: "blur(20px)" }}>
            {/* Header */}
            <div className="shrink-0 p-4 pb-3 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <div className="flex items-center gap-2.5">
                <div className="h-7 w-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.2)" }}>
                  <ClipboardList className="h-3.5 w-3.5 text-amber-400" />
                </div>
                <span className="font-black text-sm uppercase tracking-widest text-white">Pending Tasks</span>
              </div>
              <div className="h-6 min-w-[24px] px-2 rounded-md flex items-center justify-center font-black text-xs" style={{ background: "rgba(245,158,11,0.15)", color: "#fbbf24" }}>
                {activeTasks.length}
              </div>
            </div>

            {/* Task List - Scrollable */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2 scrollbar-hide" style={{ scrollbarWidth: "none" }}>
              {activeTasks.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center gap-3 opacity-40">
                  <div className="h-12 w-12 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <ClipboardList className="h-5 w-5 text-slate-700" />
                  </div>
                  <p className="text-slate-600 text-xs font-bold tracking-widest uppercase">All Cleared</p>
                </div>
              ) : (
                activeTasks.map((t, i) => (
                  <motion.div key={t.$id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}
                    className="p-3 rounded-xl" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h3 className="font-semibold text-sm text-slate-100 leading-snug line-clamp-2 flex-1">{t.title}</h3>
                      <span className="shrink-0 text-[10px] font-black px-2 py-0.5 rounded-md uppercase tracking-widest" style={t.status === "in_progress" ? { background: "rgba(245,158,11,0.15)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.2)" } : { background: "rgba(255,255,255,0.05)", color: "#475569", border: "1px solid rgba(255,255,255,0.06)" }}>
                        {t.status === "in_progress" ? "Active" : "Todo"}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {(t.assigneeNames ? t.assigneeNames.split(",") : [t.assigneeName]).filter(Boolean).map((name: string, j: number) => (
                        <span key={j} className="text-[10px] font-bold px-2 py-0.5 rounded-md" style={{ background: "rgba(99,102,241,0.12)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.15)" }}>
                          @{name.trim()}
                        </span>
                      ))}
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* ─── CENTER: Massive Countdown ─── */}
        <div className="col-span-6 flex flex-col rounded-2xl overflow-hidden relative" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", backdropFilter: "blur(20px)" }}>
          {/* Glow behind countdown */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 rounded-full pointer-events-none transition-all duration-1000" style={{ background: `radial-gradient(circle, ${tc.glow} 0%, transparent 70%)`, opacity: 0.4 }} />

          {/* Timer content */}
          <div className="flex-1 flex flex-col items-center justify-center px-8 relative z-10">
            {/* Status label */}
            <motion.div key={timerMode} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-6 px-5 py-1.5 rounded-full text-xs font-black tracking-[0.4em] uppercase" style={{ background: `rgba(${timerMode === "normal" ? "16,185,129" : timerMode === "warning" ? "239,68,68" : timerMode === "overtime" ? "129,140,248" : "245,158,11"},0.1)`, border: `1px solid rgba(${timerMode === "normal" ? "16,185,129" : timerMode === "warning" ? "239,68,68" : timerMode === "overtime" ? "129,140,248" : "245,158,11"},0.25)`, color: tc.text }}>
              {tc.label}
            </motion.div>

            {/* Giant countdown */}
            <motion.div key={countdown} className="font-mono font-black leading-none tabular-nums text-center" style={{
              fontSize: countdown.length <= 5 ? "10rem" : "7rem",
              color: tc.text,
              textShadow: `0 0 60px ${tc.glow}, 0 0 120px ${tc.glow}`,
              letterSpacing: "-0.02em"
            }}>
              {countdown}
            </motion.div>

            <p className="mt-6 text-slate-600 font-bold text-xs tracking-[0.4em] uppercase">
              {breakEndTime ? "Club Intermission" : isOvertime ? "Midnight Push Active" : "Until 5:00 PM Shutdown"}
            </p>
          </div>

          {/* Break controls */}
          <div className="shrink-0 p-4" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
            <div className="flex items-center justify-center gap-3">
              <span className="text-slate-600 text-[10px] font-black tracking-[0.3em] uppercase">Break</span>
              {[5, 10, 15].map(m => (
                <button key={m} onClick={() => { const e = new Date(); e.setMinutes(e.getMinutes() + m); setBreakEndTime(e); }}
                  className="h-8 px-4 rounded-lg text-xs font-black uppercase tracking-widest transition-all duration-200 hover:scale-105 active:scale-95"
                  style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", color: "#f59e0b" }}>
                  {m}m
                </button>
              ))}
              <button onClick={() => setBreakEndTime(null)} className="h-8 px-4 rounded-lg text-xs font-black uppercase tracking-widest transition-all duration-200"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", color: "#475569" }}>
                End
              </button>
            </div>
          </div>
        </div>

        {/* ─── RIGHT: Satellite Passes ─── */}
        <div className="col-span-3 flex flex-col rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)", backdropFilter: "blur(20px)" }}>
          {/* Header */}
          <div className="shrink-0 p-4 pb-3 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <div className="flex items-center gap-2.5">
              <div className="h-7 w-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(168,85,247,0.15)", border: "1px solid rgba(168,85,247,0.2)" }}>
                <Radio className="h-3.5 w-3.5 text-purple-400" />
              </div>
              <span className="font-black text-sm uppercase tracking-widest text-white">Sat Passes</span>
            </div>
            <div className="flex items-center gap-2">
              {satLastUpdated && (
                <span className="text-[9px] text-slate-600 font-bold">Updated {satLastUpdated.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}</span>
              )}
              <div className="h-6 min-w-[24px] px-2 rounded-md flex items-center justify-center font-black text-xs" style={{ background: "rgba(168,85,247,0.15)", color: "#c084fc" }}>
                {satPasses.length}
              </div>
            </div>
          </div>

          {/* Pass List - Scrollable */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2 scrollbar-hide" style={{ scrollbarWidth: "none" }}>
            {!SAT_CONFIGURED ? (
              <div className="h-full flex flex-col items-center justify-center gap-3 px-4 text-center">
                <AlertCircle className="h-8 w-8 text-slate-700" />
                <p className="text-slate-600 text-xs font-bold leading-relaxed">Set VITE_LAB_LAT / VITE_LAB_LNG in <code className="text-slate-500">.env.local</code></p>
              </div>
            ) : satLoading ? (
              <div className="h-full flex flex-col items-center justify-center gap-3">
                <div className="h-6 w-6 rounded-full border-2 border-t-purple-500 border-purple-500/10 animate-spin" />
                <p className="text-slate-600 text-[10px] font-bold tracking-widest uppercase">Computing Passes...</p>
              </div>
            ) : satError ? (
              <div className="h-full flex flex-col items-center justify-center gap-3 px-4 text-center">
                <AlertCircle className="h-8 w-8 text-red-800" />
                <p className="text-red-800 text-[10px] font-bold">{satError}</p>
              </div>
            ) : satPasses.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-3">
                <Radio className="h-8 w-8 text-slate-700" />
                <p className="text-slate-600 text-xs font-bold tracking-widest uppercase">No passes today</p>
              </div>
            ) : (
              satPasses.slice(0, 10).map((p, i) => {
                const ec = elevationColor(p.maxEl);
                const isNext = i === 0;
                const minAway = Math.round((p.startUTC - Date.now() / 1000) / 60);
                return (
                  <motion.div key={`${p.noradId}-${p.startUTC}`}
                    initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
                    className="p-3 rounded-xl relative overflow-hidden"
                    style={{ background: isNext ? "rgba(168,85,247,0.08)" : "rgba(255,255,255,0.03)", border: isNext ? "1px solid rgba(168,85,247,0.25)" : "1px solid rgba(255,255,255,0.05)" }}>
                    {isNext && <div className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-purple-400 animate-pulse" />}
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-black text-xs text-white truncate flex-1">{p.satName}</span>
                      <span className="shrink-0 ml-2 text-[9px] font-black px-2 py-0.5 rounded-full" style={{ background: ec.bg, color: ec.text, border: `1px solid ${ec.border}` }}>
                        {p.maxEl}°
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 font-bold text-xs">{formatPassTime(p.startUTC)}</span>
                      <span className="text-slate-600 text-[10px] font-bold">
                        {minAway < 60 ? `in ${minAway}m` : `in ${Math.floor(minAway/60)}h ${minAway%60}m`} · {Math.round(p.duration/60)}min window
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-1">
                      <span className="text-[9px] font-bold tracking-widest uppercase" style={{ color: "#6366f1" }}>{p.maxAzCompass}</span>
                      <span className="text-slate-700 text-[9px]">peak azimuth</span>
                    </div>
                  </motion.div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="shrink-0 p-3 pt-2" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
            <div className="flex items-center justify-between px-3 py-2 rounded-xl" style={{ background: "rgba(168,85,247,0.06)", border: "1px solid rgba(168,85,247,0.1)" }}>
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Tracking</span>
              <span className="text-purple-400 font-black text-[10px]">{TRACKED_SATS.length} satellites</span>
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════ WELCOME POPUP ═══════════════════════════ */}
      <AnimatePresence>
        {showWelcome && welcomeMember && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-16"
            style={{ background: "rgba(3,5,12,0.92)", backdropFilter: "blur(20px)" }}>
            <motion.div initial={{ scale: 0.85, y: 30, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.92, opacity: 0 }}
              transition={{ type: "spring", damping: 22, stiffness: 280 }}
              className="w-full max-w-5xl aspect-video relative overflow-hidden flex flex-col items-center justify-center text-center px-20"
              style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "24px", backdropFilter: "blur(40px)" }}>

              {/* Glow */}
              <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(59,130,246,0.15) 0%, transparent 70%)" }} />
              <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 70%)" }} />

              {/* Top bar */}
              <div className="absolute top-8 left-0 right-0 flex justify-center">
                <div className="px-4 py-1 rounded-full text-[10px] font-black tracking-[0.4em] uppercase" style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)", color: "#10b981" }}>
                  ASGS Attendance Verified
                </div>
              </div>

              {/* Avatar */}
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.15, type: "spring", stiffness: 300 }}
                className="h-20 w-20 rounded-full flex items-center justify-center mb-8 text-3xl font-black text-white"
                style={{ background: "linear-gradient(135deg, #3b82f6, #6366f1)", boxShadow: "0 0 60px rgba(99,102,241,0.5)" }}>
                {welcomeMember.name.charAt(0).toUpperCase()}
              </motion.div>

              <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
                className="font-black text-slate-400 text-sm tracking-[0.5em] uppercase mb-3">Welcome Back</motion.p>

              <motion.h1 initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
                className="font-black text-white mb-8 leading-none"
                style={{ fontSize: "clamp(2.5rem, 6vw, 5rem)", textShadow: "0 0 40px rgba(99,102,241,0.4)" }}>
                {welcomeMember.name}
              </motion.h1>

              <motion.div initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: 0.4, duration: 0.5 }}
                className="h-px w-32 mb-8 rounded-full" style={{ background: "linear-gradient(90deg, transparent, rgba(99,102,241,0.6), transparent)" }} />

              <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
                className="text-slate-400 text-xl italic font-medium max-w-2xl leading-relaxed">
                "{welcomeMember.quote}"
              </motion.p>

              <div className="absolute bottom-8 flex items-center gap-2">
                <Sparkles className="h-3 w-3 text-slate-700" />
                <span className="text-slate-700 text-[10px] font-black tracking-[0.4em] uppercase">ASGS Network</span>
                <Sparkles className="h-3 w-3 text-slate-700" />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══════════════════════════ AUDIO UNLOCK GATE ═══════════════════════════ */}
      <AnimatePresence>
        {!audioEnabled && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center"
            style={{ background: "rgba(3,5,12,0.95)", backdropFilter: "blur(30px)" }}>
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              className="text-center p-14 rounded-3xl max-w-md relative overflow-hidden"
              style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)" }}>
              <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(circle at 50% 0%, rgba(59,130,246,0.08) 0%, transparent 70%)" }} />
              <div className="h-16 w-16 rounded-2xl flex items-center justify-center mx-auto mb-8 relative z-10" style={{ background: "linear-gradient(135deg, #3b82f6, #6366f1)", boxShadow: "0 0 40px rgba(99,102,241,0.4)" }}>
                <Wifi className="h-8 w-8 text-white" />
              </div>
              <h2 className="text-2xl font-black text-white mb-3 relative z-10">TV Dashboard Ready</h2>
              <p className="text-slate-500 text-sm mb-10 leading-relaxed relative z-10">
                Tap below to synchronize live data and enable<br />real-time voice announcements.
              </p>
              <button onClick={() => { sessionStorage.setItem("tv_audio_enabled", "true"); setAudioEnabled(true); toast.success("System Online!"); }}
                className="w-full h-14 rounded-xl font-black text-sm uppercase tracking-widest text-white transition-all duration-300 hover:scale-105 active:scale-95 relative z-10"
                style={{ background: "linear-gradient(135deg, #3b82f6, #6366f1)", boxShadow: "0 0 30px rgba(99,102,241,0.3)" }}>
                Launch Dashboard
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
