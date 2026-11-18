// The game site on Cloudflare: serves the built app from dist/ and hands /room/* (the multiplayer WebSocket) to the
// relay Worker through a service binding, so the page and its game connection share one hostname.

/** Invite links (/join/CODE redirects to /?room=CODE): the preview says it's an invitation to a table. */
function invitePreview(response, code, origin) {
  const set = (content) => ({ element: (e) => e.setAttribute('content', content) });
  const title = `Join my Rummy Tiles table · ${code}`;
  const text = 'Tap to take a seat. Runs, groups and a table everyone can rearrange: play in your browser, no sign-up.';
  return new HTMLRewriter()
    .on('meta[property="og:title"]', set(title))
    .on('meta[name="description"]', set(text))
    .on('meta[property="og:description"]', set(text))
    .on('meta[property="og:url"]', set(`${origin}/join/${code}`))
    .transform(response);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path.startsWith('/room/')) return env.RELAY.fetch(request);
    const join = /^\/join\/([a-z]{4})\/?$/i.exec(path);
    if (join) return Response.redirect(new URL(`/?room=${join[1].toUpperCase()}`, request.url).href, 302);
    const room = url.searchParams.get('room');
    if ((path === '/' || path === '/index.html') && room && /^[a-z]{4}$/i.test(room)) {
      const page = invitePreview(await env.ASSETS.fetch(request), room.toUpperCase(), url.origin);
      const res = new Response(page.body, page);
      res.headers.set('X-Robots-Tag', 'noindex');
      return res;
    }
    return env.ASSETS.fetch(request);
  },
};
