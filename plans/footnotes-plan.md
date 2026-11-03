# Footnotes v1 — implementation plan

This plan builds what `ideas/footnotes-brief.md` asks for, and only what the demo video shows. It's written for a team of coding agents: the General fixes the contracts in milestone 0, then five workstreams build in parallel against those contracts, each in its own worktree and branch.

**Finish line:** on the deployed Worker, a replay of the Rome walking video with a map pin as location gives unprompted, timely commentary when the Pantheon comes into view, answers a spoken "what's that?" about the thing in frame, stops when the walker talks over it, changes its commentary after it learns the walker's interests, follows the chattiness slider, and ends with a map recap and a shareable image. The same web app, running inside the iOS companion app with the Meta glasses, does the same on a real walk outside.

**Deadline:** Wednesday Nov 4, 9:00 PM ET (6:00 PM Vancouver).

## Blocked on Oscar (and Mark) before the build

1. **Which Wonder, and a budget for it.** Meta's Model API docs list one Wonder model, `muse-wonder-1.0` (preview), which takes image input and streams through `/v1/responses`. "Muse Wonder Full" appears only as a Muse Code plan feature, and the docs say no API parameter selects it. So this plan uses `muse-wonder-1.0`, and Mark confirms whether the gateway exposes anything closer to Full. Cost is the larger problem: at $4 per million input tokens and $20 per million output tokens, one turn with a 768 px frame and about 3,000 tokens of context costs roughly 1.5 cents, and a 20-minute walk with about 150 turns costs about $2. The gateway's $0.50 a day per visitor ends a walk after about five minutes, so Footnotes needs a higher cap (or its own key) for development, the demo walk and judging.
2. **Cartesia account and key.** We need a Cartesia API key as the Worker secret `CARTESIA_API_KEY` on previews and production. The free plan's 20,000 credits are about 25 minutes of speech, which three test walks would use up, so the recommendation is the Startup plan ($49 a month, 1.25M credits, five concurrent TTS streams). TTS costs one credit per character and STT three credits per second, so a 20-minute walk costs about 4,000 credits of listening plus whatever the guide says.
3. **Glasses developer access.** The Wearables Device Access Toolkit (DAT, iOS SDK 1.0.1) is native only, with no web API, so the glasses port needs: a Mac with Xcode 26.4 or later, an iPhone on iOS 17.2 or later, an Apple developer team to install the app, the Meta AI app paired with the glasses, and Developer Mode turned on in Meta AI (Settings → your glasses → Developer Mode). In Developer Mode the app registers without a Wearables Developer Center app ID, so the camera needs no Meta approval for the demo. Microphone audio from the glasses through DAT is an experimental feature that needs "Audio Streaming" approval in the Developer Center, so Oscar should request it now in case W5 needs it (see W5 step 2). Oscar also decides who owns W5 and holds the hardware.
4. **The test video.** The Rome walk ([Prowalk Tours, 3:50:43](https://www.youtube.com/watch?v=uOJkVLwnCNI)) has to be a local file, because a YouTube embed doesn't let the page read frames. Each developer downloads it with `yt-dlp` for their own testing, and it never goes in the repo. For the "any video works" moment in the demo video, we should film our own first-person clip on the glasses instead of showing Prowalk footage we don't have rights to.
5. **The voice.** The General shortlists three Cartesia voices that fit "a warm, witty local friend", and Oscar picks one. The voice ID then lives in `lib/voice/config.ts`.
6. **Dependencies (for Oscar's approval).** Each one is proposed with the reason it's worth adding:
   - **`maplibre-gl`** draws the pin-drop map in replay mode and the recap map. Its tiles come from [OpenFreeMap](https://openfreemap.org), which needs no key. Leaflet is the lighter alternative, but MapLibre's vector maps look much better in a demo, and both maps are on screen in the video.
   - **`@ricky0123/vad-web`** detects the start of the walker's speech in the browser (Silero VAD on ONNX Runtime Web), so the guide stops talking within a fraction of a second. A loudness threshold is the free alternative, but street noise and the guide's own voice make it trigger falsely, and "talk over it and it stops" is a demo moment.
   - **No Cartesia SDK.** `@cartesia/cartesia-js` 4.2.0 lists browsers as supported, but its docs don't show how to pass a browser access token to its WebSocket helper, and the raw protocol is a documented URL plus JSON messages. A small client of our own in `lib/voice/` is less code to debug than an SDK we'd have to read. If M0 shows the SDK works in the browser with a token, W3 may switch to it.
   - **Meta Wearables DAT iOS SDK** ([`meta-wearables-dat-ios`](https://github.com/facebook/meta-wearables-dat-ios) 1.0.1, Swift Package Manager) for the companion app. It's the only way to get the glasses' camera, and its Mock Device Kit lets W5 build before the hardware is set up.
   - **Dev tools only, not app dependencies:** `yt-dlp` to download the test video and `ffmpeg` to extract frames for the replay eval script (both from Homebrew).

   Deliberately not added: the `openai` client (plain `fetch`, as in the Misogi plan), a database (a walk lives on the phone), an auth library (there are no accounts), Playwright (agents check the UI in the built-in browser), a state-management library, an image-generation model for the share graphic (Canvas draws it) and SAM (the guide asks "the one with the green dome?" instead of segmenting).

## Architecture

```
 Phone or laptop: the Footnotes web app (Next.js page)              Cloudflare Worker
 ┌───────────────────────────────────────────────────────┐        ┌─────────────────────────┐
 │ FrameSource     video file  |  glasses bridge          │        │ POST /api/guide         │
 │ LocationSource  map pin | route file | phone GPS       │ JSON   │  builds the prompt,     │──▶ Meta gateway
 │ PlaceContext    Wikipedia geosearch + OSM reverse geo  │───────▶│  calls Muse Wonder,     │    /v1/responses
 │ Guide loop      when to ask, cancel, walker notes      │◀───────│  passes the stream back │◀──
 │ Voice           Cartesia TTS out, STT in, VAD barge-in │  SSE   │                         │
 │ Walk store      IndexedDB → recap map + share PNG      │        │ POST /api/voice/token   │──▶ Cartesia
 └───────────────────────────────────────────────────────┘        └─────────────────────────┘    access token
            │ WebSocket with a short-lived token
            ▼
        Cartesia TTS + STT

 On the glasses: iOS companion app (DAT SDK) → WKWebView with the same page.
 Camera frames enter through a JS bridge; voice plays and records over Bluetooth.
```

The whole guide runs in the page. The Worker does two small things: it holds the Meta and Cartesia keys, and it turns a guide request into one model call. The glasses port swaps the frame and location sources and changes nothing else.

## Decisions

1. **One web app, two hosts.** The guide is a Next.js page that runs in a desktop browser for video replay and inside a WKWebView in the iOS companion app for the glasses. The iOS app does three things: it connects to the glasses with DAT, passes camera frames into the page and gives the page location permission. *Rejected:* writing the guide loop again in Swift, because that doubles the hardest code one day before the deadline.
2. **Muse Wonder is the only model.** It sees the frame, decides whether to speak, writes the words and updates its notes about the walker, all in one call per turn. The ID is `muse-wonder-1.0` (see blocker 1), and model IDs live in one place, `lib/meta.ts`, so a gateway alias for Wonder Full is a one-line change. Every call sets `reasoning.effort` to `minimal`, the lowest level Wonder accepts, because each reasoning pass delays the first spoken word, and M0 checks whether `low` sounds better for the extra delay. *Rejected:* a cheap model (Muse Spark) as a gate that decides when to call Wonder. It would save credits, but it splits the "is this interesting, for this person, now?" judgment across two models, and that judgment is the product. We add the gate only if M0's cost numbers force it.
3. **The model decides, the loop only saves calls.** The loop calls the guide on a tick (every 4 seconds while nothing is playing), when the walker finishes speaking and when the guide finishes a line at the podcast end of the slider. It skips a tick only when the frame is almost the same as the last one sent and the walker has moved less than 15 m, which is cost control and makes no judgment about content. Only one request is in flight at a time, and ticks don't queue. *Rejected:* rules about place types, distances to landmarks or topic lists, because the brief says to give the model context, not rules.
4. **Context comes from open, worldwide data.** Each turn sends the latest frame (JPEG, longest side 768 px), the location, the street and neighbourhood from OpenStreetMap reverse geocoding, and up to ten nearby Wikipedia articles from the Wikipedia GeoSearch API, with titles, distances and URLs. The page calls both APIs directly, because they allow browser requests, and caches them by location. The read-more link on a footnote must be one of the URLs we sent, or a Wikipedia search link for the subject, so the guide never makes up a link. *Rejected:* the gateway's hosted web search, which is refused for now, and curated city content, which is out of scope.
5. **Speech first, metadata last.** The model's output is the words to speak, then a line with only `§`, then one line of JSON with the footnote and the updated walker notes. If it has nothing to say, it outputs only `§` and the JSON. The Worker passes the gateway's SSE stream through unchanged, because parsing each event in the Worker would spend CPU time we don't have, and the page reads the `response.output_text.delta` events. The page sends each finished sentence to Cartesia while the rest is still arriving, so the first words play before the model finishes. A metadata line that doesn't parse fails noisily in the debug panel and the speech still plays. *Rejected:* JSON output, because nothing can be spoken until the whole object has arrived.
6. **Cartesia for voice, out and in, straight from the browser.** The Worker calls Cartesia's `POST /access-token` with grants for `tts` and `stt` and a 10-minute expiry, and the page passes that token as `access_token` on the WebSocket URL, because browsers can't set WebSocket headers. The page then opens one WebSocket for TTS (`sonic-3.6`, `pcm_f32le` at 24 kHz, played through Web Audio) and one for STT (`ink-2`, 16 kHz PCM in 100 ms chunks, with Cartesia's turn events). Audio never passes through the Worker, so it stays far below the 10 ms CPU limit. `ink-2` covers English, which is all v1 needs. *Rejected:* Meta's Muse Voice Transcribe ($0.18 an hour, 25 languages), because its realtime WebSocket takes the Meta API key in the handshake, so the browser can't connect to it without a long-lived WebSocket proxy, and the README's gateway doesn't offer it.
7. **Barge-in is local and instant.** When VAD detects the walker starting to speak, the page stops playback at once, drops every audio chunk that still arrives for the current TTS context, sends Cartesia a cancel for it and aborts the in-flight guide request. Dropping chunks matters because Cartesia's cancel only stops generations that haven't started, so a line in progress keeps streaming after the cancel. It also keeps the frame from that moment, because "what's that?" means what was in view when they started talking, not two seconds later. When the transcript is final, the page sends it to the guide with that frame. What the guide does next, whether it stays quiet, goes deeper or changes subject, is the model's call. *Rejected:* waiting for the transcript to stop the voice, which feels like talking to a wall.
8. **Interest learning is notes the model keeps.** The system prompt tells the guide to keep short notes about what this walker cares about and to return them each turn. The page sends the latest notes back every turn and stores them with the walk. Nothing about interests is in code. *Rejected:* an interest profile with fixed categories, because the brief rules it out.
9. **The chattiness slider is context, plus one mechanism.** The slider has five stops, from "only the remarkable" to "full podcast". The page sends the stop, and the prompt describes each one in words. At the podcast stop the loop also asks for the next line as soon as one finishes, so the guide keeps talking about the area between sights. The default is the second stop.
10. **A walk lives on the phone.** The walk (route points, footnotes with their frames, notes) is stored in IndexedDB. The recap and the share image are drawn from that, and nothing is uploaded. *Rejected:* a database and a public recap URL, because the brief asks for an image to post, and a shared link would need storage, IDs and privacy decisions we don't need for the demo.
11. **The share image is drawn, not generated.** A Canvas renderer draws the route line, numbered pins, the walk's name, distance and time, and three highlights, in a Strava-like layout at 1080×1350. The page shares it with the Web Share API or downloads it. *Rejected:* map tiles in the image (CORS and attribution problems) and Muse Image (slow, costly and hard to make consistent).
12. **Simulated GPS has two modes.** For the Rome video, a route file lists video timestamps with coordinates, taken from the video's chapters (for example Piazza di Pietra at 49:39 and the Pantheon at 55:18), and the page interpolates between them. For any other video, the person drops a pin on the map and can drag it as the video plays. On the glasses, the location comes from the phone's GPS. All three implement the same `LocationSource`.
13. **English only, walking only.** The guide speaks English, and nothing handles driving speeds or other languages.

## Contracts (milestone 0, owned by the General)

These types go in `lib/contracts.ts`. A worker that finds a contract wrong stops and reports it instead of working around it.

### Sources (`lib/sources/types.ts`)

```ts
type Frame = { jpeg: Blob; width: number; height: number; capturedAt: number }; // ms since walk start

interface FrameSource {
  latest(): Frame | null;            // newest frame, already downscaled
  start(): Promise<void>; stop(): void;
}

type Location = { lat: number; lng: number; accuracyM: number; source: "pin" | "route" | "gps" };

interface LocationSource {
  current(): Location | null;
  subscribe(fn: (l: Location) => void): () => void;
}
```

Implementations: `VideoFrameSource` (a `<video>` element and a canvas), `GlassesFrameSource` (frames from the iOS bridge), `PinLocationSource`, `RouteLocationSource` (route file plus video time) and `GpsLocationSource` (`navigator.geolocation`).

### Guide request and reply (`POST /api/guide`)

```ts
type GuideRequest = {
  trigger: "tick" | "walker" | "line_done";
  frame: string;                       // data URL, JPEG
  location: Location;
  place: { street?: string; area?: string; nearby: { title: string; url: string; distanceM: number }[] };
  walker?: string;                     // final transcript when trigger is "walker"
  history: { who: "guide" | "walker"; text: string; at: number }[]; // last 12 turns
  covered: string[];                   // subjects already talked about on this walk
  notes: string;                       // the guide's own notes about the walker
  chattiness: 0 | 1 | 2 | 3 | 4;
  walkSeconds: number;
};
```

The response is a text stream in the speech-first format from decision 5. The page parses it into:

```ts
type GuideReply = {
  speech: string;                      // empty when the guide stays quiet
  meta: {
    footnote?: { subject: string; summary: string; readMoreUrl?: string };
    notes: string;
  };
};
```

A `429 gateway_resting` answer becomes a `Resting` state: the guide goes quiet, the page shows a small "guide is resting" note and the walk continues.

### Voice (`lib/voice/index.ts`)

```ts
interface Voice {
  speak(sentences: AsyncIterable<string>): Promise<"done" | "interrupted">;
  stop(): void;                                         // immediate, cancels the TTS context
  listen(handlers: {
    onSpeechStart(): void;                              // from VAD, before any transcript
    onTranscript(text: string, final: boolean): void;
  }): () => void;
}
```

### Walk record (`lib/walk/types.ts`)

```ts
type Footnote = {
  id: string; at: number; location: Location;
  frameKey: string;                    // IndexedDB key of the JPEG
  subject: string; said: string; readMoreUrl?: string;
};

type Walk = {
  id: string; startedAt: string; endedAt?: string;
  source: "video" | "glasses";
  route: { lat: number; lng: number; at: number }[];
  footnotes: Footnote[];
  notes: string;
};
```

### iOS bridge (`ios/` → page)

The iOS app streams the glasses camera at DAT's `.medium` size (504×896, portrait) and 7 frames per second, and calls `window.footnotes.pushFrame(base64Jpeg, width, height)` with the newest frame about twice a second, and `window.footnotes.glasses(status)` when the glasses connect or disconnect. The page sends `{type: "ready"}` through `webkit.messageHandlers.footnotes` when it's ready for frames. Nothing else crosses the bridge.

### The guide prompt (`lib/guide/prompt.md`)

The General writes the system prompt, because it's product voice. It covers: the persona (a warm, witty local friend); speak only about what's in the current frame, or at the podcast stop the area around it; it's late once the walker has passed it; ask "the one with the green dome?" when unsure what the walker means; one to three sentences unless asked to go on; stop and follow the walker when they cut in; keep and return notes on the walker's interests; what each chattiness stop means; and the output format.

## Workstreams

After milestone 0, five workers run in parallel. Each one works in its own git worktree on its own `oh-` branch and owns the files listed for it. Everything else is read-only for that worker.

### W1 — Walk page and inputs (`worker`, with the `frontend-design` skill)

**Owns:** `app/walk/**`, `components/walk/**`, `lib/sources/**`, `lib/place/**`, `data/routes/**`.

1. **Walk page:** one screen with the video (or a "connected to glasses" state), a small map with the location, the chattiness slider, a live transcript and a debug panel that shows each guide request, its latency and its raw reply. On a phone the page is the companion app, so the slider and transcript work at 375 px.
2. **Video replay:** pick any local video file, or the Rome file through a dev setting. `VideoFrameSource` draws the current video frame to a canvas and encodes a 768 px JPEG on demand. Seeking to a chapter must work, so testing starts at the Pantheon rather than at minute zero.
3. **Locations:** `PinLocationSource` (drop and drag on the MapLibre map), `RouteLocationSource` with the Rome route file (at least eight chapter points from Piazza di Pietra through the Pantheon), and `GpsLocationSource`.
4. **Place context:** `lib/place/` calls Nominatim reverse geocoding and Wikipedia GeoSearch (radius 300 m), caches results per 50 m grid cell and follows Nominatim's usage policy (one request per second, an identifying header).

**Done when:** in the built-in browser against `bun run preview`, the Rome video plays from the Pantheon chapter, the map pin moves along the route, and the debug panel shows a frame, coordinates, the street name and nearby Wikipedia titles that include the Pantheon.

### W2 — Guide brain (`worker`)

**Owns:** `app/api/guide/**`, `lib/meta.ts`, `lib/guide/**` (except `prompt.md`, which the General owns), `scripts/replay-eval.ts`, `tests/fixtures/guide/**`.

1. **Gateway client:** `lib/meta.ts` is a plain `fetch` to `/v1/responses` that follows the README: no retries, `max_output_tokens` set (400 is plenty for a spoken line plus metadata), `stream: true`, `reasoning.effort: "minimal"`, `x-visitor` as the sha256 of `cf-connecting-ip`, the judges' key when the request carries the judges' flag, and `429 gateway_resting` mapped to a typed `Resting` result. The frame goes in the `user` message as an `input_image` data URL, since Meta's API only accepts images in user messages, and the whole request must stay under the API's 1 MiB body limit.
2. **Guide route:** `POST /api/guide` builds the model input from a `GuideRequest` and the prompt, then returns the gateway's SSE body unchanged. The page-side parser for `response.output_text.delta`, `response.completed` and `response.failed` lives in `lib/guide/stream.ts`. The route measures and logs CPU time for a typical request in `bun run preview`.
3. **Guide loop (`lib/guide/loop.ts`):** the triggers and the skip rule from decision 3, one request in flight, abort on barge-in, the sentence splitter that feeds `Voice.speak`, the reply parser and the updates to `history`, `covered` and `notes`.
4. **Replay eval:** `scripts/replay-eval.ts` uses `ffmpeg` to take a frame every 4 seconds from a stretch of the Rome video, interpolates the route file and runs the real loop against the live gateway with text only, no voice. It writes a transcript with timestamps, a thumbnail per line and the notes after each turn to `evals/<date>-<segment>.md`. It costs credits, so it runs on demand only, never in the default suite.

**Done when:** `bun test` passes the route tests against `bun run preview` with recorded gateway answers (speech, silence, broken metadata, resting). One eval run over the Piazza di Pietra to Pantheon stretch has a transcript where the guide stays quiet on plain streets and speaks within one tick of the Pantheon entering the frame. The PR includes the measured time from request to first text.

### W3 — Voice (`worker`)

**Owns:** `app/api/voice/**`, `lib/voice/**`.

1. **Token route:** `POST /api/voice/token` calls Cartesia's `POST /access-token` (header `Cartesia-Version`, grants `tts` and `stt`, `expires_in` 600) and returns only the token. The page fetches a new one before the old one expires, and a reconnect uses the new one.
2. **TTS:** one WebSocket per walk to `wss://api.cartesia.ai/tts/websocket`, a new `context_id` per guide line, sentences pushed with `continue: true` as they arrive and a final empty push to close the line, base64 PCM decoded and scheduled through an AudioWorklet so there are no gaps. `stop()` silences output within 100 ms, sends the cancel and ignores any later chunk for that context (decision 7).
3. **STT and barge-in:** a microphone stream with echo cancellation on, resampled to 16 kHz, VAD for `onSpeechStart` and `ink-2` streaming for transcripts, with Cartesia's `turn.end` as the final transcript. While the guide is speaking, VAD's threshold goes up so the guide's own voice doesn't count as the walker.
4. **Voice settings:** the chosen voice ID, speed, the model names and the pinned `cartesia_version` in `lib/voice/config.ts`. The docs show two different version dates, so W3 pins the one the M0 spike worked with.

**Done when:** on a laptop with headphones in the built-in browser, a test page speaks a three-sentence streamed line with the first audio in under one second after the first sentence arrives, and speaking over it stops playback at once and prints the transcript. The PR states the measured time to first audio and the false barge-in rate over a two-minute recording with speakers instead of headphones.

### W4 — Recap and share (`worker`, with the `frontend-design` skill)

**Owns:** `app/recap/**`, `components/recap/**`, `lib/walk/**`, `lib/share/**`.

1. **Walk store:** `lib/walk/` saves the walk to IndexedDB as it happens, with route points every 10 m and footnotes with their frame JPEGs, so a page reload doesn't lose the walk.
2. **Recap page:** a MapLibre map with the route and a pin per footnote. Opening a pin shows the frame, what was said and the read-more link. A list under the map shows the same footnotes in order.
3. **Share image:** `lib/share/` draws the 1080×1350 image from decision 11, then shares it with `navigator.share` with a file, or downloads it where that isn't supported.

**Done when:** a seeded walk from `tests/fixtures/walks/rome.json` renders at 375 px and at desktop width in the built-in browser, every pin opens with its frame, and the share image looks like something a person would post. The General judges the last point.

### W5 — Glasses companion app (`worker` for the code, a person with the hardware for testing)

**Owns:** `ios/**`.

1. **Swift app:** registers with Meta AI in Developer Mode, starts the DAT camera stream (`.raw`, `.medium`, 7 fps) and passes the newest frame into a WKWebView that loads the deployed walk page, using the bridge in the contracts. It sets up the `Info.plist` entries DAT requires (URL scheme, `MWDAT`, the Bluetooth and external-accessory background modes), asks for location permission and keeps the screen awake during a walk. The stream stops when the glasses fold, overheat or run low, and the page shows that state instead of going silent without a reason.
2. **Audio:** DAT has no speaker API, so the guide's voice plays through iOS's normal Bluetooth audio route to the glasses. For the microphone, W5 tries the simple path first: the glasses as a Bluetooth headset microphone through `AVAudioSession`, which the page's `getUserMedia` then uses. If that route sounds bad (risk 4) or doesn't reach the WKWebView, the fallback is DAT's experimental audio streaming (16 kHz mono PCM, which needs the approval in blocker 3), passed to the page through a second bridge call. The phone's own microphone is the last fallback.
3. **Mock first:** build against DAT's Mock Device Kit until the glasses are set up. `MockCameraKit.setCameraFeed` can play the Rome video as the glasses camera, so the bridge and the page are tested end to end before the hardware is.

**Done when:** on an iPhone with the glasses, the walk page shows live frames from the glasses camera, the guide's voice plays in the glasses, and a question spoken through the glasses gets an answer.

## Schedule

| When (ET) | Milestone | Done when |
|---|---|---|
| Mon Nov 2, evening | **M0: contracts and spikes** (General plus one worker). `lib/contracts.ts`, the prompt draft, and four spikes: a streamed `muse-wonder-1.0` call with a Rome frame through the gateway (time to first token at `minimal` and `low` effort, cost per call), Cartesia TTS from the browser with a token (time to first audio, and whether the JS SDK works with a token), `ink-2` STT streaming, and frame capture from a local video file. | One Rome frame becomes a spoken line in the browser, and we know the cost per call. |
| Nov 2 night – Nov 3 | **M1: parallel build**, W1 to W5 in separate worktrees, each merged by its own PR. | Each workstream meets its own done-when. |
| Tue Nov 3, evening | **M2: integration on video.** Merge to main and replay 15 minutes of Rome on the deployed Worker, covering all six product moments. Run the eval, read the transcript and tune the prompt. | The video half of the finish line, on the live URL. |
| Wed Nov 4, morning | **M3: glasses and the real walk.** The iOS app on the device, a test walk outside, fixes, then filming the demo walk and our own first-person clip for the "any video" moment. | The glasses half of the finish line. |
| Nov 4, after 2 PM | Buffer, the Wikipedia side-by-side shot, editing, the write-up and submission. | Submitted before 9 PM ET. |

Demo moment 7, the side-by-side with someone reading Wikipedia on a phone, is filmed and edited. It needs no code.

## How the agents work

- **Roles:** the General writes the contracts and the prompt, reads every eval transcript, reviews every PR diff against its workstream's done-when and makes every decision that changes a contract. Workers implement. The prompt is the product, so prompt changes come from the General, based on eval transcripts.
- **Next.js 16:** before writing route or page code, each worker reads `node_modules/next/dist/docs/`, as `AGENTS.md` requires.
- **CPU budget:** the free plan allows 10 ms of CPU per request. Waiting on the model doesn't count, and streaming a response through is cheap, but parsing a request with a 100 KB image does count. W2 measures `/api/guide` in `bun run preview`. If it's over, the fix is the $5 Workers paid plan, and that's Oscar's and Mark's call.
- **Testing:** `bun test` runs E2E against `bun run preview` with recorded gateway answers and no mocks of our own code. UI is checked in the built-in browser. Voice and glasses are tested by a person, because the browser pane has no microphone and no glasses, and each PR says what was tested by hand.
- **Git:** one `oh-` branch per workstream, small commits with concise messages, everything to main by PR and no force-pushes. `CLAUDE.md`, `AGENTS.md` and `TASKS.md` stay out of commits. The test video, eval frames and any `.env` files are in `.gitignore`.
- **Gateway credits:** screens and tests use recorded answers. Live calls happen only in M0's spike, eval runs, and the M2 and M3 walks.

## Risks

1. **Latency may make the guide late.** Meta publishes no latency numbers for Wonder, which Meta positions for long, complex work rather than quick replies, so a call with an image might take several seconds while the walker keeps moving. If `minimal` effort is still too slow, the fallback is Muse Spark 1.3 for ticks and Wonder for the walker's questions, which is a model ID change in `lib/meta.ts`. Streaming, smaller frames and a short first sentence help, and M0 measures it. If it's still too slow, the loop sends frames on scene change rather than on the tick, so the guide starts thinking as a building comes into view rather than when it fills the frame.
2. **The gateway budget may not cover continuous use.** At about 1.5 cents a turn, the $0.50 per-visitor cap ends a walk after about five minutes in a resting state. Blocker 1 asks for a budget. The fallbacks are a longer tick, a smaller frame (image tokens scale with resolution) and the Spark gate from decision 2, since Spark costs about a quarter as much.
3. **Echo may cause false barge-ins.** The glasses' open-ear speakers are close to their microphones. Echo cancellation, a higher VAD threshold while the guide speaks and W3's measurement handle most of it. If it's still bad on the glasses, a tap on the phone or the glasses to interrupt is the fallback.
4. **Bluetooth audio may sound worse with the microphone on.** When a phone uses the glasses' microphone over Bluetooth HFP, playback can drop to phone-call quality, and the voice is half the product. W5 tests it first. If it's bad, the options are DAT's experimental audio streaming, which needs Meta's approval (blocker 3), or the phone's microphone.
5. **Glasses access may come late.** If DAT registration or the device build doesn't work by Wednesday morning, the fallback is to record a first-person walk on the glasses with the normal capture and run it through video mode with GPS from the phone. We say plainly in the demo that it's a replay.
6. **The guide may talk too much or too little.** That's prompt work, tuned on eval transcripts, and the slider covers taste. It's also the most likely way the demo disappoints, so M2 reserves the evening for it.
