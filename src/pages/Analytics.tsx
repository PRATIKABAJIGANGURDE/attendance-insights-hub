import { motion } from "framer-motion";
import DashboardLayout from "@/components/DashboardLayout";
import { mockMonthlyTrend, mockMembers, mockWeeklyAttendance } from "@/data/mockData";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from "recharts";

export default function Analytics() {
  const sortedMembers = [...mockMembers]
    .filter((m) => m.isActive)
    .sort((a, b) => b.attendancePercent - a.attendancePercent);

  return (
    <DashboardLayout>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-foreground">Analytics</h2>
        <p className="mt-1 text-sm text-muted-foreground">Attendance insights and trends.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Trend Chart */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-5">
          <h3 className="mb-4 text-sm font-semibold text-foreground">Attendance Trend</h3>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={mockMonthlyTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(225, 12%, 18%)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(215, 15%, 50%)" }} />
              <YAxis tick={{ fontSize: 10, fill: "hsl(215, 15%, 50%)" }} domain={[0, 100]} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(225, 14%, 11%)",
                  border: "1px solid hsl(225, 12%, 18%)",
                  borderRadius: "8px",
                  fontSize: "12px",
                  color: "hsl(210, 20%, 92%)",
                }}
              />
              <Line type="monotone" dataKey="rate" stroke="hsl(217, 91%, 60%)" strokeWidth={2} dot={{ fill: "hsl(217, 91%, 60%)", r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </motion.div>

        {/* Weekly Chart */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-card p-5">
          <h3 className="mb-4 text-sm font-semibold text-foreground">Weekly Pattern</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={mockWeeklyAttendance}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(225, 12%, 18%)" />
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: "hsl(215, 15%, 50%)" }} />
              <YAxis tick={{ fontSize: 10, fill: "hsl(215, 15%, 50%)" }} domain={[0, 100]} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(225, 14%, 11%)",
                  border: "1px solid hsl(225, 12%, 18%)",
                  borderRadius: "8px",
                  fontSize: "12px",
                  color: "hsl(210, 20%, 92%)",
                }}
              />
              <Bar dataKey="rate" fill="hsl(152, 69%, 45%)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </motion.div>

        {/* Member Ranking */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass-card p-5 lg:col-span-2">
          <h3 className="mb-4 text-sm font-semibold text-foreground">Member Reliability Ranking</h3>
          <div className="space-y-3">
            {sortedMembers.map((m, i) => (
              <div key={m.id} className="flex items-center gap-4">
                <span className="w-6 text-center text-xs font-bold text-muted-foreground">#{i + 1}</span>
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                  {m.name.split(" ").map((n) => n[0]).join("")}
                </div>
                <span className="w-32 text-sm font-medium text-foreground">{m.name}</span>
                <div className="flex-1">
                  <div className="h-2 rounded-full bg-surface-3">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${m.attendancePercent}%` }}
                      transition={{ duration: 0.6, delay: i * 0.05 }}
                      className="h-2 rounded-full bg-primary"
                    />
                  </div>
                </div>
                <span className="w-12 text-right text-xs font-semibold text-foreground">{m.attendancePercent}%</span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </DashboardLayout>
  );
}
