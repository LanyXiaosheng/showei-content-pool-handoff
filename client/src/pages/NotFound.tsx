import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/ui';

export function NotFound() {
  return (
    <div className="page">
      <EmptyState
        title="这一页不在菜单里"
        description="链接可能已失效，或者内容已经被移走。"
        action={<Link to="/" className="btn btn--primary btn--md">回到工作台</Link>}
      />
    </div>
  );
}
