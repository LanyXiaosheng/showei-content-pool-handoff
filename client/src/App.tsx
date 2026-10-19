import { useEffect, type ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { AppShell } from '@/components/AppShell';
import type { Role } from '@/api/types';
import { Login } from '@/pages/Login';
import { Register } from '@/pages/Register';
import { Dashboard } from '@/pages/Dashboard';
import { Tasks } from '@/pages/Tasks';
import { NewTask } from '@/pages/NewTask';
import { TaskDetail } from '@/pages/TaskDetail';
import { Review } from '@/pages/Review';
import { Pool } from '@/pages/Pool';
import { Library } from '@/pages/Library';
import { AdminContent } from '@/pages/AdminContent';
import { Users } from '@/pages/Users';
import { Team } from '@/pages/Team';
import { Invites } from '@/pages/Invites';
import { Prompts } from '@/pages/Prompts';
import { Settings } from '@/pages/Settings';
import { Logs } from '@/pages/Logs';
import { Account } from '@/pages/Account';
import { AccessDenied } from '@/pages/AccessDenied';
import { NotFound } from '@/pages/NotFound';

function ScrollToTop() {
  const location = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [location.pathname]);
  return null;
}

function ProtectedShell() {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) {
    return (
      <div className="boot">
        <div className="brand-seal">拾</div>
        <Loader2 className="spin" size={18} />
        <span>正在打开内容中台…</span>
      </div>
    );
  }
  if (!user) {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }
  return <AppShell />;
}

function RoleRoute({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role)) return <AccessDenied />;
  return <>{children}</>;
}

export function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route element={<ProtectedShell />}>
          <Route index element={<Dashboard />} />
          <Route path="pool" element={<Pool />} />
          <Route path="library" element={<RoleRoute roles={['AGENT', 'USER']}><Library /></RoleRoute>} />
          <Route path="tasks" element={<Tasks />} />
          <Route path="tasks/new" element={<RoleRoute roles={['AGENT', 'USER']}><NewTask /></RoleRoute>} />
          <Route path="tasks/:id" element={<TaskDetail />} />
          <Route path="review" element={<RoleRoute roles={['ADMIN']}><Review /></RoleRoute>} />
          <Route path="content" element={<RoleRoute roles={['ADMIN']}><AdminContent /></RoleRoute>} />
          <Route path="users" element={<RoleRoute roles={['ADMIN']}><Users /></RoleRoute>} />
          <Route path="team" element={<RoleRoute roles={['AGENT']}><Team /></RoleRoute>} />
          <Route path="invites" element={<RoleRoute roles={['ADMIN', 'AGENT']}><Invites /></RoleRoute>} />
          <Route path="prompts" element={<RoleRoute roles={['ADMIN']}><Prompts /></RoleRoute>} />
          <Route path="settings" element={<RoleRoute roles={['ADMIN']}><Settings /></RoleRoute>} />
          <Route path="logs" element={<RoleRoute roles={['ADMIN']}><Logs /></RoleRoute>} />
          <Route path="account" element={<Account />} />
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
