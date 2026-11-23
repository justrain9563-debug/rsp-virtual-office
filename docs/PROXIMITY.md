# How proximity audio/video works

## 1. The server decides who is in a conversation

Every 150 ms `server/src/realtime.ts` checks every pair of connected people using
`evaluatePair()` in `shared/proximity.ts`:

| Situation | Result |
|---|---|
| Both in the **same private room** (conference, management, ops meeting, break room, 1:1 booths) | connected, mode `room`, full volume at any distance |
| Exactly one of them in a private room, or different rooms | **never** connected |
| Open area, either person on **Do Not Disturb** | not connected |
| Open area, a **wall** tile on the straight line between them | not connected |
| Open area, distance ≤ `connectRadius` (default 5 tiles, +0.5) | connected, mode `proximity` |
| Already connected and distance ≤ connectRadius + 0.75 | stays connected (hysteresis, so standing on the edge doesn't flicker) |

Open-area conversations are capped at `maxPeers` (default 8) per person, nearest first.
Room size is capped by each room's capacity. Admins can change all of these in **Admin → Office settings / Meeting rooms**.

When someone's set of conversation partners changes, the server sends them a `peers` event.

## 2. Browsers connect directly (WebRTC)

For each partner, `client/src/media/MediaManager.ts` opens one `RTCPeerConnection`:

- The person with the smaller user id makes the offer. Offers never collide.
- Each connection has three fixed channels: microphone, camera, screen. Turning a device on or off swaps the
  track (`replaceTrack`) without renegotiating. When off, nothing is sent.
- SDP offers/answers and ICE candidates travel through the server's `signal` event. **The server only relays
  them between two people it has currently put in the same conversation**, so nobody can open a media
  connection to someone they aren't standing next to (or in a room with).
- Media flows browser-to-browser, encrypted (DTLS-SRTP). STUN finds public addresses; a TURN server
  (optional, `TURN_*` env vars) relays when firewalls block direct paths. TURN credentials are only given to signed-in users.
- Connection drops: ICE restart up to twice, then a fresh connection. Socket reconnects within 10 s keep your place.

## 3. Volume follows distance

Every 100 ms each browser computes the distance between the two avatars and sets that person's audio volume
(`volumeForDistance`):

```
 distance (tiles)   0 ─── 2.5 ─────────────── 5.5 ── 6.25
 volume            100%  100% ── fades ──▶ 15%  ──▶ 0%   then disconnect
```

The change is smoothed so voices fade instead of jumping. In private rooms everyone is at 100%.
Video tiles also fade slightly as people move away and disappear when the connection closes.

## Scaling

This is a peer-to-peer mesh: each person sends their media to each partner. That is cheap and needs no media
server, and works well up to roughly 8 people per conversation. For all-hands-sized rooms, swap the media
layer for an SFU such as LiveKit: keep the server's conversation groups, and instead of relaying `signal`, issue
LiveKit room tokens per group. That is not built yet.
