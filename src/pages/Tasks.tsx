import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { databases } from "@/lib/appwrite";
import { ID, Query } from "appwrite";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ClipboardList, Plus, Trash2, Edit, Clock, CheckCircle2, Calendar as CalendarIcon, Check, ArrowLeft } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";

export default function Tasks() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form State
  const [title, setTitle] = useState("");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [status, setStatus] = useState("todo");
  const [priority, setPriority] = useState("medium");
  const [points, setPoints] = useState(10);
  const [deadline, setDeadline] = useState<Date | undefined>(undefined);
  const [deadlineTime, setDeadlineTime] = useState("23:59");

  const fetchData = async () => {
    try {
      setLoading(true);
      const dbId = import.meta.env.VITE_APPWRITE_DATABASE_ID || "main_db";
      const [tasksRes, membersRes] = await Promise.all([
        databases.listDocuments(dbId, "club_tasks", [Query.orderDesc("$createdAt")]),
        databases.listDocuments(dbId, import.meta.env.VITE_APPWRITE_COLLECTION_ID || "members", [Query.limit(500)])
      ]);
      setTasks(tasksRes.documents);
      setMembers(membersRes.documents.filter((m: any) => m.isActive !== false && m.role !== "super_admin"));
    } catch (err) {
      console.error("Failed to load tasks", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || assigneeIds.length === 0) return toast.error("Please fill all required fields, including at least one assignee.");

    setIsSubmitting(true);
    try {
      const dbId = import.meta.env.VITE_APPWRITE_DATABASE_ID || "main_db";
      const assignedMembers = members.filter(m => assigneeIds.includes(m.$id));
      
      let finalDeadlineISO = null;
      if (deadline) {
        const d = new Date(deadline);
        const [hours, minutes] = deadlineTime.split(':').map(Number);
        d.setHours(hours, minutes, 0, 0);
        finalDeadlineISO = d.toISOString();
      }

      const newDoc = await databases.createDocument(dbId, "club_tasks", ID.unique(), {
        title,
        assigneeId: assigneeIds[0] || "group_task", // Legacy fallback
        assigneeName: assignedMembers.length > 1 ? "Multiple Members" : (assignedMembers[0]?.name || "Unknown"),
        assigneeIds: assigneeIds.join(','),
        assigneeNames: assignedMembers.map(m => m.name).join(', '),
        status,
        priority,
        points: Number(points),
        deadline: finalDeadlineISO
      });

      setTasks([newDoc, ...tasks]);
      toast.success("Task created successfully!");
      setDialogOpen(false);
      
      // Reset form
      setTitle(""); setAssigneeIds([]); setStatus("todo"); setPriority("medium"); setPoints(10); setDeadline(undefined); setDeadlineTime("23:59");
    } catch (err: any) {
      toast.error(err.message || "Failed to create task");
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateTaskStatus = async (docId: string, newStatus: string) => {
    try {
      const dbId = import.meta.env.VITE_APPWRITE_DATABASE_ID || "main_db";
      const updated = await databases.updateDocument(dbId, "club_tasks", docId, { status: newStatus });
      setTasks(tasks.map(t => t.$id === docId ? updated : t));
      toast.success("Task status updated");
    } catch (err) {
      toast.error("Failed to update status");
    }
  };

  const deleteTask = async (docId: string) => {
    if (!window.confirm("Delete this task?")) return;
    try {
      const dbId = import.meta.env.VITE_APPWRITE_DATABASE_ID || "main_db";
      await databases.deleteDocument(dbId, "club_tasks", docId);
      setTasks(tasks.filter(t => t.$id !== docId));
      toast.success("Task removed");
    } catch (err) {
      toast.error("Failed to delete task");
    }
  };

  const getPriorityColor = (p: string) => {
    if (p === "high") return "text-destructive bg-destructive/10";
    if (p === "medium") return "text-warning bg-warning/10";
    return "text-success bg-success/10";
  };

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

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground flex items-center gap-2 uppercase tracking-tight">
            <ClipboardList className="h-6 w-6 text-primary" /> Club Tasks
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Manage project assignments and to-dos for the club.</p>
        </div>
        
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="flex items-center gap-2 font-bold px-6 py-4 rounded-xl shadow-lg hover:shadow-primary/30 active:scale-95 transition-all bg-gradient-to-br from-primary via-primary to-blue-700 border-none group">
              <Plus className="h-5 w-5 group-hover:rotate-90 transition-transform duration-300" /> 
              Delegate Mission
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border sm:max-w-md">
            <form onSubmit={handleSubmit}>
              <DialogHeader>
                <DialogTitle>Assign New Task</DialogTitle>
                <DialogDescription>Delegate a project assignment to a specific club member.</DialogDescription>
              </DialogHeader>
              
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Task Title</label>
                  <Input placeholder="e.g. Solder Power Distribution PCB" value={title} onChange={(e) => setTitle(e.target.value)} required className="bg-background"/>
                </div>
                
                <div className="space-y-3">
                  <label className="text-sm font-semibold flex items-center justify-between">
                    Assign To 
                    <span className="text-[10px] bg-secondary px-2 py-0.5 rounded text-muted-foreground uppercase tracking-widest">{assigneeIds.length} Selected</span>
                  </label>
                  <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto p-1 custom-scrollbar">
                    {members.map(m => {
                      const isSelected = assigneeIds.includes(m.$id);
                      return (
                        <button
                          key={m.$id}
                          type="button"
                          onClick={() => {
                            if (isSelected) setAssigneeIds(assigneeIds.filter(id => id !== m.$id));
                            else setAssigneeIds([...assigneeIds, m.$id]);
                          }}
                          className={cn(
                            "flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all duration-300 text-[10px] font-black uppercase tracking-widest",
                            isSelected 
                              ? "bg-primary border-primary text-primary-foreground shadow-[0_4px_12px_rgba(var(--primary),0.4)] scale-105 z-10" 
                              : "bg-background border-border text-muted-foreground hover:border-primary/50 hover:text-foreground hover:bg-muted/30"
                          )}
                        >
                          {isSelected ? (
                            <Check className="h-3 w-3 animate-in zoom-in duration-300" />
                          ) : (
                            <div className="h-3 w-3 rounded-full bg-muted-foreground/20 flex items-center justify-center text-[7px]">
                              {m.name[0]}
                            </div>
                          )}
                          {m.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
                
                <div className="flex gap-4">
                  <div className="space-y-2 flex-1">
                    <label className="text-sm font-medium">Priority</label>
                    <div className="flex bg-background border border-input rounded-md p-1 h-10 w-full gap-1">
                      <button type="button" onClick={() => setPriority('low')} className={`flex-1 text-sm rounded-sm transition-colors ${priority === 'low' ? 'bg-primary/20 text-primary font-bold' : 'text-muted-foreground hover:bg-muted/50'}`}>Low</button>
                      <button type="button" onClick={() => setPriority('medium')} className={`flex-1 text-sm rounded-sm transition-colors ${priority === 'medium' ? 'bg-warning/20 text-warning font-bold' : 'text-muted-foreground hover:bg-muted/50'}`}>Med</button>
                      <button type="button" onClick={() => setPriority('high')} className={`flex-1 text-sm rounded-sm transition-colors ${priority === 'high' ? 'bg-destructive/20 text-destructive font-bold' : 'text-muted-foreground hover:bg-muted/50'}`}>High</button>
                    </div>
                  </div>
                  <div className="space-y-2 flex-1">
                    <label className="text-sm font-medium">Initial Status</label>
                    <div className="flex bg-background border border-input rounded-md p-1 h-10 w-full gap-1">
                      <button type="button" onClick={() => setStatus('todo')} className={`flex-1 text-sm rounded-sm transition-colors ${status === 'todo' ? 'bg-primary text-primary-foreground font-bold' : 'text-muted-foreground hover:bg-muted/50'}`}>To Do</button>
                      <button type="button" onClick={() => setStatus('in_progress')} className={`flex-1 text-sm rounded-sm transition-colors ${status === 'in_progress' ? 'bg-warning text-warning-foreground font-bold' : 'text-muted-foreground hover:bg-muted/50'}`}>Working</button>
                      <button type="button" onClick={() => setStatus('done')} className={`flex-1 text-sm rounded-sm transition-colors ${status === 'done' ? 'bg-emerald-600 text-white font-bold' : 'text-muted-foreground hover:bg-muted/50'}`}>Done</button>
                    </div>
                  </div>
                </div>
                <div className="flex gap-4 mt-4">
                  <div className="space-y-2 flex-1">
                    <label className="text-sm font-medium text-warning">Bounty Points</label>
                    <Input type="number" min="0" max="1000" value={points} onChange={(e) => setPoints(Number(e.target.value))} required className="bg-background"/>
                  </div>
                  <div className="space-y-2 flex-1 relative">
                    <label className="text-sm font-medium text-destructive flex items-center gap-1.5">
                      <CalendarIcon className="h-3.5 w-3.5" /> Strict Deadline
                    </label>
                    <div className="flex gap-2">
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button 
                            type="button"
                            variant="outline" 
                            className={cn(
                              "w-full justify-start text-left font-normal bg-background border-border hover:bg-muted/50 transition-all",
                              !deadline && "text-muted-foreground"
                            )}
                          >
                            <CalendarIcon className="mr-2 h-4 w-4 text-destructive/70" />
                            {deadline ? format(deadline, "PPP") : <span>Pick a date</span>}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0 border-border bg-card shadow-2xl" align="start">
                          <Calendar
                            mode="single"
                            selected={deadline}
                            onSelect={(date) => setDeadline(date)}
                            initialFocus
                            className="bg-card"
                          />
                        </PopoverContent>
                      </Popover>
                      
                      <div className="relative w-32">
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button 
                              type="button"
                              variant="outline"
                              className="w-full justify-start text-left font-bold bg-background border-border hover:bg-muted/50 [color-scheme:dark] pl-8 text-xs"
                            >
                              <Clock className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground mr-2" />
                              {deadlineTime}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-64 p-3 border-border bg-card shadow-2xl" align="end">
                            <div className="space-y-4">
                              <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Hour (24h)</label>
                                <div className="grid grid-cols-6 gap-1">
                                  {Array.from({ length: 24 }).map((_, i) => {
                                    const h = i.toString().padStart(2, '0');
                                    const isSelected = deadlineTime.split(':')[0] === h;
                                    return (
                                      <button
                                        key={h}
                                        type="button"
                                        onClick={() => setDeadlineTime(`${h}:${deadlineTime.split(':')[1]}`)}
                                        className={cn(
                                          "h-8 w-full rounded text-[10px] font-bold transition-all",
                                          isSelected 
                                            ? "bg-primary text-primary-foreground shadow-lg scale-110 z-10" 
                                            : "hover:bg-muted text-muted-foreground"
                                        )}
                                      >
                                        {h}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                              <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Minute</label>
                                <div className="grid grid-cols-4 gap-1">
                                  {['00', '15', '30', '45'].map((m) => {
                                    const isSelected = deadlineTime.split(':')[1] === m;
                                    return (
                                      <button
                                        key={m}
                                        type="button"
                                        onClick={() => setDeadlineTime(`${deadlineTime.split(':')[0]}:${m}`)}
                                        className={cn(
                                          "h-8 w-full rounded text-[10px] font-bold transition-all",
                                          isSelected 
                                            ? "bg-primary text-primary-foreground shadow-lg scale-110 z-10" 
                                            : "hover:bg-muted text-muted-foreground"
                                        )}
                                      >
                                        {m}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                              <div className="pt-2 border-t border-border flex justify-between items-center">
                                <span className="text-[10px] font-medium text-muted-foreground italic">Quick click to set</span>
                                <Button 
                                  type="button" 
                                  variant="ghost" 
                                  size="sm" 
                                  className="h-6 px-2 text-[10px] font-bold"
                                  onClick={() => setDeadlineTime("23:59")}
                                >
                                  End of Day (23:59)
                                </Button>
                              </div>
                            </div>
                          </PopoverContent>
                        </Popover>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              
              <DialogFooter>
                <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto font-bold uppercase tracking-widest gap-2 bg-gradient-to-r from-primary to-blue-600 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-[0_0_20px_rgba(var(--primary),0.3)]">
                  {isSubmitting ? "Locking In..." : (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      Assign Mission
                    </>
                  )}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center glass-card">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-surface-2 text-muted-foreground">
            <ClipboardList className="h-8 w-8" />
          </div>
          <h3 className="text-lg font-medium text-foreground">No Tasks Yet</h3>
          <p className="mt-2 text-sm text-muted-foreground">Start delegating project tasks to your team.</p>
        </div>
      ) : (
        <div className="glass-card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/50 bg-muted/20">
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Task</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Assignee</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-warning">Bounty</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-destructive">Deadline</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Priority</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task, i) => (
                <motion.tr
                  key={task.$id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.05 }}
                  className="border-b border-border/30 transition-colors hover:bg-accent/30"
                >
                  <td className="px-5 py-4">
                    <span className="font-medium text-foreground block">{task.title}</span>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex flex-col gap-1 items-start">
                      {task.assigneeNames ? (
                         task.assigneeNames.split(',').map((name: string, idx: number) => (
                           <div key={idx} className="flex items-center gap-2">
                             <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[9px] font-bold text-primary uppercase border border-primary/20">
                               {name.trim()[0]}
                             </div>
                             <span className="text-xs font-semibold text-muted-foreground">{name.trim()}</span>
                           </div>
                         ))
                      ) : (
                         <div className="flex items-center gap-2">
                           <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary uppercase">
                             {task.assigneeName[0]}
                           </div>
                           <span className="text-sm text-muted-foreground">{task.assigneeName}</span>
                         </div>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex flex-col items-start gap-1">
                      <span className="text-sm font-black text-warning">+{task.points || 0} XP</span>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <span className={`text-xs font-bold ${task.deadline && new Date(task.deadline) < new Date() && task.status !== 'done' ? 'text-destructive animate-pulse' : 'text-muted-foreground'}`}>
                      {task.deadline ? new Date(task.deadline).toLocaleDateString() : 'N/A'}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium uppercase tracking-wider ${getPriorityColor(task.priority)}`}>
                      {task.priority}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex bg-muted/40 rounded-md p-1 w-max border border-border/50 gap-1">
                       <button onClick={() => updateTaskStatus(task.$id, 'todo')} className={`px-2.5 py-1 text-xs rounded transition-colors font-semibold ${task.status === 'todo' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}>To Do</button>
                       <button onClick={() => updateTaskStatus(task.$id, 'in_progress')} className={`px-2.5 py-1 text-xs rounded transition-colors font-semibold ${task.status === 'in_progress' ? 'bg-amber-500 text-amber-950' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}>Working</button>
                       <button onClick={() => updateTaskStatus(task.$id, 'done')} className={`px-2.5 py-1 text-xs rounded transition-colors font-semibold ${task.status === 'done' ? 'bg-emerald-500 text-emerald-950' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}>Done</button>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => deleteTask(task.$id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DashboardLayout>
  );
}
