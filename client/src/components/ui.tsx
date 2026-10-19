import { forwardRef, useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { AlertTriangle, Check, Copy, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { GROUP_STATUS_LABEL, INVITE_STATUS_LABEL, ROLE_LABEL, TASK_STATUS_LABEL } from '@/lib/format';

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}) {
  return (
    <button
      className={clsx('btn', `btn--${variant}`, `btn--${size}`, className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 size={15} className="spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  function IconButton({ className, ...props }, ref) {
    return <button ref={ref} type="button" className={clsx('icon-btn', className)} {...props} />;
  },
);

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={clsx('field', className)}>
      <span className="field__label">
        {label}
        {required ? <span className="field__required">必填</span> : null}
      </span>
      {children}
      {error ? <span className="field__error">{error}</span> : hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx('input', className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx('textarea', className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={clsx('select', className)} {...props}>
      {children}
    </select>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  dot = false,
  className,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'red' | 'green' | 'amber' | 'blue' | 'muted';
  dot?: boolean;
  className?: string;
}) {
  return (
    <span className={clsx('badge', `badge--${tone}`, className)}>
      {dot ? <i className="badge__dot" aria-hidden /> : null}
      {children}
    </span>
  );
}

const taskTone: Record<string, 'neutral' | 'red' | 'green' | 'amber' | 'blue' | 'muted'> = {
  PENDING_REVIEW: 'amber',
  REJECTED: 'red',
  QUEUED: 'blue',
  GENERATING: 'blue',
  COMPLETED: 'green',
  FAILED: 'red',
  VOID: 'muted',
};

export function TaskStatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={taskTone[status] ?? 'neutral'} dot>
      {TASK_STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

const groupTone: Record<string, 'neutral' | 'red' | 'green' | 'amber' | 'blue' | 'muted'> = {
  STAGED: 'amber',
  AVAILABLE: 'green',
  CLAIMED: 'blue',
  WITHDRAWN: 'muted',
};

export function GroupStatusBadge({ status }: { status: string }) {
  return <Badge tone={groupTone[status] ?? 'neutral'}>{GROUP_STATUS_LABEL[status] ?? status}</Badge>;
}

export function RoleBadge({ role }: { role: string }) {
  return <Badge tone={role === 'ADMIN' ? 'red' : role === 'AGENT' ? 'green' : 'neutral'}>{ROLE_LABEL[role] ?? role}</Badge>;
}

export function InviteStatusBadge({ status }: { status: string }) {
  const tone = status === 'ACTIVE' ? 'green' : status === 'EXPIRED' ? 'muted' : status === 'REVOKED' ? 'red' : 'amber';
  return <Badge tone={tone}>{INVITE_STATUS_LABEL[status] ?? status}</Badge>;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  children,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div className="page-head__main">
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1 className="page-title">{title}</h1>
        {description ? <p className="page-desc">{description}</p> : null}
        {children}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

export function SectionHeader({ title, hint, actions }: { title: ReactNode; hint?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="section-head">
      <div>
        <h2>{title}</h2>
        {hint ? <p>{hint}</p> : null}
      </div>
      {actions}
    </div>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={clsx('panel', className)}>{children}</section>;
}

export function Pagination({
  page,
  totalPages,
  total,
  onChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onChange: (page: number) => void;
}) {
  if (total <= 0) return null;
  return (
    <div className="pagination">
      <span className="pagination__meta">共 {total} 条 · 第 {page} / {totalPages} 页</span>
      <div className="pagination__buttons">
        <Button size="sm" variant="quiet" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          上一页
        </Button>
        <Button size="sm" variant="quiet" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
          下一页
        </Button>
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon ? <div className="empty__icon">{icon}</div> : <div className="empty__mark">拾</div>}
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action ? <div className="empty__action">{action}</div> : null}
    </div>
  );
}

export function LoadingBlock({ label = '正在读取…' }: { label?: string }) {
  return (
    <div className="loading-block">
      <Loader2 size={18} className="spin" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorBlock({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="error-block">
      <AlertTriangle size={18} />
      <span>{message}</span>
      {retry ? <Button size="sm" variant="quiet" onClick={retry}>重试</Button> : null}
    </div>
  );
}

export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  width = '520px',
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    document.body.classList.add('modal-open');
    const timer = setTimeout(() => closeRef.current?.focus(), 30);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !modalRef.current) return;
      const focusable = Array.from(modalRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !modalRef.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !modalRef.current.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      document.body.classList.remove('modal-open');
      window.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div className="modal" ref={modalRef} role="dialog" aria-modal="true" aria-label={title} style={{ maxWidth: width }}>
        <div className="modal__head">
          <div>
            <h2>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <IconButton ref={closeRef} aria-label="关闭" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        <div className="modal__body">{children}</div>
        {footer ? <div className="modal__foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '确认',
  danger = false,
  loading = false,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <Modal
      open={open}
      title={title}
      description={description}
      onClose={onClose}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>取消</Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}

export function CopyButton({ value, label = '复制' }: { value: string; label?: string }) {
  return (
    <Button
      type="button"
      size="sm"
      variant="quiet"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          toast.success('已复制');
        } catch {
          toast.error('复制失败，请手动选择文本');
        }
      }}
    >
      <Copy size={14} />
      {label}
    </Button>
  );
}

export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={clsx('toggle', checked && 'is-on')}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

export function Progress({ value, label }: { value: number; label?: string }) {
  return (
    <div className="progress-wrap">
      <div className="progress" aria-label={label ?? '进度'}>
        <span style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
      {label ? <span className="progress-label">{label}</span> : null}
    </div>
  );
}

export function CheckLine({ children }: { children: ReactNode }) {
  return (
    <div className="check-line">
      <Check size={14} />
      <span>{children}</span>
    </div>
  );
}
