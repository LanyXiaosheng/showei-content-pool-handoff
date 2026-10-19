import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { ApiError, api } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AuthLayout } from '@/components/AuthLayout';
import { Button, Field, Input } from '@/components/ui';
import { toast } from 'sonner';

export function Login() {
  const { user, login, demoLogin } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [demoLoading, setDemoLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const config = useQuery({
    queryKey: ['public-config'],
    queryFn: () => api.get<{ demoMode: boolean }>('/public/config'),
    staleTime: 300_000,
  });
  const requestedNext = searchParams.get('next') || '/';
  const next = requestedNext.startsWith('/') && !requestedNext.startsWith('//') ? requestedNext : '/';

  useEffect(() => {
    if (user) navigate(next, { replace: true });
  }, [user, navigate, next]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email.trim(), password);
      toast.success('登录成功，欢迎回来');
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录失败，请稍后再试');
    } finally {
      setSubmitting(false);
    }
  }

  async function onDemo(role: 'ADMIN' | 'AGENT' | 'USER') {
    setDemoLoading(role);
    setError(null);
    try {
      await demoLogin(role);
      toast.success(`已以${role === 'ADMIN' ? '管理员' : role === 'AGENT' ? '代理' : '普通用户'}身份进入演示`);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '演示登录失败');
    } finally {
      setDemoLoading(null);
    }
  }

  return (
    <AuthLayout
      eyebrow="SHIWEI CONTENT STUDIO · 2026"
      headline={<>把一桌好菜，<br />拆成十种让人心动的说法。</>}
      description="原图不变形，文案不生硬。一套素材经过人工审核与批量变体，进入公共内容池，被唯一的人领取。"
      footer={
        <span className="auth__security">
          <ShieldCheck size={14} /> 三层权限隔离 · 会话加密 · API 密钥仅管理员可见
        </span>
      }
    >
      <div className="auth-form-head">
        <span className="eyebrow">WELCOME BACK</span>
        <h2>回到内容中台</h2>
        <p>使用管理员、代理或普通用户账号登录。</p>
      </div>

      <form className="auth-form" onSubmit={onSubmit}>
        <Field label="邮箱" required>
          <Input
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </Field>
        <Field label="密码" required>
          <div className="input-with-action">
            <Input
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="输入登录密码"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            <button type="button" className="input-action" aria-label={showPassword ? '隐藏密码' : '显示密码'} onClick={() => setShowPassword((value) => !value)}>
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </Field>
        {error ? <div className="form-error">{error}</div> : null}
        <Button type="submit" variant="primary" size="lg" loading={submitting} className="auth-submit">
          登录 <ArrowRight size={16} />
        </Button>
      </form>

      {config.data?.demoMode ? (
        <div className="demo-box">
          <div className="demo-box__head">
            <span>本地演示模式</span>
            <em>无需密码</em>
          </div>
          <div className="demo-box__actions">
            <Button size="sm" variant="quiet" loading={demoLoading === 'ADMIN'} onClick={() => onDemo('ADMIN')}>管理员</Button>
            <Button size="sm" variant="quiet" loading={demoLoading === 'AGENT'} onClick={() => onDemo('AGENT')}>代理</Button>
            <Button size="sm" variant="quiet" loading={demoLoading === 'USER'} onClick={() => onDemo('USER')}>普通用户</Button>
          </div>
        </div>
      ) : null}

      <div className="auth-switch">
        收到邀请码？<Link to="/register">注册普通用户 / 代理</Link>
      </div>
      <p className="auth-disclaimer">
        素材变体仅帮助降低重复度，不保证大众点评、小红书等平台审核通过。矩阵分发合规责任由使用者自行承担。
      </p>
    </AuthLayout>
  );
}
