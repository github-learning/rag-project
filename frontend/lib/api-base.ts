/** Nest 全局前缀为 /api，默认本地后端端口 3001 */
export function getApiBase(): string {
  const raw = process.env.NEXT_PUBLIC_API_BASE?.trim();
  if (raw) {
    return raw.replace(/\/$/, '');
  }
  return 'http://localhost:3001/api';
}
