import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  ALLOWED_TRANSITIONS,
  type AnnotationDomainSnapshot,
  type AnnotationStatus,
  type AuthSessionResponseDto,
  type ExportFileV1,
  type ImportItemError,
  canActorModifyAnnotation,
  evaluateAnnotationMutation,
  validateExportPayload,
} from '@spriter/shared';
import { AnnotationWorkspaceStore } from '../../app/annotation-store.ts';
import { ApiClientError } from '../../adapters/http-annotation-api.ts';
import { ModelUploadService } from '../../adapters/model-upload.ts';
import { SocketRealtimeAdapter, type SocketLike } from '../../adapters/socket-realtime-adapter.ts';
import type { ViewportBridge } from '@spriter/shared';
import { AnnotationThreadPanelController } from './AnnotationThreadController.ts';
import type { WorkspaceApiPort } from './workspace-ports.ts';
import { annotationTitle, displayName, formatDate, initials, statusLabels } from './annotation-view.ts';
import './collaboration.css';

type Filter = 'ALL' | AnnotationStatus;
type SessionMode = 'demo' | 'live';
type SocketFactory = (token: string) => { socket: SocketLike; disconnect(): void };

const demoSession: AuthSessionResponseDto = {
  user: { id: 'user-ui-hieu', name: 'Hồ Trọng Hiếu', email: 'hieu@spriter.local', role: 'REVIEWER' },
  accessToken: 'demo-only-token', expiresInSeconds: 86_400,
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Đã xảy ra lỗi. Vui lòng thử lại.';
}

function policyMessage(reason?: string): string {
  switch (reason) {
    case 'MISSING_RESOLUTION_COMMENT': return 'Cần ít nhất một bình luận giải thích dài từ 10 ký tự.';
    case 'ANNOTATION_ARCHIVED_IMMUTABLE': return 'Pin đã lưu trữ, không thể sửa.';
    case 'SPATIAL_LOCKED_WHEN_RESOLVED': return 'Mở lại pin trước khi đổi vị trí 3D.';
    case 'INVALID_STATE_TRANSITION': return 'Không thể chuyển sang trạng thái này.';
    default: return 'Thao tác chưa hợp lệ.';
  }
}

function Avatar({ name }: { name: string }) {
  return <span className="avatar avatar--mint" aria-hidden="true">{initials(name)}</span>;
}

function StatusBadge({ status }: { status: AnnotationStatus }) {
  return <span className={`status-badge status-badge--${status.toLowerCase()}`}>{statusLabels[status]}</span>;
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') { onClose(); return; }
    if (event.key !== 'Tab') return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]'));
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal" role="dialog" aria-modal="true" aria-label={title} onKeyDown={handleKeyDown}>
        <div className="modal__header"><h2>{title}</h2><button type="button" ref={closeRef} className="icon-button" onClick={onClose} aria-label="Đóng hộp thoại">×</button></div>
        {children}
      </section>
    </div>
  );
}

export interface CollaborationWorkspaceProps {
  api: WorkspaceApiPort;
  store: AnnotationWorkspaceStore;
  bridge: ViewportBridge;
  modelId: string;
  mode: SessionMode;
  createSocket?: SocketFactory;
  onDemoPick?: () => void;
}

