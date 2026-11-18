---
name: test-locally
description: Run Rummy Tiles and its relay locally and check a change in a real browser (muted Playwright), including online tables and reconnects. Use before telling the user a UI, network or game change works.
---

# Test Rummy Tiles locally

## 1. Start the servers (in the background)
- Relay: `cd relay && npm install && npx wrangler dev --config wrangler.toml --port 8799`
  You must pass `--config`. Without it wrangler uses the site's wrangler.jsonc.
- Site: `VITE_RELAY_URL=ws://localhost:8799 npx vite --port 5199 --strictPort`. The game is at http://localhost:5199/

## 2. Browser scripts
Put the scripts in the scratchpad, not the repo.
- **Every browser must be muted.** Add this to each context:
  ```js
  await ctx.addInitScript(() => { try { localStorage.setItem('rt-muted', '1'); } catch {}
    const C = window.AudioContext; if (C) window.AudioContext = class extends C { constructor(o) { super(o); super.suspend(); } resume() { return Promise.resolve(); } }; });
  ```
- Prefer `getByRole` to `getByText`.
- Log errors with `p.on('pageerror', …)`.
- Check results in localStorage: games against bots save to `rt-solo-session`, hosted tables to `rt-host-session`.
- To test a crowded table, build a game with the engine and bots in a script, write it as `rt-solo-session`
  (`{ code: 'SOLO', state, seats, settings, savedAt }`, with your seat's clientId also set as `rt-client-id`), and
  press **Resume your game**.
- Check that no tile overlaps another or sits outside `.board`, and that the page never scrolls sideways.
- For an online table, give the host and each player its own context.
- Drag with `page.mouse` (down, a few moves, up); a tap is a click.
- For phone layouts, set the viewport to 390×844. For desktop, use 1280×860.

## 3. Also run
- `npm run typecheck`
- After game or bot changes: `npm run sim` and `npm run leaktest`

Stop the servers when you're done. Report what you checked and what you didn't.
