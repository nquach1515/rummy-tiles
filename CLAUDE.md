# Rummy Tiles

A tile rummy game for 2–4 players, online with friends or against bots. README.md explains the rules, the
architecture and the bots, so read it first. It's built like the Shengji game (nquach1515/shengji) and should keep
matching its look.

## Layout
- `src/game/`: tiles (`tiles.ts`), what counts as a set (`rules.ts`), the turn and round rules (`engine.ts`), and the
  bots (`bot.ts`).
- `src/net/`: networking.
  - `host.ts`: the host's browser runs the game.
  - `client.ts`: the player side.
  - `relay.ts`: the socket watchdog.
  - `protocol.ts`: the message types.
- `src/ui/`: React components. `Table.tsx` is the game screen (drag and drop, the board layout).
- `relay/`: a Cloudflare Worker with one Durable Object per room.
- `site/worker.js`: serves the site and sends `/room/*` to the relay.

## Rules for changes
- Commit and push only when the user asks. Run `git pull --rebase` before pushing.
- Pushing to main deploys the site and the relay automatically, through GitHub Actions.
- Never set GitHub secrets or Cloudflare credentials. The user sets them.
- Bots see only `redactFor()` state. After any bot change, `npm run leaktest` must pass.
- Battery matters, because the host's phone runs the game and the bots. Keep bot search inside its node budget.
- The look should match Shengji:
  - red felt oval with a gold rim, and a dark cherry background
  - teal for you, orange for everyone else
  - quiet sounds
  - tiles never overlap or clip (the board picks the largest tile size at which every set fits)
- Check UI changes at phone size (390×844) and desktop size.
- The privacy policy (`public/privacy.html`) says nothing about players is stored. Any new data collection needs a
  policy update.
- Don't call the game by another game's brand name.

## Verify
- `npm run typecheck`
- `npm run sim` and `npm run leaktest`
- For anything in the browser or network, use the `test-locally` skill: local relay and Vite, plus muted Playwright.
