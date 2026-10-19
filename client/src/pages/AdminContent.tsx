import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, ImageOff, Layers, Search } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, api, buildQuery, downloadFile } from '@/api/client';
import type { AdminContentItem, Pagination } from '@/api/types';
import {
  Button,
  EmptyState,
  ErrorBlock,
  GroupStatusBadge,
  Input,
  LoadingBlock,
  PageHeader,
  Pagination as PaginationControl,
} from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { groupImageUrl } from '@/lib/media';
import { useDebouncedValue } from '@/lib/hooks';

const statusTabs = [
  { value: '', label: '全部' },
  { value: 'AVAILABLE', label: '可领取' },
  { value: 'CLAIMED', label: '已领取' },
  { value: 'STAGED', label: '待入池' },
  { value: 'WITHDRAWN', label: '已下架' },
];

export function AdminContent() {
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [downloading, setDownloading] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search, 350);
  const query = useQuery({
    queryKey: ['admin-content', { status, search: debouncedSearch, page }],
    queryFn: () => api.get<{ items: AdminContentItem[]; pagination: Pagination }>(
      `/admin/content${buildQuery({ status, q: debouncedSearch, page, pageSize: 30 })}`,
    ),
  });

  async function download(item: AdminContentItem) {
    setDownloading(item.id);
    try {
      await downloadFile(`/content/${item.id}/download`, `${item.groupCode}_Group.zip`);
      toast.success('ZIP 已开始下载');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '下载失败');
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="ALL CONTENT · 全量内容"
        title="内容资产管理"
        description="查看所有任务生成的每一组内容、当前状态与领取归属。下载仅用于审核留档，不代表领取。"
      />
      <div className="toolbar">
        <div className="tabs tabs--scroll">
          {statusTabs.map((tab) => (
            <button key={tab.value} className={`tab ${status === tab.value ? 'is-active' : ''}`} onClick={() => { setStatus(tab.value); setPage(1); }}>{tab.label}</button>
          ))}
        </div>
        <div className="search-box">
          <Search size={15} />
          <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="搜索内容编号 / 标题 / 任务号" />
        </div>
      </div>

      {query.isLoading ? <LoadingBlock /> : query.isError ? <ErrorBlock message="内容列表加载失败" retry={() => query.refetch()} /> : !query.data?.items.length ? (
        <EmptyState icon={<Layers size={22} />} title="没有符合条件的内容" description="生成完成后，内容组会在这里按状态展示。" />
      ) : (
        <>
          <div className="table-wrap">
            <table className="data-table data-table--content">
              <thead>
                <tr><th>内容</th><th>状态</th><th>来源任务</th><th>领取人</th><th>领取时间</th><th>生成时间</th><th /></tr>
              </thead>
              <tbody>
                {query.data.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="content-cell">
                        {item.coverImageId ? <img src={groupImageUrl(item.coverImageId, true)} alt="" /> : <span className="content-cell__fallback"><ImageOff size={15} /></span>}
                        <div className="cell-stack">
                          <span className="mono-label">{item.groupCode}</span>
                          <strong>{item.title}</strong>
                          <span className="cell-muted">{item.imageCount} 张变体图</span>
                        </div>
                      </div>
                    </td>
                    <td><GroupStatusBadge status={item.status} /></td>
                    <td><span className="mono-label">{item.taskNo}</span><span className="cell-muted block">{item.sourceTitle.slice(0, 20)}…</span></td>
                    <td>{item.claimantName ?? '—'}</td>
                    <td className="nowrap">{item.claimedAt ? formatDateTime(item.claimedAt) : '—'}</td>
                    <td className="nowrap">{formatDateTime(item.createdAt)}</td>
                    <td><Button size="sm" variant="quiet" loading={downloading === item.id} onClick={() => download(item)}><Download size={14} /></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PaginationControl page={query.data.pagination.page} totalPages={query.data.pagination.totalPages} total={query.data.pagination.total} onChange={setPage} />
        </>
      )}
    </div>
  );
}
