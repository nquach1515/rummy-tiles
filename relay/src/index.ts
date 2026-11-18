/*
 * Message relay for online tables. The game itself still runs in the host's browser; this only forwards messages
 * between the host and the players over WebSockets (wss on port 443, which VPNs and work networks let through,
 * unlike browser-to-browser WebRTC).
 *
 * One Durable Object per room code holds that room's sockets.
 *   host   → wss://…/room/CODE?role=host     sends {to, data} or {to, close: true}; receives {k: 'open'|'msg'|'close', id, data?}
 *   player → wss://…/room/CODE?role=player   sends and receives the game's own messages, untouched
 * A player who connects while no host is in the room is closed with code 4004.
 */
import { DurableObject } from 'cloudflare:workers';

interface Env {
  ROOMS: DurableObjectNamespace<Room>;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/room\/([A-Z]{4})$/);
    if (!m) return new Response('rummy tiles relay', { status: 200 });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req);
  },
};

const MAX_MSG = 256 * 1024;
/** Hosts ping every 5 s (25 s in pages from before the connection watchdog), so this much silence means it's gone. */
const HOST_SILENT_MS = 30000;
/** After this much silence the players are told the host is away (their phone locked, or the app in the background). */
const HOST_AWAY_MS = 15000;
/** How often the room checks on its host while players are connected. */
const CHECK_MS = 5000;
/** How long players stay connected, waiting, after their host's connection drops. */
const HOST_GONE_MS = 5 * 60000;

