import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Copy, KeyRound, Plus, Ticket, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, api, buildQuery } from '@/api/client';
import type { Invite, Pagination, Role } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import {
  Button,
  CopyButton,
  EmptyState,
  ErrorBlock,
  Field,
  Input,
  InviteStatusBadge,
  LoadingBlock,
  Modal,
  PageHeader,
  Pagination as PaginationControl,
  RoleBadge,
  Select,
  Textarea,
} from '@/components/ui';
import { formatDate, formatDateTime } from '@/lib/format';

export function Invites() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [created, setCreated] = useState<Invite | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<Invite | null>(null);

  const query = useQuery({
    queryKey: ['invites', { status, page }],
    queryFn: () => api.get<{ items: Invite[]; pagination: Pagination; inviteEnabled: boolean }>(
      `/invites${buildQuery({ status, page, pageSize: 20 })}`,
    ),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.post(`/invites/${id}/revoke`),
    onSuccess: async () => {
      toast.success('邀请码已撤销');
      setRevokeTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['invites'] });
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : '撤销失败'),
  });

  const isAdmin = user?.role === 'ADMIN';
  const inviteEnabled = query.data?.inviteEnabled ?? (isAdmin || user?.inviteEnabled);
  return (
    <div className="page">
      <PageHeader
        eyebrow="INVITATIONS · 邀请体系"
        title="一张码，只带对的人来。"
        description={isAdmin ? '管理员可以邀请代理或普通用户。代理只能邀请普通用户，且邀请能力可随时关闭。' : '你只能邀请普通用户。用户之间没有互相邀请入口。'}
        actions={
          <>
            <Button variant="primary" onClick={() => setCreateOpen(true)} disabled={!inviteEnabled}>
              <Plus size={16} /> 生成邀请码
            </Button>
          </>
        }
      />

      {!inviteEnabled ? (
        <div className="notice notice--amber"><Ban size={17} /><div><strong>邀请权限已被管理员关闭。</strong>你不能生成新的邀请码，已有邀请码也会暂停注册。</div></div>
      ) : null}

      <div className="toolbar">
        <div className="tabs">
          {['', 'ACTIVE', 'EXPIRED', 'USED', 'REVOKED'].map((value) => (
            <button key={value} className={`tab ${status === value ? 'is-active' : ''}`} onClick={() => { setStatus(value); setPage(1); }}>
              {{ '': '全部', ACTIVE: '可用', EXPIRED: '已过期', USED: '已用完', REVOKED: '已撤销' }[value]}
            </button>
          ))}
        </div>
        <span className="toolbar__note">邀请码绑定角色 · 有有效期与使用次数上限</span>
      </div>

      {query.isLoading ? <LoadingBlock /> : query.isError ? <ErrorBlock message="邀请码加载失败" retry={() => query.refetch()} /> : !query.data?.items.length ? (
        <EmptyState
          icon={<Ticket size={22} />}
          title="还没有邀请码"
          description={inviteEnabled ? '生成一张邀请码，发给需要加入的普通用户或代理。' : '邀请权限开启后才能生成。'}
          action={inviteEnabled ? <Button variant="primary" onClick={() => setCreateOpen(true)}><KeyRound size={15} /> 生成第一张邀请码</Button> : null}
        />
      ) : (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>邀请码</th><th>角色</th><th>邀请人</th><th>使用情况</th><th>有效期</th><th>状态</th><th /></tr></thead>
              <tbody>
                {query.data.items.map((invite) => (
                  <tr key={invite.id}>
                    <td>
                      <div className="cell-stack">
                        <span className="invite-code">{invite.code}</span>
                        {invite.note ? <span className="cell-muted">{invite.note}</span> : null}
                      </div>
                    </td>
                    <td><RoleBadge role={invite.role} /></td>
                    <td>{invite.inviterName}</td>
                    <td><span className="num-cell">{invite.usedCount}</span> / {invite.maxUses} 次</td>
                    <td><div className="cell-stack"><span>{formatDate(invite.expiresAt)}</span><span className="cell-muted">{formatDateTime(invite.createdAt)} 创建</span></div></td>
                    <td><InviteStatusBadge status={invite.status} /></td>
                    <td>
                      <div className="inline-actions">
                        <CopyButton value={invite.url} label="复制链接" />
                        {invite.status === 'ACTIVE' ? (
                          <Button size="sm" variant="quiet" onClick={() => setRevokeTarget(invite)}><Ban size={13} /> 撤销</Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PaginationControl page={query.data.pagination.page} totalPages={query.data.pagination.totalPages} total={query.data.pagination.total} onChange={setPage} />
        </>
      )}

      <CreateInviteModal
        open={createOpen}
        isAdmin={isAdmin}
        onClose={() => setCreateOpen(false)}
        onCreated={async (invite) => {
          setCreateOpen(false);
          setCreated(invite);
          await queryClient.invalidateQueries({ queryKey: ['invites'] });
        }}
      />

      <Modal
        open={Boolean(created)}
        title="邀请码已生成"
        description="邀请链接包含角色与使用限制。请通过可信渠道发送。"
        onClose={() => setCreated(null)}
        footer={<Button variant="primary" onClick={() => setCreated(null)}>完成</Button>}
      >
        {created ? (
          <div className="invite-created">
            <span className="eyebrow">INVITE CODE</span>
            <strong className="invite-created__code">{created.code}</strong>
            <div className="invite-created__link">
              <Input readOnly value={created.url} onFocus={(event) => event.target.select()} />
              <CopyButton value={created.url} label="复制链接" />
            </div>
            <div className="invite-created__facts">
              <div><span>角色</span><RoleBadge role={created.role} /></div>
              <div><span>有效期至</span><strong>{formatDate(created.expiresAt)}</strong></div>
              <div><span>可用次数</span><strong>{created.maxUses} 次</strong></div>
            </div>
            <p><UserPlus size={14} /> 注册时角色由邀请码决定，注册后不可通过前端改变。</p>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(revokeTarget)}
        title="撤销这张邀请码？"
        description="撤销后立即失效，已使用该码注册的账号不受影响。"
        onClose={() => setRevokeTarget(null)}
        footer={<><Button variant="quiet" onClick={() => setRevokeTarget(null)}>取消</Button><Button variant="danger" loading={revoke.isPending} onClick={() => revokeTarget && revoke.mutate(revokeTarget.id)}>确认撤销</Button></>}
      >
        <div className="review-summary"><div><span>邀请码</span><strong>{revokeTarget?.code}</strong></div><div><span>已使用</span><strong>{revokeTarget?.usedCount} 次</strong></div></div>
      </Modal>
    </div>
  );
}

function CreateInviteModal({
  open,
  isAdmin,
  onClose,
  onCreated,
}: {
  open: boolean;
  isAdmin: boolean;
  onClose: () => void;
  onCreated: (invite: Invite) => void;
}) {
  const [role, setRole] = useState<Role>('USER');
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [maxUses, setMaxUses] = useState(1);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => api.post<Invite>('/invites', { role, expiresInDays, maxUses, note }),
    onSuccess: (data) => {
      setNote('');
      setError(null);
      onCreated(data);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : '生成失败'),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    mutation.mutate();
  }

  return (
    <Modal
      open={open}
      title="生成邀请码"
      description={isAdmin ? '管理员可邀请代理或普通用户。' : '代理只能邀请普通用户，邀请权限需由管理员开启。'}
      onClose={onClose}
      footer={<><Button variant="quiet" onClick={onClose}>取消</Button><Button variant="primary" loading={mutation.isPending} onClick={submit}>生成邀请码</Button></>}
    >
      <form className="form-stack" onSubmit={submit}>
        {isAdmin ? (
          <div className="segmented">
            <button type="button" className={role === 'USER' ? 'is-active' : ''} onClick={() => setRole('USER')}>邀请普通用户</button>
            <button type="button" className={role === 'AGENT' ? 'is-active' : ''} onClick={() => setRole('AGENT')}>邀请代理</button>
          </div>
        ) : (
          <div className="locked-role"><RoleBadge role="USER" /><span>代理只能邀请普通用户，角色不可更改。</span></div>
        )}
        <div className="form-grid">
          <Field label="有效期" required>
            <Select value={String(expiresInDays)} onChange={(event) => setExpiresInDays(Number(event.target.value))}>
              <option value="1">1 天</option><option value="3">3 天</option><option value="7">7 天</option><option value="14">14 天</option><option value="30">30 天</option>
            </Select>
          </Field>
          <Field label="可用次数" required hint="每次注册消耗 1 次">
            <Select value={String(maxUses)} onChange={(event) => setMaxUses(Number(event.target.value))}>
              <option value="1">1 次</option><option value="3">3 次</option><option value="5">5 次</option><option value="10">10 次</option><option value="20">20 次</option>
            </Select>
          </Field>
        </div>
        <Field label="备注" hint="仅管理员和邀请人可见，例如：给探店小队">
          <Textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} maxLength={200} placeholder="可选备注" />
        </Field>
        <div className="notice notice--muted notice--compact"><Ticket size={15} /><div>邀请码有防刷限制：同一创建人 24 小时最多 30 张，注册接口有独立限流。</div></div>
        {error ? <div className="form-error">{error}</div> : null}
      </form>
    </Modal>
  );
}
