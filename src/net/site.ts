/**
 * Link friends can open to join a table. On the site it's /join/CODE (site/worker.js gives it a link preview and
 * redirects to /?room=CODE); local testing and other static hosts use ?room=CODE directly.
 */
export function inviteLink(code: string): string {
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || location.port !== '';
  if (local || location.protocol !== 'https:') return `${location.origin}${location.pathname}?room=${code}`;
  return `${location.origin}/join/${code}`;
}
