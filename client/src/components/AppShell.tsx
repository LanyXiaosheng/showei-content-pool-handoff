import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  BookOpen,
  ChevronRight,
  ClipboardCheck,
  FileText,
  FolderLock,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  Plus,
  Settings2,
  ShieldCheck,
  Sparkles,
  Upload,
  Users,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { api } from '@/api/client';
import type { NotificationItem } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { Badge, Button, IconButton } from '@/components/ui';
import { ROLE_LABEL, fromNow } from '@/lib/format';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  roles: Array<'ADMIN' | 'AGENT' | 'USER'>;
  end?: boolean;
}

const navGroups: Array<{ label: string; items: NavItem[] }> = [
  {
    label: '内容与任务',
    items: [
      { to: '/', label: '工作台', icon: <LayoutDashboard size={17} />, roles: ['ADMIN', 'AGENT', 'USER'], end: true },
      { to: '/pool', label: '公共内容池', icon: <Sparkles size={17} />, roles: ['ADMIN', 'AGENT', 'USER'] },
      { to: '/library', label: '我的领取', icon: <FolderLock size={17} />, roles: ['AGENT', 'USER'] },
      { to: '/tasks/new', label: '提交素材任务', icon: <Upload size={17} />, roles: ['AGENT', 'USER'] },
      { to: '/tasks', label: '任务记录', icon: <ListChecks size={17} />, roles: ['AGENT', 'USER'] },
      { to: '/review', label: '任务审核', icon: <ClipboardCheck size={17} />, roles: ['ADMIN'] },
      { to: '/tasks', label: '全部任务', icon: <FileText size={17} />, roles: ['ADMIN'] },
      { to: '/content', label: '内容管理', icon: <BookOpen size={17} />, roles: ['ADMIN'] },
    ],
  },
  {
    label: '组织与权限',
    items: [
      { to: '/users', label: '用户与代理', icon: <Users size={17} />, roles: ['ADMIN'] },
      { to: '/team', label: '我的团队', icon: <Users size={17} />, roles: ['AGENT'] },
      { to: '/invites', label: '邀请码', icon: <KeyRound size={17} />, roles: ['ADMIN', 'AGENT'] },
    ],
  },
  {
    label: '系统设置',
    items: [
      { to: '/prompts', label: 'Prompt 模板', icon: <ShieldCheck size={17} />, roles: ['ADMIN'] },
      { to: '/settings', label: 'API 接入', icon: <Settings2 size={17} />, roles: ['ADMIN'] },
      { to: '/logs', label: '运行日志', icon: <FileText size={17} />, roles: ['ADMIN'] },
      { to: '/account', label: '账户设置', icon: <KeyRound size={17} />, roles: ['ADMIN', 'AGENT', 'USER'] },
    ],
  },
];

const routeNames: Array<[RegExp, string]> = [
  [/^\/$/, '工作台'],
  [/^\/pool/, '公共内容池'],
  [/^\/library/, '我的领取'],
  [/^\/tasks\/new/, '提交素材任务'],
  [/^\/tasks\/[^/]+/, '任务详情'],
  [/^\/tasks/, '任务记录'],
  [/^\/review/, '任务审核'],
  [/^\/content/, '内容管理'],
  [/^\/users/, '用户与代理'],
  [/^\/team/, '我的团队'],
  [/^\/invites/, '邀请码'],
  [/^\/prompts/, 'Prompt 模板'],
  [/^\/settings/, 'API 接入'],
  [/^\/logs/, '运行日志'],
  [/^\/account/, '账户设置'],
];

