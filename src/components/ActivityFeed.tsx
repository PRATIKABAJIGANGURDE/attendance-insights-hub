import { motion } from "framer-motion";
import { ActivityEvent } from "@/types/models";
import { Fingerprint, Shield, Cpu } from "lucide-react";
import { cn } from "@/lib/utils";

const iconMap: Record<string, any> = {
  attendance: Fingerprint,
  admin: Shield,
  system: Cpu,
};

const dotColor: Record<string, string> = {
  attendance: "bg-success",
  admin: "bg-primary",
  system: "bg-warning",
};

export default function ActivityFeed({ events }: { events: ActivityEvent[] }) {
  return (
    <div className="glass-card p-5">
      <h3 className="mb-4 text-sm font-semibold text-foreground">Live Activity</h3>
      <div className="space-y-3">
        {events.map((event, i) => {
          const Icon = iconMap[event.eventType] || Cpu;
          return (
            <motion.div
              key={event.$id}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: i * 0.05 }}
              className="flex items-start gap-3"
            >
              <div className="relative mt-0.5">
                <div className={cn("h-2 w-2 rounded-full", dotColor[event.eventType] || "bg-gray-500")} />
                {event.eventType === "attendance" && (
                  <div className={cn("absolute inset-0 h-2 w-2 rounded-full animate-pulse-dot", dotColor[event.eventType])} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate text-xs text-foreground">{event.message}</p>
                <p className="text-[10px] text-muted-foreground">
                  {event.$createdAt ? new Date(event.$createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : event.eventTime}
                </p>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
