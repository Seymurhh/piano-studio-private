# Frame bench

Renders still frames and short frame sequences of the studio's 3D stage in headless Chrome, at chosen music times. Use it to check any change to the picture by eye against the reference video. It does not change the app. It only loads the app's modules into its own page (`tools/frame.html`).

Requirements: Node 26 or later, Google Chrome in `/Applications`, and `ffmpeg` (only for `--mp4` and `--contact`). Nothing needs to be installed.

## Quick start

Run from the app folder (`Piano studio - private`):

```sh
# Stills at three music times (seconds)
node tools/render-frames.mjs --piece satie-gymnopedie-1.smf --times 2,5,10 --out ~/Desktop/frames

# Two pieces, four times each, plus a contact sheet per piece
node tools/render-frames.mjs --piece beethoven-fur-elise.smf,satie-gymnopedie-1.smf --times 0,6,20,45 --contact --out ~/Desktop/frames

# A 2-second, 24 fps sequence for checking motion, joined into an mp4
node tools/render-frames.mjs --piece beethoven-fur-elise.smf --video 6 8 24 --mp4 --out ~/Desktop/frames

# Other options and size: tall (phone) picture, a different camera and glow
node tools/render-frames.mjs --piece bach-prelude-in-c --shape tall --set sheetCam=low --set glow=0.7 --times 10 --out ~/Desktop/frames

# Everything else
node tools/render-frames.mjs --help
```

The script prints each file it writes, the time each frame took, and a brightness check (`luma mean/max sd`). It warns when a frame looks black or blank.

## Checking the real app page

`tools/app-check.mjs` opens `index.html` itself in headless Chrome, the way a visitor would, and reports every console
error and uncaught exception. It can also play notes on the computer keyboard, choose a piece, click through the Look
controls and make a video with the app's own "Make the video" button, saving the mp4 as a download.

```sh
# Load the page, list console errors, save a screenshot (page.png)
node tools/app-check.mjs --out ~/Desktop/app

# Also play a few notes on the computer keyboard (live playing) and take screenshots
node tools/app-check.mjs --out ~/Desktop/app --keys

# Make a 720p, 30 fps video of the demo and save it (as <out>/demo-pattern.mp4); --shape tall for the phone shape
node tools/app-check.mjs --out ~/Desktop/app --piece demo --export 720 --fps 30

# Run page scripts in turn from a JSON file: [{ "js": "...", "wait": seconds, "shot": "name.png" }]
node tools/app-check.mjs --out ~/Desktop/app --steps steps.json
```

`--look paper|night`, `--view`, `--shape` and `--set key=value` start the page with those saved choices. The microphone
is a fake test tone in this browser, so "Listen with the microphone" can be tried too. The script exits with code 2
when the page logged any error.

## Output files

| What | File |
|---|---|
| Still | `<out>/<prefix>-<time>.png`, for example `satie-gymnopedie-1-005.00.png`. A negative time such as -1.5 is written `m001.50`. |
| Sequence | `<out>/<prefix>-seq-<start>-<end>-<fps>fps/f00000.png` and onwards |
| Sequence video (`--mp4`) | `<out>/<prefix>-seq-<start>-<end>-<fps>fps.mp4` (H.264) |
| Contact sheet (`--contact`) | `<out>/<prefix>-contact.png` (stills tiled at 640 px wide) |

The prefix is the piece name, with the view added when it is not `sheet`. Use `--prefix` to change it.

## Options

