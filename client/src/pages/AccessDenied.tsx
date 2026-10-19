import { Link } from 'react-router-dom';
import { ShieldX } from 'lucide-react';
import { EmptyState } from '@/components/ui';

export function AccessDenied() {
  return (
    <div className="page">
      <EmptyState
        icon={<ShieldX size={24} />}
        title="这扇门不对你的角色开放"
        description="当前账号没有访问此页面的权限。管理员可访问配置与审核，代理仅能查看名下用户，普通用户没有邀请能力。"
        action={<Link to="/" className="btn btn--primary btn--md">回到工作台</Link>}
      />
    </div>
  );
}
