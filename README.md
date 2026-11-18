# Rummy Tiles

The tile rummy game for 2 to 4 players, playable online with friends or against bots. Make runs and groups,
rearrange the table, and be the first to empty your rack. No accounts and no database: a tiny relay server forwards
messages.

It's built the same way as [Shengji](https://github.com/nquach1515/shengji) and shares its look: a red felt oval
with a gold rim on a dark cherry background, teal for you and orange for everyone else, and quiet sounds.

## How it works

- It's a static site (Vite + React + TypeScript).
- Multiplayer goes through a small WebSocket relay (`relay/`, a Cloudflare Worker with one Durable Object per room
  code). Everyone, host included, connects to it over `wss://`, which gets through VPNs and work networks that block
  browser-to-browser connections. The relay only forwards messages and stores nothing.
- The **host's browser runs the game**: it shuffles, deals, enforces the rules, and sends each player only their own
  rack. If the host refreshes, **Resume your table** brings everyone back.
- While a player arranges the table, everyone else watches the tiles move. Nothing counts until they press Done.
- Empty seats can be bots. If a friend drops out, the host can let a bot play for them until they come back with the
  same link.

## Develop

```sh
npm install
npm run dev        # http://localhost:5173 (games against bots work without the relay)
npm run sim        # rules checks + bot-vs-bot rounds
npm run leaktest   # bots decide only from what their seat can see
npm run build      # production build in dist/
```

For online tables locally, run the relay too: `cd relay && npm install && npx wrangler dev --config wrangler.toml --port 8799`,
then `VITE_RELAY_URL=ws://localhost:8799 npm run dev`.

## Deploy (Cloudflare)

Every push to `main` deploys through GitHub Actions, using the repository secrets `CLOUDFLARE_API_TOKEN` (an "Edit
Cloudflare Workers" token) and `CLOUDFLARE_ACCOUNT_ID`:

- `.github/workflows/cloudflare.yml` builds the game and deploys the site (`wrangler.jsonc`, `site/worker.js`).
- `.github/workflows/relay.yml` deploys the relay (`relay/`) when it changes. The site passes `/room/*` to it, so the
  page and its game connection share one hostname.

Deploy the relay first (the site binds to it by name). The site comes up on `rummy-tiles.<account>.workers.dev`; add a
custom domain in the Cloudflare dashboard if you want one.

By hand: `cd relay && npx wrangler deploy --config wrangler.toml`, then `npm run build && npx wrangler deploy`.

## Rules implemented

- 106 tiles: 1–13 in red, blue, orange and black, two of each, and two jokers. 14 tiles each; a random player starts
  the first round, then it goes round the table.
- **Run**: 3–13 consecutive numbers in one colour (1 is low only). **Group**: 3–4 tiles of one number, all different
  colours. A joker stands for any tile a set needs.
- On your turn, place tiles and rearrange the table any way you like. Every row must be a valid set when you finish,
  and at least one tile must come from your rack. Otherwise draw a tile (or pass when the pool is empty).
- **First meld**: your first play of a round must be new sets of your own tiles worth 30 or more (jokers count as the
  tile they stand for), without touching the table. The host can turn this off.
- **Turn timer** (optional: 1, 1½ or 2 minutes): when it runs out, a legal arrangement is played; otherwise the tiles
  go back and you draw.
- **Scoring**: the player who goes out wins the round. Everyone else loses what's left on their rack (a joker costs
  30), and the winner gains the total. If the pool is empty and nobody can play, the lowest rack wins.

## Bots

Bots get a redacted copy of the game: their own rack and the table, never anyone else's rack or the pool
(`npm run leaktest` checks this).

- **Easy**: a first meld, then only new sets from its own rack.
- **Normal**: also adds tiles to the ends of runs and to groups.
- **Hard**: also rearranges the whole table when that places more tiles. An exact search over the table and the rack
  (`src/game/bot.ts`) with a node budget, so a turn costs a few milliseconds on a phone.

The Hint button shows what a Hard bot would play in your seat.
