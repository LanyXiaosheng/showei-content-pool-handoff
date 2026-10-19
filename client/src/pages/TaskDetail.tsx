import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertOctagon,
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FileWarning,
  Image as ImageIcon,
  Info,
  RefreshCcw,
  RotateCcw,
  ShieldX,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, api } from '@/api/client';
import type { TaskDetail as TaskDetailType, TaskLog } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import {
  Badge,
  Button,
  ErrorBlock,
  LoadingBlock,
  Modal,
  PageHeader,
  Panel,
  Progress,
  SectionHeader,
  TaskStatusBadge,
  Textarea,
} from '@/components/ui';
import { formatBytes } from '@/api/client';
import { formatDateTime, JOB_STATUS_LABEL, percent } from '@/lib/format';
import { taskImageUrl } from '@/lib/media';

type AdminAction = 'APPROVE' | 'REJECT' | 'VOID' | null;

export function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [action, setAction] = useState<AdminAction>(null);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const taskQuery = useQuery({
    queryKey: ['task', id],
    queryFn: () => api.get<TaskDetailType>(`/tasks/${id}`),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const data = query.state.data as TaskDetailType | undefined;
      return data && ['QUEUED', 'GENERATING'].includes(data.status) ? 4000 : false;
    },
  });
  const logsQuery = useQuery({
    queryKey: ['task-logs', id],
    queryFn: () => api.get<{ items: TaskLog[] }>(`/tasks/${id}/logs`),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const data = taskQuery.data;
      return data && ['QUEUED', 'GENERATING'].includes(data.status) ? 4000 : false;
    },
  });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['task', id] }),
      queryClient.invalidateQueries({ queryKey: ['task-logs', id] }),
      queryClient.invalidateQueries({ queryKey: ['tasks'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-content'] }),
    ]);
  };

  const reviewMutation = useMutation({
    mutationFn: (payload: { decision: 'APPROVE' | 'REJECT'; comment?: string }) => api.post(`/tasks/${id}/review`, payload),
    onSuccess: async (_data, variables) => {
      toast.success(variables.decision === 'APPROVE' ? '审核通过，任务已进入生成队列' : '任务已驳回，已通知提交人');
      setAction(null);
      setReason('');
      setActionError(null);
      await invalidate();
    },
    onError: (error) => setActionError(error instanceof ApiError ? error.message : '操作失败'),
  });

  const voidMutation = useMutation({
    mutationFn: () => api.post(`/tasks/${id}/void`, { reason }),
    onSuccess: async () => {
      toast.success('任务已作废，未领取内容已下架');
      setAction(null);
      setReason('');
      setActionError(null);
      await invalidate();
    },
    onError: (error) => setActionError(error instanceof ApiError ? error.message : '操作失败'),
  });

  const retryMutation = useMutation({
    mutationFn: () => api.post(`/tasks/${id}/retry`),
    onSuccess: async () => {
      toast.success('任务已重新进入生成队列');
      await invalidate();
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : '重试失败'),
  });

  if (taskQuery.isLoading) return <div className="page"><LoadingBlock label="正在读取任务详情…" /></div>;
  if (taskQuery.isError || !taskQuery.data) {
    return <div className="page"><ErrorBlock message="任务不存在或你无权查看" retry={() => taskQuery.refetch()} /></div>;
  }
  const task = taskQuery.data;
  const job = task.job;
  const completed = job ? percent(job.completedGroups, job.totalGroups) : 0;
  const isGenerating = ['QUEUED', 'GENERATING'].includes(task.status);
  const timelineStage = task.status === 'PENDING_REVIEW' ? 1 : task.status === 'REJECTED' ? 1 : task.status === 'VOID' ? 0 : task.status === 'COMPLETED' ? 4 : 3;

  function submitAction() {
    setActionError(null);
    if (action === 'APPROVE') return reviewMutation.mutate({ decision: 'APPROVE' });
    if (action === 'REJECT') {
      if (reason.trim().length < 2) {
        setActionError('请填写至少 2 个字的驳回理由');
        return;
      }
      return reviewMutation.mutate({ decision: 'REJECT', comment: reason.trim() });
    }
    if (action === 'VOID') {
      if (reason.trim().length < 2) {
        setActionError('请填写至少 2 个字的作废原因');
        return;
      }
      return voidMutation.mutate();
    }
  }

  return (
    <div className="page task-detail">
      <button className="back-link" onClick={() => navigate(user?.role === 'ADMIN' && task.status === 'PENDING_REVIEW' ? '/review' : '/tasks')}>
        <ArrowLeft size={15} /> 返回{user?.role === 'ADMIN' && task.status === 'PENDING_REVIEW' ? '审核队列' : '任务列表'}
      </button>

      <PageHeader
        eyebrow={`${task.taskNo} · ${formatDateTime(task.createdAt)} 提交`}
        title={task.sourceTitle}
        description={
          <span className="task-subline">
            <TaskStatusBadge status={task.status} />
            <span>提交人 <strong>{task.submitter.displayName}</strong> · {task.submitter.role === 'AGENT' ? '代理' : task.submitter.role === 'ADMIN' ? '管理员' : '普通用户'}</span>
            <span>生成 {task.generationCount} 组</span>
            {task.submitter.id !== user?.id && user?.role === 'ADMIN' ? <span>{task.submitter.email}</span> : null}
          </span>
        }
        actions={
          <>
            {task.permissions.canReview ? (
              <>
                <Button variant="primary" onClick={() => { setAction('APPROVE'); setReason(''); setActionError(null); }}>
                  <CheckCircle2 size={16} /> 审核通过
                </Button>
                <Button variant="quiet" onClick={() => { setAction('REJECT'); setReason(''); setActionError(null); }}>
                  <XCircle size={16} /> 驳回
                </Button>
              </>
            ) : null}
            {task.permissions.canRetry ? (
              <Button variant="secondary" loading={retryMutation.isPending} onClick={() => retryMutation.mutate()}>
                <RotateCcw size={15} /> 重新入队
              </Button>
            ) : null}
            {task.permissions.canVoid ? (
              <Button variant="quiet" onClick={() => { setAction('VOID'); setReason(''); setActionError(null); }}>
                <ShieldX size={15} /> 作废
              </Button>
            ) : null}
          </>
        }
      />

      {task.status === 'PENDING_REVIEW' ? (
        <div className="notice notice--amber">
          <Clock3 size={17} />
          <div><strong>等待管理员审核。</strong>审核通过前，本任务不会调用任何外部 API。</div>
        </div>
      ) : null}
      {task.status === 'REJECTED' ? (
        <div className="notice notice--red">
          <XCircle size={17} />
          <div><strong>任务已被驳回。</strong>{task.reviewComment || '管理员未填写理由。'} <span className="notice__meta">{task.reviewedAt ? formatDateTime(task.reviewedAt) : ''}</span></div>
        </div>
      ) : null}
      {task.status === 'FAILED' ? (
        <div className="notice notice--red">
          <AlertOctagon size={17} />
          <div><strong>生成失败。</strong>{task.failureReason || job?.lastError || '请查看运行日志。'}</div>
        </div>
      ) : null}
      {task.status === 'VOID' ? (
        <div className="notice notice--muted">
          <FileWarning size={17} />
          <div><strong>任务已作废。</strong>{task.voidReason || ''} 未领取内容已从公共池下架，已领取内容不受影响。</div>
        </div>
      ) : null}

      <div className="status-track" aria-label="任务进度">
        {[
          { label: '素材提交', time: formatDateTime(task.createdAt) },
          { label: '人工审核', time: task.reviewedAt ? formatDateTime(task.reviewedAt) : '待处理' },
          { label: '批量生成', time: job ? `${job.completedGroups}/${job.totalGroups} 组` : '未开始' },
          { label: '进入公共池', time: task.counts.available + task.counts.claimed > 0 ? `${task.counts.available + task.counts.claimed} 组已入池` : '未开始' },
        ].map((step, index) => (
          <div className={`status-track__step ${index < timelineStage ? 'is-done' : index === timelineStage ? 'is-current' : ''}`} key={step.label}>
            <span className="status-track__dot">{index < timelineStage ? <CheckCircle2 size={14} /> : String(index + 1).padStart(2, '0')}</span>
            <div><strong>{step.label}</strong><span>{step.time}</span></div>
          </div>
        ))}
      </div>

      <div className="detail-grid">
        <div className="detail-main">
          <Panel>
            <SectionHeader title="原始素材" hint={`${task.images.length} 张原图 · 仅任务相关人可见`} />
            <div className="source-gallery">
              {task.images.map((image) => (
                <button key={image.id} className="source-image" onClick={() => setPreview(taskImageUrl(image.id, false))}>
                  <img src={taskImageUrl(image.id)} alt={image.originalName} />
                  <span><ImageIcon size={13} /> {image.width}×{image.height} · {formatBytes(image.byteSize)}</span>
                </button>
              ))}
            </div>
            <div className="copy-block">
              <span className="label">原始标题</span>
              <h3>{task.sourceTitle}</h3>
              <span className="label">原始正文</span>
              <p>{task.sourceBody || '未填写；生成时以标题和卖点为依据。'}</p>
              <span className="label">菜品卖点 · {task.sellingPoints.length} 项</span>
              <ul className="selling-list">{task.sellingPoints.map((point) => <li key={point}>{point}</li>)}</ul>
              <span className="label">原始标签</span>
              <div className="tag-row">{task.tags.length
                ? task.tags.map((tag) => <span className="tag" key={tag}>#{tag}</span>)
                : <span>未填写；生成时使用标签库。</span>}</div>
            </div>
          </Panel>

          <Panel>
            <SectionHeader
              title="生成进度"
              hint={isGenerating ? '内容组完成后会先暂存，全部完成后统一入池' : '任务级运行记录'}
              actions={job ? <Badge tone={job.status === 'SUCCEEDED' ? 'green' : job.status === 'FAILED' ? 'red' : 'blue'}>{JOB_STATUS_LABEL[job.status] ?? job.status}</Badge> : null}
            />
            {job ? (
              <>
                <div className="job-progress">
                  <div className="job-progress__head">
                    <strong>{job.completedGroups} <em>/ {job.totalGroups} 组</em></strong>
                    <span>第 {job.attempts} / {job.maxAttempts} 次尝试</span>
                  </div>
                  <Progress value={completed} />
                  <div className="job-progress__meta">
                    <span>开始：{job.startedAt ? formatDateTime(job.startedAt) : '—'}</span>
                    <span>结束：{job.finishedAt ? formatDateTime(job.finishedAt) : '—'}</span>
                    {job.lastError ? <span className="text-danger">最近错误：{job.lastError}</span> : null}
                  </div>
                </div>
                <div className="detail-counters">
                  <div><span>可领取</span><strong>{task.counts.available}</strong></div>
                  <div><span>已领取</span><strong>{task.counts.claimed}</strong></div>
                  <div><span>已下架</span><strong>{task.counts.withdrawn}</strong></div>
                  <div><span>变体图片</span><strong>{task.counts.generatedImages}</strong></div>
                </div>
              </>
            ) : (
              <div className="inline-empty">审核通过后会创建生成队列。当前未调用外部 API。</div>
            )}
          </Panel>

          <Panel>
            <SectionHeader title="运行日志" hint="接口重试、质量卡口、相似度过滤与状态变更" actions={<Button size="sm" variant="quiet" onClick={() => logsQuery.refetch()}><RefreshCcw size={13} /> 刷新</Button>} />
            {logsQuery.isLoading ? <LoadingBlock /> : !logsQuery.data?.items.length ? (
              <div className="inline-empty">暂无日志</div>
            ) : (
              <div className="log-list">
                {logsQuery.data.items.slice(0, 40).map((log) => (
                  <details className={`log-item log-item--${log.level.toLowerCase()}`} key={log.id}>
                    <summary>
                      <span className="log-item__level">{log.level}</span>
                      <span className="log-item__message">{log.message}</span>
                      <time>{formatDateTime(log.created_at)}</time>
                    </summary>
                    <div className="log-item__meta">
                      <span className="mono-label">{log.event}</span>
                      {log.meta && Object.keys(log.meta).length ? <pre>{JSON.stringify(log.meta, null, 2)}</pre> : <p>无额外上下文</p>}
                    </div>
                  </details>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <aside className="detail-aside">
          <div className="aside-card">
            <span className="eyebrow">TASK FACTS</span>
            <h3>任务信息</h3>
            <dl className="fact-list">
              <div><dt>任务编号</dt><dd className="mono-label">{task.taskNo}</dd></div>
              <div><dt>提交人</dt><dd>{task.submitter.displayName}</dd></div>
              <div><dt>提交时间</dt><dd>{formatDateTime(task.createdAt)}</dd></div>
              <div><dt>审核时间</dt><dd>{task.reviewedAt ? formatDateTime(task.reviewedAt) : '待审核'}</dd></div>
              <div><dt>生成组数</dt><dd>{task.generationCount} 组</dd></div>
              <div><dt>当前状态</dt><dd><TaskStatusBadge status={task.status} /></dd></div>
            </dl>
          </div>
          <div className="aside-card aside-card--quote">
            <p>“成品不属于提交者。<br />所有内容进入公共池，<br />先到先得，领完即止。”</p>
            <span>— 拾味 · 领取规则</span>
          </div>
          {user?.role === 'ADMIN' && task.status === 'PENDING_REVIEW' ? (
            <div className="aside-card aside-card--rules">
              <span className="eyebrow">REVIEW CHECK</span>
              <h3>审核前检查</h3>
              <ul className="rule-list">
                <li><ClipboardCheck size={14} /> 素材是否与任务描述一致</li>
                <li><ClipboardCheck size={14} /> 卖点是否完整、具体</li>
                <li><ClipboardCheck size={14} /> 生成组数是否合理</li>
                <li><ClipboardCheck size={14} /> 是否疑似恶意消耗额度</li>
              </ul>
            </div>
          ) : null}
          {task.review?.comment ? (
            <div className="aside-card aside-card--muted">
              <span className="eyebrow">REVIEW NOTE</span>
              <p>{task.review.comment}</p>
            </div>
          ) : null}
          {user?.role === 'ADMIN' ? (
            <div className="aside-card aside-card--muted">
              <span className="eyebrow">PRIVACY</span>
              <p>此页面不展示底层 Prompt、API 密钥或 Provider 返回的原始响应。敏感信息只存在管理员配置中心。</p>
            </div>
          ) : null}
        </aside>
      </div>

      <Modal
        open={action !== null}
        title={action === 'APPROVE' ? '确认通过审核？' : action === 'REJECT' ? '驳回这个任务' : '作废任务'}
        description={action === 'APPROVE' ? '通过后将立即进入生成队列，并开始消耗外部 API 额度。' : action === 'REJECT' ? '驳回理由会通知提交者；任务不会生成。' : '作废后，未领取内容会从公共池下架；已领取内容保留。'}
        onClose={() => { if (!reviewMutation.isPending && !voidMutation.isPending) setAction(null); }}
        footer={
          <>
            <Button variant="quiet" onClick={() => setAction(null)} disabled={reviewMutation.isPending || voidMutation.isPending}>取消</Button>
            <Button
              variant={action === 'APPROVE' ? 'primary' : 'danger'}
              loading={reviewMutation.isPending || voidMutation.isPending}
              onClick={submitAction}
            >
              {action === 'APPROVE' ? '确认通过，开始生成' : action === 'REJECT' ? '确认驳回' : '确认作废'}
            </Button>
          </>
        }
      >
        {action === 'APPROVE' ? (
          <div className="review-summary">
            <div><span>任务</span><strong>{task.taskNo}</strong></div>
            <div><span>生成组数</span><strong>{task.generationCount} 组</strong></div>
            <div><span>提交人</span><strong>{task.submitter.displayName}</strong></div>
            <p><Info size={14} /> 提交人不会自动获得成品，全部内容将进入公共池。</p>
          </div>
        ) : (
          <label className="field">
            <span className="field__label">{action === 'REJECT' ? '驳回理由' : '作废原因'} <span className="field__required">必填</span></span>
            <Textarea
              rows={4}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={action === 'REJECT' ? '例如：素材不是菜品实拍 / 卖点与原文不一致 / 建议补充原图后重提' : '例如：素材版权存疑，任务作废'}
              maxLength={500}
              autoFocus
            />
          </label>
        )}
        {actionError ? <div className="form-error">{actionError}</div> : null}
      </Modal>

      <Modal open={Boolean(preview)} title="原图预览" onClose={() => setPreview(null)} width="860px">
        {preview ? <img src={preview} alt="原图预览" style={{ width: '100%', borderRadius: '2px' }} /> : null}
      </Modal>
    </div>
  );
}