export function CollaborationWorkspace({ api, store, bridge, modelId, mode, createSocket, onDemoPick }: CollaborationWorkspaceProps) {
  useSyncExternalStore(store.subscribe, store.getRevision, store.getRevision);
  const [session, setSession] = useState<AuthSessionResponseDto | null>(mode === 'demo' ? demoSession : null);
  const [activeModelId, setActiveModelId] = useState(modelId);
  const [modelName, setModelName] = useState('turbine_housing_v1.glb');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState('');
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [initialComment, setInitialComment] = useState('');
  const [placementArmed, setPlacementArmed] = useState(false);
  const [conflictController, setConflictController] = useState<AnnotationThreadPanelController | null>(null);
  const [showConflict, setShowConflict] = useState(false);
  const [conflictError, setConflictError] = useState('');
  const [pendingImport, setPendingImport] = useState<ExportFileV1 | null>(null);
  const [hashMismatch, setHashMismatch] = useState<{ expected: string; actual: string } | null>(null);
  const [importErrors, setImportErrors] = useState<ImportItemError[] | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const importInputRef = useRef<HTMLInputElement>(null);

  const annotations = store.getAnnotations();
  const selected = store.getSelectedAnnotation();
  const commentDraft = selected ? commentDrafts[selected.id] ?? '' : '';
  const pendingPick = store.getPendingPick();
  const visible = useMemo(() => annotations
    .filter((item) => (filter === 'ALL' || item.status === filter) &&
      annotationTitle(item).toLocaleLowerCase('vi-VN').includes(query.trim().toLocaleLowerCase('vi-VN')))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [annotations, filter, query]);

  useEffect(() => { api.setAccessToken(session?.accessToken ?? null); }, [api, session]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    setLoading(true);
    setNotice('');
    async function load() {
      try {
        let cursor: string | undefined;
        let firstId: string | undefined;
        do {
          const page = await api.listAnnotations(activeModelId, { cursor, limit: 50 });
          if (cancelled) return;
          for (const item of page.items) store.upsertSnapshot(item);
          firstId ??= page.items[0]?.id;
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
        if (!store.getSelectedId() && firstId) store.selectAnnotation(firstId, false);
      } catch (error) {
        if (!cancelled) setNotice(`Không thể tải annotations: ${errorMessage(error)}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [api, session, activeModelId, store]);

  useEffect(() => {
    if (!session || mode !== 'live' || !createSocket) return;
    const connection = createSocket(session.accessToken);
    const realtime = new SocketRealtimeAdapter(connection.socket, activeModelId, store, api, (error) => setNotice(`Realtime: ${errorMessage(error)}`));
    realtime.start();
    return () => { realtime.stop(); connection.disconnect(); };
  }, [session, mode, createSocket, activeModelId, api, store]);

  useEffect(() => { if (pendingPick) setPlacementArmed(false); }, [pendingPick]);

  async function submitAuth(event: React.FormEvent) {
    event.preventDefault();
    setWorking(true); setNotice('');
    try {
      const result = authMode === 'login'
        ? await api.login({ email: authEmail, password: authPassword })
        : await api.register({ email: authEmail, password: authPassword, name: authName });
      api.setAccessToken(result.accessToken);
      setSession(result);
      setAuthPassword('');
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setWorking(false); }
  }

  async function createAnnotation(event: React.FormEvent) {
    event.preventDefault();
    if (!pendingPick || !initialComment.trim()) return;
    setWorking(true); setNotice('');
    try {
      const item = await api.createAnnotation(activeModelId, { ...pendingPick, initialComment: initialComment.trim() });
      store.upsertSnapshot(item);
      store.selectAnnotation(item.id, false);
      store.clearPendingPick();
      setInitialComment('');
      setNotice('Đã tạo pin mới.');
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setWorking(false); }
  }

  async function addComment(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !commentDraft.trim()) return;
    setWorking(true); setNotice('');
    try {
      const item = await api.addComment(selected.id, { content: commentDraft.trim() });
      store.upsertSnapshot(item);
      setCommentDrafts((drafts) => ({ ...drafts, [selected.id]: '' }));
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setWorking(false); }
  }

  async function changeStatus(status: AnnotationStatus) {
    if (!selected) return;
    const controller = new AnnotationThreadPanelController(selected, api, { onAnnotationUpdated: () => {} });
    setWorking(true); setNotice('');
    try {
      await controller.updateStatus(status);
      store.upsertSnapshot(controller.getSnapshot());
    } catch (error) {
      if (controller.getConflictState()) { setConflictController(controller); setConflictError(''); setShowConflict(true); }
      else setNotice(errorMessage(error));
    } finally { setWorking(false); }
  }

  function acceptServer() {
    if (!conflictController) return;
    store.upsertSnapshot(conflictController.acceptServerConflictSnapshot());
    setConflictController(null);
    setShowConflict(false);
    setConflictError('');
    setNotice('Đã dùng bản mới nhất từ server.');
  }

  async function retryConflict() {
    if (!conflictController) return;
    setWorking(true); setNotice('');
    try {
      await conflictController.retryPendingStatusOnLatestVersion();
      store.upsertSnapshot(conflictController.getSnapshot());
      setConflictController(null);
      setShowConflict(false);
      setConflictError('');
    } catch (error) {
      const raw = errorMessage(error);
      setConflictError(raw.startsWith('DOMAIN_PRECHECK_REJECTED:') ? policyMessage(raw.split(':')[1]) : raw);
    } finally { setWorking(false); }
  }

  async function exportJson() {
    setWorking(true); setNotice('');
    try {
      const payload = await api.exportAnnotations(activeModelId);
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url; link.download = `spriter-${activeModelId}-annotations.json`; link.click();
      URL.revokeObjectURL(url);
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setWorking(false); }
  }

  async function runImport(payload: ExportFileV1, force = false) {
    setWorking(true); setNotice('');
    try {
      const result = await api.importAnnotations(activeModelId, { mode: force ? 'FORCE_HASH_MISMATCH' : 'STRICT', payload });
      for (const item of result.annotations) store.upsertSnapshot(item);
      setPendingImport(null);
      setImportErrors(null);
      setNotice(`Đã nhập ${result.importedCount} pin.`);
    } catch (error) {
      if (error instanceof ApiClientError && error.detail.errorCode === 'IMPORT_MODEL_HASH_MISMATCH') {
        setPendingImport(payload);
        setHashMismatch({ expected: error.detail.expectedFileHash ?? '—', actual: error.detail.actualFileHash ?? '—' });
      }
      else if (error instanceof ApiClientError && error.detail.errorCode === 'IMPORT_VALIDATION_FAILED') setImportErrors(error.detail.itemErrors ?? []);
      else setNotice(errorMessage(error));
    } finally { setWorking(false); }
  }

  async function readImport(file: File | undefined) {
    if (!file) return;
    setNotice(''); setImportErrors(null);
    try {
      const payload = JSON.parse(await file.text()) as ExportFileV1;
      if (payload.schemaVersion !== '1.0' || !Array.isArray(payload.annotations) || !payload.modelMeta?.fileHash) throw new Error('File JSON không đúng cấu trúc ExportFileV1.');
      const check = validateExportPayload(payload);
      if (!check.valid) { setImportErrors(check.itemErrors); return; }
      await runImport(payload);
    } catch (error) { setNotice(errorMessage(error)); }
    finally { if (importInputRef.current) importInputRef.current.value = ''; }
  }

  async function uploadModel(event: React.FormEvent) {
    event.preventDefault();
    if (!uploadFile) return;
    setWorking(true); setNotice(''); setUploadError(''); setUploadProgress(0);
    try {
      const demoUpload = async (_url: string, _file: File, onProgress: (percent: number) => void) => { onProgress(100); };
      const uploader = mode === 'demo' ? new ModelUploadService(api, demoUpload) : new ModelUploadService(api);
      const model = await uploader.upload(uploadFile, setUploadProgress);
      store.clearAll();
      setActiveModelId(model.id);
      setModelName(model.name);
      setShowUpload(false); setUploadFile(null);
      setNotice('Model đã sẵn sàng để review.');
    } catch (error) { setUploadError(errorMessage(error)); }
    finally { setWorking(false); }
  }

  function armPlacement() {
    setPlacementArmed(true);
    bridge.setPlacementMode(true);
    setNotice('Chọn một điểm trên bề mặt 3D để đặt pin.');
  }

  function cancelPlacement() {
    bridge.setPlacementMode(false);
    store.clearPendingPick();
    setPlacementArmed(false);
    setInitialComment('');
  }

  if (!session) {
    return <div className="auth-screen"><form className="auth-card" onSubmit={(event) => void submitAuth(event)}>
      <div className="brand"><span className="brand__mark"><span /></span><span>spriter<span className="brand__period">.</span></span></div>
      <p className="eyebrow">KHÔNG GIAN CỘNG TÁC</p>
      <h1>{authMode === 'login' ? 'Đăng nhập để review' : 'Tạo tài khoản review'}</h1>
      {authMode === 'register' && <label>Họ tên<input required value={authName} onChange={(event) => setAuthName(event.target.value)} autoComplete="name" /></label>}
      <label>Email<input required type="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} autoComplete="email" /></label>
      <label>Mật khẩu<input required type="password" minLength={authMode === 'register' ? 8 : undefined} value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} /></label>
      {notice && <p className="form-error" role="alert">{notice}</p>}
      <button className="primary-button" disabled={working} type="submit">{working ? 'Đang xử lý...' : authMode === 'login' ? 'Đăng nhập' : 'Đăng ký'}</button>
      <button className="text-button" type="button" onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setNotice(''); }}>{authMode === 'login' ? 'Chưa có tài khoản? Đăng ký' : 'Đã có tài khoản? Đăng nhập'}</button>
    </form></div>;
  }

  const conflictSnapshot = conflictController?.getConflictState();
  const pendingStatus = conflictController?.getPendingStatusAttempt();

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand__mark" aria-hidden="true"><span /></span><span>spriter<span className="brand__period">.</span></span></div>
      <span className="topbar__divider" />
      <div className="project-title"><span>Không gian đánh giá</span><strong>{modelName}</strong></div>
      <div className="topbar__spacer" />
      <span className="demo-pill"><span /> {mode === 'demo' ? 'Dữ liệu mẫu' : 'API trực tiếp'}</span>
      <button className="toolbar-button" type="button" onClick={() => void exportJson()} disabled={working}>Xuất JSON</button>
      <button className="toolbar-button" type="button" onClick={() => importInputRef.current?.click()} disabled={working}>Nhập JSON</button>
      <input ref={importInputRef} className="sr-only" tabIndex={-1} type="file" accept=".json,application/json" aria-label="Chọn file JSON để nhập" onChange={(event) => void readImport(event.target.files?.[0])} />
      <button className="toolbar-button" type="button" onClick={() => setShowUpload(true)}>Tải model</button>
      <button className="avatar avatar--mint avatar-button" type="button" title="Đăng xuất" aria-label={`Đăng xuất ${session.user.name}`} onClick={() => { setSession(null); store.clearAll(); }}>{initials(session.user.name)}</button>
    </header>

    <main className="workspace">
      <section className="viewer" aria-label="Vùng dành cho 3D viewer">
        <div className="viewer__topline"><span className="viewer__label"><span className="viewer__label-dot" /> VIEWPORT</span><span>{mode === 'demo' ? 'FakeViewportBridge' : 'Chờ viewer của nhóm'}</span></div>
        <div className="viewer__center">
          <div className="viewer__placeholder-icon" aria-hidden="true"><svg viewBox="0 0 64 64" fill="none"><path d="m32 5 24 13.5v27L32 59 8 45.5v-27L32 5Z" stroke="currentColor" strokeWidth="1.5"/><path d="M8 18.5 32 32l24-13.5M32 32v27" stroke="currentColor" strokeWidth="1.5"/></svg></div>
          <p className="viewer__eyebrow">DÀNH CHO 3D VIEWER</p><h1>Không gian 3D đang chờ kết nối</h1>
          <p>Pin và góc camera được đồng bộ qua ViewportBridge. Viewer thật sẽ được ghép tại đây.</p>
          {placementArmed && onDemoPick && <button type="button" className="primary-button demo-pick" onClick={onDemoPick}>Mô phỏng chọn bề mặt</button>}
        </div>
        <div className="viewer__footer"><span>SPRITER / COLLABORATION UI</span><span>{annotations.length} pin trong workspace</span></div>
      </section>

      <aside className="sidebar" aria-label="Annotations">
        <div className="sidebar__header"><p className="eyebrow">BẢNG CỘNG TÁC</p><h2>Annotations <span>{annotations.length}</span></h2><p>Theo dõi góp ý trên mô hình</p></div>
        <div className="sidebar__controls">
          <button type="button" className="primary-button" onClick={armPlacement} disabled={working || placementArmed || Boolean(pendingPick)} aria-label="Thêm annotation bằng cách chọn bề mặt 3D">+ Thêm annotation</button>
          <label className="search-field"><span className="sr-only">Tìm pin theo nội dung</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm pin..." /></label>
          <label className="filter-field"><span>Lọc trạng thái</span><select value={filter} onChange={(event) => setFilter(event.target.value as Filter)} aria-label="Lọc pin theo trạng thái"><option value="ALL">Tất cả</option>{(Object.keys(statusLabels) as AnnotationStatus[]).map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></label>
        </div>
        {(notice || conflictController) && <div className="notice" role="status"><span>{notice || 'Có xung đột phiên bản chưa được giải quyết.'}{conflictController && <button type="button" className="notice-link" onClick={() => setShowConflict(true)}>Xem xung đột</button>}</span><button type="button" onClick={() => setNotice('')} aria-label="Đóng thông báo">×</button></div>}
        <div className="list-section"><div className="section-heading"><h3>Danh sách pin</h3><span>{visible.length} pin</span></div>
          <div className="annotation-list" role="list">
            {loading && <p className="list-message" role="status">Đang tải danh sách...</p>}
            {!loading && visible.length === 0 && <p className="list-message">Không có pin phù hợp.</p>}
            {visible.map((item, index) => <button type="button" role="listitem" key={item.id} className={`annotation-item${selected?.id === item.id ? ' annotation-item--selected' : ''}`} aria-pressed={selected?.id === item.id} onClick={() => store.selectAnnotation(item.id, true)}>
              <span className="pin-marker">{String(index + 1).padStart(2, '0')}</span>
              <span className="annotation-item__body"><span className="annotation-item__title">{annotationTitle(item)}</span><span className="annotation-item__meta"><Avatar name={displayName(item.authorName, item.authorId)} />{displayName(item.authorName, item.authorId)}</span></span>
              <span className="annotation-item__right"><StatusBadge status={item.status} /><span className="comment-count">{item.comments.length} bình luận</span></span>
            </button>)}
          </div>
        </div>
        <section className="details-section" aria-label="Chi tiết pin"><div className="section-heading"><h3>Chi tiết pin</h3><span>{selected ? `v${selected.version}` : '—'}</span></div>
          {pendingPick ? <form className="details-content" onSubmit={(event) => void createAnnotation(event)}><p className="eyebrow">PIN MỚI</p><h3>Thêm góp ý tại điểm đã chọn</h3><p className="details-description">Vị trí: {pendingPick.position.map((n) => n.toFixed(2)).join(', ')} · {pendingPick.meshName ?? 'Bề mặt 3D'}</p><label className="form-field">Bình luận đầu tiên<textarea required value={initialComment} onChange={(event) => setInitialComment(event.target.value)} rows={4} placeholder="Mô tả điều cần xem lại..." /></label><div className="actions"><button type="submit" className="primary-button" disabled={working || !initialComment.trim()}>Lưu pin</button><button type="button" className="secondary-button" onClick={cancelPlacement}>Hủy</button></div></form>
          : selected ? <div className="details-content"><div className="details-heading"><span className="eyebrow">{selected.meshName ?? 'PIN 3D'}</span><StatusBadge status={selected.status} /></div><h3>{annotationTitle(selected)}</h3><p className="details-description">Tọa độ: {selected.position.map((n) => n.toFixed(2)).join(', ')} · Cập nhật {formatDate(selected.updatedAt)}</p><div className="details-author"><Avatar name={displayName(selected.authorName, selected.authorId)} /><span><strong>{displayName(selected.authorName, selected.authorId)}</strong><small>Tạo ngày {formatDate(selected.createdAt)}</small></span></div>
              <div className="status-actions"><h4>Chuyển trạng thái</h4><div className="actions">{ALLOWED_TRANSITIONS[selected.status].map((target) => {
                const check = evaluateAnnotationMutation(selected, { status: target });
                const canArchive = target !== 'ARCHIVED' || canActorModifyAnnotation(session.user, selected, 'ARCHIVE');
                const reason = canArchive ? check.reasonCode : 'FORBIDDEN_OPERATION';
                return <button key={target} type="button" className="secondary-button" disabled={working || Boolean(conflictController) || !check.allowed || !canArchive} title={reason ? policyMessage(reason) : undefined} aria-label={`Chuyển pin sang ${statusLabels[target]}`} onClick={() => void changeStatus(target)}>{statusLabels[target]}</button>;
              })}{selected.status === 'ARCHIVED' && <span className="muted-text">Pin đã lưu trữ.</span>}</div>
              {ALLOWED_TRANSITIONS[selected.status].includes('RESOLVED') && !evaluateAnnotationMutation(selected, { status: 'RESOLVED' }).allowed && <p className="policy-hint">{policyMessage(evaluateAnnotationMutation(selected, { status: 'RESOLVED' }).reasonCode)}</p>}
              </div>
              <div className="comments-heading"><h4>Bình luận <span>{selected.comments.length}</span></h4></div>
              <div className="comments-list">{selected.comments.length === 0 ? <p className="empty-comments">Chưa có bình luận.</p> : selected.comments.map((comment) => <article className="comment" key={comment.id}><Avatar name={displayName(comment.authorName, comment.authorId)} /><div className="comment__body"><div className="comment__heading"><strong>{displayName(comment.authorName, comment.authorId)}</strong><time dateTime={comment.createdAt}>{formatDate(comment.createdAt)}</time></div><p>{comment.content}</p></div></article>)}</div>
              {selected.status !== 'ARCHIVED' && <form className="comment-form" onSubmit={(event) => void addComment(event)}><label className="form-field">Thêm bình luận<textarea rows={3} value={commentDraft} onChange={(event) => setCommentDrafts((drafts) => ({ ...drafts, [selected.id]: event.target.value }))} placeholder="Viết phản hồi..." /></label><button type="submit" className="primary-button" disabled={working || !commentDraft.trim()}>Gửi bình luận</button></form>}
            </div> : <div className="details-placeholder">Chọn một pin để xem chi tiết.</div>}
        </section>
      </aside>
    </main>

    {placementArmed && !pendingPick && <div className="placement-banner" role="status">Đang chờ chọn bề mặt trên viewer <button type="button" onClick={cancelPlacement}>Hủy</button></div>}

    {showConflict && conflictSnapshot && <Dialog title="Có thay đổi mới từ người khác" onClose={() => setShowConflict(false)}><p className="modal__intro">Bản bạn đang sửa đã cũ. Thao tác <strong>{pendingStatus ? statusLabels[pendingStatus] : 'đổi trạng thái'}</strong> vẫn được giữ để bạn quyết định.</p><div className="conflict-summary"><div><span>Bản của bạn</span><strong>{selected ? statusLabels[selected.status] : '—'} · v{selected?.version}</strong></div><div><span>Bản trên server</span><strong>{statusLabels[conflictSnapshot.status]} · v{conflictSnapshot.version}</strong></div></div>{conflictError && <p className="form-error" role="alert">{conflictError}</p>}<div className="actions"><button type="button" className="secondary-button" onClick={acceptServer}>Chấp nhận bản server</button><button type="button" className="primary-button" onClick={() => void retryConflict()} disabled={working}>Thử lại trên bản mới</button></div></Dialog>}

    {pendingImport && <Dialog title="Model trong file JSON không khớp" onClose={() => setPendingImport(null)}><p className="modal__intro">Mã băm file 3D khác model hiện tại. Chỉ tiếp tục nếu bạn chắc các pin vẫn thuộc đúng mô hình.</p><div className="hash-comparison"><span>Model hiện tại: {hashMismatch?.expected}</span><span>File JSON: {hashMismatch?.actual}</span></div><div className="actions"><button type="button" className="secondary-button" onClick={() => setPendingImport(null)}>Hủy import</button><button type="button" className="primary-button" disabled={working} onClick={() => void runImport(pendingImport, true)}>Nhập dù khác model</button></div></Dialog>}

    {importErrors && <Dialog title="File JSON có lỗi" onClose={() => setImportErrors(null)}><p className="modal__intro">Chưa nhập pin nào. Hãy sửa các dòng sau rồi thử lại:</p><ul className="error-list">{importErrors.map((item) => <li key={`${item.index}-${item.annotationId}`}>Dòng {item.index + 1}: {item.message}</li>)}</ul></Dialog>}

    {showUpload && <Dialog title="Tải model .glb" onClose={() => setShowUpload(false)}><form onSubmit={(event) => void uploadModel(event)}><p className="modal__intro">File được gửi trực tiếp tới kho lưu trữ qua URL do API cấp.</p><label className="form-field">Chọn file .glb<input type="file" accept=".glb,model/gltf-binary" onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)} /></label>{uploadError && <p className="form-error" role="alert">{uploadError}</p>}{working && <div className="upload-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploadProgress}><span style={{ width: `${uploadProgress}%` }} /></div>}<div className="actions"><button type="button" className="secondary-button" onClick={() => setShowUpload(false)}>Hủy</button><button type="submit" className="primary-button" disabled={working || !uploadFile}>{working ? `${uploadProgress}%` : 'Tải lên'}</button></div></form></Dialog>}
  </div>;
}
