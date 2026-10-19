import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Eye, FileCode2, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, api } from '@/api/client';
import type { PromptTemplate } from '@/api/types';
import {
  Badge,
  Button,
  EmptyState,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Textarea,
  Toggle,
} from '@/components/ui';
import { formatDateTime } from '@/lib/format';

export function Prompts() {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<'IMAGE' | 'COPY'>('IMAGE');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PromptTemplate | null>(null);
  const query = useQuery({
    queryKey: ['prompts'],
    queryFn: () => api.get<{ items: PromptTemplate[] }>('/admin/prompts'),
  });
  const versions = useMemo(() => (query.data?.items ?? []).filter((item) => item.kind === kind), [query.data, kind]);
  const active = versions.find((item) => item.isActive) ?? null;
  const selected = versions.find((item) => item.id === selectedId) ?? active ?? versions[0] ?? null;

  useEffect(() => {
    if (!selectedId && active) setSelectedId(active.id);
  }, [active, selectedId]);

  useEffect(() => {
    setSelectedId(null);
  }, [kind]);

  const activate = useMutation({
    mutationFn: (id: string) => api.post(`/admin/prompts/${id}/activate`),
    onSuccess: async () => {
      toast.success('已切换为当前生效版本');
      await queryClient.invalidateQueries({ queryKey: ['prompts'] });
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : '切换失败'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/prompts/${id}`),
    onSuccess: async () => {
      toast.success('Prompt 版本已删除');
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['prompts'] });
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : '删除失败'),
  });

  return (
    <div className="page prompts-page">
      <PageHeader
        eyebrow="INTERNAL PROMPTS · 仅管理员"
        title="提示词，是这套系统的底稿。"
        description="生图与文案 Prompt 只对管理员可见。代理和普通用户的任何接口都不会返回 Prompt 内容。每次修改都会生成新版本，正在运行的任务继续使用启动时的快照。"
        actions={<Button variant="primary" onClick={() => setEditorOpen(true)} disabled={!versions.length}><Plus size={16} /> 新建版本</Button>}
      />

      <div className="notice notice--muted">
        <ShieldCheck size={17} />
        <div><strong>权限边界</strong> Prompt 相关接口全部经过管理员角色校验。即使知道 URL，代理与普通用户也会收到 403。此页面不读取任何 API 密钥。</div>
      </div>

      <div className="prompt-tabs">
        <div className="tabs">
          <button className={`tab ${kind === 'IMAGE' ? 'is-active' : ''}`} onClick={() => setKind('IMAGE')}>生图 Prompt</button>
          <button className={`tab ${kind === 'COPY' ? 'is-active' : ''}`} onClick={() => setKind('COPY')}>文案 Prompt</button>
        </div>
        <span className="toolbar__note">{versions.length} 个历史版本 · 当前生效 {active ? `v${active.version}` : '无'}</span>
      </div>

      {query.isLoading ? <LoadingBlock /> : query.isError ? <ErrorBlock message="Prompt 加载失败" retry={() => query.refetch()} /> : !versions.length ? (
        <EmptyState icon={<FileCode2 size={22} />} title="还没有 Prompt 版本" description="创建一个版本并激活后，审核通过的任务才能开始生成。" />
      ) : (
        <div className="prompt-layout">
          <aside className="version-rail">
            <div className="version-rail__head"><span className="eyebrow">VERSIONS</span><span>{versions.length}</span></div>
            {versions.map((version) => (
              <button
                key={version.id}
                className={`version-item ${selected?.id === version.id ? 'is-selected' : ''}`}
                onClick={() => setSelectedId(version.id)}
              >
                <span className="version-item__num">v{version.version}</span>
                <span className="version-item__meta">
                  <strong>{version.name}</strong>
                  <span>{formatDateTime(version.createdAt)} · {version.creatorName ?? '系统'}</span>
                </span>
                {version.isActive ? <Badge tone="green">生效</Badge> : null}
              </button>
            ))}
          </aside>

          <section className="prompt-viewer">
            {selected ? (
              <>
                <div className="prompt-viewer__head">
                  <div>
                    <span className="eyebrow">{kind === 'IMAGE' ? 'IMAGE GENERATION PROMPT' : 'COPYWRITING PROMPT'} · V{selected.version}</span>
                    <h2>{selected.name}</h2>
                    <p>{selected.isActive ? '这是当前生效版本。新审核通过的任务会使用它。' : '这是历史版本，仅供查看与对比。'}</p>
                  </div>
                  <div className="inline-actions">
                    {!selected.isActive ? (
                      <Button size="sm" variant="secondary" loading={activate.isPending} onClick={() => activate.mutate(selected.id)}><Check size={14} /> 设为生效</Button>
                    ) : <Badge tone="green" dot>当前生效</Badge>}
                    <Button size="sm" variant="quiet" onClick={() => setEditorOpen(true)}><Plus size={14} /> 基于此版本新建</Button>
                    {!selected.isActive ? <Button size="sm" variant="quiet" onClick={() => setDeleteTarget(selected)}><Trash2 size={14} /></Button> : null}
                  </div>
                </div>

                {kind === 'IMAGE' ? (
                  <div className="prompt-content">
                    <PromptSection title="正向提示词" text={selected.content.positiveTemplate} />
                    <PromptSection title="负面提示词" text={selected.content.negativeTemplate} />
                    <div className="prompt-grid">
                      <PromptList title="倾斜角度" items={selected.content.variantOptions?.angles} />
                      <PromptList title="裁切景别" items={selected.content.variantOptions?.crops} />
                      <PromptList title="光影" items={selected.content.variantOptions?.lights} />
                      <PromptList title="配菜重排" items={selected.content.variantOptions?.garnishes} />
                    </div>
                    <div className="prompt-meta-line"><span>API 输出尺寸</span><strong>{selected.content.outputSize || '1024x1536'}</strong><span>占位符</span><code>{'{{angle}} {{crop}} {{garnish}} {{light}}'}</code></div>
                  </div>
                ) : (
                  <div className="prompt-content">
                    <PromptSection title="System Prompt" text={selected.content.systemPrompt} />
                    <PromptSection title="User Prompt 模板" text={selected.content.userTemplate} tall />
                    <div className="prompt-grid">
                      <PromptList title="标题钩子池" items={selected.content.titleHooks} />
                      <PromptList title="开篇方向" items={selected.content.openingLines} />
                      <PromptList title="叙事结构" items={selected.content.narrativeStructures} />
                      <PromptList title="标签库" items={selected.content.tagLibrary} />
                    </div>
                    <div className="prompt-meta-line"><span>可用占位符</span><code>{'{{sourceTitle}} {{sourceBody}} {{sellingPoints}} {{tags}} {{titleHooks}} {{openingLines}} {{narrativeStructures}} {{tagLibrary}}'}</code></div>
                  </div>
                )}
              </>
            ) : null}
          </section>
        </div>
      )}

      {editorOpen ? (
        <PromptEditor
          kind={kind}
          source={selected}
          open={editorOpen}
          onClose={() => setEditorOpen(false)}
          onSaved={async () => {
            setEditorOpen(false);
            await queryClient.invalidateQueries({ queryKey: ['prompts'] });
          }}
        />
      ) : null}

      <Modal
        open={Boolean(deleteTarget)}
        title="删除这个历史版本？"
        description="只有未生效的版本可以删除，此操作不可撤销。"
        onClose={() => setDeleteTarget(null)}
        footer={<><Button variant="quiet" onClick={() => setDeleteTarget(null)}>取消</Button><Button variant="danger" loading={remove.isPending} onClick={() => deleteTarget && remove.mutate(deleteTarget.id)}>确认删除</Button></>}
      >
        <div className="review-summary"><div><span>版本</span><strong>v{deleteTarget?.version}</strong></div><div><span>名称</span><strong>{deleteTarget?.name}</strong></div></div>
      </Modal>
    </div>
  );
}

function PromptSection({ title, text, tall = false }: { title: string; text: string; tall?: boolean }) {
  return (
    <div className="prompt-section">
      <div className="prompt-section__head"><span className="eyebrow">{title}</span><span>{text?.length ?? 0} 字</span></div>
      <pre className={tall ? 'is-tall' : ''}>{text}</pre>
    </div>
  );
}

function PromptList({ title, items }: { title: string; items?: string[] }) {
  return (
    <div className="prompt-list">
      <div className="prompt-list__head"><span className="eyebrow">{title}</span><span>{items?.length ?? 0}</span></div>
      <ol>{items?.map((item, index) => <li key={`${item}-${index}`}><span>{String(index + 1).padStart(2, '0')}</span>{item}</li>)}</ol>
    </div>
  );
}

function linesToArray(value: string): string[] {
  return value.split('\n').map((line) => line.trim()).filter(Boolean);
}

function PromptEditor({
  kind,
  source,
  open,
  onClose,
  onSaved,
}: {
  kind: 'IMAGE' | 'COPY';
  source: PromptTemplate | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(source ? `${source.name} · 新版` : kind === 'IMAGE' ? '内置生图 Prompt' : '内置文案 Prompt');
  const [positive, setPositive] = useState(source?.kind === 'IMAGE' ? source.content.positiveTemplate : '');
  const [negative, setNegative] = useState(source?.kind === 'IMAGE' ? source.content.negativeTemplate : '');
  const [outputSize, setOutputSize] = useState(source?.kind === 'IMAGE' ? source.content.outputSize ?? '1024x1536' : '1024x1536');
  const [angles, setAngles] = useState(source?.kind === 'IMAGE' ? (source.content.variantOptions?.angles ?? []).join('\n') : '小幅度左倾\n大幅度左倾\n小幅度右倾\n大幅度右倾');
  const [crops, setCrops] = useState(source?.kind === 'IMAGE' ? (source.content.variantOptions?.crops ?? []).join('\n') : '局部特写\n半盘特写\n完整摆盘');
  const [garnishes, setGarnishes] = useState(source?.kind === 'IMAGE' ? (source.content.variantOptions?.garnishes ?? []).join('\n') : '柠檬移到左上\n香草散落在右下\n酱汁沿盘缘轻扫');
  const [lights, setLights] = useState(source?.kind === 'IMAGE' ? (source.content.variantOptions?.lights ?? []).join('\n') : '暖自然光\n冷调柔光\n局部高光');
  const [systemPrompt, setSystemPrompt] = useState(source?.kind === 'COPY' ? source.content.systemPrompt : '');
  const [userTemplate, setUserTemplate] = useState(source?.kind === 'COPY' ? source.content.userTemplate : '');
  const [titleHooks, setTitleHooks] = useState(source?.kind === 'COPY' ? (source.content.titleHooks ?? []).join('\n') : '');
  const [openings, setOpenings] = useState(source?.kind === 'COPY' ? (source.content.openingLines ?? []).join('\n') : '');
  const [structures, setStructures] = useState(source?.kind === 'COPY' ? (source.content.narrativeStructures ?? []).join('\n') : '场景前置\n菜品体验前置\n细节反差前置');
  const [tagLibrary, setTagLibrary] = useState(source?.kind === 'COPY' ? (source.content.tagLibrary ?? []).join('\n') : '');
  const [activateNow, setActivateNow] = useState(!source?.isActive);
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => api.post<PromptTemplate>('/admin/prompts', {
      kind,
      name,
      activate: activateNow,
      content: kind === 'IMAGE' ? {
        positiveTemplate: positive,
        negativeTemplate: negative,
        outputSize,
        variantOptions: {
          angles: linesToArray(angles),
          crops: linesToArray(crops),
          garnishes: linesToArray(garnishes),
          lights: linesToArray(lights),
        },
      } : {
        systemPrompt,
        userTemplate,
        titleHooks: linesToArray(titleHooks),
        openingLines: linesToArray(openings),
        narrativeStructures: linesToArray(structures),
        tagLibrary: linesToArray(tagLibrary),
      },
    }),
    onSuccess: async () => {
      toast.success(activateNow ? '新版本已保存并生效' : '新版本已保存，当前未生效');
      await onSaved();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : '保存失败'),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!name.trim()) return setError('请填写版本名称');
    mutation.mutate();
  }

  return (
    <Modal
      open={open}
      title={source ? `基于 v${source.version} 创建新版本` : '新建 Prompt 版本'}
      description={kind === 'IMAGE' ? 'Prompt 中可以使用 {{angle}}、{{crop}}、{{garnish}}、{{light}} 占位符。' : 'Prompt 中可以使用原始素材与变体指令占位符。保存后不会修改历史版本。'}
      onClose={onClose}
      width="900px"
      footer={<><Button variant="quiet" onClick={onClose}>取消</Button><Button variant="primary" loading={mutation.isPending} onClick={submit}>保存为新版本</Button></>}
    >
      <form className="form-stack prompt-editor" onSubmit={submit}>
        <Field label="版本名称" required><Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} /></Field>
        {kind === 'IMAGE' ? (
          <>
            <Field label="正向提示词" required hint="包含构图、材质、光影、L 型倾斜与去除水印要求">
              <Textarea rows={7} value={positive} onChange={(event) => setPositive(event.target.value)} />
            </Field>
            <Field label="负面提示词" required hint="强约束餐盘变形、塑料质感、水印与 AI 假质感">
              <Textarea rows={3} value={negative} onChange={(event) => setNegative(event.target.value)} />
            </Field>
            <Field label="API 输出尺寸"><Input value={outputSize} onChange={(event) => setOutputSize(event.target.value)} placeholder="1024x1536" /></Field>
            <div className="form-grid form-grid--two">
              <Field label="倾斜角度池" hint="每行一个，至少 2 个"><Textarea rows={4} value={angles} onChange={(event) => setAngles(event.target.value)} /></Field>
              <Field label="裁切景别池" hint="每行一个"><Textarea rows={4} value={crops} onChange={(event) => setCrops(event.target.value)} /></Field>
              <Field label="配菜重排池" hint="每行一个"><Textarea rows={4} value={garnishes} onChange={(event) => setGarnishes(event.target.value)} /></Field>
              <Field label="光影池" hint="每行一个"><Textarea rows={4} value={lights} onChange={(event) => setLights(event.target.value)} /></Field>
            </div>
          </>
        ) : (
          <>
            <Field label="System Prompt" required><Textarea rows={4} value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} /></Field>
            <Field label="User Prompt 模板" required hint="必须包含原始素材与全部卖点，并约束三段式与 JSON 输出"><Textarea rows={9} value={userTemplate} onChange={(event) => setUserTemplate(event.target.value)} /></Field>
            <div className="form-grid form-grid--two">
              <Field label="标题钩子池" hint="每行一个"><Textarea rows={5} value={titleHooks} onChange={(event) => setTitleHooks(event.target.value)} /></Field>
              <Field label="开篇方向" hint="每行一个"><Textarea rows={5} value={openings} onChange={(event) => setOpenings(event.target.value)} /></Field>
              <Field label="叙事结构池" hint="每行一个"><Textarea rows={4} value={structures} onChange={(event) => setStructures(event.target.value)} /></Field>
              <Field label="话题标签库" hint="每行一个"><Textarea rows={4} value={tagLibrary} onChange={(event) => setTagLibrary(event.target.value)} /></Field>
            </div>
          </>
        )}
        <div className="switch-line">
          <div><strong>保存后立即设为生效版本</strong><span>正在运行的任务仍使用启动时的快照，不受影响</span></div>
          <Toggle checked={activateNow} onChange={setActivateNow} label="保存后立即生效" />
        </div>
        {error ? <div className="form-error">{error}</div> : null}
      </form>
    </Modal>
  );
}
