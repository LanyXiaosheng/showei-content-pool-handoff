import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Eye, EyeOff, Ticket } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, api, buildQuery } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AuthLayout } from '@/components/AuthLayout';
import { Button, Field, Input } from '@/components/ui';
import { useDebouncedValue } from '@/lib/hooks';
import { ROLE_LABEL, formatDate } from '@/lib/format';

interface InviteCheck {
  valid: boolean;
  reason?: string;
  role?: 'AGENT' | 'USER';
  inviterName?: string;
  expiresAt?: string;
  remainingUses?: number;
}

export function Register() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { refresh, user } = useAuth();
  const [code, setCode] = useState(searchParams.get('code')?.toUpperCase() ?? '');
  const debouncedCode = useDebouncedValue(code, 300);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invite = useQuery({
    queryKey: ['invite-check', debouncedCode],
    queryFn: () => api.get<InviteCheck>(`/invites/check/${encodeURIComponent(debouncedCode)}`),
    enabled: debouncedCode.length >= 6,
    retry: false,
  });

  useEffect(() => {
    if (user) navigate('/', { replace: true });
  }, [user, navigate]);

  const passwordIssue = useMemo(() => {
    if (!password) return null;
    if (password.length < 10) return '密码至少 10 位';
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return '密码需同时包含字母和数字';
    return null;
  }, [password]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!invite.data?.valid) {
      setError(invite.data?.reason ?? '邀请码不可用');
      return;
    }
    if (password !== confirm) {
      setError('两次输入的密码不一致');
      return;
    }
    if (passwordIssue) {
      setError(passwordIssue);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.post('/auth/register', { code: code.trim(), displayName, email, password });
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      await refresh();
      toast.success('注册成功，欢迎加入拾味');
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '注册失败，请稍后再试');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      eyebrow="INVITE ONLY · 拾味内容中台"
      headline={<>好内容不靠运气，<br />靠一整套被审过的素材。</>}
      description="这里没有公开注册。每一张邀请码都有有效期、使用次数和邀请人，普通用户之间无法互相邀请。"
      footer={<span className="auth__security">注册即表示你理解：平台仅提供素材变体工具，不承诺平台过审。</span>}
    >
      <div className="auth-form-head">
        <span className="eyebrow">ACCEPT INVITATION</span>
        <h2>用邀请码注册</h2>
        <p>邀请码决定你的账号角色，注册后不可更改。</p>
      </div>

      <form className="auth-form" onSubmit={onSubmit}>
        <Field label="邀请码" required hint="由管理员或已开启邀请权限的代理提供">
          <Input
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="例如：K7M2P9QX4A"
            maxLength={24}
            autoCapitalize="characters"
            required
          />
        </Field>
        {debouncedCode.length >= 6 ? (
          <div className={`invite-state ${invite.data?.valid ? 'is-valid' : 'is-invalid'}`}>
            <Ticket size={16} />
            {invite.isLoading ? (
              <span>正在校验邀请码…</span>
            ) : invite.data?.valid ? (
              <span>
                来自 <strong>{invite.data.inviterName}</strong> 的 {ROLE_LABEL[invite.data.role ?? 'USER']} 邀请 · 剩余 {invite.data.remainingUses} 次 · {formatDate(invite.data.expiresAt)} 前有效
              </span>
            ) : (
              <span>{invite.data?.reason ?? '邀请码无效'}</span>
            )}
          </div>
        ) : null}
        <div className="form-grid">
          <Field label="昵称" required>
            <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="怎么称呼你" maxLength={40} required />
          </Field>
          <Field label="邮箱" required>
            <Input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required />
          </Field>
        </div>
        <Field label="设置密码" required hint={passwordIssue ?? '至少 10 位，包含字母和数字'}>
          <div className="input-with-action">
            <Input
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            <button type="button" className="input-action" aria-label={showPassword ? '隐藏密码' : '显示密码'} onClick={() => setShowPassword((value) => !value)}>
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </Field>
        <Field label="确认密码" required error={confirm && confirm !== password ? '两次输入的密码不一致' : null}>
          <Input type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required />
        </Field>
        {error ? <div className="form-error">{error}</div> : null}
        <Button type="submit" variant="primary" size="lg" loading={submitting} disabled={!invite.data?.valid} className="auth-submit">
          创建账号 <ArrowRight size={16} />
        </Button>
      </form>
      <div className="auth-switch">
        已有账号？<Link to="/login">返回登录</Link>
      </div>
      <p className="auth-disclaimer">
        普通用户没有邀请入口。代理只能邀请普通用户，且邀请权限由管理员实时开关。邮箱重复、邀请码用完或过期均无法注册。
      </p>
    </AuthLayout>
  );
}
