import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface AttendanceCalendarProps {
  data: Record<string, "present" | "absent">;
}

export default function AttendanceCalendar({ data }: AttendanceCalendarProps) {
  const current = new Date();
  const [currentMonth, setCurrentMonth] = useState(new Date(current.getFullYear(), current.getMonth(), 1));

  const { days, startDay, daysInMonth } = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const dim = new Date(year, month + 1, 0).getDate();
    const sd = new Date(year, month, 1).getDay();
    const daysArr = Array.from({ length: dim }, (_, i) => {
      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`;
      return { day: i + 1, date: dateStr, status: data[dateStr] || null };
    });
    return { days: daysArr, startDay: sd, daysInMonth: dim };
  }, [currentMonth, data]);

  // Native system today tracker
  const todayD = new Date();
  const today = `${todayD.getFullYear()}-${String(todayD.getMonth() + 1).padStart(2, "0")}-${String(todayD.getDate()).padStart(2, "0")}`;
  const monthName = currentMonth.toLocaleString("default", { month: "long", year: "numeric" });

  const prevMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));

  return (
    <div className="glass-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Attendance Calendar</h3>
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-xs font-medium text-foreground min-w-[120px] text-center">{monthName}</span>
          <button onClick={nextMonth} className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="mb-3 flex gap-4">
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-success" />
          <span className="text-[10px] text-muted-foreground">Present</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-absent" />
          <span className="text-[10px] text-muted-foreground">Absent</span>
        </div>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="text-center text-[10px] font-medium text-muted-foreground py-1">{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: startDay }).map((_, i) => (
          <div key={`empty-${i}`} />
        ))}
        {days.map((d) => {
          const isToday = d.date === today;
          return (
            <motion.div
              key={d.date}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: d.day * 0.01 }}
              className={cn(
                "relative flex h-9 w-full items-center justify-center rounded-md text-xs font-medium transition-all cursor-default",
                isToday && "ring-2 ring-primary ring-offset-1 ring-offset-background",
                d.status === "present" && "bg-success/15 text-success",
                d.status === "absent" && "bg-absent/15 text-absent",
                !d.status && "text-muted-foreground"
              )}
            >
              {d.day}
              {d.status && (
                <div className={cn(
                  "absolute bottom-1 h-1 w-1 rounded-full",
                  d.status === "present" ? "bg-success" : "bg-absent"
                )} />
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