function routeName(pathname: string): string {
  return routeNames.find(([pattern]) => pattern.test(pathname))?.[1] ?? '拾味内容中台';
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ items: NotificationItem[]; unreadCount: number }>('/notifications?limit=8'),
    refetchInterval: 20_000,
  });
  const markAll = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const markOne = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  useEffect(() => {
    if (!open) return;
    const listener = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', listener);
    return () => window.removeEventListener('mousedown', listener);
  }, [open]);

  const unread = notifications.data?.unreadCount ?? 0;
  return (
    <div className="notify" ref={panelRef}>
      <button className="notify__trigger" aria-label="通知" onClick={() => setOpen((value) => !value)}>
        <Bell size={18} />
        {unread > 0 ? <span className="notify__dot">{unread > 9 ? '9+' : unread}</span> : null}
      </button>
      {open ? (
        <div className="notify__panel">
          <div className="notify__head">
            <div>
              <span className="eyebrow">NOTIFICATIONS</span>
              <strong>消息通知</strong>
            </div>
            {unread > 0 ? (
              <button className="text-button" onClick={() => markAll.mutate()} disabled={markAll.isPending}>
                全部已读
              </button>
            ) : null}
          </div>
          <div className="notify__list">
            {notifications.data?.items.length ? notifications.data.items.map((item) => (
              <button
                key={item.id}
                className={clsx('notify__item', !item.readAt && 'is-unread')}
                onClick={() => {
                  if (!item.readAt) markOne.mutate(item.id);
                  if (item.taskId) navigate(`/tasks/${item.taskId}`);
                  setOpen(false);
                }}
              >
                <span className="notify__kind">{item.kind === 'TASK_REVIEW' ? '审核' : item.kind === 'TASK_REJECTED' ? '驳回' : item.kind === 'TASK_COMPLETED' ? '入池' : '系统'}</span>
                <span className="notify__body">
                  <strong>{item.title}</strong>
                  <span>{item.body}</span>
                  <time>{fromNow(item.createdAt)}</time>
                </span>
              </button>
            )) : (
              <div className="notify__empty">暂时没有新消息</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function AppShell() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  if (!user) return null;
  const title = routeName(location.pathname);
  const initials = user.displayName.slice(0, 1);

  return (
    <div className="app">
      <div className={clsx('sidebar-scrim', mobileOpen && 'is-visible')} onClick={() => setMobileOpen(false)} />
      <aside className={clsx('sidebar', mobileOpen && 'is-open')}>
        <div className="sidebar__brand">
          <div className="brand-seal" aria-hidden>拾</div>
          <div>
            <strong>拾味</strong>
            <span>内容中台</span>
          </div>
          <IconButton className="sidebar__close" aria-label="关闭导航" onClick={() => setMobileOpen(false)}>
            <X size={18} />
          </IconButton>
        </div>
        <p className="sidebar__tagline">探店素材变体 · 审核 · 独占领取</p>
        <nav className="sidebar__nav">
          {navGroups.map((group) => {
            const items = group.items.filter((item) => item.roles.includes(user.role));
            if (!items.length) return null;
            return (
              <div className="nav-group" key={group.label}>
                <span className="nav-group__label">{group.label}</span>
                {items.map((item) => (
                  <NavLink
                    key={`${item.to}-${item.label}`}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) => clsx('nav-link', isActive && 'is-active')}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                    <ChevronRight size={14} className="nav-link__chevron" />
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="sidebar__cta">
          {user.role !== 'ADMIN' ? (
            <Button variant="primary" size="sm" onClick={() => navigate('/tasks/new')}>
              <Plus size={15} /> 新建素材任务
            </Button>
          ) : (
            <Button variant="primary" size="sm" onClick={() => navigate('/review')}>
              <ClipboardCheck size={15} /> 去审核任务
            </Button>
          )}
        </div>
        <div className="sidebar__foot">
          <button className="sidebar-user" onClick={() => navigate('/account')}>
            <span className="avatar">{initials}</span>
            <span className="sidebar-user__meta">
              <strong>{user.displayName}</strong>
              <span>{ROLE_LABEL[user.role]}{user.role === 'AGENT' && !user.inviteEnabled ? ' · 邀请已停' : ''}</span>
            </span>
          </button>
          <button
            className="sidebar-logout"
            title="退出登录"
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar__left">
            <IconButton className="topbar__menu" aria-label="打开导航" onClick={() => setMobileOpen(true)}>
              <Menu size={20} />
            </IconButton>
            <div className="topbar__crumb">
              <span>拾味内容中台</span>
              <i>/</i>
              <strong>{title}</strong>
            </div>
          </div>
          <div className="topbar__right">
            <Badge tone={user.role === 'ADMIN' ? 'red' : user.role === 'AGENT' ? 'green' : 'neutral'}>
              {ROLE_LABEL[user.role]}
            </Badge>
            <span className="topbar__date">
              {new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', weekday: 'short' }).format(new Date())}
            </span>
            <NotificationBell />
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
        <footer className="app-foot">
          <span>拾味内容中台 · 素材变体不保证平台审核通过，分发合规由使用者自行承担。</span>
          <span>仅管理员可访问底层 Prompt 与 API 配置</span>
        </footer>
      </div>
    </div>
  );
}
