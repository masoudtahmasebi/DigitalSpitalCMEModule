# The eight-second Fortbildung

`kurzvideo.webm` — 320×180, VP8, 10 fps, **exactly 8.00 seconds**, 29 KB.

## Why a video is committed at all

The journey suite watches a course to completion. That is the half of the
product every browser test before it stopped short of, and it stopped short for
a real reason: the anti-skip rule measures watched time against elapsed real
time since the learner's last activity, so a physician cannot watch ten minutes
in one second and the API refuses a report that claims they did.

The fixture is the answer to that, **not a weakened rule**. The course this
suite builds uses an eight-second video with `requiredWatchPercent` at its real
value. Watching 80 % of eight seconds takes seven seconds of wall clock, and
every rule stays exactly as it is in production — nothing is relaxed, mocked or
fast-forwarded for the test.

## Why WebM and not MP4

Playwright's bundled Chromium ships without proprietary codecs, so it cannot
decode H.264. An MP4 fixture would load, report `readyState` 0 forever and never
fire `timeupdate` — a silent failure that looks exactly like a broken player.
VP8 in WebM is what this browser can actually play.

That is also why `docs/qa/` §9 records the same finding: the MP4 the platform
serves to physicians is correct, and is not the file to test the _harness_ with.

## Why the frames say what they say

Each frame carries the elapsed time and a bar that fills over the eight seconds.
When a run fails at "the gate did not open", the trace screenshot shows how far
the player actually got — which distinguishes "the video never played" from
"the progress never reached the API", and those two have entirely different
causes.

## Regenerating it

`make-kurzvideo.py` writes the raw MJPEG frames; Playwright's own ffmpeg turns
them into the WebM. Its build is deliberately minimal — no filters, no PNG
decoder — so the frames go in as MJPEG and come out as VP8:

```sh
python3 make-kurzvideo.py > /tmp/frames.mjpeg
"$PLAYWRIGHT_BROWSERS_PATH"/ffmpeg-*/ffmpeg-linux \
  -f image2pipe -c:v mjpeg -framerate 10 -i file:/tmp/frames.mjpeg \
  -c:v libvpx -b:v 120k -y kurzvideo.webm
```

The committed file is the artefact; the script is here so that "where did this
binary come from" has an answer that is not "somebody's laptop".
