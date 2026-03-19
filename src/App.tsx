import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import Members from "./pages/Members";
import MemberProfile from "./pages/MemberProfile";
import Analytics from "./pages/Analytics";
import DeviceManagement from "./pages/DeviceManagement";
import NotFound from "./pages/NotFound";
import Login from "./pages/Login";
import SuperAdminRegister from "./pages/SuperAdminRegister";
import Register from "./pages/Register";
import Approvals from "./pages/Approvals";
import ProtectedRoute from "./components/ProtectedRoute";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          {/* Public Routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/admin-register" element={<SuperAdminRegister />} />
          <Route path="*" element={<NotFound />} />

          {/* Admin-Only Routes */}
          <Route element={<ProtectedRoute adminOnly />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/approvals" element={<Approvals />} />
            <Route path="/members" element={<Members />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/device" element={<DeviceManagement />} />
          </Route>

          {/* General Protected Route (Both User and Admin) */}
          <Route element={<ProtectedRoute />}>
            <Route path="/members/:id" element={<MemberProfile />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
