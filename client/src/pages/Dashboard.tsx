import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowUpRight,
  ClipboardCheck,
  Clock3,
  FolderLock,
  Layers,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  Users,
} from 'lucide-react';
import { api } from '@/api/client';
import type { DashboardData, TaskSummary } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { Badge, Button, EmptyState, ErrorBlock, LoadingBlock, PageHeader, Panel, Progress, SectionHeader, TaskStatusBadge } from '@/components/ui';
import { formatDateTime, fromNow, percent, TASK_STATUS_LABEL } from '@/lib/format';

const todayLabel = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());

function Metric({ label, value, hint, accent = false }: { label: string; value: number | string; hint?: string; accent?: boolean }) {
  return (
    <div className={`metric ${accent ? 'metric--accent' : ''}`}>
      <span className="metric__label">{label}</span>
      <strong className="metric__value">{value}</strong>
      {hint ? <span className="metric__hint">{hint}</span> : null}
    </div>
  );
}

function TrendChart({ series }: { series: DashboardData['series'] }) {
  const max = Math.max(1, ...series.map((item) => item.count));
  return (
    <div className="trend">
      <div className="trend__plot">
        {series.map((item) => (
          <div className="trend__col" key={item.day}>
            <span className="trend__count">{item.count || ''}</span>
            <div className="trend__track">
              <span className="trend__bar" style={{ height: `${Math.max(4, (item.count / max) * 100)}%` }} />
            </div>
            <span className="trend__day">{item.day}</span>
          </div>
        ))}
      </div>
      <div className="trend__foot">
        <span>近 7 日入池组数</span>
        <strong>{series.reduce((sum, item) => sum + item.count, 0)}<em>组</em></strong>
      </div>
    </div>
  );
}

function TaskRow({ task, onOpen }: { task: TaskSummary; onOpen: () => void }) {
  return (
    <button className="task-row" onClick={onOpen}>
      <span className="task-row__main">
        <span className="task-row__no">{task.taskNo}</span>
        <strong>{task.sourceTitle}</strong>
        <span className="task-row__meta">{task.submitter.displayName} · {task.imageCount} 张原图 · {task.generationCount} 组</span>
      </span>
      <span className="task-row__status">
        <TaskStatusBadge status={task.status} />
        {task.job ? (
          <span className="task-row__progress">
            <Progress value={percent(task.job.completedGroups, task.job.totalGroups)} />
            <em>{task.job.completedGroups}/{task.job.totalGroups}</em>
          </span>
        ) : null}
      </span>
      <span className="task-row__time">{formatDateTime(task.createdAt)}</span>
      <ArrowUpRight size={15} className="task-row__arrow" />
    </button>
  );
}

