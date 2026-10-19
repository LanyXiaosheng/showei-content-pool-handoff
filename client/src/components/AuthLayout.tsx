import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function AuthLayout({
  eyebrow,
  headline,
  description,
  children,
  footer,
}: {
  eyebrow: string;
  headline: ReactNode;
  description: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="auth">
      <section className="auth__visual">
        <img src="/api/public/hero-image" alt="炭火牛肉宽面实拍" className="auth__image" />
        <div className="auth__veil" />
        <div className="auth__visual-top">
          <Link to="/login" className="auth-brand">
            <span className="brand-seal">拾</span>
            <span>
              <strong>拾味</strong>
              <em>内容中台</em>
            </span>
          </Link>
          <span className="auth__internal">邀请制 · 内部使用</span>
        </div>
        <div className="auth__statement">
          <span className="eyebrow eyebrow--light">{eyebrow}</span>
          <h1>{headline}</h1>
          <p>{description}</p>
        </div>
        <div className="auth__visual-foot">
          <span>01 素材审核</span>
          <span>02 批量变体</span>
          <span>03 独占领取</span>
        </div>
      </section>
      <section className="auth__panel">
        <div className="auth__panel-inner">
          {children}
          {footer ? <div className="auth__footer">{footer}</div> : null}
        </div>
      </section>
    </div>
  );
}
