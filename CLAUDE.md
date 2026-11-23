# RSP Virtual Office: notes for Claude

Gather-style virtual office for RSP Supply: 8-bit pixel-art office in the browser, proximity
video/audio over WebRTC, chat, private rooms, admin tools. Anyone with the link types a name and walks in.

**Start every session by reading [docs/PROGRESS.md](docs/PROGRESS.md)**: it has where we left off,
the decisions made so far, and the next-steps backlog. Update it at the end of each session
(add a dated entry and adjust "Next up").

## Layout

- `shared/`: map data (`map.ts`: the default office + editable `Layout` JSON), proximity rules, types. Used by client **and** server.
  The live map is mutated in place by `applyLayout`, so `MAP.*` arrays are always current.
- `server/`: Express + Socket.IO. `realtime.ts` is the authoritative presence/conversation engine (also teleport,
  ring/invite/knock requests, locked conversations, spotlight, layout save). `objects.ts`: whiteboards/notes/TVs.
- `client/`: React + Phaser 3 + Tailwind (Vite).
  - `src/game/pixel.ts`, `art.ts`, `avatar.ts`: procedural pixel art (16 px art, drawn 2x to 32 px tiles).
  - `src/game/lighting.ts`, `fx.ts`: the "modern pixel" layer (light map, sunbeams, glow, shadows,
    particles, bloom/vignette, day/night). Keep the art itself crisp and blocky; make the *light* smooth.
  - `src/game/OfficeScene.ts`: the Phaser scene (movement, avatars, emotes, sitting, follow, interactions, doors,
    build-mode input). It restarts itself whenever the layout changes.
  - `src/game/editor.ts` + `src/components/BuildPanel.tsx`: admin build mode.
  - `src/components/ObjectModal.tsx`: whiteboard / TV / sticky-note windows. `PlayerCard.tsx`: click-a-person actions.
  - `src/media/MediaManager.ts`: WebRTC.
- `tools/e2e.mjs`: two real Edge browsers run the 16-step checklist. `tools/screenshots.mjs`: visual check.

## Commands

```bash
npm run dev                       # server :3001 + client http://localhost:5173
npm run typecheck
npm test                          # server tests
npm run build && npm run test:e2e # browser end-to-end (Edge)
npm run build && npm run shots    # screenshots → .qa/look-<time>-<place>.png  (TIMES=morning,day,evening,night)
```

Preview another time of day in the browser with `?time=night` (morning | day | evening | night).

## Conventions

- Deploy target: Render free plan via `render.yaml` Blueprint, one Node service serving the built client
  (same pattern as the JustMafia project). Repo: https://github.com/justrain9563-debug/rsp-virtual-office (branch `main`).
- Pushing to GitHub from Claude's shell works. Render redeploys automatically on push to `main`.
- All art is original and procedural (no copied game assets). Brand colours: navy `#123a6b`, orange `#f26b1d`.
- Run `npm run typecheck`, `npm test` and (for rendering changes) `npm run shots` before committing.