- **Piece** (`--piece`): a file in `assets/music` (".smf" is added when there is no extension), a path from the app folder, a MIDI file anywhere on disk (served to the page at `/__piece/…`), or `demo`. A comma list draws each piece in turn.
- **Times** (`--times`): music seconds. The app's playback starts at -1.5, just before the first note. `a:b:step` expands to a range, for example `0:30:5`.
- **Sequence** (`--video <start> <end> <fps>`): every frame from start up to, but not including, end.
- **Size** (`--w`, `--h`, `--shape wide|tall`): the default is 1280x720, or 720x1280 when tall.
- **Pixel ratio** (`--ratio`): by default each frame is drawn larger and scaled down, exactly as the app's video export does it. That means 2x up to 1080p, 1.5x up to 1440p and 1x above. `--raw` saves the full drawn picture instead.
- **Stage options** (`--set key=value`, or `--key value`): every option the driver itself does not use goes to the page. The page calls the stage setter of the same name, ignoring case: `theme` calls `setTheme`, `sheetCam` calls `setSheetCam`, and the same goes for `sky`, `glow`, `landing`, `effects`, `motion`, `paths`, `view` and others. `look` calls `setLook` (`paper` or `night`), `hands` calls `setHands` (`rose`, `gold`, `lilac`, `pearl`) and `title` calls `setTitle`. Values `true`/`false`/`on`/`off` become booleans, numbers become numbers, and JSON is parsed. If a name has no setter, the script prints a warning listing the setters that do exist.
- **Page script** (`--js "<code>"`): runs in the page after setup, with `stage` in scope.
- **Waiting for assets** (`--settle <ms>`): waits after the first frame, for anything the stage loads in the background. If the stage ever gains a `stage.ready()` function that returns a promise, it is always awaited.
- **Format** (`--format jpeg --quality 0.9`): smaller and faster files, useful for long sequences.
- **Graphics backend** (`--gl auto|metal|swiftshader|default`): `auto` uses Metal through ANGLE, which is fast on this Mac. It falls back to SwiftShader, a software renderer about 20 times slower, only when the graphics fail.
- **Console** (`--verbose`): prints the page's console messages. Page errors are always printed.
- **Waiting time** (`--timeout <s>`): how long to wait for the page and for each frame. The default is 120.

## Opening the bench by hand

```sh
node tools/render-frames.mjs --serve --piece beethoven-fur-elise.smf --times 20
```

This prints an address. Open it in Chrome to get the stage with a scrub bar over the whole piece, which is handy for finding the moments worth rendering. Press Ctrl-C to stop the server. All the query options are described at the top of `tools/frame.js`.

## How it works

- `render-frames.mjs` does the following:
  1. Starts a small static server for the app folder on a free `127.0.0.1` port, with no caching.
  2. Launches Chrome with `--headless=new`, a fresh temporary profile and `--use-angle=metal`.
  3. Speaks the Chrome DevTools Protocol over Node's built-in WebSocket.
  4. Opens `frame.html`, waits for `window.__bench.state === 'ready'`, then calls `window.__render(t)` for each time and writes the PNG it returns.
  5. Stops Chrome and the server and deletes the profile when it ends, even after an error or Ctrl-C.
- `frame.js` builds the page:
  1. Loads the piece with the app's `parseMidi` (or `demoPiece`).
  2. Creates the stage with `createStage`.
  3. Calls `stage.resize(w, h, ratio)` as the export does.
  4. Applies the options and draws one warm-up frame, which builds the scene and compiles the shaders.
  5. For each time, draws with `stage.render(t)`, scales the result to w x h with high-quality smoothing (as the export does) and returns a PNG data URL.
- The stage carries a little state from the frame before it. The sheet's ball tails face the previous frame's camera. To keep results independent of order:
  - each still is drawn twice at its own time;
  - a sequence starts by drawing the frame before its start, so its frames match the app's own video export.

  The same command therefore gives byte-identical stills.

## Timing on this Mac (Apple M2 Pro, Metal)

At 1280x720 drawn at 2560x1440:

| Stage | Time |
|---|---|
| Chrome start | about 1 s |
| Building the scene for a piece | about 0.2 s |
| Each still | about 100 ms (it is drawn twice) |
| Each sequence frame | about 70 ms |
| Each frame with SwiftShader | about 1.9 s |
