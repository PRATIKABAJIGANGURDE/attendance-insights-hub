import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

interface AttendanceRow {
  memberName: string;
  role: string;
  timestamp: string;
  status: "present" | "absent";
}

export default function AttendanceTable({ rows }: { rows: AttendanceRow[] }) {
  return (
    <div className="glass-card overflow-hidden">
      <div className="border-b border-border px-5 py-4">
        <h3 className="text-sm font-semibold text-foreground">Today's Attendance</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border/50">
              <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Name</th>
              <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
              <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Time</th>
              <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Role</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <motion.tr
                key={row.memberName}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.05 }}
                className="border-b border-border/30 transition-colors hover:bg-accent/50"
              >
                <td className="px-5 py-3 text-sm font-medium text-foreground">{row.memberName}</td>
                <td className="px-5 py-3">
                  <span className={cn(
                    "inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold",
                    row.status === "present" ? "status-present" : "status-absent"
                  )}>
                    {row.status === "present" ? "Present" : "Absent"}
                  </span>
                </td>
                <td className="px-5 py-3 text-xs text-muted-foreground">
                  {row.status === "present" 
                    ? new Date(row.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                    : "—"
                  }
                </td>
                <td className="px-5 py-3">
                  <Badge variant="outline" className="text-[10px] font-medium">{row.role}</Badge>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
