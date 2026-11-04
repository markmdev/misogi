// Art manifest for Misogi. Every path is served from /public/art.
// Icons: 512x512 transparent webp (clay style). Mascot "Virgil": 768x768 transparent webp, same scale and
// baseline across poses. Scenes: 1600x900 webp plus an 800x450 "-sm" variant.

export const ICON_SIZE = 512;
export const MASCOT_SIZE = 768;

export const ICONS = {
  streak: "/art/icons/streak.webp",
  xp: "/art/icons/xp.webp",
  trophy: "/art/icons/trophy.webp",
  camp: "/art/icons/camp.webp",
  flag: "/art/icons/flag.webp",
  summit: "/art/icons/summit.webp",
  calendar: "/art/icons/calendar.webp",
  bell: "/art/icons/bell.webp",
  check: "/art/icons/check.webp",
  quest: "/art/icons/quest.webp",
  map: "/art/icons/map.webp",
  compass: "/art/icons/compass.webp",
  backpack: "/art/icons/backpack.webp",
  sparkles: "/art/icons/sparkles.webp",
  cheer: "/art/icons/cheer.webp",
  crown: "/art/icons/crown.webp",
  gift: "/art/icons/gift.webp",
  lock: "/art/icons/lock.webp",
  target: "/art/icons/target.webp",
  hourglass: "/art/icons/hourglass.webp",
  chart: "/art/icons/chart.webp",
  highfive: "/art/icons/highfive.webp",
  chat: "/art/icons/chat.webp",
  key: "/art/icons/key.webp",
  link: "/art/icons/link.webp",
  camera: "/art/icons/camera.webp",
  microphone: "/art/icons/microphone.webp",
  paintbrush: "/art/icons/paintbrush.webp",
  wand: "/art/icons/wand.webp",
  orb: "/art/icons/orb.webp",
  pencil: "/art/icons/pencil.webp",
  shield: "/art/icons/shield.webp",
  seedling: "/art/icons/seedling.webp",
  rocket: "/art/icons/rocket.webp",
  language: "/art/icons/language.webp",
  running: "/art/icons/running.webp",
  books: "/art/icons/books.webp",
  code: "/art/icons/code.webp",
  smarthome: "/art/icons/smarthome.webp",
  music: "/art/icons/music.webp",
  art: "/art/icons/art.webp",
  travel: "/art/icons/travel.webp",
  mindful: "/art/icons/mindful.webp",
  cooking: "/art/icons/cooking.webp",
  writing: "/art/icons/writing.webp",
  money: "/art/icons/money.webp",
  boxing: "/art/icons/boxing.webp",
  tie: "/art/icons/tie.webp",
  handshake: "/art/icons/handshake.webp",
  letter: "/art/icons/letter.webp",
  pin: "/art/icons/pin.webp",
  podium: "/art/icons/podium.webp",
  hiking: "/art/icons/hiking.webp",
  sleep: "/art/icons/sleep.webp",
  swim: "/art/icons/swim.webp",
  chess: "/art/icons/chess.webp",
} as const;
export type IconName = keyof typeof ICONS;

/** Virgil, the mountain spirit guide. */
export const MASCOT = {
  idle: "/art/mascot/idle.webp",
  wave: "/art/mascot/wave.webp",
  cheer: "/art/mascot/cheer.webp",
  think: "/art/mascot/think.webp",
  sleep: "/art/mascot/sleep.webp",
  climb: "/art/mascot/climb.webp",
  flag: "/art/mascot/flag.webp",
  read: "/art/mascot/read.webp",
} as const;
export type MascotPose = keyof typeof MASCOT;

/** One header scene per theme (big mountain right of center, empty sky on the left for text), plus the home hero. */
export const SCENES = {
  "home-hero": { src: "/art/scenes/home-hero.webp", sm: "/art/scenes/home-hero-sm.webp", width: 1600, height: 900 },
  teal: { src: "/art/scenes/teal.webp", sm: "/art/scenes/teal-sm.webp", width: 1600, height: 900 },
  mint: { src: "/art/scenes/mint.webp", sm: "/art/scenes/mint-sm.webp", width: 1600, height: 900 },
  sand: { src: "/art/scenes/sand.webp", sm: "/art/scenes/sand-sm.webp", width: 1600, height: 900 },
  peach: { src: "/art/scenes/peach.webp", sm: "/art/scenes/peach-sm.webp", width: 1600, height: 900 },
  lilac: { src: "/art/scenes/lilac.webp", sm: "/art/scenes/lilac-sm.webp", width: 1600, height: 900 },
  sky: { src: "/art/scenes/sky.webp", sm: "/art/scenes/sky-sm.webp", width: 1600, height: 900 },
  rose: { src: "/art/scenes/rose.webp", sm: "/art/scenes/rose-sm.webp", width: 1600, height: 900 },
  night: { src: "/art/scenes/night.webp", sm: "/art/scenes/night-sm.webp", width: 1600, height: 900 },
} as const;
export type SceneName = keyof typeof SCENES;