export class Room extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // keepalive pings are answered without waking the object
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(req: Request): Promise<Response> {
    const role = new URL(req.url).searchParams.get('role');
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    if (role === 'host') {
      // a refreshed or reconnecting host replaces its old connection
      for (const old of this.ctx.getWebSockets('host')) old.close(4000, 'replaced');
      this.ctx.acceptWebSocket(server, ['host']);
      server.serializeAttachment({ since: Date.now() });
      // Players stay connected while their host is gone or reconnecting (lost signal, the phone locked, the app in the
      // background): the new host connection is introduced to each of them, with the hello they sent, so the game
      // re-seats them without anyone else's connection dropping. (They used to be closed and all reconnect.)
      for (const p of this.ctx.getWebSockets('player')) {
        const { id, hello } = (p.deserializeAttachment() as { id: string; hello?: string } | null) ?? { id: '' };
        if (!id) continue;
        server.send(JSON.stringify({ k: 'open', id }));
        if (hello) server.send(`{"k":"msg","id":${JSON.stringify(id)},"data":${hello}}`);
      }
      await this.ctx.storage.delete('hostGone');
      await this.setAway(false);

    } else {
      let host = this.host();
      // A host whose connection died without closing (common on mobile data) still looks connected; if it hasn't pinged
      // for a while, drop it, so this player hears "no host" and retries instead of waiting on a host that can't answer.
      if (host && this.silentFor(host) > HOST_SILENT_MS) {
        host.close(4002, 'host silent');
        this.gone(host, 4002);
        host = null;
      }
      // no host now, but one was here a moment ago (its signal dropped): wait with the other players for it to come back
      const gone = await this.ctx.storage.get<number>('hostGone');
      if (!host && !(gone && Date.now() - gone < HOST_GONE_MS)) {
        this.ctx.acceptWebSocket(server, ['dead']);
        server.close(4004, 'no host');
        return new Response(null, { status: 101, webSocket: client });
      }
      const id = crypto.randomUUID();
      this.ctx.acceptWebSocket(server, ['player', `p:${id}`]);
      server.serializeAttachment({ id });
      host?.send(JSON.stringify({ k: 'open', id }));
      if (!host || (await this.ctx.storage.get<boolean>('away'))) server.send(JSON.stringify({ t: 'hostAway', away: true }));
      // keep an eye on the host while someone is waiting on them
      if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + CHECK_MS);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  private host(): WebSocket | null {
    // a host connection we just closed (replaced, or dropped for being silent) can linger until its close completes
    return this.ctx.getWebSockets('host').find((h) => h.readyState === 1 /* OPEN */) ?? null;
  }

  /** How long since we last heard from the host: its last ping (answered here without waking us), message or arrival. */
  private silentFor(ws: WebSocket): number {
    const pinged = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0;
    const a = (ws.deserializeAttachment() as { since?: number; last?: number } | null) ?? {};
    return Date.now() - Math.max(pinged, a.since ?? 0, a.last ?? 0);
  }

  /** Tell the players whether the host is away, when that changes. */
  private async setAway(away: boolean) {
    if (((await this.ctx.storage.get<boolean>('away')) ?? false) === away) return;
    await this.ctx.storage.put('away', away);
    const msg = JSON.stringify({ t: 'hostAway', away });
    for (const p of this.ctx.getWebSockets('player')) {
      try {
        p.send(msg);
      } catch {
        /* closing */
      }
    }
  }

  /** Every CHECK_MS while players are connected: has the host gone quiet, or come back? */
  async alarm() {
    const host = this.host();
    const players = this.ctx.getWebSockets('player');
    if (players.length === 0) {
      await this.ctx.storage.put('away', false);
      return; // nobody waiting: stop checking until a player connects again
    }
    if (!host) {
      // the host has been gone too long: let the players go (they keep retrying, as before)
      const gone = (await this.ctx.storage.get<number>('hostGone')) ?? 0;
      if (Date.now() - gone >= HOST_GONE_MS) {
        for (const p of players) p.close(4003, 'host left');
        await this.ctx.storage.put('away', false);
        return;
      }
      await this.setAway(true);
    } else await this.setAway(this.silentFor(host) > HOST_AWAY_MS);
    await this.ctx.storage.setAlarm(Date.now() + CHECK_MS);
  }

  private isHost(ws: WebSocket) {
    return this.ctx.getTags(ws).includes('host');
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string' || raw.length > MAX_MSG) return;
    if (this.isHost(ws)) {
      // the host is talking: note when, and if the players were told it was away, it's back
      const a = (ws.deserializeAttachment() as object | null) ?? {};
      ws.serializeAttachment({ ...a, last: Date.now() });
      await this.setAway(false);
      let msg: { to?: string; data?: unknown; close?: boolean };
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      const target = msg.to ? this.ctx.getWebSockets(`p:${msg.to}`)[0] : undefined;
      if (!target) return;
      if (msg.close) target.close(4001, 'closed by host');
      else target.send(JSON.stringify(msg.data));
    } else {
      const att = ws.deserializeAttachment() as { id: string; hello?: string };
      const { id } = att;
      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch {
        return;
      }
      // keep the player's hello, to introduce them to the host again if its connection is replaced
      if ((data as { t?: string } | null)?.t === 'hello' && raw.length < 2048) ws.serializeAttachment({ ...att, hello: raw });
      this.host()?.send(JSON.stringify({ k: 'msg', id, data }));
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    // answer the close, so the other end's socket finishes closing (and the game there can reconnect) right away
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, reason);
    } catch {
      /* already closed */
    }
    this.gone(ws, code);
  }

  async webSocketError(ws: WebSocket) {
    this.gone(ws);
  }

  /** The host's connection dropped: the players hear it's away and keep their connections, for up to HOST_GONE_MS. */
  private async hostGone() {
    if (this.ctx.getWebSockets('player').length === 0) return;
    await this.ctx.storage.put('hostGone', Date.now());
    await this.setAway(true);
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + CHECK_MS);
  }

  private gone(ws: WebSocket, code = 0) {
    const tags = this.ctx.getTags(ws);
    if (tags.includes('host')) {
      // only if no newer host connection took over
      if (this.ctx.getWebSockets('host').some((h) => h !== ws)) return;
      // a host that left on purpose (1000) ends the table; otherwise the players wait a while for it to reconnect
      if (code === 1000) {
        for (const p of this.ctx.getWebSockets('player')) p.close(4003, 'host left');
        return;
      }
      void this.hostGone();
    } else if (tags.includes('player')) {
      const { id } = ws.deserializeAttachment() as { id: string };
      this.host()?.send(JSON.stringify({ k: 'close', id }));
    }
  }
}
