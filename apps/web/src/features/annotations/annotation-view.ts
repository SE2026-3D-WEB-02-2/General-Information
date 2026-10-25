import type { AnnotationDomainSnapshot, AnnotationStatus } from '@spriter/shared';

export const statusLabels: Record<AnnotationStatus, string> = {
  OPEN: 'Đang mở', IN_PROGRESS: 'Đang xử lý', RESOLVED: 'Đã giải quyết', ARCHIVED: 'Lưu trữ',
};

export function annotationTitle(item: AnnotationDomainSnapshot): string {
  const first = item.comments[0]?.content.trim();
  if (first) return first.length > 48 ? `${first.slice(0, 48)}…` : first;
  return item.meshName || `Pin ${item.id.slice(0, 8)}`;
}

export function displayName(name: string | undefined, id: string): string {
  return name?.trim() || id;
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(-2).map((part) => part[0]?.toUpperCase()).join('') || '?';
}

export function formatDate(value: string | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value));
}
