# Progress log

The place to pick up where we left off. Newest entry first. Keep "Next up" current.

## Next up

1. **Deploy to Render** (not done yet): render.com → New → Blueprint → pick `rsp-virtual-office` → Apply.
   Then copy `ADMIN_CODE` from the service's Environment tab. See README "Put it online".
2. Add a free Postgres (`DATABASE_URL`, e.g. Neon) so profiles/chat/desks survive restarts.
3. Two-person test on different networks (README manual checklist). Add a TURN server if video stays "connecting".
4. Set `OFFICE_PASSCODE` and/or `ALLOWED_EMAIL_DOMAINS=rspsupply.com`.
5. Swap the placeholder logo for the official RSP Supply logo (`client/src/components/Logo.tsx`).

### Gather features still missing

- Calendar integration (show Google/Outlook meetings on rooms, "join from calendar").
- Camera background blur / virtual backgrounds.
- Multiple floors or maps with portals between them (map size is fixed at 60×38 tiles today).
- Uploading custom images/objects into the map in build mode (only the built-in pixel-art items today).
- Gather-style "private area" drawing that is separate from walls (today private areas are rooms).

### Graphics ideas not built yet

- Animated details: conveyor belt moving, plants swaying, clock hands, blinking server/printer LEDs.
- Normal-mapped or rim-lit characters (light from nearby lamps tints the avatar edge).
- Weather through the windows (rain streaks / snow) tied to a setting.
- Seasonal decorations toggle (holiday lights, etc.).

## 2026-11-23 (later): Gather parity, always-bright lighting, doors, build mode

User asked: "needs all of the features of Gather", "look lighted and nice all day long", plus "locked meeting rooms
and doors and a customize office layout for the admin creation tools and creation mode".

Done:
- Lighting is bright all day; time of day only shifts warmth (`ambienceFor` in `client/src/game/lighting.ts`).
- Gather features: emotes 1-6 / raise hand (6) / dance (Z) with pop-up bubbles; click a person for an action card
  (walk to, go to = teleport, follow, ring, invite here, wave, message, locate); knock on locked rooms (people inside
  "Let them in"); lock a hallway conversation (lock button on the video dock); spotlight broadcast for managers/admins
  (Meeting panel); Nearby chat channel (not saved); custom status text (status menu); auto-away after 10 min idle;
  mini-map (M) with click-to-walk; sitting on chairs; 8-bit sound effects (Settings toggle).
- Interactive objects (walk up, X): whiteboards (live shared drawing), TVs (any https link or YouTube), orders board +
  bookshelf (sticky notes), kiosk, coffee/water/vending, clock. Server: `server/src/objects.ts`, saved in `settings.objects`.
- Doors (`door` object) on every private room; drawn closed + red when the room is locked.
- Build mode (admins, hammer button in the top bar): `client/src/components/BuildPanel.tsx` + `client/src/game/editor.ts`.
  Layout = `Layout` JSON in `shared/map.ts` (`exportLayout` / `validateLayout` / `applyLayout`), saved in
  `settings.layout`, sent to clients in `init` and `layout` events. Map size is fixed at 60×38.
- New server tests for all of the above (`server/test/realtime.test.ts`), e2e still passes, screenshots reviewed
  (`npm run shots` now also saves `.qa/feature-*.png`).

## 2026-11-23: "8-bit art, modern graphics" pass

Goal from the user: keep the framework, make it look 8-bit but with modern graphics.

Done:
- New `client/src/game/lighting.ts` + `fx.ts`:
  - Multiply-blended light map (ceiling lights per room, desk monitors, lamps, TVs, vending machines,
    kiosk, logo sign), clipped per room so light doesn't leak through walls.
  - Sunbeams from windows/front door (additive), with drifting pixel dust motes.
  - Time-of-day warmth from the viewer's local clock (morning/day/evening/night), re-checked every minute.
    Preview with `?time=night`. (Later changed to stay bright all day.)
  - Soft ambient occlusion along walls (baked into the floor) and contact shadows under furniture.
  - Soft drop shadow under every character, footstep dust puffs, coffee machine steam.
  - Additive glow halos that gently pulse on screens and lamps.
  - Camera post-processing (WebGL): subtle bloom, slight saturation/contrast, vignette.
- Name tags and room labels now render above the lighting (readable at night) in the pixel font
  **Pixelify Sans**; UI headings, zone name and logo use it too (`font-display`).
- Settings (gear) → **Graphics**: "Full effects" or "Performance" (no bloom/particles/flicker), saved per browser.
- `npm run shots` screenshots tool (`tools/screenshots.mjs`).
- Verified: typecheck, `npm test`, `npm run test:e2e` all pass; screenshots reviewed day and night.

## 2026-11-23: First build

- Built the whole app (see README status table) and pushed to GitHub
  (https://github.com/justrain9563-debug/rsp-virtual-office, branch `main`).
- Decided: deploy like JustMafia (Render Blueprint, single Node service), open name-based join with an
  optional passcode instead of real accounts.
