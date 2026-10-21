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

## Project layout

```
index.html          page, HTML menus
src/main.js         browser entry: engine settings, touch gamepad, menus
src/game.js         game state machine and LittleJS callbacks (no DOM)
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
