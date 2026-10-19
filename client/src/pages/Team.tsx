import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowUpRight, KeyRound, ShieldAlert, UserPlus, Users } from 'lucide-react';
import { api, buildQuery } from '@/api/client';
import type { Pagination, TeamUser } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import {
  Badge,
  Button,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  Pagination as PaginationControl,
} from '@/components/ui';
import { formatDate, fromNow } from '@/lib/format';

export function Team() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const overview = useQuery({
    queryKey: ['team-overview'],
    queryFn: () => api.get<{
      downline: number; activeDownline: number; pendingTasks: number; completedTasks: number; inviteEnabled: boolean;
    }>('/team/overview'),
  });
  const team = useQuery({
    queryKey: ['team', page],
    queryFn: () => api.get<{ items: TeamUser[]; pagination: Pagination }>(`/team/users${buildQuery({ page, pageSize: 20 })}`),
  });

  return (
    <div className="page">
      <PageHeader
        eyebrow="MY DOWNLINE · 我的团队"
        title="你带来的食客。"
        description="代理只能邀请普通用户。这里展示你名下邀请注册的用户，以及他们提交任务的概况。"
        actions={
          overview.data?.inviteEnabled
            ? <Link to="/invites" className="btn btn--primary btn--md"><UserPlus size={16} /> 生成邀请码</Link>
            : <Button variant="quiet" disabled><ShieldAlert size={15} /> 邀请权限已关闭</Button>
        }
      />

      {overview.data && !overview.data.inviteEnabled ? (
        <div className="notice notice--amber">
          <ShieldAlert size={17} />
          <div><strong>管理员已暂停你的邀请权限。</strong>已有邀请码暂时无法注册，恢复权限后自动生效。你仍可提交素材与领取内容。</div>
        </div>
      ) : null}

      <section className="stat-ribbon stat-ribbon--compact">
        <div className="metric"><span className="metric__label">名下用户</span><strong className="metric__value">{overview.data?.downline ?? '—'}</strong><span className="metric__hint">其中活跃 {overview.data?.activeDownline ?? 0} 人</span></div>
        <div className="metric"><span className="metric__label">团队待审任务</span><strong className="metric__value">{overview.data?.pendingTasks ?? '—'}</strong><span className="metric__hint">等待管理员审核</span></div>
        <div className="metric"><span className="metric__label">团队已完成</span><strong className="metric__value">{overview.data?.completedTasks ?? '—'}</strong><span className="metric__hint">内容已进入公共池</span></div>
        <div className="metric"><span className="metric__label">邀请权限</span><strong className="metric__value metric__value--text">{overview.data?.inviteEnabled ? '开启中' : '已暂停'}</strong><span className="metric__hint">由管理员实时控制</span></div>
      </section>

      {team.isLoading ? <LoadingBlock /> : team.isError ? <ErrorBlock message="团队列表加载失败" retry={() => team.refetch()} /> : !team.data?.items.length ? (
        <EmptyState
          icon={<Users size={22} />}
          title={overview.data?.inviteEnabled ? '还没有邀请过用户' : '暂无团队成员'}
          description={overview.data?.inviteEnabled ? '生成一个邀请码，把它发给想加入的普通用户。' : '邀请权限关闭期间不会产生新的团队成员。'}
          action={overview.data?.inviteEnabled ? <Link to="/invites" className="btn btn--primary btn--md"><KeyRound size={15} /> 去生成邀请码</Link> : null}
        />
      ) : (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>用户</th><th>状态</th><th>任务数</th><th>待审</th><th>已完成</th><th>最近提交</th><th>加入时间</th></tr></thead>
              <tbody>
                {team.data.items.map((member) => (
                  <tr key={member.id}>
                    <td><div className="user-cell"><span className="avatar avatar--user">{member.display_name.slice(0, 1)}</span><div className="cell-stack"><strong>{member.display_name}</strong><span className="cell-muted">{member.email}</span></div></div></td>
                    <td><Badge tone={member.status === 'ACTIVE' ? 'green' : 'muted'} dot>{member.status === 'ACTIVE' ? '正常' : '已停用'}</Badge></td>
                    <td className="num-cell">{member.task_count}</td>
                    <td className="num-cell">{member.pending_count}</td>
                    <td className="num-cell">{member.completed_count}</td>
                    <td>{member.last_task_at ? fromNow(member.last_task_at) : '—'}</td>
                    <td>{formatDate(member.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PaginationControl page={team.data.pagination.page} totalPages={team.data.pagination.totalPages} total={team.data.pagination.total} onChange={setPage} />
        </>
      )}
      <div className="inline-note"><ArrowUpRight size={14} /> 你只能查看名下用户的任务记录；无法访问 Prompt、API 密钥，也无法替他们领取内容。</div>
    </div>
  );
}
