import { useState, useEffect, useRef } from "react";
import { Users, ClipboardList, Clock, Moon, Sparkles, Volume2, VolumeX, Unlock, ShieldAlert, ShieldCheck, DoorOpen } from "lucide-react";
import { databases, client } from "@/lib/appwrite";
import { Query, ID } from "appwrite";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function TvCast() {
  const [members, setMembers] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [deviceDoc, setDeviceDoc] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  // Timer States
  const [countdown, setCountdown] = useState("00:00:00");
  const [timerColor, setTimerColor] = useState("text-emerald-500");
  const [timerLabel, setTimerLabel] = useState("Time Remaining");
  const [isBusinessHours, setIsBusinessHours] = useState(false);
  const [isOvertime, setIsOvertime] = useState(false);
  const [breakEndTime, setBreakEndTime] = useState<Date | null>(null);
  
  // Welcome Popup States
  const [welcomeMember, setWelcomeMember] = useState<{ name: string, quote: string } | null>(null);
  const [showWelcome, setShowWelcome] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(() => {
    return typeof window !== "undefined" && sessionStorage.getItem("tv_audio_enabled") === "true";
  });
  const [isMuted, setIsMuted] = useState(() => {
    return typeof window !== "undefined" && sessionStorage.getItem("tv_is_muted") === "true";
  });
  const welcomeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Motivational Quotes
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
    "Every line of code moves us closer to the stars."
  ];

  const speakWelcome = async (name: string, quote: string) => {
    if (!audioEnabled) {
      console.warn("Audio skipped: Interaction required. Click 'Launch Dashboard'.");
      toast.info("Audio is locked. Click 'Launch Dashboard' to enable sounds.");
      return;
    }

    const apiKey = import.meta.env.VITE_INWORLD_API_KEY;
    const voiceId = import.meta.env.VITE_INWORLD_VOICE_ID || "Ashley";

    if (!apiKey) {
      toast.error("Inworld AI API Key is missing!", {
        description: "Add VITE_INWORLD_API_KEY to .env.local and restart the server."
      });
      return;
    }

    const text = `Welcome back, ${name}. ${quote}`;
    console.log("Announcement Triggered (Inworld AI):", name);

    if (isMuted) {
      console.log("Audio suppressed (Muted mode)");
      return;
    }

    try {
      const response = await fetch("https://api.inworld.ai/tts/v1/voice", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": apiKey.startsWith("Basic ") ? apiKey : `Basic ${apiKey}`
        },
        body: JSON.stringify({
          text,
          voiceId,
          modelId: "inworld-tts-1.5-max"
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.message || "Inworld API request failed");
      }

      const data = await response.json();
      if (!data.audioContent) {
        throw new Error("No audio content returned from Inworld");
      }

      // Convert Base64 to Blob
      const audioBlob = await (await fetch(`data:audio/mp3;base64,${data.audioContent}`)).blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      
      await audio.play();
      console.log("Inworld AI audio played successfully.");
    } catch (err: any) {
      console.error("Inworld AI error:", err);
      toast.error("Inworld AI Audio Failed", {
        description: err.message || "Check your API key or network connection."
      });
    }
  };

  const triggerWelcome = (name: string) => {
    if (welcomeTimeoutRef.current) clearTimeout(welcomeTimeoutRef.current);
    
    const randomQuote = motivationalQuotes[Math.floor(Math.random() * motivationalQuotes.length)];
    setWelcomeMember({ name, quote: randomQuote });
    setShowWelcome(true);
    
    // Play audio if enabled
    speakWelcome(name, randomQuote);

    welcomeTimeoutRef.current = setTimeout(() => {
      setShowWelcome(false);
    }, 8000); // 8 seconds display
  };

  // Fetch Data Routine
  useEffect(() => {
    const fetchData = async () => {
      try {
        const dbId = import.meta.env.VITE_APPWRITE_DATABASE_ID || "main_db";

        const [membersRes, attendRes, tasksRes, deviceRes] = await Promise.all([
          databases.listDocuments(dbId, import.meta.env.VITE_APPWRITE_COLLECTION_ID || "members", [Query.limit(500)]),
          databases.listDocuments(dbId, "attendance", [
            Query.greaterThanEqual("$createdAt", new Date(new Date().setHours(0,0,0,0)).toISOString()),
            Query.limit(200), Query.orderDesc("$createdAt")
          ]),
          databases.listDocuments(dbId, "club_tasks", [Query.orderDesc("$createdAt"), Query.limit(100)]),
          databases.listDocuments(dbId, import.meta.env.VITE_APPWRITE_COLLECTION_ID_DEVICES || "devices", [Query.limit(1)])
        ]);

        setMembers(membersRes.documents);
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
    const interval = setInterval(fetchData, 10000); // 10s auto-refresh data

    // Force hard reload precisely at 00:00:00 every night to prevent TV memory leaks
    const now = new Date();
    const msUntilMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0).getTime() - now.getTime();
    const midnightTimer = setTimeout(() => {
      window.location.reload();
    }, msUntilMidnight);

    return () => {
      clearInterval(interval);
      clearTimeout(midnightTimer);
    };
  }, []);

  // Real-time Attendance Subscription
  useEffect(() => {
    const dbId = import.meta.env.VITE_APPWRITE_DATABASE_ID || "main_db";
    const unsubscribe = client.subscribe(
      `databases.${dbId}.collections.attendance.documents`,
      (response) => {
        if (response.events.some(e => e.includes('.create'))) {
          const newLog = response.payload as any;
          // Find all potential member matches (to handle ID collisions)
          const potentialMatches = members.filter(m => String(m.fingerprintId || m.$id) === String(newLog.memberId));
          
          // Prioritize matches that are NOT named "Super Admin" and matches that ARE named "Pratik"
          const preferredMember = potentialMatches.find(m => m.name.toLowerCase().includes("pratik")) || 
                                  potentialMatches.find(m => m.name.toLowerCase() !== "super admin") || 
                                  potentialMatches[0];
          
          if (preferredMember) {
            triggerWelcome(preferredMember.name);
            // Also refresh attendance to update the list
            setAttendance(prev => [newLog, ...prev.slice(0, 199)]);
          }
        }
      }
    );

    return () => unsubscribe();
  }, [members]);

  // Countdown & Shift Routine (Runs every second)
  useEffect(() => {
    const calculateCountdown = () => {
      const now = new Date();
      
      const startOfDay = new Date();
      startOfDay.setHours(9, 0, 0, 0); // 9:00 AM Open
      
      const endOfDay = new Date();
      endOfDay.setHours(17, 0, 0, 0); // 5:00 PM Close
      
      const last30Mins = new Date();
      last30Mins.setHours(16, 30, 0, 0); // 4:30 PM Start Red Mode

      // Check Business Hours
      const outsideHours = now.getTime() < startOfDay.getTime() || now.getTime() >= endOfDay.getTime();
      
      if (outsideHours && !isOvertime) {
        setIsBusinessHours(false);
        setCountdown("OFFLINE");
        return;
      }
      
      setIsBusinessHours(true);

      // Determine Timer Mode
      if (outsideHours && isOvertime) {
        // OVERTIME MODE
        setTimerLabel("KEEP IT UP GUYS, YOU'RE DOING GREAT!");
        setTimerColor("text-indigo-400 drop-shadow-[0_0_30px_rgba(129,140,248,0.6)]");
        setCountdown("OVERTIME");
        
        // Auto-clear break timer when expired
        if (breakEndTime && now.getTime() >= breakEndTime.getTime()) setBreakEndTime(null);
      } else if (breakEndTime && now.getTime() < breakEndTime.getTime()) {
        // BREAK MODE
        const diff = breakEndTime.getTime() - now.getTime();
        const m = Math.floor(diff / (1000 * 60));
        const s = Math.floor((diff % (1000 * 60)) / 1000);
        
        setTimerLabel("ON BREAK");
        setTimerColor("text-amber-400 drop-shadow-[0_0_25px_rgba(251,191,36,0.5)]");
        setCountdown(`${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`);
      } else {
        // REGULAR DASHBOARD MODE
        const isLast30Mins = now.getTime() >= last30Mins.getTime();
        
        setTimerLabel(isLast30Mins ? "CRITICAL: END OF DAY NEARING" : "Time Remaining");
        setTimerColor(isLast30Mins ? "text-rose-500 drop-shadow-[0_0_25px_rgba(244,63,94,0.5)] animate-pulse" : "text-emerald-500 drop-shadow-[0_0_20px_rgba(16,185,129,0.3)]");
        
        const diff = endOfDay.getTime() - now.getTime();
        const h = Math.floor(diff / (1000 * 60 * 60));
        const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const s = Math.floor((diff % (1000 * 60)) / 1000);
        
        // Auto-clear break timer when expired
        if (breakEndTime) setBreakEndTime(null);

        // If hours > 0, show H:M:S, else show M:S
        if (h > 0) {
          setCountdown(`${h.toString()}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`);
        } else {
          setCountdown(`${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`);
        }
      }
    };

    calculateCountdown();
    const timerInterval = setInterval(calculateCountdown, 1000);
    return () => clearInterval(timerInterval);
  }, [breakEndTime, isOvertime]);

  // Remote Unlock Controller
  const [isUnlocking, setIsUnlocking] = useState(false);
  const handleRemoteUnlock = async () => {
    setIsUnlocking(true);
    const toastId = toast.loading("Sending unlock command...");
    try {
      await databases.createDocument(
        import.meta.env.VITE_APPWRITE_DATABASE_ID || "main_db",
        import.meta.env.VITE_APPWRITE_COLLECTION_ID_COMMANDS || "device_commands",
        ID.unique(),
        {
          command: "updateDevice",  // Using existing Enum value
          status: "pending",
          deviceId: "ESP32_DEVICE_01",
          memberName: "REMOTE_UNLOCK" // Special flag for ESP32
        }
      );
      toast.success("Remote Unlock Triggered!", { id: toastId });
    } catch (err: any) {
      toast.error("Failed to unlock door", { 
        id: toastId, 
        description: err.message || "Appwrite request failed" 
      });
    } finally {
      setIsUnlocking(false);
    }
  };

  const handleToggleLabLock = async () => {
    if (!deviceDoc) return;
    try {
      const newLocked = !deviceDoc.labLocked;
      const res = await databases.updateDocument(
        import.meta.env.VITE_APPWRITE_DATABASE_ID || "main_db",
        import.meta.env.VITE_APPWRITE_COLLECTION_ID_DEVICES || "devices",
        deviceDoc.$id,
        { labLocked: newLocked }
      );
      setDeviceDoc(res);
      toast.success(newLocked ? "Lab is now LOCKED" : "Lab Unlocked");
    } catch (err: any) {
      toast.error("Failed to toggle global lock");
    }
  };

  const handleToggleEventMode = async () => {
    if (!deviceDoc) return;
    try {
      const newEventMode = !deviceDoc.eventMode;
      const res = await databases.updateDocument(
        import.meta.env.VITE_APPWRITE_DATABASE_ID || "main_db",
        import.meta.env.VITE_APPWRITE_COLLECTION_ID_DEVICES || "devices",
        deviceDoc.$id,
        { eventMode: newEventMode }
      );
      setDeviceDoc(res);
      toast.success(newEventMode ? "Event Mode ON: Door is Open!" : "Event Mode OFF");
    } catch (err: any) {
      toast.error("Failed to toggle event mode");
    }
  };

  // Break Controllers
  const startBreak = (minutes: number) => {
    const end = new Date();
    end.setMinutes(end.getMinutes() + minutes);
    setBreakEndTime(end);
  };

  // Compute Checked-In Members
  const validMemberMaps = new Map(members.filter(m => m.isActive !== false).map(m => [String(m.fingerprintId || m.$id), m]));
  
  const presentMemberNames = Array.from(new Set(attendance.map(a => String(a.memberId))))
      .filter(id => validMemberMaps.has(id))
      .map(id => validMemberMaps.get(id)?.name)
      .filter(Boolean) as string[];

  // Active Tasks
  const activeTasks = tasks.filter(t => t.status !== "done");

  if (loading && tasks.length === 0) {
    return (
      <div className="h-screen w-screen bg-slate-950 flex flex-col items-center justify-center text-slate-300">
        <div className="animate-spin h-12 w-12 border-4 border-slate-500 border-t-transparent rounded-full mb-4" />
        <p className="text-xl font-medium tracking-wide">Loading System...</p>
      </div>
    );
  }

  // SLEEP MODE UI (Saves TV Screen Burn-in outside 9AM-5PM)
  if (!loading && !isBusinessHours) {
    return (
      <div className="h-screen w-screen overflow-hidden bg-black text-slate-600 font-sans flex flex-col items-center justify-center select-none relative">
        <Moon className="h-16 w-16 mb-6 text-slate-800" />
        <h1 className="text-4xl font-extrabold tracking-widest uppercase mb-4 text-slate-700">Campus Closed</h1>
        <p className="text-xl font-medium font-mono uppercase">ASGS Network Standby Mode</p>
        
        {/* OVERTIME BUTTON */}
        <button 
          onClick={() => setIsOvertime(true)}
          className="mt-12 px-8 py-3 bg-slate-900 border border-slate-800 rounded-full text-slate-400 font-bold uppercase tracking-widest hover:text-white hover:border-slate-600 hover:bg-slate-800 transition-all duration-300 shadow-[0_0_15px_rgba(0,0,0,0.5)] hover:shadow-[0_0_20px_rgba(255,255,255,0.1)] active:scale-95"
        >
          We Are Still Working
        </button>
        <p className="text-sm font-bold text-slate-800 tracking-[0.3em] uppercase mt-12 absolute bottom-10 animate-pulse">
           System will wake at 09:00 AM
        </p>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#0a0f18] text-slate-200 font-sans p-6 flex flex-col select-none">
      
      {/* Header */}
      <div className="flex justify-between items-end mb-6 pb-4 shrink-0">
        <div>
          <h1 className="text-4xl text-white font-bold flex items-center gap-3 tracking-tight">
             <Clock className="h-8 w-8 text-blue-500" /> ASGS Dashboard
          </h1>
          <p className="text-slate-400 mt-1 text-lg font-medium tracking-wide flex items-center gap-3">
            Command & Control Center <span className="text-slate-600">•</span> {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div className="flex items-center gap-4">
          {/* Mute Toggle Button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              const newState = !isMuted;
              setIsMuted(newState);
              sessionStorage.setItem("tv_is_muted", String(newState));
              toast.success(newState ? "Audio Muted" : "Audio Active", {
                description: newState ? "Popups only" : "Voice announcements enabled",
                duration: 2000
              });
            }}
            className="h-10 w-10 rounded-xl bg-slate-800/40 border border-slate-700/50 hover:bg-slate-700/80 transition-all backdrop-blur-sm"
          >
            {isMuted ? <VolumeX className="h-5 w-5 text-slate-400" /> : <Volume2 className="h-5 w-5 text-blue-400" />}
          </Button>

          {/* Event Mode Toggle */}
          <Button
            variant="outline"
            onClick={handleToggleEventMode}
            className={`h-10 px-4 rounded-xl font-bold uppercase tracking-widest transition-all backdrop-blur-sm 
              ${deviceDoc?.eventMode 
                ? "bg-amber-500/20 border-amber-500 text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.2)]" 
                : "bg-slate-800/40 border-slate-700/50 text-slate-400 hover:bg-slate-700/80"}`}
          >
            <DoorOpen className={`h-4 w-4 mr-2 ${deviceDoc?.eventMode ? "animate-bounce" : ""}`} />
            {deviceDoc?.eventMode ? "Event Mode ON" : "Event Mode"}
          </Button>

          {/* Global Lab Lock Toggle */}
          <Button
            variant="outline"
            onClick={handleToggleLabLock}
            className={`h-10 px-4 rounded-xl font-bold uppercase tracking-widest transition-all backdrop-blur-sm 
              ${deviceDoc?.labLocked 
                ? "bg-red-500/20 border-red-500 text-red-500 shadow-[0_0_15px_rgba(239,68,68,0.3)] animate-pulse" 
                : "bg-slate-800/40 border-slate-700/50 text-slate-400 hover:bg-slate-700/80"}`}
          >
            {deviceDoc?.labLocked ? <ShieldAlert className="h-4 w-4 mr-2" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
            {deviceDoc?.labLocked ? "LAB LOCKED" : "Lab Active"}
          </Button>
          
          <Button
            variant="outline"
            onClick={handleRemoteUnlock}
            disabled={isUnlocking}
            className="h-10 px-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 hover:bg-emerald-500/20 text-emerald-400 font-bold uppercase tracking-widest transition-all backdrop-blur-sm shadow-[0_0_15px_rgba(16,185,129,0.1)] hover:shadow-[0_0_20px_rgba(16,185,129,0.2)] disabled:opacity-50"
          >
            <Unlock className={`h-4 w-4 mr-2 ${isUnlocking ? 'animate-pulse' : ''}`} />
            {isUnlocking ? "Opening..." : "Open Door"}
          </Button>

          <div className="flex items-center gap-2 border border-slate-700/50 px-4 py-2 rounded-full bg-slate-800/30 backdrop-blur-sm">
             <div className="h-2 w-2 bg-emerald-500 rounded-full animate-pulse" />
             <p className="text-slate-300 font-bold text-sm uppercase tracking-widest">Live Sync</p>
          </div>
        </div>
      </div>

      {/* Main Content: 3 Clean Columns */}
      <div className="flex-1 min-h-0 grid grid-cols-12 gap-6 relative">
        
        {/* COLUMN 1: Present Members (Smaller) */}
        <div className="col-span-3 flex flex-col h-full bg-slate-900/40 backdrop-blur-sm rounded-2xl border border-slate-800/80 shadow-xl overflow-hidden relative">
          <div className="bg-blue-500/10 p-5 shrink-0 flex items-center justify-between border-b border-white/5">
            <h2 className="text-xl font-semibold text-white flex items-center gap-2">
              <Users className="h-5 w-5 text-blue-400" /> Members
            </h2>
            <span className="bg-blue-600 text-white font-bold px-3 py-1 rounded-full text-xs">
               {presentMemberNames.length}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
             {presentMemberNames.length === 0 ? (
                <div className="h-full flex items-center justify-center text-slate-500 text-base font-medium">Nobody checked in.</div>
             ) : (
                <ul className="space-y-2">
                   {presentMemberNames.map((name, i) => (
                      <li key={i} className="py-2.5 px-3 bg-white/5 rounded-lg text-base font-medium text-slate-200 flex items-center gap-3 border border-white/5">
                         <div className="h-2 w-2 bg-emerald-400 rounded-full shadow-[0_0_8px_rgba(52,211,153,0.8)]" /> 
                         {name}
                      </li>
                   ))}
                </ul>
             )}
          </div>
        </div>

        {/* COLUMN 2: CENTER (Giant 5:00 PM Countdown) */}
        <div className="col-span-6 flex flex-col h-full bg-slate-900/40 backdrop-blur-sm rounded-2xl border border-slate-800/80 shadow-2xl overflow-hidden relative">
          <div className="p-8 text-center flex-1 flex flex-col justify-center items-center">
             <h2 className={`text-2xl font-bold mb-8 uppercase tracking-[0.2em] transition-colors duration-500 ${timerColor}`}>
               {timerLabel}
             </h2>
             <div className="w-full flex justify-center items-center">
               <span className={`font-mono font-bold text-[6rem] ${isOvertime ? 'xl:text-[6rem] 2xl:text-[8rem]' : 'xl:text-[8rem] 2xl:text-[10rem]'} leading-none tracking-tight whitespace-nowrap transition-colors duration-500 drop-shadow-[0_0_20px_rgba(0,0,0,0.5)] ${timerColor}`}>
                  {countdown}
               </span>
             </div>
             <p className="text-xl text-slate-500 font-medium tracking-wide mt-8 uppercase">
                {breakEndTime ? "Club Intermission" : (isOvertime ? "Midnight Sync Active" : "Until 5:00 PM Shutdown")}
             </p>
          </div>
          
          {/* subtle break timer controls */}
          <div className="shrink-0 p-6 bg-black/40 border-t border-white/5 flex items-center justify-center gap-4">
             <span className="text-slate-500 text-sm font-bold uppercase tracking-widest mr-2">Break:</span>
             <button onClick={() => startBreak(5)} className="px-4 py-1.5 rounded-lg bg-amber-500/10 text-amber-500 font-bold text-sm border border-amber-500/20 hover:bg-amber-500/30 transition shadow-[0_0_15px_rgba(245,158,11,0.2)]">5m</button>
             <button onClick={() => startBreak(10)} className="px-4 py-1.5 rounded-lg bg-amber-500/10 text-amber-500 font-bold text-sm border border-amber-500/20 hover:bg-amber-500/30 transition shadow-[0_0_15px_rgba(245,158,11,0.2)]">10m</button>
             <button onClick={() => startBreak(15)} className="px-4 py-1.5 rounded-lg bg-amber-500/10 text-amber-500 font-bold text-sm border border-amber-500/20 hover:bg-amber-500/30 transition shadow-[0_0_15px_rgba(245,158,11,0.2)]">15m</button>
             <button onClick={() => setBreakEndTime(null)} className="px-4 py-1.5 rounded-lg bg-slate-800 text-slate-300 font-bold text-sm border border-slate-700 hover:bg-slate-700 transition ml-2 tracking-wide uppercase">End Break</button>
          </div>
        </div>

        {/* COLUMN 3: Tasks */}
        <div className="col-span-3 flex flex-col h-full bg-slate-900/40 backdrop-blur-sm rounded-2xl border border-slate-800/80 shadow-xl overflow-hidden relative">
          <div className="bg-amber-500/10 p-5 shrink-0 border-b border-white/5">
            <h2 className="text-xl font-semibold text-white flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-amber-400" /> Active Tasks
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
            {activeTasks.length === 0 ? (
              <div className="h-full flex items-center justify-center text-slate-500 text-base font-medium">No active tasks.</div>
            ) : (
               activeTasks.map((t) => (
                  <div key={t.$id} className="bg-white/5 border border-white/5 rounded-xl p-4">
                     <h3 className="text-base font-semibold text-slate-100 line-clamp-2">{t.title}</h3>
                     <div className="mt-3 flex flex-col gap-2">
                        <div className="flex flex-wrap gap-1">
                          {t.assigneeNames ? (
                            t.assigneeNames.split(',').map((name: string, i: number) => (
                              <span key={i} className="text-[10px] font-bold uppercase tracking-wider bg-primary/20 text-primary px-2 py-0.5 rounded-md border border-primary/30">
                                @{name.trim()}
                              </span>
                            ))
                          ) : (
                            <span className="text-[10px] font-bold uppercase tracking-wider bg-primary/20 text-primary px-2 py-0.5 rounded-md border border-primary/30">
                              @{t.assigneeName}
                            </span>
                          )}
                        </div>
                        <span className={`text-[10px] w-max font-bold px-2.5 py-1 rounded-md uppercase tracking-widest ${t.status === 'in_progress' ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-800 text-slate-400'}`}>
                           {t.status === 'in_progress' ? 'WORKING' : 'TO-DO'}
                        </span>
                     </div>
                  </div>
               ))
            )}
          </div>
        </div>

      </div>

      {/* Welcome Popup Overlay */}
      <AnimatePresence>
        {showWelcome && welcomeMember && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-10"
          >
            <motion.div 
              initial={{ scale: 0.8, y: 40, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.9, y: 20, opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="w-full max-w-5xl aspect-video glass-card relative overflow-hidden flex flex-col items-center justify-center text-center p-16 border-2 border-primary/50"
            >
              {/* Animated Background Elements */}
              <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-24 -left-24 w-64 h-64 bg-primary/20 rounded-full blur-[100px] animate-pulse" />
                <div className="absolute -bottom-24 -right-24 w-64 h-64 bg-blue-500/20 rounded-full blur-[100px] animate-pulse" />
              </div>

              <motion.div 
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2, type: "spring" }}
                className="h-24 w-24 bg-primary rounded-full flex items-center justify-center mb-10 shadow-[0_0_50px_rgba(59,130,246,0.6)]"
              >
                <Sparkles className="h-12 w-12 text-white" />
              </motion.div>

              <motion.h1 
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="text-7xl font-black text-white mb-6 uppercase tracking-tight"
              >
                Welcome, {welcomeMember.name}!
              </motion.h1>

              <motion.div 
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="h-1 w-32 bg-primary rounded-full mb-8"
              />

              <motion.p 
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="text-4xl text-slate-300 font-medium italic max-w-3xl leading-relaxed"
              >
                "{welcomeMember.quote}"
              </motion.p>

              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.5 }}
                className="absolute bottom-12 text-slate-500 font-bold uppercase tracking-[0.5em] text-sm"
              >
                System Verified
              </motion.div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Audio Unlock Overlay (Browser Requirement) */}
      <AnimatePresence>
        {!audioEnabled && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/80 backdrop-blur-xl"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="text-center p-12 bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl max-w-lg"
            >
              <Users className="h-16 w-16 text-blue-500 mx-auto mb-6" />
              <h2 className="text-3xl font-bold text-white mb-4">TV Dashboard Ready</h2>
              <p className="text-slate-400 mb-8 text-lg">
                Click the button below to synchronize live data and enable the voice announcement system.
              </p>
              <Button 
                onClick={() => {
                  sessionStorage.setItem("tv_audio_enabled", "true");
                  setAudioEnabled(true);
                  toast.success("Audio Unlocked Successfully!");
                }} 
                className="w-full h-16 text-xl font-bold uppercase tracking-widest shadow-lg shadow-blue-500/20"
              >
                Launch Dashboard
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
