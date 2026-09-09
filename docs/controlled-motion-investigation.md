# Controlled movement: investigation after the 2.4.0 device rejection

The user tested Production v1602 / gallery 2.4.0 on an iPhone 16 Pro Max with Safari 27 beta and reported no noticeable improvement. Exact OS build, power mode and on-device traces are unavailable. Fractional positioning alone did not solve the reported experience. This change remains an unpublished candidate; there is no approval to transfer it to Experiment.

## Input and held drag

An isolated 430px, DPR 3 gallery compared current queued transform writes with a diagnostic variant that writes only the visual transform immediately and still batches callbacks. Thirty synthetic move events were injected either from timers or from RAF. Times below measure event handler entry to a matching style write, not display presentation or hardware latency.

| Engine / delivery | 2.4.0 median | Immediate visual prototype median |
| --- | ---: | ---: |
| Chromium 151 / 8ms timers | 5.9ms | 0.1ms |
| Chromium 151 / inside RAF | 16.5ms | 0ms |
| WebKit 26.5 / 8ms timers | 15ms | 0ms |
| WebKit 26.5 / inside RAF | 21ms | 0ms |
| Chromium / browser-delivered CDP touches | 0.1ms | 0ms |

The browser-delivered case is important: a queued RAF does not necessarily cost an extra frame when events are delivered before that frame's callbacks. Synthetic input from inside RAF creates an artificial worst phase. The immediate visual prototype increased writes (29 versus 15/16 for the timer burst), and remains dependent on JavaScript and browser painting. It is not included in the main candidate without device evidence of a held-drag benefit.

Once the last pending drag frame is applied, the shared controller makes no more writes or motion while the finger stays still. Axis lock still waits for 7px of movement; the main candidate does not change that threshold. Native browser scrolling did not require any programmatic scroll writes in the CDP comparison. Native compositor cadence cannot be inferred from DOM touch/RAF callbacks.

## Reproducible release defects

Using identical 16px / 16ms input samples, regular handler delivery produced velocity 1px/ms and movement of 17.26px in the first 16ms of settling. Delaying the penultimate handler, then delivering the final handler 1ms later, made 2.4.0 infer 16px/ms and move 109.72px in the first 16ms. The input timestamps were unchanged: the old implementation measured delivery intervals rather than input intervals.

After a 2.5px/ms drag, holding for 80ms retained the full speed and moved 40.44px in the first settle frame. Holding for 101ms reset speed to zero and moved only 3.62px. A one-pixel final reversal after a 140px forward drag from slide 1 selected slide 0, settling backward by 499px.

The candidate estimates release speed from event timestamps over a 60ms window, keeps the sample preceding the window for interpolation, uses an 8px turning-point threshold, and multiplies speed by exp(-stationaryTime / 40ms). Its regressions require identical trajectories under different delivery timing, continuous behavior around 100ms, rejection of micro-reversal, and acceptance of deliberate reversal. With only one move after a long initial hold, actual motion duration is underdetermined; the implementation does not invent missing input samples.

The existing bounded monotonic curve and one-neighbor policy remain. The candidate does not promise exact native inertia or remove all acceleration needed to reach a selected snap target.

## Compositor experiment

Chrome CDP screencast captured raster output while the main thread was deliberately blocked. For an isolated 400ms identical Hermite curve, RAF settling produced 17 raster frames, with a 181ms gap and about a 173px jump. A transform Web Animation produced 25 raster frames that continued through the same block, despite only 16 JavaScript RAF callbacks.

The prototype was then placed in the actual gallery runtime. For goTo from 128px to 430px (175.5ms duration), a 100ms busy interval produced 7 raster frames in the RAF version and 12 with Web Animation. Neither implementation read computed style during movement. This is evidence of compositor independence on that desktop Chromium run, not a physical iPhone FPS measurement or a guarantee of GPU promotion on every device.

The initial animation prototype also exposed a real regression: its default pending start held the release coordinate for the first RAF in the full Chrome application. The candidate explicitly assigns startTime from document.timeline.currentTime. A regression now requires the actual slide rectangle to advance on the first RAF, in both Chromium and WebKit. It also verifies logical/visible agreement and freezing the exact visible transform at interruption.

The strip's inline important transform initially overrode Web Animations; the candidate temporarily lowers its own priority during settling and restores important before cancelling. Position follows animation currentTime; per-RAF callbacks update dots without writing transform. Application callbacks can still be delayed by a busy main thread. A new gesture reads the displayed transform once, freezes it, cancels the animation and invalidates old callbacks before pinch. Missing animation/matrix APIs retain the interruptible RAF path. Images and their application-owned transforms remain untouched.

## Native movement and pinch limits

Native scrolling remains the best baseline for browser-managed movement. It cannot be assumed to deliver a new DOM pinch promptly during momentum. WebKit's implementation history explicitly suppresses DOM touches that interrupt platform momentum ([WebKit 174300](https://bugs.webkit.org/show_bug.cgi?id=174300)). Safari 27 notes additionally say scrollTo during momentum should allow momentum to continue ([Safari 27 release notes](https://webkit.org/blog/17967/news-from-wwdc26-webkit-in-safari-27-beta/)). Calling scrollTo from a touch handler is therefore not a demonstrated way to restore this application's new-pinch behavior.

The Pointer Events specification leaves new pointer delivery during an ongoing fling to user-agent behavior, and changing touch-action after a gesture begins does not change that gesture's ownership ([Pointer Events 3](https://www.w3.org/TR/pointerevents3/)). Capture phase and preventDefault cannot recover an event the browser never delivered.

A native-drag/custom-settle hybrid would have to stop native momentum at release, before the next gesture, by changing the scroll container rather than waiting for a new pinch handler. That remains an unvalidated iOS handoff with risks to the final drag coordinate, momentum, scroll-snap and image retention. Desktop CDP and synthetic WebKit cannot certify it on this Safari build. It is not part of this candidate. Browser refresh-rate bug reports alone are not evidence of the user's current cause; no system-setting changes are proposed as a fix.

## Evaluation boundary

Test the same full application artifact, separately checking held drag, release after fast motion, a stationary hold before release, a tiny reversal, deliberate reversal, and a new pinch while settling. If needed, collect event timestamps, handler entry times, RAF cadence and first-write times locally in a diagnostic build without photo sources or user data. Such logs describe scheduling, not screen FPS. The application owner is performing independent whole-artifact regression tests. Shared publication remains on hold pending evaluation.