export function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardData>('/dashboard'),
    refetchInterval: (query) => {
      const data = query.state.data as DashboardData | undefined;
      const active = Number(data?.stats?.activeTasks ?? 0);
      return active > 0 ? 5000 : 30_000;
    },
  });

  if (query.isLoading) return <div className="page"><LoadingBlock label="正在整理今天的内容池…" /></div>;
  if (query.isError || !query.data) {
    return <div className="page"><ErrorBlock message="工作台数据加载失败" retry={() => query.refetch()} /></div>;
  }

  const data = query.data;
  const stats = data.stats as Record<string, number>;
  const isAdmin = user?.role === 'ADMIN';
  const isAgent = user?.role === 'AGENT';
  const available = Number(stats.availableGroups ?? 0);
  const pending = Number(stats.pendingTasks ?? 0);
  const claimed = Number(stats.claimedGroups ?? 0);
  const completed = Number(stats.completedTasks ?? 0);

  const title = isAdmin ? (
    <>池子里还有 <span className="display-num">{available}</span> 组<br />没被认领的好素材。</>
  ) : isAgent ? (
    <>你的团队有 <span className="display-num">{Number(stats.teamPending ?? 0)}</span> 个任务<br />正在等管理员审核。</>
  ) : (
    <>今天池子里新增 <span className="display-num">{Number(stats.todayGroups ?? 0)}</span> 组，<br />挑一组顺眼的带走。</>
  );

  return (
    <div className="page dashboard">
      <PageHeader
        eyebrow={<>{todayLabel} · 内容中台日报</>}
        title={title}
        description={
          isAdmin
            ? '审核通过的任务才会调用图生图与文案 API。生成完成后全部进入公共池，提交者不自动获得成品。'
            : isAgent
              ? '成品不属于提交者。生成完成后会进入公共池，所有用户（包括你）都要自行领取。'
              : '每一组内容只允许被一个用户领取。领取后立刻从公共池下架，可下载图片与文案 ZIP。'
        }
        actions={
          <>
            {isAdmin ? (
              <Button variant="primary" onClick={() => navigate('/review')}>
                <ClipboardCheck size={16} /> 审核队列 {pending > 0 ? `· ${pending}` : ''}
              </Button>
            ) : (
              <Button variant="primary" onClick={() => navigate('/tasks/new')}>
                <Sparkles size={16} /> 提交素材
              </Button>
            )}
            <Button variant="quiet" onClick={() => navigate('/pool')}>
              进入内容池 <ArrowUpRight size={15} />
            </Button>
          </>
        }
      />

      {isAgent && !stats.inviteEnabled ? (
        <div className="notice notice--amber">
          <ShieldAlert size={17} />
          <div><strong>你的邀请权限已被管理员暂停。</strong>已创建的邀请码将暂时无法注册，恢复权限后自动生效。</div>
        </div>
      ) : null}

      <section className="stat-ribbon">
        <Metric label="公共池可领取" value={available} hint="每组仅一人可得" accent />
        <Metric label={isAdmin ? '待审任务' : isAgent ? '团队待审' : '我的待审'} value={isAgent ? Number(stats.teamPending ?? 0) : pending} hint="审核通过后才消耗 API" />
        <Metric label={isAdmin ? '累计已领取' : '我的已领取'} value={claimed} hint={isAdmin ? '全站领取总量' : '可随时下载 ZIP'} />
        <Metric label={isAdmin ? '累计完成任务' : '已完成任务'} value={completed} hint="内容全部进入公共池" />
      </section>

      <div className="dashboard-grid">
        <Panel className="trend-panel">
          <SectionHeader
            title="入池趋势"
            hint="按内容组生成时间统计，展示最近七天"
            actions={<span className="stamp">实时池存 · {available}</span>}
          />
          <TrendChart series={data.series} />
        </Panel>

        <Panel className="side-panel">
          {isAdmin ? (
            <>
              <SectionHeader title="生成引擎" hint="独立 Worker 进程 · 队列锁" />
              <div className={`worker-status ${data.worker?.online ? 'is-online' : 'is-offline'}`}>
                <span className="pulse-dot" />
                <div>
                  <strong>{data.worker?.online ? 'Worker 运行中' : 'Worker 离线'}</strong>
                  <p>{data.worker?.lastSeenAt ? `心跳 ${fromNow(data.worker.lastSeenAt)}` : '尚未收到心跳，请启动 worker 进程'}</p>
                </div>
              </div>
              <div className="queue-facts">
                <div><span>生成中任务</span><strong>{Number(stats.activeTasks ?? 0)}</strong></div>
                <div><span>失败任务</span><strong className={Number(stats.failedJobs ?? 0) > 0 ? 'text-danger' : ''}>{Number(stats.failedJobs ?? 0)}</strong></div>
                <div><span>待入池组</span><strong>{Number(stats.stagedGroups ?? 0)}</strong></div>
              </div>
              <div className="side-panel__callout">
                <Clock3 size={17} />
                <div>
                  <strong>人工审核是唯一闸门</strong>
                  <p>未审核任务不会启动任何外部 API 调用，防止恶意素材消耗额度。</p>
                </div>
              </div>
              <div className="side-panel__actions">
                <Link to="/review">处理待审任务 <ArrowUpRight size={14} /></Link>
                <Link to="/logs">查看运行日志 <ArrowUpRight size={14} /></Link>
              </div>
            </>
          ) : (
            <>
              <SectionHeader title="领取流程" hint="先到先得，领取后从池中下架" />
              <ol className="steps">
                <li><span>01</span><div><strong>进入公共内容池</strong><p>浏览预览图、标题和标签，所有成品对全员可见。</p></div></li>
                <li><span>02</span><div><strong>选中并领取</strong><p>数据库原子锁保证一组内容只会归属一个人。</p></div></li>
                <li><span>03</span><div><strong>下载完整 ZIP</strong><p>包含 Group_XX 文件夹、变体图片与独立文案 txt。</p></div></li>
              </ol>
              {isAgent ? (
                <div className="side-panel__callout">
                  <Users size={17} />
                  <div>
                    <strong>{Number(stats.downline ?? 0)} 位直属用户</strong>
                    <p>{stats.inviteEnabled ? '邀请权限已开启，可生成邀请码。' : '邀请权限已关闭，请联系管理员。'}</p>
                  </div>
                </div>
              ) : (
                <div className="side-panel__callout">
                  <FolderLock size={17} />
                  <div>
                    <strong>先领先用，不占额度</strong>
                    <p>已领取内容只出现在「我的领取」中，其他用户看不到。</p>
                  </div>
                </div>
              )}
              <div className="side-panel__actions">
                <Link to="/pool">去内容池挑一组 <ArrowUpRight size={14} /></Link>
                <Link to="/tasks/new">提交自己的素材 <ArrowUpRight size={14} /></Link>
              </div>
            </>
          )}
        </Panel>
      </div>

      <Panel>
        <SectionHeader
          title={isAdmin ? '最近任务' : isAgent ? '团队最新任务' : '我的任务'}
          hint={isAdmin ? '全部提交者的任务记录' : isAgent ? '包含你自己与名下用户提交的任务' : '仅展示你提交的任务'}
          actions={<Button size="sm" variant="quiet" onClick={() => navigate('/tasks')}>全部任务 <ArrowUpRight size={14} /></Button>}
        />
        {data.recentTasks.length ? (
          <div className="task-list">
            {data.recentTasks.map((task) => (
              <TaskRow key={task.id} task={task} onOpen={() => navigate(`/tasks/${task.id}`)} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Layers size={22} />}
            title={isAdmin ? '还没有任务提交' : '还没有提交过素材'}
            description={isAdmin ? '代理或用户提交素材后，会在这里出现。' : '上传 1–6 张原图，填写原种草文案与卖点，等待管理员审核。'}
            action={!isAdmin ? <Button variant="primary" onClick={() => navigate('/tasks/new')}>提交第一份素材</Button> : null}
          />
        )}
      </Panel>

      <div className="dashboard-footnote">
        <span><TrendingUp size={15} /> 当前池内可领取 {available} 组，今日新增 {Number(stats.todayGroups ?? 0)} 组</span>
        <span><Badge tone="amber">提示</Badge> {TASK_STATUS_LABEL.COMPLETED} 仅代表生成结束，不代表已被领取。</span>
      </div>
    </div>
  );
}
