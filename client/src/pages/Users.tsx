import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, KeyRound, Plus, Search, ShieldBan, ShieldCheck, UserCog, Users as UsersIcon } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, api, buildQuery } from '@/api/client';
import type { AdminUser, Pagination, Role } from '@/api/types';
import {
  Button,
  CopyButton,
  EmptyState,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Pagination as PaginationControl,
  RoleBadge,
  Select,
  Toggle,
  Badge,
} from '@/components/ui';
import { formatDate, fromNow } from '@/lib/format';
import { useDebouncedValue } from '@/lib/hooks';

const roleTabs = [
  { value: '', label: '全部账号' },
  { value: 'AGENT', label: '代理' },
  { value: 'USER', label: '普通用户' },
  { value: 'ADMIN', label: '管理员' },
];

export function Users() {
  const queryClient = useQueryClient();
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [createdPassword, setCreatedPassword] = useState<{ email: string; password: string } | null>(null);
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [disableTarget, setDisableTarget] = useState<AdminUser | null>(null);
  const debouncedSearch = useDebouncedValue(search, 350);

  const query = useQuery({
    queryKey: ['admin-users', { role, status, search: debouncedSearch, page }],
    queryFn: () => api.get<{ items: AdminUser[]; pagination: Pagination }>(
      `/admin/users${buildQuery({ role, status, q: debouncedSearch, page, pageSize: 20 })}`,
    ),
  });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      queryClient.invalidateQueries({ queryKey: ['team'] }),
    ]);
  };

  const toggleInvite = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api.patch(`/admin/users/${id}`, { inviteEnabled: enabled }),
    onSuccess: async (_data, vars) => {
      toast.success(vars.enabled ? '已开启代理邀请权限' : '已关闭代理邀请权限，其邀请码将暂停注册');
      await invalidate();
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : '更新失败'),
  });

  const toggleStatus = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.patch(`/admin/users/${id}`, { status: active ? 'ACTIVE' : 'DISABLED' }),
    onSuccess: async (_data, vars) => {
      toast.success(vars.active ? '账号已启用' : '账号已停用，所有会话已退出');
      setDisableTarget(null);
      await invalidate();
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : '更新失败'),
  });

  return (
    <div className="page">
      <PageHeader
        eyebrow="PEOPLE & ACCESS · 组织权限"
        title="用户与代理"
        description="邀请权限是代理的单独开关。普通用户永远没有邀请入口；用户之间不能互相邀请。"
        actions={<Button variant="primary" onClick={() => setCreateOpen(true)}><Plus size={16} /> 直接创建账号</Button>}
      />

      <div className="toolbar">
        <div className="tabs tabs--scroll">
          {roleTabs.map((tab) => (
            <button key={tab.value} className={`tab ${role === tab.value ? 'is-active' : ''}`} onClick={() => { setRole(tab.value); setPage(1); }}>{tab.label}</button>
          ))}
        </div>
        <div className="toolbar__right">
          <Select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} aria-label="账号状态">
            <option value="">全部状态</option>
            <option value="ACTIVE">正常</option>
            <option value="DISABLED">已停用</option>
          </Select>
          <div className="search-box search-box--compact">
            <Search size={15} />
            <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="搜索姓名或邮箱" />
          </div>
        </div>
      </div>

      {query.isLoading ? <LoadingBlock /> : query.isError ? <ErrorBlock message="账号列表加载失败" retry={() => query.refetch()} /> : !query.data?.items.length ? (
        <EmptyState icon={<UsersIcon size={22} />} title="没有符合条件的账号" description="调整筛选条件，或直接创建一个新账号。" />
      ) : (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>账号</th><th>角色</th><th>状态</th><th>邀请权限</th><th>任务 / 名下用户</th><th>加入时间</th><th /></tr></thead>
              <tbody>
                {query.data.items.map((account) => (
                  <tr key={account.id}>
                    <td>
                      <div className="user-cell">
                        <span className={`avatar avatar--${account.role.toLowerCase()}`}>{account.display_name.slice(0, 1)}</span>
                        <div className="cell-stack">
                          <strong>{account.display_name}</strong>
                          <span className="cell-muted">{account.email}</span>
                          {account.inviter_name ? <span className="cell-muted">邀请人：{account.inviter_name}</span> : null}
                        </div>
                      </div>
                    </td>
                    <td><RoleBadge role={account.role} /></td>
                    <td><Badge tone={account.status === 'ACTIVE' ? 'green' : 'muted'} dot>{account.status === 'ACTIVE' ? '正常' : '已停用'}</Badge></td>
                    <td>
                      {account.role === 'AGENT' ? (
                        <div className="invite-toggle">
                          <Toggle
                            label={`${account.display_name} 的邀请权限`}
                            checked={account.invite_enabled}
                            disabled={toggleInvite.isPending}
                            onChange={(enabled) => toggleInvite.mutate({ id: account.id, enabled })}
                          />
                          <span>{account.invite_enabled ? '已开启' : '已关闭'}</span>
                        </div>
                      ) : account.role === 'ADMIN' ? <span className="cell-muted">始终可邀请</span> : <span className="cell-muted">无邀请权限</span>}
                    </td>
                    <td><span className="num-cell">{account.task_count}</span><span className="cell-muted"> / {account.downline_count}</span></td>
                    <td>
                      <div className="cell-stack"><span>{formatDate(account.created_at)}</span><span className="cell-muted">{account.last_login_at ? `${fromNow(account.last_login_at)}登录` : '未登录'}</span></div>
                    </td>
                    <td>
                      {account.role !== 'ADMIN' ? (
                        <div className="inline-actions">
                          <Button size="sm" variant="quiet" onClick={() => setResetTarget(account)} title="重置密码" aria-label={`重置 ${account.display_name} 的密码`}><KeyRound size={14} /></Button>
                          <Button size="sm" variant="quiet" title={account.status === 'ACTIVE' ? '停用账号' : '启用账号'} aria-label={account.status === 'ACTIVE' ? `停用 ${account.display_name}` : `启用 ${account.display_name}`} onClick={() => account.status === 'ACTIVE' ? setDisableTarget(account) : toggleStatus.mutate({ id: account.id, active: true })}>
                            {account.status === 'ACTIVE' ? <ShieldBan size={14} /> : <ShieldCheck size={14} />}
                          </Button>
                        </div>
                      ) : <span className="cell-muted">系统账号</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PaginationControl page={query.data.pagination.page} totalPages={query.data.pagination.totalPages} total={query.data.pagination.total} onChange={setPage} />
        </>
      )}

      <CreateUserModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={async (result) => {
          setCreateOpen(false);
          setCreatedPassword({ email: result.email, password: result.temporaryPassword });
          await invalidate();
        }}
      />

      <ResetPasswordModal target={resetTarget} onClose={() => setResetTarget(null)} />

      <Modal
        open={Boolean(disableTarget)}
        title="停用这个账号？"
        description="停用后该账号的所有会话会立即失效，无法登录、领取或提交任务。"
        onClose={() => setDisableTarget(null)}
        footer={
          <>
            <Button variant="quiet" onClick={() => setDisableTarget(null)}>取消</Button>
            <Button variant="danger" loading={toggleStatus.isPending} onClick={() => disableTarget && toggleStatus.mutate({ id: disableTarget.id, active: false })}>确认停用</Button>
          </>
        }
      >
        <div className="review-summary">
          <div><span>账号</span><strong>{disableTarget?.display_name}</strong></div>
          <div><span>邮箱</span><strong>{disableTarget?.email}</strong></div>
        </div>
      </Modal>

      <Modal
        open={Boolean(createdPassword)}
        title="账号已创建"
        description="临时密码只展示一次，请通过安全渠道发送给账号本人。"
        onClose={() => setCreatedPassword(null)}
        footer={<Button variant="primary" onClick={() => setCreatedPassword(null)}>我已保存</Button>}
      >
        {createdPassword ? (
          <div className="credential-box">
            <span>登录邮箱</span>
            <strong>{createdPassword.email}</strong>
            <span>临时密码</span>
            <div className="credential-box__password">
              <code>{createdPassword.password}</code>
              <CopyButton value={createdPassword.password} />
            </div>
            <p><Check size={14} /> 对方登录后应尽快在账户设置中修改密码。</p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function CreateUserModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (result: { email: string; temporaryPassword: string }) => void;
}) {
  const [role, setRole] = useState<Role>('USER');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteEnabled, setInviteEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => api.post<{ user: { email: string }; temporaryPassword: string | null }>('/admin/users', {
      role,
      displayName,
      email,
      password: password || undefined,
      inviteEnabled: role === 'AGENT' ? inviteEnabled : false,
    }),
    onSuccess: (data) => {
      setError(null);
      setDisplayName('');
      setEmail('');
      setPassword('');
      setInviteEnabled(false);
      setRole('USER');
      onCreated({ email: data.user.email, temporaryPassword: data.temporaryPassword ?? password });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : '创建失败'),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!displayName.trim() || !email.trim()) return setError('请填写昵称与邮箱');
    if (password && (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password))) {
      return setError('密码至少 10 位，且包含字母和数字');
    }
    mutation.mutate();
  }

  return (
    <Modal
      open={open}
      title="直接创建账号"
      description="管理员可直接创建代理或普通用户。代理的邀请权限可在此一并开启。"
      onClose={onClose}
      footer={<><Button variant="quiet" onClick={onClose}>取消</Button><Button variant="primary" loading={mutation.isPending} onClick={submit}>创建账号</Button></>}
    >
      <form className="form-stack" onSubmit={submit}>
        <div className="segmented">
          <button type="button" className={role === 'USER' ? 'is-active' : ''} onClick={() => setRole('USER')}>普通用户</button>
          <button type="button" className={role === 'AGENT' ? 'is-active' : ''} onClick={() => setRole('AGENT')}>代理</button>
        </div>
        <Field label="昵称" required><Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={40} placeholder="账号展示名" /></Field>
        <Field label="登录邮箱" required><Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" /></Field>
        <Field label="初始密码" hint="留空则由系统生成一次性临时密码"><Input type="text" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 10 位，含字母和数字" /></Field>
        {role === 'AGENT' ? (
          <div className="switch-line">
            <div><strong>开启邀请权限</strong><span>关闭时该代理无法生成新的邀请码</span></div>
            <Toggle checked={inviteEnabled} onChange={setInviteEnabled} label="开启邀请权限" />
          </div>
        ) : null}
        {error ? <div className="form-error">{error}</div> : null}
      </form>
    </Modal>
  );
}

function ResetPasswordModal({ target, onClose }: { target: AdminUser | null; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!target) {
      setPassword('');
      setError(null);
    }
  }, [target]);
  const mutation = useMutation({
    mutationFn: () => api.post(`/admin/users/${target?.id}/reset-password`, { newPassword: password }),
    onSuccess: () => {
      toast.success('密码已重置，该账号所有会话已退出');
      setPassword('');
      setError(null);
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : '重置失败'),
  });
  return (
    <Modal
      open={Boolean(target)}
      title="重置密码"
      description={target ? `为 ${target.display_name}（${target.email}）设置新密码，操作后其所有会话会失效。` : undefined}
      onClose={onClose}
      footer={<><Button variant="quiet" onClick={onClose}>取消</Button><Button variant="danger" loading={mutation.isPending} onClick={() => {
        if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) return setError('密码至少 10 位，且包含字母和数字');
        mutation.mutate();
      }}>确认重置</Button></>}
    >
      <Field label="新密码" required error={error} hint="至少 10 位，含字母和数字">
        <Input type="text" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="设置新密码" />
      </Field>
      <div className="notice notice--red notice--compact"><ShieldBan size={16} /><div>该操作不通知账号本人，请通过安全渠道告知新密码。</div></div>
    </Modal>
  );
}
