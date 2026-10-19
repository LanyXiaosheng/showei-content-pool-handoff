export function taskImageUrl(id: string | null | undefined, thumb = true): string {
  if (!id) return '';
  return `/api/media/task-images/${id}${thumb ? '?thumb=1' : ''}`;
}

export function groupImageUrl(id: string | null | undefined, thumb = true): string {
  if (!id) return '';
  return `/api/media/group-images/${id}${thumb ? '?thumb=1' : ''}`;
}
