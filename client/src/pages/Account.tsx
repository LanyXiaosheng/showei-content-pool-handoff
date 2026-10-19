import { FormEvent, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { KeyRound, LockKeyhole, ShieldCheck, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, api } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Badge, Button, Field, Input, PageHeader, Panel, RoleBadge, SectionHeader } from '@/components/ui';
import { ROLE_LABEL } from '@/lib/format';

const permissionRows = [
  { key: '提交素材任务', roles: ['AGENT', 'USER'] },
  { key: '查看公共内容池', roles: ['ADMIN', 'AGENT', 'USER'] },
  { key: '领取内容 / 下载 ZIP', roles: ['AGENT', 'USER'] },
  { key: '邀请普通用户', roles: ['ADMIN', 'AGENT'] },
  { key: '邀请代理', roles: ['ADMIN'] },
  { key: '审核 / 驳回 / 作废任务', roles: ['ADMIN'] },
  { key: '配置 API 密钥', roles: ['ADMIN'] },
  { key: '编辑底层 Prompt', roles: ['ADMIN'] },
  { key: '查看全站日志与审计', roles: ['ADMIN'] },
];

export function Account() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => api.post('/auth/change-password', { currentPassword, newPassword }),
    onSuccess: () => {
      toast.success('密码已更新，其他设备已退出登录');
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
      setError(null);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : '修改失败'),
  });

  if (!user) return null;

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (newPassword.length < 10 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      return setError('新密码至少 10 位，且包含字母和数字');
    }
    if (newPassword !== confirm) return setError('两次输入的新密码不一致');
    mutation.mutate();
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="ACCOUNT · 账户与权限"
        title="你的权限，边界清清楚楚。"
        description="账号角色由管理员创建或邀请码决定，不能在前端自行变更。所有敏感配置只对管理员开放。"
      />
      <div className="account-grid">
        <div>
          <Panel>
            <SectionHeader title="账号信息" />
            <div className="account-identity">
              <span className={`avatar avatar--large avatar--${user.role.toLowerCase()}`}>{user.displayName.slice(0, 1)}</span>
              <div>
                <h2>{user.displayName}</h2>
                <p>{user.email}</p>
                <div className="inline-actions"><RoleBadge role={user.role} /><Badge tone="green" dot>账号正常</Badge>{user.role === 'AGENT' ? <Badge tone={user.inviteEnabled ? 'green' : 'muted'}>{user.inviteEnabled ? '邀请权限开启' : '邀请权限关闭'}</Badge> : null}</div>
              </div>
            </div>
            <dl className="fact-list fact-list--wide">
              <div><dt>角色</dt><dd>{ROLE_LABEL[user.role]}</dd></div>
              <div><dt>账号状态</dt><dd>{user.status === 'ACTIVE' ? '正常' : '已停用'}</dd></div>
              <div><dt>会话有效期</dt><dd>7 天 · HttpOnly Cookie</dd></div>
              <div><dt>权限模型</dt><dd>管理员 / 代理 / 普通用户三级隔离</dd></div>
            </dl>
          </Panel>

          <Panel>
            <SectionHeader title="修改密码" hint="修改后所有会话会被注销，并自动为当前浏览器重新登录" />
            <form className="form-stack account-password" onSubmit={submit}>
              <Field label="当前密码" required><Input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></Field>
              <div className="form-grid">
                <Field label="新密码" required hint="至少 10 位，包含字母和数字"><Input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></Field>
                <Field label="确认新密码" required><Input type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></Field>
              </div>
              {error ? <div className="form-error">{error}</div> : null}
              <div className="inline-actions"><Button type="submit" variant="primary" loading={mutation.isPending}><KeyRound size={15} /> 更新密码</Button></div>
            </form>
          </Panel>
        </div>

        <aside>
          <div className="aside-card">
            <span className="eyebrow">PERMISSION MATRIX</span>
            <h3>当前角色能做什么</h3>
            <div className="permission-list">
              {permissionRows.map((row) => {
                const allowed = row.roles.includes(user.role);
                return (
                  <div className={allowed ? 'is-allowed' : 'is-denied'} key={row.key}>
                    <span>{row.key}</span>
                    {allowed ? <Badge tone="green">允许</Badge> : <Badge tone="muted">无权</Badge>}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="aside-card aside-card--rules">
            <span className="eyebrow">SECURITY</span>
            <h3>安全约定</h3>
            <ul className="rule-list">
              <li><ShieldCheck size={14} /> API 密钥以 AES-256-GCM 加密存储</li>
              <li><LockKeyhole size={14} /> 底层 Prompt 与密钥接口仅管理员可访问</li>
              <li><UserRound size={14} /> 用户之间禁止互相邀请，代理只能邀请普通用户</li>
              <li><ShieldCheck size={14} /> 内容领取使用数据库原子更新，防并发超发</li>
            </ul>
          </div>
          <div className="aside-card aside-card--quote">
            <p>“权限不是功能，<br />是出事时能说清楚的那条线。”</p>
            <span>— 拾味 · 权限准则</span>
          </div>
        </aside>
      </div>
    </div>
  );
}