/** Category id -> icon. Unknown categories should fall back to "summit". */
export const CATEGORY_ICON: Record<string, IconName> = {
  language: "language",
  fitness: "running",
  running: "running",
  reading: "books",
  code: "code",
  making: "smarthome",
  smarthome: "smarthome",
  music: "music",
  art: "art",
  travel: "travel",
  mindful: "mindful",
  cooking: "cooking",
  writing: "writing",
  money: "money",
  boxing: "boxing",
  social: "handshake",
  other: "summit",
};

/** Covers of the challenges that ship with the site that have a Grok Imagine loop, by picture name: /art/motion/covers/<name>.mp4. */
const COVER_LOOPS = new Set([
  "chl_1jllmx23s0mw-oml4vhkg", "chl_demo21mu0jqs-lnzrgr7l", "chl_demo21wztq3o-pb45d8dr", "chl_demo2sgdvwyp-jxujyjr2", "chl_demo3v8son77-gdw49kz4",
  "chl_demo4za7toba-0m6ll424", "chl_demo6ebl35f3-vhkpvu7y", "chl_demo6pz9hi23-y8cmc3xs", "chl_demo868st571-kre1hfi2", "chl_demo9918eizb-6wekgtr2",
  "chl_demo9m966gr6-whrdiniz", "chl_demobnlfdz36-eo93kjrw", "chl_demobxw1dw1x-t60imbo2", "chl_demobz5307og-tkbmbjb9", "chl_demod8j2fvyu-dz108edw",
  "chl_demodocj0gjv-w3ye3g5r", "chl_demogvedtcsv-4q74v95e", "chl_demok0n7ppto-b3gy94p3", "chl_demol4evv73u-bhhgpy92", "chl_demolnjh0p4m-wuzvc3aj",
  "chl_demolx5lj3n1-ndlyxh5m", "chl_demoo1vcw5o3-pn3t6kb4", "chl_demopivi7ux9-q0namgza", "chl_demorn0urysa-f37pkdnq", "chl_demosali7j3c-iin07otc",
  "chl_demov6s9qc4o-rhdkpesv", "chl_demowew4z4h3-kto6in9l", "chl_demoy30vwjcp-vzbzvhsr", "chl_demozlc9srp0-7jh7ij9k",
]);

/** The loop for this cover, when it's one of those exact pictures; a redrawn cover has none. */
export function coverLoop(coverUrl: string | null): string | null {
  const name = coverUrl?.match(/\/media\/covers\/([\w-]+)\.\w+$/)?.[1];
  return name && COVER_LOOPS.has(name) ? name : null;
}

/** Dressed Virgils that have a Grok Imagine loop, by picture name: /art/motion/virgils/<name>.webm and .mov. */
const VIRGIL_LOOPS = new Set([
  "chl_1jllmx23s0mw-7brizp6g", "chl_demo21mu0jqs-i3ljvrh5", "chl_demo21wztq3o-gzgakkbp", "chl_demo2sgdvwyp-aawzpoey", "chl_demo3v8son77-0ruq4emb",
  "chl_demo4za7toba-lcsj0wi1", "chl_demo6ebl35f3-a23flhli", "chl_demo6pz9hi23-epwurq2z", "chl_demo868st571-1rqtrzu4", "chl_demo9918eizb-r8vhgxcb",
  "chl_demo9m966gr6-jmfsgqh0", "chl_demobnlfdz36-911nmkqu", "chl_demobxw1dw1x-8av15bax", "chl_demobz5307og-g0q2q3vq", "chl_demod8j2fvyu-fj78vmr3",
  "chl_demodocj0gjv-ax57e5pp", "chl_demogvedtcsv-76ul880c", "chl_demok0n7ppto-woipkka9", "chl_demol4evv73u-8fxkv1j7", "chl_demolnjh0p4m-n0u1bvlk",
  "chl_demolx5lj3n1-lijgi41l", "chl_demoo1vcw5o3-dli89hfg", "chl_demopivi7ux9-adharcfb", "chl_demorn0urysa-l55fsstm", "chl_demosali7j3c-9u5e2g6n",
  "chl_demov6s9qc4o-1htys7xw", "chl_demowew4z4h3-2oma3wa0", "chl_demoy30vwjcp-y3f4f18r", "chl_demozlc9srp0-4eb0lg3p",
  "chl_jt7xa93js083-ad7tre55",
]);

/** The loop for this dressed Virgil, when it's one of those exact pictures; a redrawn one has none. */
export function virgilLoop(url: string): string | null {
  const name = url.match(/\/media\/virgils\/([\w-]+)\.\w+$/)?.[1];
  return name && VIRGIL_LOOPS.has(name) ? name : null;
}
