# Saultsteroids

A Sault College take on *Asteroids*, built with [LittleJS](https://github.com/KilledByAPixel/LittleJS).

**Play:** https://saultcollege.github.io/saultsteroids/

Fold your notes into a paper airplane and clear a night sky full of deadlines.
Throw pencils to break **exams** (textbooks) into **assignments**, and assignments
into **quizzes** (sticky notes). Clear the sky to finish the term; every four
terms earns a diploma. Your lives are coffees, so don't spill them.

## Controls

| | Keyboard | Touch | Gamepad |
|---|---|---|---|
| Steer | ← → | left thumb stick (points the plane) | left stick |
| Fly | ↑ | push the stick further | left stick |
| Brake | ↓ | | |
| Throw pencil | Space or click (hold to keep throwing) | right button | A |
| Pause | P / Esc | | |
| Start | Enter | Start button | Start / A |

## Open-house kiosk mode

Put the game on a big screen and let visitors fly from their phones:

1. On the kiosk computer, open **https://saultcollege.github.io/saultsteroids/?kiosk**
   in a full-screen browser (F11). It shows a QR code and a four-letter room code.
2. Visitors scan the QR code. Their phone becomes a controller (thumb stick plus
   throw button), and their own coloured, named paper airplane appears on the big screen.
3. Everyone shares the sky. Each player has their own coffees and credits; the
   scoreboard is on the big screen. Running out of coffee shows "Play again" on that phone.

Up to 6 people play at once (more are told the sky is full and can retry). When
nobody has played for 20 seconds, the sky resets to a fresh first semester. The
room code stays in the kiosk's address bar, so reloading the kiosk keeps the same
QR code, and phones reconnect by themselves.

### How it works

The game stays a static site. Phones and the kiosk exchange small messages through
[Supabase Realtime Broadcast](https://supabase.com/docs/guides/realtime/broadcast)
over a secure WebSocket. A peer-to-peer (WebRTC) approach was tested first and
failed on the college Wi-Fi, which blocks UDP and isolates devices from each other.

- The kiosk runs the whole game. Phones only send their stick and throw button,
  rounded so small thumb wobbles don't cost a message: at most 8 times a second,
  plus a keepalive every 2 seconds. The kiosk tells each phone its coffees and credits.
- Each phone has its own channel to the kiosk, so its messages reach only the kiosk.
- Worst case, 6 players all steering constantly, is under 100 messages a second, the
  Supabase Free plan's rate. A test checks this. The Free plan also includes
  2 million messages a month: about 5½ hours of a completely full kiosk, and far
  more in normal use. An empty kiosk sends nothing.
- Names are generated (e.g. "Swift Moose"); the kiosk only shows names from its own
  lists, so nothing unexpected appears on the big screen.

Protocol details are at the top of `src/net/protocol.js`. Supabase settings are in
`src/net/config.js`; the key there is the project's *publishable* key, which is
meant to be public.

**Before an event:** Supabase pauses Free-plan projects after a week without use.
Open the Supabase dashboard and unpause the project if needed, then test with a phone.

### Trying kiosk mode without Supabase

Add `transport=local` to use the browser's BroadcastChannel instead: open
`http://localhost:8080/?kiosk&transport=local` in one tab and the link it shows in
another tab of the same browser. Arrow keys and Space work on the controller page.

## Run it locally

No build step: the game is plain ES modules served as static files.

```sh
npm install   # only needed for the tests and for updating LittleJS
npm start     # serves on http://localhost:8080
```

Any static server works (`python3 -m http.server`, for example). Opening
`index.html` straight from disk does not, because browsers block ES modules on `file://`.

## Tests

```sh
npm test
```

Tests use Node's built-in test runner, with no extra dependencies:

- `test/rules.test.js`: unit tests for the pure game rules (wrapping, splitting, scoring, difficulty, steering).
- `test/playfield.test.js`: fitting the playfield to different screen shapes.
- `test/game.test.js`: integration tests that run the real game in LittleJS
  [headless mode](https://github.com/KilledByAPixel/LittleJS/blob/main/REFERENCE.md#headless-testing),
  stepping it frame by frame. Input can't be synthesized headless, so tests feed
  controls through `setControlSource()`.
- `test/protocol.test.js`: unit tests for the kiosk protocol (room codes, names, input rounding).
- `test/kiosk.test.js`: the kiosk host and phone controllers running against the
  headless game through an in-memory network (`test/helpers/memory-transport.js`)
  with a fake clock: joining, steering, scoring, spills, timeouts, reconnecting,
  a full sky, and the message budget.

## Project layout

```
index.html          page, HTML menus, kiosk panel
play/index.html     phone controller page for kiosk mode
src/main.js         browser entry: engine settings, touch gamepad, menus, ?kiosk
src/game.js         game state and LittleJS callbacks, solo and kiosk (no DOM)
src/kiosk.js        kiosk host: connects phones to planes (no DOM)
src/kiosk-ui.js     kiosk QR code, scoreboard, relay connection
src/controller.js   phone controller logic (no DOM)
src/controller-ui.js  phone controller page: thumb stick, throw button
src/net/            protocol, Supabase config, transports
src/entities.js     PaperPlane, Pencil and Deadline objects and their art
src/rules.js        pure rules, no LittleJS dependency
src/playfield.js    screen-fitted wrap-around playfield
src/theme.js        Sault College colours and flavour text
lib/                vendored LittleJS build (MIT, see LICENSE-littlejs.txt)
assets/             logo and favicon
```

## Deployment

`.github/workflows/pages.yml` runs the tests on every push and pull request.
On `main`, if they pass, it publishes the static files to GitHub Pages.

## Updating LittleJS

```sh
npm install -D littlejsengine@<version>
npm run vendor   # copies the build into lib/
npm test         # one test checks lib/ matches package.json
```

## Branding

Colours are sampled from the official logo files in the
[Sault College Brand Centre](https://www.saultcollege.ca/welcome-our-brand-centre):
green `#8EA366`, blue `#57B0E3`, charcoal `#58585A` and slate `#4A7085`.
The logo appears unaltered, with clear space, on the title screen only. The
style guide forbids rotating the logo or using its parts on their own, so the
trillium is never used as a game sprite.
