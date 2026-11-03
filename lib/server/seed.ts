// Demo data for the live site: Zuckerberg-inspired templates plus seven active challenges
// with members, plans, quests, logs, cheers and a feed that reads like real people.
// History is generated relative to "now", so it stays fresh whenever it's seeded.
// Runs inside the Next server (better-sqlite3 doesn't run under Bun): POST /api/admin/seed.

import type BetterSqlite3 from "better-sqlite3";
import type { Milestone, Theme } from "@/lib/shared/types";
import { all, db, one, tx } from "./db";
import { levelFor, MILESTONE_XP } from "./facts";
import { addDays, addYear, dateIn, id, randomToken, sha256 } from "./util";

// ---------- Spec types ----------

type AgentKind = "muse" | "mcp" | "virgil" | "agent";
type Avatar = "sky" | "mint" | "peach" | "lilac" | "sand" | "rose";
type Aggregation = "sum" | "count" | "distinct";

type DemoUser = {
  handle: string;
  name: string;
  tz: string;
  avatar: Avatar;
  style: string;
  agent: AgentKind;
  agentName?: string;
  /** Local hour windows when this person usually logs. */
  hours: [number, number][];
};

type Camp = { title: string; detail: string; target: number; week: number; emoji: string };
type QuestTpl = { title: string; detail: string; kind: "daily" | "weekly" | "boss" | "one_off"; xp: number };
type Item = { label: string; note?: string; daysAgo?: number };
type Beat = { daysAgo: number; value?: number; note: string; long?: boolean };

type MemberSpec = {
  handle: string;
  /** Joined this many days before today (in their own time zone). */
  daysAgo: number;
  plan: { summary: string; cadence: string };
  replan?: { daysAgo: number; reason: string; shiftWeeks: number; summary?: string; cadence?: string };
  /** Windows with no logs: [fromDaysAgo, toDaysAgo], inclusive. */
  gaps?: [number, number][];
  // Daily logging (sum metrics)
  pace?: number;
  weekdays?: number[]; // chance per weekday, Sunday first
  amount?: [number, number];
  long?: { weekday: number; chance: number; amount: [number, number] };
  after?: { daysAgo: number; weekdays: number[]; amount: [number, number] };
  ritual?: { weekday: number; amount: number; hour: number; notes: string[]; every?: number };
  beats?: Beat[];
  noteRate?: number;
  // Running notes
  paceSec?: number;
  places?: string[];
  km?: boolean;
  // Item logging (count / distinct metrics)
  items?: Item[];
  /** What this member asks the codegen model for when building their own page. */
  space?: string;
};

type NoteCtx = { m: MemberSpec; value: number; hour: number; long: boolean; rng: Rng };

type ChallengeSpec = {
  key: string;
  slug: string;
  title: string;
  tagline: string;
  description: string;
  emoji: string;
  theme: Theme;
  category: string;
  metric: { name: string; unit: string; target: number; aggregation: Aggregation };
  step?: number;
  camps: Camp[];
  members: MemberSpec[];
  openQuests: QuestTpl[];
  doneQuest: (log: { value: number | null; label: string | null }, rng: Rng) => QuestTpl;
  notes?: string[];
  shortNotes?: string[];
  noteFor?: (ctx: NoteCtx) => string;
  /** What to ask the codegen model for when building this challenge's page. */
  space: string;
};

type TemplateSpec = {
  year: number;
  slug: string;
  title: string;
  tagline: string;
  intro: string;
  camps: string[];
  emoji: string;
  theme: Theme;
  category: string;
  metric: { name: string; unit: string; target: number; aggregation: "sum" | "count" | "days" | "latest" | "distinct" };
};

const q = (title: string, detail: string, kind: QuestTpl["kind"], xp: number): QuestTpl => ({ title, detail, kind, xp });

// ---------- People ----------

const USERS: DemoUser[] = [
  { handle: "danielokafor", name: "Daniel Okafor", tz: "Europe/London", avatar: "sky", agent: "muse", agentName: "Juno", style: "Gentle and specific. Remind me why I started when I drift.", hours: [[7, 8], [21, 22]] },
  { handle: "sofiam", name: "Sofía Márquez", tz: "Europe/Madrid", avatar: "peach", agent: "mcp", agentName: "Claude", style: "Data first. Show me the numbers and the gap, skip the pep talk.", hours: [[13, 14], [21, 23]] },
  { handle: "kenjimorita", name: "Kenji Morita", tz: "Asia/Tokyo", avatar: "mint", agent: "muse", agentName: "Pip", style: "Competitive. Tell me when someone passes me.", hours: [[6, 7], [21, 23]] },
  { handle: "hannahlevi", name: "Hannah Levi", tz: "America/New_York", avatar: "lilac", agent: "virgil", style: "Kind and calm. Small steps, no guilt.", hours: [[19, 22]] },
  { handle: "arjunm", name: "Arjun Mehta", tz: "America/Los_Angeles", avatar: "sand", agent: "virgil", style: "Playful. Short messages, jokes welcome.", hours: [[7, 8], [20, 22]] },
  { handle: "chloedubois", name: "Chloé Dubois", tz: "America/Toronto", avatar: "rose", agent: "virgil", style: "Encouraging. Celebrate the small wins.", hours: [[10, 12], [17, 19]] },
  { handle: "tomasherrera", name: "Tomás Herrera", tz: "America/Chicago", avatar: "sand", agent: "mcp", agentName: "Claude", style: "Straight talk. Engineer to engineer.", hours: [[6, 7], [20, 23]] },
  { handle: "ingrid", name: "Ingrid Solberg", tz: "Europe/Oslo", avatar: "mint", agent: "muse", agentName: "Ziggy", style: "Warm and practical. One clear next step.", hours: [[19, 22]] },
  { handle: "weizhang", name: "Wei Zhang", tz: "Asia/Singapore", avatar: "sky", agent: "mcp", agentName: "Claude", style: "Brief. Facts first, then one suggestion.", hours: [[12, 13], [21, 23]] },
  { handle: "femi", name: "Femi Adeyemi", tz: "Europe/Berlin", avatar: "peach", agent: "muse", agentName: "Rook", style: "Hype me up. I like energy.", hours: [[18, 22]] },
  { handle: "rachelkim", name: "Rachel Kim", tz: "America/Los_Angeles", avatar: "rose", agent: "virgil", style: "Gentle. I travel a lot, so plan around it.", hours: [[20, 22]] },
  { handle: "noahb", name: "Noah Brennan", tz: "America/Denver", avatar: "lilac", agent: "virgil", style: "Curious. Explain the why.", hours: [[19, 21]] },
  { handle: "amara", name: "Amara Nwosu", tz: "America/New_York", avatar: "peach", agent: "muse", agentName: "Momo", style: "Bookish and warm. Ask me what I thought.", hours: [[7, 8], [21, 23]] },
  { handle: "lucasf", name: "Lucas Ferreira", tz: "Europe/Lisbon", avatar: "sky", agent: "virgil", style: "Relaxed. No pressure, just company.", hours: [[8, 9], [22, 23]] },
  { handle: "yukitanaka", name: "Yuki Tanaka", tz: "Asia/Tokyo", avatar: "lilac", agent: "agent", agentName: "Hoshi", style: "Quiet encouragement. Notice consistency.", hours: [[21, 23]] },
  { handle: "graceoc", name: "Grace O'Connell", tz: "Europe/Dublin", avatar: "mint", agent: "virgil", style: "Patient. Life happens, help me restart.", hours: [[21, 23]] },
  { handle: "raviiyer", name: "Ravi Iyer", tz: "Asia/Kolkata", avatar: "sand", agent: "muse", agentName: "Kit", style: "Push me a little. I respond to streaks.", hours: [[8, 9], [22, 23]] },
  { handle: "emmal", name: "Emma Lindqvist", tz: "Europe/Stockholm", avatar: "rose", agent: "virgil", style: "Cozy. Short check-ins on Sundays.", hours: [[20, 22]] },
  { handle: "samwhit", name: "Sam Whitaker", tz: "America/Los_Angeles", avatar: "mint", agent: "virgil", style: "Dad schedule. Keep it light.", hours: [[21, 22]] },
  { handle: "jordanruns", name: "Jordan Ellis", tz: "America/New_York", avatar: "sky", agent: "mcp", agentName: "Claude", style: "Numbers and splits. Tell me if I'm overdoing it.", hours: [[6, 7]] },
  { handle: "mayac", name: "Maya Castillo", tz: "America/Los_Angeles", avatar: "rose", agent: "muse", agentName: "Sunny", style: "Hard-hitting. I like a challenge.", hours: [[5, 6], [17, 18]] },
  { handle: "aidenm", name: "Aiden Murphy", tz: "America/Chicago", avatar: "peach", agent: "agent", agentName: "Rex", style: "Keep me honest. No sugarcoating.", hours: [[17, 19]] },
  { handle: "lenafischer", name: "Lena Fischer", tz: "Europe/Berlin", avatar: "lilac", agent: "muse", agentName: "Fritz", style: "Structured. Weekly totals, clear targets.", hours: [[6, 7], [18, 19]] },
  { handle: "priyar", name: "Priya Raman", tz: "America/Toronto", avatar: "sand", agent: "virgil", style: "Gentle. Protect me from my own enthusiasm.", hours: [[6, 7], [18, 19]] },
  { handle: "kwame", name: "Kwame Mensah", tz: "Europe/London", avatar: "mint", agent: "virgil", style: "Friendly. I'm new to this, keep it simple.", hours: [[7, 8], [18, 19]] },
  { handle: "jiwoo", name: "Ji-woo Park", tz: "Asia/Seoul", avatar: "sky", agent: "virgil", style: "Steady. Remind me the night before long runs.", hours: [[5, 6]] },
  { handle: "elenap", name: "Elena Petrova", tz: "America/New_York", avatar: "lilac", agent: "muse", agentName: "Quill", style: "Honest editor. Tell me what's weak.", hours: [[6, 8], [21, 23]] },
  { handle: "claireb", name: "Claire Bennett", tz: "Europe/London", avatar: "rose", agent: "mcp", agentName: "Claude", style: "Dry humour welcome. Deadlines help.", hours: [[20, 22]] },
  { handle: "marcob", name: "Marco Bellini", tz: "Europe/Rome", avatar: "sand", agent: "virgil", style: "Easygoing. Don't nag, just remind.", hours: [[22, 23]] },
  { handle: "nadiah", name: "Nadia Haddad", tz: "Europe/Paris", avatar: "peach", agent: "virgil", style: "Thoughtful. Ask me good questions.", hours: [[7, 8], [21, 22]] },
  { handle: "carmenontheroad", name: "Carmen Ruiz", tz: "America/Phoenix", avatar: "peach", agent: "muse", agentName: "Nova", style: "Adventurous. Celebrate the stories, not the count.", hours: [[17, 20]] },
  { handle: "tylerb", name: "Tyler Brooks", tz: "America/Chicago", avatar: "sky", agent: "muse", agentName: "Scout", style: "Competitive, but friendly.", hours: [[18, 21]] },
  { handle: "mianguyen", name: "Mia Nguyen", tz: "America/Chicago", avatar: "rose", agent: "virgil", style: "Encouraging. Help me plan around work.", hours: [[19, 21]] },
  { handle: "ellie808", name: "Ellie Carter", tz: "Pacific/Honolulu", avatar: "mint", agent: "virgil", style: "Realistic. Flights are expensive from here.", hours: [[18, 20]] },
  { handle: "benlarsen", name: "Ben Larsen", tz: "America/Chicago", avatar: "lilac", agent: "virgil", style: "Plain and short.", hours: [[19, 21]] },
  { handle: "olliegrant", name: "Ollie Grant", tz: "Europe/London", avatar: "sand", agent: "muse", agentName: "Bramble", style: "Cheeky. Take the mickey a bit, I can handle it.", hours: [[19, 22]] },
  { handle: "anacosta", name: "Ana Costa", tz: "Europe/Lisbon", avatar: "rose", agent: "virgil", style: "Sweet and patient. I'm a total beginner.", hours: [[20, 22]] },
  { handle: "rohank", name: "Rohan Kapoor", tz: "Asia/Kolkata", avatar: "peach", agent: "mcp", agentName: "Claude", style: "Technical. Treat practice like training.", hours: [[6, 7], [21, 22]] },
  { handle: "helennovak", name: "Helen Novak", tz: "America/Chicago", avatar: "rose", agent: "muse", agentName: "Bao", style: "Warm and steady. Remind me who it's for.", hours: [[7, 8], [19, 22]] },
];

// ---------- Templates (Zuckerberg's yearly challenges) ----------

const TEMPLATE_LABEL = "Inspired by Mark Zuckerberg";

const TEMPLATES: TemplateSpec[] = [
  {
    year: 2009,
    slug: "wear-a-tie-every-day-2009",
    title: "Wear a tie every day",
    tagline: "Put on a tie every day for a year, as a daily reminder that this year is serious.",
    intro: "In 2009 Mark Zuckerberg wore a tie to work every day. It was a hard year, and the tie was a small, visible way to take it seriously. Pick your own daily signal: a tie, a pressed shirt, a made bed.",
    camps: ["Pick five ties and lay one out every night", "30 days without a miss", "Learn three new knots", "100 days", "Half a year: 183 days", "365 days"],
    emoji: "tie",
    theme: "night",
    category: "other",
    metric: { name: "days with a tie", unit: "days", target: 365, aggregation: "days" },
  },
  {
    year: 2010,
    slug: "learn-mandarin-2010",
    title: "Learn Mandarin",
    tagline: "Go from zero to HSK 4: real conversations and a few hundred characters.",
    intro: "In 2010 Zuckerberg set out to learn Mandarin. Years later he gave a whole Q&A in it. Start with the tones, practice a little every day, and find someone to talk to early.",
    camps: ["Pinyin and the four tones", "HSK 1: 150 words", "HSK 2: order food and ask for directions", "HSK 3: a 10-minute conversation", "HSK 4"],
    emoji: "language",
    theme: "rose",
    category: "language",
    metric: { name: "HSK level", unit: "HSK", target: 4, aggregation: "latest" },
  },
  {
    year: 2011,
    slug: "only-eat-meat-you-hunted-2011",
    title: "Only eat meat you hunted yourself",
    tagline: "Know exactly where your food comes from. Eat only meat you killed yourself.",
    intro: "In 2011 Zuckerberg only ate meat from animals he had killed himself. Most days that meant vegetarian food. The point was to be thankful for the food and honest about where it comes from.",
    camps: ["Take a hunter safety course", "Get your hunting license", "Go out with an experienced hunter", "First animal, processed yourself", "A full season", "365 days"],
    emoji: "cooking",
    theme: "sand",
    category: "cooking",
    metric: { name: "days eating only meat you hunted", unit: "days", target: 365, aggregation: "days" },
  },
  {
    year: 2012,
    slug: "write-code-every-day-2012",
    title: "Write code every day",
    tagline: "Write some code every single day. Ten lines counts.",
    intro: "In 2012 Zuckerberg's challenge was to write code every day. The trick is that a day counts even when it's small: a test, a script, one bug fixed.",
    camps: ["7-day streak", "Ship a small tool you use yourself", "30-day streak", "100 days", "A project someone else uses", "365 days"],
    emoji: "code",
    theme: "teal",
    category: "code",
    metric: { name: "days coding", unit: "days", target: 365, aggregation: "days" },
  },
  {
    year: 2013,
    slug: "meet-someone-new-every-day-2013",
    title: "Meet someone new every day",
    tagline: "Meet one new person every day, outside work, and actually talk.",
    intro: "In 2013 Zuckerberg tried to meet a new person every day who didn't work at Facebook. Log each person by first name, with a line about what you talked about.",
    camps: ["First week: seven new people", "30 people", "Host a dinner for people you just met", "100 people", "200 people", "365 people"],
    emoji: "handshake",
    theme: "peach",
    category: "social",
    metric: { name: "new people met", unit: "people", target: 365, aggregation: "distinct" },
  },
  {
    year: 2014,
    slug: "write-a-thank-you-note-every-day-2014",
    title: "Write a thank-you note every day",
    tagline: "One thank-you note a day. Be specific about what the person did.",
    intro: "In 2014 Zuckerberg wrote a thank-you note every day, often by hand. Specific beats grand: thank someone for one thing they actually did.",
    camps: ["Buy cards and stamps", "First 30 notes", "Thank someone you lost touch with", "100 notes", "200 notes", "365 notes"],
    emoji: "letter",
    theme: "lilac",
    category: "writing",
    metric: { name: "thank-you notes", unit: "notes", target: 365, aggregation: "count" },
  },
  {
    year: 2015,
    slug: "read-a-book-every-two-weeks-2015",
    title: "Read a book every two weeks",
    tagline: "Twenty-six books in a year, with an eye on other cultures, beliefs and histories.",
    intro: "In 2015 Zuckerberg ran \"A Year of Books\": a book every two weeks, picked to learn about different cultures, beliefs, histories and technologies.",
    camps: ["First book in two weeks", "Six books", "A book far outside your usual shelf", "13 books: halfway", "20 books", "26 books"],
    emoji: "books",
    theme: "sand",
    category: "reading",
    metric: { name: "books read", unit: "books", target: 26, aggregation: "count" },
  },
  {
    year: 2016,
    slug: "run-365-miles-2016",
    title: "Run 365 miles",
    tagline: "A mile a day, on average. In 2016 thousands of people ran it together.",
    intro: "In 2016 Zuckerberg ran 365 miles and invited everyone to join \"A Year of Running\". Most people did three or four runs a week, not one a day.",
    camps: ["25 miles", "100 miles", "Halfway: 183 miles", "250 miles", "365 miles"],
    emoji: "running",
    theme: "mint",
    category: "fitness",
    metric: { name: "miles run", unit: "mi", target: 365, aggregation: "sum" },
  },
  {
    year: 2016,
    slug: "build-a-simple-ai-for-your-home-2016",
    title: "Build a simple AI for your home",
    tagline: "A simple assistant that runs your home: lights, music, the door, and a voice to talk to.",
    intro: "Also in 2016, Zuckerberg built Jarvis, a simple AI for his home that controlled the lights, music and temperature and knew who was at the door. Count each feature that works every day.",
    camps: ["Pick a hub and connect the lights", "Control music and temperature", "Know who's at the door", "Talk to it by text", "Talk to it by voice", "10 features working"],
    emoji: "smarthome",
    theme: "sky",
    category: "making",
    metric: { name: "features working", unit: "features", target: 10, aggregation: "count" },
  },
  {
    year: 2017,
    slug: "visit-every-us-state-2017",
    title: "Visit every US state",
    tagline: "Visit every state, meet people where they live, and listen.",
    intro: "In 2017 Zuckerberg visited the US states he hadn't been to yet, to meet people and hear how they live and work. A state counts when you stop and talk to someone there.",
    camps: ["Plan a route for the first five", "10 states", "Every state in one region", "30 states", "40 states", "All 50"],
    emoji: "travel",
    theme: "peach",
    category: "travel",
    metric: { name: "states visited", unit: "states", target: 50, aggregation: "distinct" },
  },
  {
    year: 2019,
    slug: "public-conversations-about-tech-2019",
    title: "Host public conversations about tech",
    tagline: "Host a public conversation about technology and the future, about once a month.",
    intro: "In 2019 Zuckerberg hosted a series of public discussions about technology's role in society. Yours can be a meetup, a livestream or a podcast. Invite people who disagree with you.",
    camps: ["Pick five topics and five guests", "First conversation, recorded and posted", "Three conversations", "Six: halfway", "Nine conversations", "12 conversations"],
    emoji: "podium",
    theme: "teal",
    category: "social",
    metric: { name: "conversations hosted", unit: "talks", target: 12, aggregation: "count" },
  },
];

// ---------- Live challenges ----------

const MANDARIN_NOTES = [
  "Second tone vs third tone drill. Still mixing up mǎi and mài.",
  "HelloChinese unit 6 done. Food words.",
  "Shadowed a 3-minute podcast clip five times.",
  "Learned how to say I'm vegetarian: wǒ chī sù.",
  "Flashcards on the bus. 40 cards, 31 right.",
  "Read prices out loud at the Asian supermarket. Numbers are sticking.",
  "Wrote 我 twenty times until the strokes felt natural.",
  "Tones are easier when I exaggerate them. Felt silly, worked.",
  "Slow Chinese podcast while cooking dinner.",
  "Measure words are a rabbit hole. Using 个 for everything for now.",
  "Recorded myself reading a dialogue. Painful to hear, very useful.",
  "Learned the radicals for water and person. Characters make more sense now.",
  "Asked a coworker how to say see you tomorrow. Míngtiān jiàn.",
  "Only had 10 minutes. Did tone pairs anyway.",
  "Cooking video in Mandarin with subtitles. Caught 'a little salt'.",
  "Reviewed all the greetings. Ready for the first 30 seconds of small talk.",
  "Practiced asking for directions. Left, right, straight ahead.",
  "Pinyin dictation, 8 out of 10.",
  "Neutral tone finally clicked. It's lighter, not lower.",
  "Read a children's picture book with pinyin. Very proud of this.",
  "Rough day. Flashcards in bed so the streak lives.",
  "Learned to say what I do for work. Long sentence, lots of tones.",
  "Zhège duōshǎo qián? How much is this? Said it out loud ten times.",
  "Lin made me describe my apartment. I know the word for window now.",
  "Cleared the flashcard backlog. 120 cards.",
  "Sang along to a Mandopop song. Tones mostly vanish in songs, apparently.",
  "Introduced myself with no notes. Name, city, job, hobbies.",
  "Time words today: yesterday, today, tomorrow, next week.",
  "Drilled zh, ch, sh and r in front of a mirror.",
  "Listening practice on the train. Got the gist of a short story.",
  "Learned bù hǎo yìsi, sorry to bother you. Will use it constantly.",
  "Scored 90+ on every HelloChinese speaking exercise today.",
  "Practiced ordering bubble tea: shǎo bīng, bàn táng. Less ice, half sugar.",
  "Texted a friend in pinyin. She replied with a sticker.",
  "Lin says my r sounds too English. Working on it.",
  "Did an HSK 1 practice test. Passed comfortably.",
  "Counted to 100 out loud on a walk.",
  "Long session. Went back through old lesson notes and filled the gaps.",
  "Ten characters, ten sentences. Short and done.",
  "Asked Lin about 会 vs 能. Finally clear.",
  "Traced the tones in the air with a pen, like Lin showed me. Weird but it helps.",
  "The word for computer is 'electric brain'. Best word so far.",
  "Weather small talk. Jīntiān hěn lěng, it's cold today.",
  "Learned the days of the week. Monday is literally 'week one'.",
  "Street food video from Chengdu. Understood the word for spicy, mostly.",
  "Wrote a 5-line diary entry in characters. Took 25 minutes.",
  "Minimal pairs: mā má mǎ mà. The neighbors must think I'm calling my mom.",
  "Learned how to say I'm learning Mandarin. Wǒ zài xué zhōngwén.",
  "Practiced a phone call to book a table. Lots of numbers.",
  "Mixed up 四 and 十 again. Four and ten. Drilled it 20 times.",
  "Read the menu at a Sichuan place without the English column. Ordered mapo tofu.",
  "Finally hear the difference between q and ch.",
  "Lin's homework: talk for one minute about breakfast. Managed 40 seconds.",
  "Anki streak at 30 days.",
  "Listened to the same dialogue until I could follow it with my eyes closed.",
  "Learned to say 'can you speak slower'. Most useful phrase yet.",
];

const RUN_SHORT = [
  "negative splits",
  "legs heavy from yesterday",
  "easy, conversational",
  "headwind both ways somehow",
  "fartlek, 8 × 1 min",
  "new shoes, no blisters",
  "rain the whole way, loved it",
  "hill repeats × 6",
  "felt strong",
  "felt awful, ran anyway",
  "strides at the end",
  "kept heart rate under 150",
  "ran with the dog",
  "dark at 6am now, headlamp on",
  "first run in tights this season",
  "sore calves, took it easy",
  "recovery jog",
  "tempo miles in the middle",
  "music off, just breathing",
  "foggy and quiet",
  "chased by a goose",
  "ran before the rain hit",
  "back-to-back days",
  "slow and happy",
  "cold hands",
  "track session, 4 × 800m",
  "treadmill, watched half an episode",
  "PR on the usual loop",
];

const RUN_LONG = [
  "long run, gel at mile 6",
  "longest run in weeks",
  "slow and steady, walked the water stops",
  "legs done, heart happy",
  "long run with the Saturday group",
  "last 2 miles at goal pace",
  "hungry for the rest of the day",
  "out to the bridge and back",
];

function mmss(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
}

function runTitle(hour: number): string {
  if (hour < 11) return "Morning Run";
  if (hour < 14) return "Lunch Run";
  if (hour < 17) return "Afternoon Run";
  if (hour < 21) return "Evening Run";
  return "Night Run";
}

function runNote({ m, value, hour, long, rng }: NoteCtx): string {
  const r = rng.next();
  if (r < 0.3) return "";
  const pace = (m.paceSec ?? 600) + (long ? 25 : 0) + rng.int(-25, 25);
  let phrase = long ? rng.pick(RUN_LONG) : m.places && rng.chance(0.4) ? rng.pick(m.places) : rng.pick(RUN_SHORT);
  const title = runTitle(hour);
  if (m.km) {
    phrase = phrase.replace("mile 6", "km 10").replace("last 2 miles", "last 3 km");
    const km = (value * 1.609).toFixed(1);
    return `${title} · ${km} km · ${mmss(pace / 1.609)}/km${rng.chance(0.6) ? ` · ${phrase}` : ""}`;
  }
  if (r < 0.55) return `${title} · ${mmss(pace)}/mi`;
  if (r < 0.88) return `${title} · ${mmss(pace)}/mi · ${phrase}`;
  return phrase.charAt(0).toUpperCase() + phrase.slice(1) + ".";
}

const CHALLENGES: ChallengeSpec[] = [
  // ----- Mandarin -----
  {
    key: "mandarin",
    slug: "mandarin-conversation",
    title: "Hold a 20-minute conversation in Mandarin",
    tagline: "About 25 minutes a day, from zero to a real 20-minute chat.",
    description:
      "Start Mandarin from scratch and end the year with a 20-minute conversation with a native speaker, all in Mandarin.\n\n" +
      "Practice time is the shared yardstick: about 25 minutes a day gets you to 150 hours. Tutor lessons, apps, flashcards, podcasts and shadowing all count. Log minutes.",
    emoji: "language",
    theme: "rose",
    category: "language",
    metric: { name: "practice minutes", unit: "min", target: 9000, aggregation: "sum" },
    step: 5,
    camps: [
      { title: "Pinyin and the four tones", detail: "Hear and say all four tones. Read any pinyin out loud.", target: 300, week: 3, emoji: "language" },
      { title: "Order dumplings in Mandarin", detail: "Greetings, numbers and food words. Order a meal without English.", target: 1200, week: 9, emoji: "cooking" },
      { title: "First 5-minute chat", detail: "Five minutes with a tutor about everyday things, no English.", target: 3000, week: 20, emoji: "chat" },
      { title: "HSK 2 practice test", detail: "Pass a full HSK 2 practice test, listening and reading.", target: 5000, week: 31, emoji: "target" },
      { title: "10-minute conversation", detail: "Ten minutes about your life, your work and your plans.", target: 7000, week: 42, emoji: "microphone" },
      { title: "20 minutes, all in Mandarin", detail: "A real 20-minute conversation with a native speaker.", target: 9000, week: 52, emoji: "summit" },
    ],
    notes: MANDARIN_NOTES,
    shortNotes: ["HelloChinese", "Flashcards", "Tone drills", "Podcast on the commute", "Anki review", "Quick review before bed", "Shadowing"],
    members: [
      {
        handle: "danielokafor",
        daysAgo: 70,
        pace: 0.8,
        amount: [15, 35],
        ritual: {
          weekday: 2,
          amount: 60,
          hour: 19,
          notes: [
            "Lesson with Lin.",
            "Lin lesson: food and restaurants.",
            "Lesson with Lin. Only Mandarin for the first ten minutes!",
            "",
            "Lin lesson: family words, so I can talk about Nai Nai.",
            "Lesson with Lin. Directions and transport.",
            "Lesson with Lin. Talked about my weekend, badly but all the way through.",
            "",
            "Lin lesson: tones in full sentences, not just single words.",
            "Lesson with Lin. She only switched to English once.",
          ],
        },
        beats: [
          { daysAgo: 70, value: 20, note: "Day one. Learned nǐ hǎo and found out tones are going to be a problem." },
          { daysAgo: 18, value: 30, note: "Ordered dumplings in Mandarin in Chinatown. The waiter answered in English, but she understood me first." },
          { daysAgo: 9, value: 35, note: "Lin says my third tone finally dips instead of crashing." },
          { daysAgo: 2, value: 25, note: "Practiced the Lunar New Year greeting for Nai Nai. Xīnnián kuàilè!" },
        ],
        plan: {
          summary:
            "Daniel wants to talk with his partner's grandmother at Lunar New Year without anyone translating. Daily practice in HelloChinese, a weekly lesson with Lin on Tuesdays, and five minutes of tone drills before bed. Weekends are lighter on purpose.",
          cadence: "Daily, 20–30 min. Lesson with Lin every Tuesday.",
        },
      },
      {
        handle: "kenjimorita",
        daysAgo: 66,
        pace: 0.93,
        amount: [25, 55],
        ritual: {
          weekday: 6,
          amount: 60,
          hour: 9,
          notes: [
            "Language exchange with Mei in Taipei. 30 minutes each way.",
            "Exchange with Mei. She corrected my tones on every place name.",
            "",
            "Mei call. We talked about food for the whole hour.",
            "Exchange with Mei. First time I didn't switch to English.",
            "Mei taught me how to complain about the weather.",
            "",
            "Exchange with Mei. We argued about the best ramen in a mix of three languages.",
            "Mei call. She says I sound less like a textbook now.",
          ],
        },
        beats: [
          { daysAgo: 66, value: 40, note: "Characters are easy because of kanji. Tones are humbling." },
          { daysAgo: 30, value: 45, note: "Read a short news article without pinyin. Kanji carries a lot." },
          { daysAgo: 12, value: 50, note: "Watched a C-drama episode with Chinese subtitles. Understood about a third." },
          { daysAgo: 3, value: 40, note: "Mei says my second tone sounds like a question now. In a good way." },
        ],
        plan: {
          summary:
            "Kenji already reads kanji, so characters come fast and tones are the real work. Two thirds of every session goes to listening and speaking: shadowing, minimal pairs, and a Saturday language exchange with Mei in Taipei.",
          cadence: "Daily, 30–45 min. Exchange with Mei on Saturdays.",
        },
      },
      {
        handle: "sofiam",
        daysAgo: 61,
        weekdays: [0.3, 0.85, 0.85, 0.8, 0.85, 0.8, 0.3],
        amount: [15, 30],
        ritual: { weekday: 4, every: 2, amount: 50, hour: 19, notes: ["Lin, restaurant phrases.", "Lesson with Lin.", "Lin: small talk at a business dinner.", "", "Lin. Numbers, prices, dates."] },
        beats: [
          { daysAgo: 61, value: 30, note: "Booked Lin on Daniel's recommendation. First lesson: greetings and numbers." },
          { daysAgo: 25, value: 25, note: "Business dinner phrases: gānbēi, and how to turn down a third drink politely." },
          { daysAgo: 6, value: 35, note: "Did a 3-minute role play of a Shanghai taxi ride with Lin. Got us there." },
        ],
        plan: {
          summary:
            "Sofía has a work trip to Shanghai in March and wants to handle the dinners without a translator. Short sessions at lunch on weekdays, a podcast on the commute, and a lesson with Lin every other Thursday on restaurant and small-talk phrases.",
          cadence: "Weekdays at lunch, 20 min. Lin every other Thursday.",
        },
      },
      {
        handle: "hannahlevi",
        daysAgo: 55,
        pace: 0.72,
        amount: [10, 25],
        gaps: [[34, 20]],
        beats: [
          { daysAgo: 55, value: 15, note: "Starting slow. 15 minutes of HelloChinese before bed." },
          { daysAgo: 36, value: 10, note: "Packing boxes all week. Squeezed in flashcards." },
          { daysAgo: 19, value: 10, note: "Back. Unpacked the last box and did 10 minutes of HelloChinese on the floor." },
          { daysAgo: 4, value: 20, note: "Five days in a row again. Feels good." },
        ],
        plan: {
          summary:
            "Hannah is learning for herself, and to greet her students' grandparents at the spring open house. Fifteen minutes a day with HelloChinese and flashcards, plus one longer listening session on weekends.",
          cadence: "Daily, 15 min. One longer session on Sunday.",
        },
        replan: {
          daysAgo: 19,
          shiftWeeks: 3,
          reason: "Moved apartments in late September and lost two weeks. Pushed every camp back three weeks and kept sessions to 15 minutes until the habit is back.",
          summary:
            "Back after the move. Fifteen minutes a day with HelloChinese, no long sessions until the habit is solid again. Camps moved back three weeks so the next one is still reachable.",
        },
      },
      {
        handle: "chloedubois",
        daysAgo: 47,
        weekdays: [0.9, 0.6, 0.85, 0.6, 0.85, 0.9, 0.9],
        amount: [15, 35],
        beats: [
          { daysAgo: 47, value: 15, note: "Downloaded HelloChinese. Day one: the four tones." },
          { daysAgo: 21, value: 20, note: "HelloChinese streak at 25 days. Night shifts haven't broken it yet." },
          { daysAgo: 5, value: 30, note: "Wrote my first full sentence in characters: 我喜欢喝茶. I like drinking tea." },
        ],
        plan: {
          summary:
            "Chloé works two night shifts a week, so the plan uses short app sessions on work days and longer ones on days off. The first camp is clean pinyin and the four tones.",
          cadence: "Daily. 10 min on shift days, 30 min off.",
        },
      },
      {
        handle: "arjunm",
        daysAgo: 9,
        pace: 0.9,
        amount: [10, 20],
        noteRate: 0.15,
        beats: [
          { daysAgo: 9, value: 10, note: "Joined after reading Daniel's dumpling story. Day one: tones." },
          { daysAgo: 3, value: 15, note: "Recognized 你好 on a restaurant sign in San Gabriel. Small thrill." },
        ],
        plan: {
          summary: "Arjun is starting from zero. Ten minutes a day for the first month, then twenty. The first camp is the four tones, three weeks out.",
          cadence: "Daily, 10 min to start.",
        },
      },
      {
        handle: "rachelkim",
        daysAgo: 38,
        pace: 0.7,
        amount: [10, 30],
        gaps: [[24, 19]],
        beats: [
          { daysAgo: 38, value: 20, note: "I fly to Taipei every quarter for work. Time to stop pointing at menus." },
          { daysAgo: 18, value: 15, note: "Back from Taipei. Asked for the bill in Mandarin, mǎidān, and it worked." },
          { daysAgo: 4, value: 40, note: "Podcast on the flight home. Forty minutes and no movie." },
        ],
        plan: {
          summary:
            "Rachel flies to Taipei every quarter and wants to get through a client dinner without English by spring. Short sessions on travel days, longer ones at home, and trips are planned in, so a light week never counts as falling behind.",
          cadence: "15 min most days, longer at home. Travel weeks are light.",
        },
      },
      {
        handle: "lucasf",
        daysAgo: 14,
        pace: 0.75,
        amount: [10, 25],
        noteRate: 0.15,
        beats: [
          { daysAgo: 14, value: 15, note: "My daughter started Mandarin at school. I'm learning so I can keep up with her." },
          { daysAgo: 5, value: 20, note: "Bia corrected my tones at breakfast. She's eight." },
        ],
        plan: {
          summary: "Lucas is learning alongside his daughter Bia, who started Mandarin at school. Ten to twenty minutes in the evening, and the two of them quiz each other on Sundays.",
          cadence: "Evenings, 15 min. Quiz with Bia on Sundays.",
        },
      },
      {
        handle: "helennovak",
        daysAgo: 27,
        pace: 0.85,
        amount: [20, 35],
        after: { daysAgo: 16, weekdays: [1, 1, 1, 1, 1, 1, 1], amount: [25, 40] },
        noteRate: 0.3,
        ritual: {
          weekday: 6,
          amount: 45,
          hour: 10,
          notes: [
            "First lesson with Lin. Greetings, and how to say who I am.",
            "Lesson with Lin. We practised meeting Lí's parents for the first time.",
            "Lin lesson: family words. Son, daughter-in-law, in-laws.",
            "Lin lesson: food words, because Lí's dad cooks for everyone.",
          ],
        },
        beats: [
          { daysAgo: 27, value: 20, note: "Day one. My son marries Lí in Chengdu next October, and I want to talk with her parents myself." },
          { daysAgo: 26, value: 25, note: "Booked Lin after reading Daniel's notes here. First lesson on Saturday." },
          { daysAgo: 12, value: 30, note: "Video call with Lí's mother. I said hěn gāoxìng rènshi nín and she clapped." },
          { daysAgo: 6, value: 35, note: "Lin says my third tone sounds lovely now. Started Sichuan food words." },
          { daysAgo: 1, value: 40, note: "Wrote the first two lines of my wedding toast in Mandarin. Lin fixed one word." },
        ],
        plan: {
          summary:
            "Helen's son marries Lí in Chengdu next October, and Helen wants to talk with Lí's parents for twenty minutes in Mandarin, and give a short toast at the wedding. Twenty-five minutes every evening after dinner: tones and phrases first, then shadowing. A lesson with Lin every Saturday morning, and a video call with Lí's mother once a month to practise for real.",
          cadence: "Every evening, 25 min. Lesson with Lin on Saturdays.",
        },
        space:
          "Make my page a wedding scrapbook in red and gold: a countdown to the wedding in Chengdu on 9 October 2027, my minutes so far toward the 150 hours, my camps as stepping stones with the ones I've reached stamped, this week's quests as a little to-do card, and my newest notes as torn-paper snippets.",
      },
    ],
    openQuests: [
      q("Tone pairs: 10 minutes a day", "Second vs third tone. Record one pair each day and compare it with the app.", "daily", 10),
      q("Finish HelloChinese unit 8", "Food and drink. Do the speaking exercises out loud.", "weekly", 25),
      q("Describe your morning in 5 sentences", "Write them in pinyin, then say them to Lin without reading.", "weekly", 20),
      q("Shadow one podcast clip", "Pick 60 seconds. Repeat it five times until you sound like the speaker.", "weekly", 20),
      q("Learn 20 new characters", "Food and numbers first. Write each one three times.", "weekly", 25),
      q("Ask Lin three questions about her week", "Prepare them in advance. Listen to the answers without translating in your head.", "weekly", 20),
      q("Clear the Anki backlog", "Get to zero due cards before Sunday.", "one_off", 15),
      q("Watch one episode with Chinese subtitles", "Pause and note three words you hear more than once.", "weekly", 20),
      q("5-minute chat, no English", "With Lin or a language partner. Ask them to stop you if you switch.", "boss", 80),
      q("Drill zh, ch, sh and r", "Two minutes in front of a mirror, every day this week.", "daily", 10),
      q("Order something in Mandarin", "Bubble tea, dumplings, anything. Count it even if they answer in English.", "boss", 60),
    ],
    doneQuest: (_log, rng) =>
      rng.pick([
        q("Tone pairs: second vs third", "Ten minutes. Record one pair and compare.", "weekly", 20),
        q("Finish HelloChinese unit 4", "Greetings and introductions.", "weekly", 25),
        q("Introduce yourself without notes", "Name, city, job and one hobby. To Lin or a mirror.", "weekly", 20),
        q("Learn the numbers 1 to 100", "Then read five prices out loud.", "weekly", 20),
        q("Shadow a podcast clip five times", "60 seconds, same clip, until it sounds right.", "weekly", 20),
        q("Order bubble tea in Mandarin", "Less ice, half sugar. Count it even if they reply in English.", "boss", 60),
        q("Write 我, 你, 他 and 好 ten times each", "Stroke order matters. Go slow.", "one_off", 15),
        q("Learn 15 food words", "Enough to read the top of a menu.", "weekly", 20),
        q("Review every flashcard due this week", "Little and often beats one big session.", "weekly", 15),
        q("Ask for directions in a role play", "Left, right, straight ahead, how far.", "weekly", 20),
        q("Describe your apartment in 6 sentences", "Rooms, furniture, what you see from the window.", "weekly", 20),
        q("Listen to one slow podcast episode", "No pausing. Note what you understood after.", "weekly", 15),
      ]),
    space:
      "Make it feel like a Chinese study notebook: warm paper, thin red margin lines, rose accents. Lead with the group's combined practice hours as one big number, with no progress bar under it: 150 hours is each learner's own goal, not the group's. Then a calendar strip of the last 6 weeks showing how many people practiced each day. Show the newest notes as handwritten-style margin notes (they mention tones, lessons with Lin and HelloChinese). End with each member's progress toward the target as small bamboo-stalk bars.",
  },

  // ----- Smart home -----
  {
    key: "smarthome",
    slug: "smart-home-from-scratch",
    title: "Build a smart home from scratch",
    tagline: "Twelve small projects that make home a little smarter, all running locally.",
    description:
      "Turn an ordinary home into a smart one, one project at a time. Avoid cloud lock-in where you can: Home Assistant, cheap sensors and things you can fix yourself.\n\n" +
      "A project counts when it's running and someone in the house actually uses it.",
    emoji: "smarthome",
    theme: "sky",
    category: "making",
    metric: { name: "projects shipped", unit: "projects", target: 12, aggregation: "count" },
    camps: [
      { title: "The hub is up", detail: "Home Assistant running and reachable from your phone.", target: 1, week: 2, emoji: "smarthome" },
      { title: "First sensor reporting", detail: "One sensor you built or flashed yourself, sending real data.", target: 3, week: 8, emoji: "target" },
      { title: "Lights that follow the sun", detail: "Lighting that changes with sunset and bedtime, no taps needed.", target: 5, week: 16, emoji: "sparkles" },
      { title: "An automation the family loves", detail: "Something everyone at home uses every day without thinking.", target: 8, week: 28, emoji: "highfive" },
      { title: "A local voice assistant", detail: "Wake word to action, running on your own hardware.", target: 10, week: 40, emoji: "microphone" },
      { title: "12 projects shipped", detail: "A home that quietly runs itself.", target: 12, week: 52, emoji: "summit" },
    ],
    members: [
      {
        handle: "tomasherrera",
        daysAgo: 58,
        items: [
          { label: "Home Assistant on a Raspberry Pi 5", note: "Flashed HAOS and moved it to an SSD. Found 23 devices on the network I forgot about." },
          { label: "Zigbee bulbs in the living room", note: "Sonoff dongle and four IKEA bulbs. Paired on the second try." },
          { label: "Porch light at sunset", note: "First real automation. It came on at 6:41 and my partner noticed." },
          { label: "ESP32 garage door sensor", note: "Reed switch on the door. My phone pings if it's open after 10pm." },
          { label: "Energy dashboard", note: "Clamp meter on the panel. The dryer is the villain." },
          { label: "Leak sensor under the water heater", note: "" },
          { label: "Morning routine: blinds and coffee", note: "Blinds open at 7:00, coffee plug on at 6:55. Weekdays only." },
        ],
        plan: {
          summary:
            "Tomás wants a house that runs without a single cloud account. Home Assistant on a Pi is the hub, and every project after that is one evening of work. He's handy with a soldering iron, so the plan moves fast early and saves the local voice assistant for spring.",
          cadence: "One project every 2–3 weeks. Build night on Wednesdays.",
        },
      },
      {
        handle: "ingrid",
        daysAgo: 54,
        items: [
          { label: "Home Assistant on an old laptop", note: "Lives on a shelf in the hallway. Loud fan, works fine." },
          { label: "ESP32 soil sensor for the basil", note: "Capacitive sensor and ESPHome. The basil gets thirsty every three days. Now I know." },
          { label: "Bedroom lights that dim at 21:30", note: "Zigbee bulbs go warm and low at bedtime. The kids complain less." },
        ],
        plan: {
          summary:
            "Ingrid wants the house to help with the dark Oslo winter: lights that follow the sun, plants that ask for water, and nothing that needs an app to open the door. Each project is sized for two or three Thursday evenings.",
          cadence: "Thursday evenings, about one project a month.",
        },
      },
      {
        handle: "weizhang",
        daysAgo: 49,
        items: [
          { label: "Home Assistant on a mini PC", note: "Intel N100 box. Idles at 6 W." },
          { label: "Aircon presets by room", note: "IR blaster for the old aircon units. 26°C at night, off when nobody's home." },
          { label: "Dehumidifier on a schedule", note: "Smart plug and a humidity sensor. Runs whenever it's above 70%." },
          { label: "Front door sensor", note: "" },
          { label: "Local voice assistant, first try", note: "Whisper and Piper on the mini PC. It understands me if I talk like a newsreader." },
        ],
        plan: {
          summary:
            "Wei's flat is small, humid and full of old appliances. The plan starts with climate (the aircon and the dehumidifier), then builds toward a voice assistant that runs on his own hardware, no cloud.",
          cadence: "Two evenings a week.",
        },
      },
      {
        handle: "femi",
        daysAgo: 41,
        items: [
          { label: "Raspberry Pi with Home Assistant", note: "Took the whole Saturday. Worth it." },
          { label: "Zigbee radiator thermostats", note: "Four radiator valves. The flat heats room by room now." },
          { label: "Window open, heating off", note: "Window sensors tell the radiators to stop. Very German of me." },
        ],
        plan: {
          summary:
            "Femi rents, so nothing gets drilled into walls. Heating first (radiators that think for themselves), then lights and sensors that stick on and peel off when he moves out.",
          cadence: "Weekends, one project every three weeks.",
        },
      },
      {
        handle: "rachelkim",
        daysAgo: 50,
        gaps: [[38, 15]],
        items: [
          { label: "Smart plugs for the lamps", note: "Started small. Three plugs, one schedule.", daysAgo: 45 },
          { label: "Motion lights in the hallway", note: "Back after a month of work trips. Hallway lights for the 2am water run.", daysAgo: 13 },
          { label: "Away mode while I travel", note: "Lamps turn on at random in the evening when I'm gone.", daysAgo: 3 },
        ],
        plan: {
          summary:
            "Rachel travels for work two weeks a month. Projects are small one-evening builds she can do between trips, and the house should look lived-in while she's away.",
          cadence: "One build in each week at home.",
        },
        replan: {
          daysAgo: 14,
          shiftWeeks: 4,
          reason: "Work travel ate most of October. Spaced the camps out and made the next three projects one-evening builds.",
        },
      },
      {
        handle: "noahb",
        daysAgo: 6,
        items: [{ label: "Home Assistant Green out of the box", note: "Plugged it in and it found the TV and the thermostat on its own. Day one done.", daysAgo: 5 }],
        plan: {
          summary: "Noah just bought a Home Assistant Green and wants to learn by doing. The first camp is the hub plus one automation the family actually notices.",
          cadence: "Sunday afternoons.",
        },
      },
    ],
    openQuests: [
      q("Pick the next project and order the parts", "Order everything at once so build night isn't blocked by shipping.", "one_off", 15),
      q("Flash ESPHome on a spare ESP32", "Get it on Wi-Fi and showing up in Home Assistant.", "weekly", 20),
      q("Back up the Home Assistant config", "Full backup to a USB stick or the NAS. Then test a restore.", "one_off", 20),
      q("Write down every automation you have", "One line each: trigger and action. Delete the ones nobody uses.", "weekly", 20),
      q("Pair two more Zigbee devices", "Put a router device in the middle of the house first.", "weekly", 25),
      q("Build a dashboard for the kitchen tablet", "Weather, lights and the bin day. Nothing else.", "weekly", 30),
      q("Get the voice assistant to switch one light", "Wake word, speech to text, one action. All local.", "boss", 80),
      q("Add a low-battery alert", "A notification when any sensor drops below 20%.", "weekly", 20),
      q("Show someone at home how it works", "If they don't use it, it isn't shipped yet.", "one_off", 15),
      q("Name every device properly", "Room and purpose, so automations read like sentences.", "one_off", 15),
    ],
    doneQuest: (log) =>
      /voice/i.test(log.label ?? "")
        ? q(`Ship: ${log.label}`, "Wake word to action, all running locally.", "boss", 80)
        : q(`Ship: ${log.label}`, "Running, and used by someone in the house.", "weekly", 30),
    space:
      "A blueprint feel: sky-blue grid paper with white line drawings. Lead with the number of projects shipped by everyone together, then a floor-plan grid where each shipped project lights up a small room tile with its name and who built it. Add a short list of the newest builds with their notes.",
  },

  // ----- Books -----
  {
    key: "books",
    slug: "read-25-books",
    title: "Read 25 books",
    tagline: "Twenty-five books this year. Any genre, any length. Finished means finished.",
    description:
      "One book every two weeks, give or take. Novels, history, poetry, the cookbook you read cover to cover: if you finished it, it counts. Audiobooks count too.\n\n" +
      "Log each book when you finish it, with a line about what stayed with you.",
    emoji: "books",
    theme: "sand",
    category: "reading",
    metric: { name: "books read", unit: "books", target: 25, aggregation: "count" },
    camps: [
      { title: "First book done", detail: "Finish the first one. Any length.", target: 1, week: 3, emoji: "books" },
      { title: "Five on the shelf", detail: "Five finished books. The habit is real now.", target: 5, week: 10, emoji: "camp" },
      { title: "Ten books", detail: "Include one classic you've been avoiding.", target: 10, week: 20, emoji: "flag" },
      { title: "Halfway: 13 books", detail: "Over the hump.", target: 13, week: 26, emoji: "compass" },
      { title: "Twenty books", detail: "The home stretch.", target: 20, week: 42, emoji: "trophy" },
      { title: "25 books", detail: "Twenty-five books in a year.", target: 25, week: 52, emoji: "summit" },
    ],
    members: [
      {
        handle: "amara",
        daysAgo: 84,
        items: [
          { label: "Tomorrow, and Tomorrow, and Tomorrow", note: "Cried on the train at the hospital chapter. Good start to the year." },
          { label: "Demon Copperhead", note: "Long, but I didn't want it to end." },
          { label: "The Overstory", note: "I look at trees differently now. Not joking." },
          { label: "Piranesi", note: "Two sittings. The House is beautiful and lonely." },
          { label: "Educated", note: "Hard to read in places. Glad I did." },
          { label: "Project Hail Mary", note: "Rocky is the best character I've met this year." },
          { label: "The Remains of the Day", note: "Quiet and devastating. Stevens, why." },
          { label: "Braiding Sweetgrass", note: "" },
          { label: "Klara and the Sun", note: "Second Ishiguro this month. He's ruining me." },
        ],
        plan: {
          summary:
            "Amara wants to read more widely than last year: new fiction, a few classics she's avoided, and some nonfiction about nature. A book every ten to twelve days, with a long one saved for the holidays.",
          cadence: "Nightly, 30–45 pages.",
        },
      },
      {
        handle: "lucasf",
        daysAgo: 80,
        items: [
          { label: "The Seven Husbands of Evelyn Hugo", note: "Fast and fun. Exactly what I needed to start." },
          { label: "Blindness", note: "Read it in Portuguese. Saramago's long sentences are a workout." },
          { label: "Sapiens", note: "" },
          { label: "The Martian", note: "Laughed out loud at the potatoes." },
          { label: "Atomic Habits", note: "Useful for this challenge, honestly." },
          { label: "The Shadow of the Wind", note: "Barcelona in the rain. Perfect October book." },
        ],
        plan: {
          summary: "Lucas reads in Portuguese and English and wants both on the list. Short books in the busy months, longer ones on holidays.",
          cadence: "Before bed, about 20 pages.",
        },
      },
      {
        handle: "yukitanaka",
        daysAgo: 74,
        items: [
          { label: "Convenience Store Woman", note: "Short and strange. Keiko is my hero." },
          { label: "The Thursday Murder Club", note: "Pure comfort." },
          { label: "Pachinko", note: "Four generations. Sunja will stay with me." },
          { label: "Kafka on the Shore", note: "" },
          { label: "Before the Coffee Gets Cold", note: "Read it in Japanese years ago. The English one is just as lovely." },
        ],
        plan: {
          summary: "Yuki reads on the train to work in Osaka. One Japanese novel and one English novel at a time, alternating.",
          cadence: "Weekday commutes.",
        },
      },
      {
        handle: "graceoc",
        daysAgo: 78,
        gaps: [[50, 28]],
        items: [
          { label: "Normal People", note: "Dublin on every page.", daysAgo: 66 },
          { label: "Small Things Like These", note: "Back to reading after a rough month. A short book was the right size.", daysAgo: 25 },
          { label: "The Secret History", note: "Couldn't put it down. Up until 2am on a work night.", daysAgo: 6 },
        ],
        plan: {
          summary: "Grace reads in bursts. The plan mixes short books with one big one each season, so there's always something she can finish.",
          cadence: "Evenings, 3–4 nights a week.",
        },
        replan: {
          daysAgo: 27,
          shiftWeeks: 3,
          reason: "Lost most of September to a family emergency. Moved the next camp back three weeks and picked shorter books on purpose.",
        },
      },
      {
        handle: "raviiyer",
        daysAgo: 70,
        items: [
          { label: "The God of Small Things", note: "Every sentence is doing something." },
          { label: "Thinking, Fast and Slow", note: "Took notes the whole way. Finally finished." },
          { label: "The Ministry for the Future", note: "The first chapter is brutal. The rest gave me hope." },
          { label: "A Fine Balance", note: "Long and heavy, but it's Bombay and I couldn't stop." },
          { label: "Deep Work", note: "Turned off notifications after chapter two." },
        ],
        plan: {
          summary: "Ravi wants to swap phone time for books: thirty minutes after dinner with the phone in another room, alternating fiction and nonfiction.",
          cadence: "Nightly, 30 min.",
        },
      },
      {
        handle: "emmal",
        daysAgo: 62,
        items: [
          { label: "A Man Called Ove", note: "Had to start with a Swede. Laughed and cried." },
          { label: "Lessons in Chemistry", note: "Elizabeth Zott for president." },
          { label: "Circe", note: "Gorgeous. Read the last chapter twice." },
          { label: "The Midnight Library", note: "" },
        ],
        plan: {
          summary: "Emma wants cozy, unhurried reading. Two books a month from a list she builds at the start of each month, with Sunday afternoons as the big reading block.",
          cadence: "Sundays, plus a few evenings.",
        },
      },
      {
        handle: "hannahlevi",
        daysAgo: 52,
        items: [
          { label: "Crying in H Mart", note: "Made me call my mom." },
          { label: "The Book Thief", note: "Reread it for my students. Still gets me." },
          { label: "Remarkably Bright Creatures", note: "An octopus narrator. Delightful." },
        ],
        plan: {
          summary: "Hannah teaches eighth grade and wants to read for herself again, not just for class. One book every two weeks, and audiobooks on the drive count.",
          cadence: "Audiobook on the commute, paper on weekends.",
        },
      },
      {
        handle: "danielokafor",
        daysAgo: 66,
        items: [
          { label: "Fluent Forever", note: "The pronunciation chapter changed how I practice Mandarin." },
          { label: "The Three-Body Problem", note: "Chinese sci-fi felt on theme this year." },
          { label: "Born a Crime", note: "Audiobook. Hearing the author read it is the way." },
          { label: "Station Eleven", note: "" },
        ],
        plan: {
          summary: "Daniel reads alongside his Mandarin study, so some books are about language and China. Audiobooks on walks, paper before bed.",
          cadence: "Before bed, plus audiobooks.",
        },
      },
      {
        handle: "samwhit",
        daysAgo: 8,
        items: [{ label: "The Hobbit", note: "Read it aloud to my daughter at bedtime. She did the Gollum voice. Counts!", daysAgo: 2 }],
        plan: {
          summary: "Sam has a toddler and a long commute. Audiobooks and bedtime read-alouds count, so the plan leans on both.",
          cadence: "Commute and bedtime.",
        },
      },
    ],
    openQuests: [
      q("Read 20 pages before bed", "Phone charging in another room.", "daily", 10),
      q("Pick your next three books", "Put one short one in the mix so the shelf keeps moving.", "one_off", 15),
      q("Finish the book you're on by Sunday", "About 35 pages a day gets you there.", "weekly", 25),
      q("Try an audiobook on the commute", "Borrow one free from the library app.", "weekly", 20),
      q("Write three lines about your last book", "What happened, what stayed with you, who should read it.", "weekly", 20),
      q("Start one book over 500 pages", "40 pages a day and it's done in two weeks.", "boss", 80),
      q("Visit the library and borrow two books", "One you'd pick, one the librarian picks.", "one_off", 15),
      q("Ask someone here for a recommendation", "Look at what the others finished this month.", "one_off", 15),
      q("Read one book in your other language", "Short is fine. Novellas count.", "boss", 60),
    ],
    doneQuest: (log) => q(`Finish ${log.label}`, "About 35 pages a day gets you there by Sunday.", "weekly", 25),
    space:
      "A cozy bookshelf. Draw each finished book as a spine on wooden shelves, colored by reader, with the title on the spine; tapping a spine shows who read it and their note. Above the shelves: the total books read together and who finished one most recently. Below: the newest notes as little index cards.",
  },

  // ----- Running -----
  {
    key: "run",
    slug: "run-365-miles",
    title: "Run 365 miles",
    tagline: "A mile a day on average. Run it however your weeks allow.",
    description:
      "365 miles in a year. That's a mile a day on average, but nobody runs every day: most of us do three or four runs a week and a longer one on the weekend.\n\n" +
      "Log each run in miles. Treadmill counts. Walk breaks count.",
    emoji: "running",
    theme: "mint",
    category: "fitness",
    metric: { name: "miles run", unit: "mi", target: 365, aggregation: "sum" },
    step: 0.01,
    camps: [
      { title: "First 25 miles", detail: "A month of regular running.", target: 25, week: 4, emoji: "running" },
      { title: "100-mile club", detail: "Triple digits.", target: 100, week: 14, emoji: "flag" },
      { title: "Halfway: 183 miles", detail: "Half the year's distance.", target: 183, week: 26, emoji: "camp" },
      { title: "250 miles", detail: "Most of the mountain behind you.", target: 250, week: 36, emoji: "target" },
      { title: "300 miles", detail: "The last long climb.", target: 300, week: 44, emoji: "trophy" },
      { title: "365 miles", detail: "A mile for every day of the year.", target: 365, week: 52, emoji: "summit" },
    ],
    noteFor: runNote,
    members: [
      {
        handle: "jordanruns",
        daysAgo: 80,
        weekdays: [0, 0.08, 0.6, 0.08, 0.6, 0.08, 0.3],
        amount: [2.2, 3.4],
        long: { weekday: 0, chance: 0.75, amount: [3.8, 6] },
        paceSec: 575,
        places: ["Charles River loop", "Esplanade out and back", "Comm Ave hills", "Harvard Bridge and back", "Jamaica Pond loops"],
        beats: [{ daysAgo: 80, value: 3.2, note: "Day one. Charles River loop, 3.2 easy. Let's go." }],
        plan: {
          summary:
            "Jordan wants a steady year with no injuries. Three short runs a week and a longer one on Sundays, adding no more than 10% a week, with a cutback week every fourth week.",
          cadence: "Tue, Thu, Sat short. Long run Sunday.",
        },
      },
      {
        handle: "mayac",
        daysAgo: 78,
        weekdays: [0, 0.25, 0.8, 0.4, 0.8, 0.15, 0],
        amount: [3, 5.5],
        long: { weekday: 6, chance: 0.85, amount: [6.5, 10] },
        paceSec: 530,
        places: ["Griffith Park trails", "Santa Monica beach path", "Silver Lake Reservoir loop", "Rose Bowl loop", "Ballona Creek path"],
        beats: [
          { daysAgo: 78, value: 4.2, note: "Day one. Signed up for a half in December, so this is my training log too." },
          { daysAgo: 31, value: 10.02, long: true, note: "10 miles. Longest run ever. Ate a whole pizza after." },
          { daysAgo: 10, value: 11.5, long: true, note: "11.5 at Griffith Park. Hills on tired legs. Race is getting close." },
        ],
        plan: {
          summary:
            "Maya is training for a half marathon in December, so the first months run well ahead of the 365 pace on purpose. Four or five runs a week with a long run on Saturdays, then an easy month after the race.",
          cadence: "4–5 runs a week. Long run Saturday.",
        },
      },
      {
        handle: "lenafischer",
        daysAgo: 72,
        weekdays: [0, 0.45, 0.05, 0.5, 0.05, 0.35, 0.05],
        amount: [3, 4.3],
        long: { weekday: 0, chance: 0.7, amount: [5, 7.5] },
        paceSec: 545,
        km: true,
        places: ["along the Isar", "Englischer Garten loop", "Olympiapark hills", "Nymphenburg canal"],
        beats: [{ daysAgo: 72, value: 4.97, note: "I think in kilometres, so I'll convert for the group. Today: 8 km, which is 4.97 miles." }],
        plan: {
          summary:
            "Lena thinks in kilometres and logs in miles for the group. Three runs a week along the Isar, a longer one on Sundays, and a strength session on Tuesdays.",
          cadence: "Mon, Wed, Fri, plus a Sunday long run.",
        },
      },
      {
        handle: "priyar",
        daysAgo: 76,
        weekdays: [0.05, 0.5, 0.05, 0.5, 0.05, 0.05, 0.7],
        amount: [2.5, 4],
        gaps: [[45, 30]],
        after: { daysAgo: 29, weekdays: [0.05, 0.6, 0.05, 0.6, 0.05, 0.05, 0.6], amount: [1.2, 2.5] },
        paceSec: 640,
        places: ["High Park", "Martin Goodman Trail", "Don Valley trail", "Humber Bay"],
        beats: [
          { daysAgo: 46, value: 1.8, note: "Shins hurt again halfway. Walked home. Physio on Monday." },
          { daysAgo: 29, value: 1.6, note: "Back after shin splints. Walk-run, 1 minute on and 1 off. No pain." },
          { daysAgo: 9, value: 2.2, note: "First full mile without a walk break since September." },
        ],
        plan: {
          summary: "Priya loves running and tends to overdo it. The plan caps weekly miles and adds strength work for her shins twice a week.",
          cadence: "Three runs a week, never two days in a row.",
        },
        replan: {
          daysAgo: 29,
          shiftWeeks: 3,
          reason: "Shin splints in September. Two weeks off, then walk-run. Camps moved back three weeks and weekly miles capped at 8 until December.",
          summary:
            "Coming back from shin splints. Walk-run three times a week, never two days in a row, and no more than 8 miles a week until December. Strength work for the shins stays.",
          cadence: "Walk-run Mon, Wed, Sat.",
        },
      },
      {
        handle: "aidenm",
        daysAgo: 65,
        weekdays: [0.05, 0.35, 0.05, 0.35, 0.05, 0.3, 0.4],
        amount: [2.5, 4],
        paceSec: 600,
        places: ["Lakefront Trail", "606 trail", "Montrose Harbor", "Humboldt Park loop"],
        plan: {
          summary: "Aiden wants to get back to the fitness he had in college. Short runs after work four days a week, building slowly.",
          cadence: "Four short runs a week, after work.",
        },
      },
      {
        handle: "tomasherrera",
        daysAgo: 60,
        weekdays: [0.3, 0.05, 0.4, 0.05, 0.4, 0.05, 0.6],
        amount: [2.5, 4.5],
        paceSec: 590,
        places: ["Lady Bird Lake loop", "Shoal Creek trail", "Zilker Park", "the Pfluger bridge"],
        beats: [{ daysAgo: 33, value: 3.1, note: "Ran to the hardware store for Zigbee bulbs. Two challenges, one trip." }],
        plan: {
          summary: "Tomás runs to clear his head between build nights. Three runs a week around Lady Bird Lake, nothing fancy.",
          cadence: "Three runs a week.",
        },
      },
      {
        handle: "jiwoo",
        daysAgo: 40,
        weekdays: [0.2, 0.05, 0.6, 0.05, 0.6, 0.05, 0.7],
        amount: [2.5, 4],
        paceSec: 560,
        places: ["Han River at sunrise", "Yeouido park loop", "Namsan hill", "Banpo bridge and back"],
        plan: {
          summary: "Ji-woo runs before work along the Han River. Three runs a week, and the Saturday run gets a little longer each month.",
          cadence: "Tue, Thu, Sat at 6am.",
        },
      },
      {
        handle: "kwame",
        daysAgo: 10,
        weekdays: [0.05, 0.6, 0.05, 0.6, 0.05, 0.05, 0.7],
        amount: [1.8, 3],
        paceSec: 680,
        places: ["Regent's Park loop", "Primrose Hill", "the canal towpath", "Hampstead Heath"],
        beats: [{ daysAgo: 10, value: 2.1, note: "Couch to 5K graduate. Joining for the miles. 2.1 easy." }],
        plan: {
          summary: "Kwame just finished Couch to 5K. Three easy runs a week until 3 miles feels normal, then one gets longer.",
          cadence: "Mon, Wed, Sat.",
        },
      },
    ],
    openQuests: [
      q("Long run this weekend", "One mile longer than last week's longest. Slow enough to talk.", "weekly", 30),
      q("Three runs this week", "Any distance. Spread them out.", "weekly", 25),
      q("Strides after an easy run", "4 × 20 seconds quick, full recovery between.", "weekly", 15),
      q("Hill repeats", "6 × 1 minute uphill, jog back down.", "weekly", 25),
      q("Foam roll calves and shins", "Five minutes after every run.", "daily", 10),
      q("Try a new route", "Somewhere you've never run before.", "one_off", 15),
      q("Lay out your gear the night before", "Shoes by the door. Remove one excuse.", "daily", 10),
      q("Run with someone", "A friend, a club or the dog.", "one_off", 20),
      q("Tempo run: 2 miles comfortably hard", "Warm up first. You should be able to say a few words, not sentences.", "weekly", 25),
      q("Cutback week: keep every run under 4 miles", "Recovery is training too.", "weekly", 20),
    ],
    doneQuest: (log, rng) => {
      const v = log.value ?? 0;
      if (v >= 9) return q(`Long run: ${Math.floor(v)} miles`, "Fuel at the halfway point. Walk the water stops if you like.", "boss", 60);
      if (v >= 5) return q("Long run this weekend", "A little longer than last week. Slow enough to talk.", "weekly", 30);
      return rng.pick([
        q("Easy run before work", "Out the door before checking your phone.", "weekly", 20),
        q("Hill repeats", "6 × 1 minute uphill, jog back down.", "weekly", 25),
        q("Run with someone", "A friend, a club or the dog.", "one_off", 20),
        q("Try a new route", "Somewhere you've never run before.", "one_off", 15),
        q("Strides after an easy run", "4 × 20 seconds quick, full recovery between.", "weekly", 15),
        q("Tempo run: 2 miles comfortably hard", "Warm up first.", "weekly", 25),
      ]);
    },
    space:
      "A trail map. Show the group's combined miles as a dotted path winding up a mountain, with each member as a small marker at their own mileage out of 365. Add a bar chart of total weekly miles for the last 8 weeks, and the newest runs as a Strava-style list with distance and the note.",
  },

  // ----- Essays -----
  {
    key: "essays",
    slug: "write-52-essays",
    title: "Write 52 essays",
    tagline: "One essay a week for a year. Short is fine. Published is the point.",
    description:
      "Write and publish one essay a week. Five hundred words is enough. A blog, a newsletter or a public doc all count, as long as someone else can read it.\n\n" +
      "Log each essay when it's out, with its title.",
    emoji: "writing",
    theme: "lilac",
    category: "writing",
    metric: { name: "essays published", unit: "essays", target: 52, aggregation: "count" },
    camps: [
      { title: "First essay out", detail: "Publish one. It doesn't have to be good.", target: 1, week: 1, emoji: "pencil" },
      { title: "Ten essays", detail: "Ten weeks of showing up.", target: 10, week: 10, emoji: "writing" },
      { title: "A quarter: 13 essays", detail: "A full season of writing.", target: 13, week: 13, emoji: "camp" },
      { title: "Halfway: 26 essays", detail: "Half a year of Sundays.", target: 26, week: 26, emoji: "flag" },
      { title: "40 essays", detail: "The finish is in sight.", target: 40, week: 40, emoji: "trophy" },
      { title: "52 essays", detail: "A year of writing in public.", target: 52, week: 52, emoji: "summit" },
    ],
    members: [
      {
        handle: "elenap",
        daysAgo: 50,
        items: [
          { label: "Why I'm writing 52 essays", note: "First one. Short, honest, slightly terrified." },
          { label: "The bodega cat economy", note: "My most-read thing ever. 40 people. Ha." },
          { label: "In defense of the paper calendar", note: "" },
          { label: "What my grandmother knew about soup", note: "Cried writing the ending. Kept it anyway." },
          { label: "Notes from the G train", note: "Wrote it on the G train, fittingly." },
          { label: "Ten years in the same apartment", note: "" },
          { label: "The joy of mediocre hobbies", note: "Quill said the first draft hid its point in paragraph six. It was right." },
        ],
        plan: {
          summary:
            "Elena wants a public body of work by next fall. One essay a week, drafted Saturday morning and published Sunday night. Quill reads every draft and points out the weakest paragraph.",
          cadence: "Draft Saturday, publish Sunday.",
        },
      },
      {
        handle: "raviiyer",
        daysAgo: 47,
        items: [
          { label: "Commute essays: a beginning", note: "Wrote it on the bus. 600 words." },
          { label: "What Bengaluru traffic teaches about patience", note: "" },
          { label: "The case for boring software", note: "Shared it at work. Three people disagreed, which is good." },
          { label: "On reading slowly", note: "" },
          { label: "My father's ledger", note: "The hardest one so far. Four drafts." },
          { label: "Why I stopped using the snooze button", note: "" },
          { label: "Filter coffee, a love letter", note: "Short and sweet. 450 words." },
          { label: "Learning in public is uncomfortable", note: "" },
          { label: "The meeting that should have been a walk", note: "A colleague forwarded it to our manager. Oops." },
          { label: "What two months of logging taught me", note: "Ten essays in. Ahead of schedule for the first time in my life." },
        ],
        plan: {
          summary: "Ravi writes on the bus to work. Short essays, often 500 words, published on his blog whenever one is ready. Some weeks that's two.",
          cadence: "Weekday commutes.",
        },
      },
      {
        handle: "claireb",
        daysAgo: 46,
        items: [
          { label: "Edinburgh in the haar", note: "The fog rolled in while I was writing about the fog." },
          { label: "The ethics of the office biscuit tin", note: "" },
          { label: "Ten years of running a book club", note: "Sent it to the book club. They want edits." },
          { label: "Failing my driving test three times", note: "" },
          { label: "A short history of my bicycle", note: "Shortest one yet. 500 words exactly." },
          { label: "Letters I never sent", note: "" },
        ],
        plan: {
          summary: "Claire publishes a newsletter for friends. One essay every Friday, with a hard deadline of 9pm.",
          cadence: "Write Thursday, send Friday.",
        },
      },
      {
        handle: "marcob",
        daysAgo: 48,
        gaps: [[35, 16]],
        items: [
          { label: "Espresso, standing up", note: "First essay. Wrote it in Italian, then translated it.", daysAgo: 44 },
          { label: "Starting again after three weeks off", note: "Missed three weeks for a work deadline. Writing about the gap was the only way back in.", daysAgo: 14 },
          { label: "The tram I take every day", note: "Line 1 in Milan. Old wooden trams and very patient drivers.", daysAgo: 5 },
        ],
        plan: {
          summary: "Marco writes in Italian first and translates. One essay a week; shorter ones are fine.",
          cadence: "Sunday evenings.",
        },
        replan: {
          daysAgo: 15,
          shiftWeeks: 3,
          reason: "Missed three weeks during a big work deadline. One essay every eight days until it stops feeling heavy, then back to weekly.",
          cadence: "One essay every eight days for now.",
        },
      },
      {
        handle: "nadiah",
        daysAgo: 40,
        items: [
          { label: "Paris without a bakery is just a city", note: "" },
          { label: "Teaching my mother to text", note: "She replied to the essay with three emojis. Success." },
          { label: "Notes on quitting a job I liked", note: "Took two weeks. Glad it's out." },
          { label: "The 7:42 to La Défense", note: "" },
          { label: "Why I keep a commonplace book", note: "Shortest one, and my favorite." },
        ],
        plan: {
          summary: "Nadia writes on the train to work and edits on weekends. One essay a week, and one longer piece each month.",
          cadence: "Train mornings, edit Saturday.",
        },
      },
      {
        handle: "samwhit",
        daysAgo: 5,
        items: [{ label: "My daughter's questions are better than my prompts", note: "First essay in ten years. 700 words, written after bedtime.", daysAgo: 2 }],
        plan: {
          summary: "Sam wants to write again after ten years. Short essays after bedtime, one a week, no word minimum.",
          cadence: "Two evenings a week.",
        },
      },
    ],
    openQuests: [
      q("Pick next week's topic by Wednesday", "Choose from your ideas list. Don't start from a blank page.", "one_off", 15),
      q("Write a messy first draft in 30 minutes", "Timer on. No editing while drafting.", "weekly", 20),
      q("Cut 20% from the draft", "Start with the first paragraph. It's usually throat-clearing.", "weekly", 20),
      q("Read one essay you admire", "Note one thing it does that you could steal.", "weekly", 15),
      q("Publish before Sunday night", "Done beats perfect.", "weekly", 30),
      q("Add five topics to your ideas list", "Things you've argued about this week count.", "one_off", 15),
      q("Ask one person for feedback before publishing", "One question: where did you get bored?", "weekly", 20),
      q("Write the opening line three ways", "Keep the one that makes you want to read the next line.", "weekly", 15),
      q("Write a 1,500-word essay", "The topic you keep circling. Give it two sittings.", "boss", 80),
    ],
    doneQuest: (log) => q(`Publish "${log.label}"`, "Out before Sunday night. Done beats perfect.", "weekly", 30),
    space:
      "A quiet literary magazine. Lead with a table of contents of the newest essays (title, author's first name, date). Show each writer's progress to 52 as a row of 52 small squares that fill in. Calm serif headings, lilac accents and plenty of white space.",
  },

  // ----- States -----
  {
    key: "states",
    slug: "visit-all-50-states",
    title: "Visit all 50 states",
    tagline: "Every state, at least one real stop. Gas stations don't count.",
    description:
      "See all 50 US states. A state counts when you stop and do something there: a meal, a walk, a conversation. Driving straight through doesn't count.\n\n" +
      "Log each state by name. Your home state counts too.",
    emoji: "travel",
    theme: "peach",
    category: "travel",
    metric: { name: "states visited", unit: "states", target: 50, aggregation: "distinct" },
    camps: [
      { title: "Home state and two neighbors", detail: "Start close to home.", target: 3, week: 4, emoji: "pin" },
      { title: "10 states", detail: "Double digits.", target: 10, week: 14, emoji: "map" },
      { title: "20 states", detail: "A real chunk of the map.", target: 20, week: 24, emoji: "compass" },
      { title: "30 states", detail: "Time for the far corners.", target: 30, week: 34, emoji: "travel" },
      { title: "40 states", detail: "Alaska and Hawaii on the calendar.", target: 40, week: 44, emoji: "flag" },
      { title: "All 50", detail: "Every state, one real stop each.", target: 50, week: 52, emoji: "summit" },
    ],
    members: [
      {
        handle: "carmenontheroad",
        daysAgo: 44,
        items: [
          { label: "Arizona", note: "Home base. Starting where the van is parked.", daysAgo: 44 },
          { label: "New Mexico", note: "Green chile breakfast burrito in Santa Fe. Worth the drive on its own.", daysAgo: 41 },
          { label: "Colorado", note: "Slept at 9,000 feet. Did not sleep well.", daysAgo: 38 },
          { label: "Utah", note: "Arches at sunrise. Too many people, still unreal.", daysAgo: 34 },
          { label: "Nevada", note: "Great Basin. Darkest sky I've ever seen.", daysAgo: 30 },
          { label: "California", note: "Two nights at my sister's in Sacramento. A real bed!", daysAgo: 27 },
          { label: "Oregon", note: "Crater Lake under fresh snow.", daysAgo: 23 },
          { label: "Washington", note: "Ferry to Bainbridge with a stranger's dog on my lap.", daysAgo: 20 },
          { label: "Idaho", note: "Hot springs in the rain.", daysAgo: 16 },
          { label: "Montana", note: "The pass was closed for snow, so I hiked instead.", daysAgo: 13 },
          { label: "Wyoming", note: "Bison traffic jam in Yellowstone.", daysAgo: 9 },
          { label: "South Dakota", note: "Badlands at dusk. Stopped at Wall Drug because you have to.", daysAgo: 5 },
          { label: "Nebraska", note: "Bought a pie from a farm stand honor box in the Sandhills.", daysAgo: 3 },
          { label: "Iowa", note: "", daysAgo: 1 },
        ],
        plan: {
          summary:
            "Carmen lives in her van this year. The route loops north through the Rockies before the snow, east across the plains in November, then south for the winter.",
          cadence: "Log each new state the day she gets there.",
        },
      },
      {
        handle: "tylerb",
        daysAgo: 40,
        items: [
          { label: "Tennessee", note: "Home state. Hot chicken in East Nashville to make it official.", daysAgo: 40 },
          { label: "Kentucky", note: "Distillery tour near Bardstown. Designated driver, sadly.", daysAgo: 33 },
          { label: "Alabama", note: "Muscle Shoals. Toured the old recording studio. Goosebumps.", daysAgo: 26 },
          { label: "Georgia", note: "Friend's wedding in Savannah. Danced badly under the oaks.", daysAgo: 19 },
          { label: "Mississippi", note: "Corinth. Ate a slugburger, which is better than it sounds.", daysAgo: 12 },
          { label: "Tennessee", note: "Smokies with my dad. Doesn't count twice, but I had to log it.", daysAgo: 8 },
          { label: "Arkansas", note: "Hawksbill Crag at peak color.", daysAgo: 4 },
        ],
        plan: {
          summary:
            "Tyler has a full-time job in Nashville and a lot of states within a day's drive. One weekend trip a month, picking up one or two new states each time.",
          cadence: "One weekend trip a month.",
        },
      },
      {
        handle: "mianguyen",
        daysAgo: 38,
        items: [
          { label: "Texas", note: "Home. Counting it with breakfast tacos.", daysAgo: 38 },
          { label: "Louisiana", note: "New Orleans. Beignets at 7am before the crowds.", daysAgo: 24 },
          { label: "Oklahoma", note: "Cousin's baby shower in Tulsa. Walked the Gathering Place after.", daysAgo: 9 },
        ],
        plan: {
          summary: "Mia works long hours in Houston. The plan uses long weekends and family visits to pick up the nearby states first.",
          cadence: "Long weekends.",
        },
      },
      {
        handle: "ellie808",
        daysAgo: 42,
        gaps: [[30, 8]],
        items: [
          { label: "Hawaii", note: "Home counts! Starting with the easiest one.", daysAgo: 42 },
          { label: "California", note: "Work trip to San Francisco. Burrito in the Mission between meetings.", daysAgo: 36 },
          { label: "Alaska", note: "Flew to Anchorage for the northern lights. Saw them on night two.", daysAgo: 6 },
        ],
        plan: {
          summary:
            "Ellie lives in Honolulu, so every mainland state means a flight. The plan groups states into a few big trips and uses work travel when it comes up.",
          cadence: "A big trip every few months.",
        },
        replan: {
          daysAgo: 7,
          shiftWeeks: 4,
          reason: "No trips in October because flights got expensive. Re-planned around two big mainland trips instead of monthly hops.",
        },
      },
      {
        handle: "benlarsen",
        daysAgo: 7,
        items: [
          { label: "Minnesota", note: "Home state. Walked around Lake Harriet to make it official.", daysAgo: 7 },
          { label: "Wisconsin", note: "Madison for the day. Cheese curds at the farmers market.", daysAgo: 2 },
        ],
        plan: {
          summary: "Ben starts with the Upper Midwest by car: Wisconsin, Iowa and the Dakotas before winter.",
          cadence: "Day trips and long weekends.",
        },
      },
    ],
    openQuests: [
      q("Pick the next state and book one night", "Somewhere you can reach in a day.", "one_off", 20),
      q("Map a loop that picks up 3 new states", "A long weekend with no backtracking.", "weekly", 25),
      q("Set a monthly travel budget", "Gas, one night's stay and one good meal per state.", "one_off", 15),
      q("Ask a local what to eat", "Then eat it.", "weekly", 15),
      q("Price out the Alaska trip", "Summer is easier. The aurora is in winter.", "boss", 60),
      q("Send a postcard from the next state", "To yourself, so there's a stack at the end.", "weekly", 10),
      q("Plan a weekend that adds 2 new states", "Leave Friday after work.", "weekly", 25),
    ],
    doneQuest: (log) => q(`Get to ${log.label}`, "One real stop: a meal, a walk or a conversation.", "weekly", 30),
    space:
      "A road-trip scrapbook. Draw a simple tile map of the 50 US states (an inline SVG grid, one rounded square per state with its postal code) and fill in every state anyone has visited, colored by who got there first. Show how many states the group has visited together, and the newest trip notes as postcards.",
  },

  // ----- Guitar -----
  {
    key: "guitar",
    slug: "learn-20-songs-guitar",
    title: "Learn 20 songs on guitar",
    tagline: "From sore fingertips to twenty songs you can play start to finish.",
    description:
      "Learn 20 songs well enough to play them start to finish for someone else, without stopping. Chords, fingerpicking or riffs, any style.\n\n" +
      "Log a song when you can play it all the way through.",
    emoji: "music",
    theme: "night",
    category: "music",
    metric: { name: "songs learned", unit: "songs", target: 20, aggregation: "count" },
    camps: [
      { title: "First song, start to finish", detail: "Four chords, no stopping.", target: 1, week: 3, emoji: "music" },
      { title: "Three songs, clean changes", detail: "No pauses between chords.", target: 3, week: 8, emoji: "check" },
      { title: "Six songs and a barre chord", detail: "One song with an F barre in it.", target: 6, week: 16, emoji: "target" },
      { title: "Play one for friends", detail: "Ten songs, and play one for real people.", target: 10, week: 26, emoji: "microphone" },
      { title: "15 songs", detail: "A full setlist.", target: 15, week: 40, emoji: "trophy" },
      { title: "20 songs", detail: "Twenty songs, start to finish.", target: 20, week: 52, emoji: "summit" },
    ],
    members: [
      {
        handle: "olliegrant",
        daysAgo: 24,
        items: [
          { label: "Wonderwall", note: "Of course it was Wonderwall. Capo 2. My flatmate has asked me to stop." },
          { label: "Horse with No Name", note: "Two chords. Felt like cheating, counts anyway." },
          { label: "Riptide", note: "The F chord still buzzes. Playing it anyway." },
          { label: "Stand by Me", note: "Played it for my nan on a video call. She sang along." },
        ],
        plan: {
          summary:
            "Ollie had a guitar under his bed for six years. Fifteen minutes a night, a new song every two weeks, starting with four-chord songs and working up to barre chords by spring.",
          cadence: "Nightly, 15 min.",
        },
      },
      {
        handle: "anacosta",
        daysAgo: 22,
        items: [
          { label: "Knockin' on Heaven's Door", note: "G, D, Am, C. My first full song!" },
          { label: "Let It Be", note: "" },
        ],
        plan: {
          summary: "Ana is a complete beginner. Short daily practice on chord changes, and one easy song at a time.",
          cadence: "Daily, 10–15 min.",
        },
      },
      {
        handle: "rohank",
        daysAgo: 21,
        items: [
          { label: "Wish You Were Here", note: "The intro riff took all week." },
          { label: "Tum Hi Ho", note: "My parents sang along on a video call. Mum cried a bit." },
          { label: "Ho Hey", note: "" },
        ],
        plan: {
          summary:
            "Rohan treats practice like training: a warm-up, chord-change drills with a metronome, then the song. Bollywood and classic rock, alternating.",
          cadence: "Daily, 20 min before work.",
        },
      },
      {
        handle: "ingrid",
        daysAgo: 18,
        items: [
          { label: "Jolene", note: "The fingerpicking pattern finally clicked on day five." },
          { label: "Fast Car", note: "The riff, slowly. Very slowly. But all of it." },
        ],
        plan: {
          summary: "Ingrid played as a teenager and wants fingerpicking this time. One fingerstyle song a month, with an easy strummed one in between.",
          cadence: "Three evenings a week.",
        },
      },
      {
        handle: "chloedubois",
        daysAgo: 20,
        gaps: [[14, 6]],
        items: [
          { label: "Leaving on a Jet Plane", note: "Three chords and a capo. Played it for my roommate.", daysAgo: 16 },
          { label: "Hallelujah", note: "Back after a week of night shifts. Slow and sad, and my cat left the room.", daysAgo: 4 },
        ],
        plan: {
          summary: "Chloé practices on days off from her night shifts. Easy songs with a capo first, barre chords later.",
          cadence: "Days off, 20 min.",
        },
      },
      {
        handle: "aidenm",
        daysAgo: 4,
        items: [{ label: "Seven Nation Army", note: "The riff on one string, all the way through. Fingers hurt. Day one done.", daysAgo: 1 }],
        plan: {
          summary: "Aiden wants a few riffs he can play for friends. Rock songs, one riff at a time.",
          cadence: "Most evenings, 10 min.",
        },
      },
    ],
    openQuests: [
      q("Chord changes: G to C for one minute", "Count clean changes. Beat yesterday's number.", "daily", 10),
      q("Learn the strumming pattern for the next song", "Mute the strings and strum along with the recording.", "weekly", 20),
      q("Play along with the recording once a day", "Keep going when you miss a chord.", "daily", 10),
      q("Record yourself playing a full song", "Listen back once. Note one thing to fix.", "weekly", 25),
      q("F barre chord: five minutes a day", "Thumb behind the neck, roll the index finger slightly.", "daily", 10),
      q("Learn the intro riff", "Slow it down to half speed first.", "weekly", 20),
      q("Play one song for someone", "A friend, family or a video call.", "boss", 60),
      q("Practice with a metronome at 70 bpm", "Speed comes later.", "weekly", 15),
    ],
    doneQuest: (log) => q(`Play ${log.label} start to finish`, "No stopping, even if a chord buzzes.", "weekly", 30),
    space:
      "A gig poster on a night stage: deep navy with warm stage-light accents. Lead with the number of songs learned together, then each player's setlist (song names and the date they learned them), and each player's progress to 20 as a guitar fretboard where frets light up.",
  },
];

// ---------- Small helpers ----------

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Stable ids, so a re-seed keeps the same rows (and their covers and spaces). */
function demoId(prefix: "chl" | "usr", key: string): string {
  const h = sha256(`misogi-demo:${prefix}:${key}`);
  let out = "";
  for (let i = 0; i < 8; i++) out += ALPHABET[parseInt(h.slice(i * 2, i * 2 + 2), 16) % 36];
  return `${prefix}_demo${out}`;
}

export const demoChallengeId = (key: string) => demoId("chl", key);

class Rng {
  private s: number;
  constructor(seed: string) {
    this.s = parseInt(sha256(seed).slice(0, 8), 16) | 0;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  float(a: number, b: number) {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number) {
    return Math.floor(this.float(a, b + 1));
  }
  chance(p: number) {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  shuffle<T>(arr: readonly T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function tzOffsetMs(tz: string, at: number): number {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, f);
  }
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(new Date(at))) if (part.type !== "literal") p[part.type] = Number(part.value);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(at / 1000) * 1000;
}

/** The instant of a local wall-clock time in a time zone. */
function localTime(date: string, hour: number, minute: number, tz: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  const first = guess - tzOffsetMs(tz, guess);
  return guess - tzOffsetMs(tz, first);
}

const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const isoAt = (ms: number) => new Date(ms).toISOString();

function roundTo(n: number, step: number): number {
  const r = Math.round(n / step) * step;
  return Math.round(r * 100) / 100;
}

/** k items spread evenly over `arr`, one random pick per slice, in order. */
function spreadPick<T>(arr: readonly T[], k: number, rng: Rng): T[] {
  if (k <= 0 || arr.length === 0) return [];
  const n = Math.min(k, arr.length);
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    const lo = Math.floor((i * arr.length) / n);
    const hi = Math.max(lo, Math.floor(((i + 1) * arr.length) / n) - 1);
    out.push(arr[rng.int(lo, hi)]);
  }
  return out;
}

// Prepared statements are cached per seed run.
const stmts = new Map<string, BetterSqlite3.Statement>();
function exec(sql: string, ...params: unknown[]) {
  let s = stmts.get(sql);
  if (!s) {
    s = db().prepare(sql);
    stmts.set(sql, s);
  }
  return s.run(...params);
}

// ---------- Seeding ----------

type SeedUser = DemoUser & { id: string; firstJoin: number; lastLog: number };

type Counts = {
  users: number;
  templates: number;
  active_challenges: number;
  memberships: number;
  plans: number;
  quests: { open: number; done: number; skipped: number };
  logs: number;
  cheers: number;
  activity: number;
};

export type SeedSummary = {
  seeded: boolean;
  forced: boolean;
  reason?: string;
  counts: Counts;
  challenges: { slug: string; title: string; status: string; members: number }[];
};

type ActRow = { kind: string; at: number; data: Record<string, unknown>; userId: string };

type LogRec = {
  id: string;
  userId: string;
  date: string;
  at: number;
  value: number | null;
  label: string | null;
  note: string;
  source: string;
  xp: number;
  crossed: boolean;
  questId: string | null;
};

function emptyCounts(): Counts {
  return { users: 0, templates: 0, active_challenges: 0, memberships: 0, plans: 0, quests: { open: 0, done: 0, skipped: 0 }, logs: 0, cheers: 0, activity: 0 };
}

const isSeeded = () => !!one("SELECT 1 FROM users WHERE is_demo = 1 AND substr(id, 1, 8) = 'usr_demo' LIMIT 1");

/** Removes everything demo people did, but keeps the demo users and challenges (and their covers and spaces). */
function resetDemoHistory() {
  const who = "SELECT id FROM users WHERE is_demo = 1 AND substr(id, 1, 8) = 'usr_demo'";
  exec(`DELETE FROM cheers WHERE user_id IN (${who})`);
  exec(`DELETE FROM activity WHERE user_id IN (${who}) AND kind != 'space'`);
  exec(`DELETE FROM logs WHERE user_id IN (${who})`);
  exec(`DELETE FROM quests WHERE user_id IN (${who})`);
  exec(`DELETE FROM plans WHERE user_id IN (${who})`);
  exec(`DELETE FROM memberships WHERE user_id IN (${who})`);
  const ids = [...TEMPLATES.map((t) => demoId("chl", `tpl-${t.slug}`)), ...CHALLENGES.map((c) => demoId("chl", c.key))];
  exec(`DELETE FROM challenges WHERE substr(id, 1, 8) = 'chl_demo' AND id NOT IN (${ids.map(() => "?").join(",")})`, ...ids);
  const userIds = USERS.map((u) => demoId("usr", u.handle));
  exec(
    `DELETE FROM users WHERE substr(id, 1, 8) = 'usr_demo' AND id NOT IN (${userIds.map(() => "?").join(",")})
       AND id NOT IN (SELECT creator_id FROM challenges WHERE creator_id IS NOT NULL)`,
    ...userIds,
  );
}

function upsertUser(u: DemoUser, now: number): SeedUser {
  const uid = demoId("usr", u.handle);
  const existing = one<{ handle: string }>("SELECT handle FROM users WHERE id = ?", uid);
  if (existing) {
    exec(
      `UPDATE users SET display_name = ?, avatar = ?, motivation_style = ?, timezone = ?, agent_name = ?, agent_kind = ?, is_demo = 1 WHERE id = ?`,
      u.name,
      u.avatar,
      u.style,
      u.tz,
      u.agentName ?? null,
      u.agent,
      uid,
    );
  } else {
    let handle = u.handle;
    for (let i = 2; one("SELECT 1 FROM users WHERE handle = ?", handle); i++) handle = `${u.handle.slice(0, 21)}${i}`;
    exec(
      `INSERT INTO users (id, handle, display_name, avatar, motivation_style, timezone, agent_name, agent_kind, is_demo, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      uid,
      handle,
      u.name,
      u.avatar,
      u.style,
      u.tz,
      u.agentName ?? null,
      u.agent,
      isoAt(now),
    );
  }
  return { ...u, id: uid, firstJoin: Number.POSITIVE_INFINITY, lastLog: 0 };
}

function upsertChallenge(
  cid: string,
  preferredSlug: string,
  f: {
    creatorId: string | null;
    title: string;
    tagline: string;
    description: string;
    emoji: string;
    theme: string;
    category: string;
    metric: { name: string; unit: string; target: number; aggregation: string };
    status: "active" | "template";
    year: number | null;
    label: string | null;
    createdAt: string;
    updatedAt: string;
  },
): string {
  const existing = one<{ slug: string }>("SELECT slug FROM challenges WHERE id = ?", cid);
  const values = [
    f.creatorId,
    f.title,
    f.tagline,
    f.description,
    f.emoji,
    f.theme,
    f.category,
    f.metric.name,
    f.metric.unit,
    f.metric.target,
    f.metric.aggregation,
    f.status,
    f.year,
    f.label,
    f.createdAt,
    f.updatedAt,
  ];
  if (existing) {
    exec(
      `UPDATE challenges SET creator_id = ?, title = ?, tagline = ?, description_md = ?, emoji = ?, theme = ?, category = ?,
         metric_name = ?, metric_unit = ?, metric_target = ?, metric_aggregation = ?, metric_direction = 'up', status = ?,
         template_year = ?, template_label = ?, created_at = ?, updated_at = ? WHERE id = ?`,
      ...values,
      cid,
    );
    return existing.slug;
  }
  let slug = preferredSlug;
  for (let i = 2; one("SELECT 1 FROM challenges WHERE slug = ?", slug); i++) slug = `${preferredSlug}-${i}`;
  exec(
    `INSERT INTO challenges (id, slug, creator_id, title, tagline, description_md, emoji, theme, category, metric_name, metric_unit,
       metric_target, metric_aggregation, metric_direction, status, template_year, template_label, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'up', ?, ?, ?, ?, ?)`,
    cid,
    slug,
    ...values,
  );
  return slug;
}

function insertActivity(cid: string, a: ActRow, counts: Counts) {
  exec(
    "INSERT INTO activity (id, challenge_id, user_id, kind, data_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    id("act"),
    cid,
    a.userId,
    a.kind,
    JSON.stringify(a.data),
    isoAt(a.at),
  );
  counts.activity++;
}

function seedTemplates(now: number, counts: Counts, out: SeedSummary["challenges"]) {
  const created = isoAt(now - 120 * DAY);
  for (const t of TEMPLATES) {
    const description = `${t.intro}\n\n**Suggested camps**\n${t.camps.map((c) => `- ${c}`).join("\n")}`;
    const slug = upsertChallenge(demoId("chl", `tpl-${t.slug}`), t.slug, {
      creatorId: null,
      title: t.title,
      tagline: t.tagline,
      description,
      emoji: t.emoji,
      theme: t.theme,
      category: t.category,
      metric: t.metric,
      status: "template",
      year: t.year,
      label: TEMPLATE_LABEL,
      createdAt: created,
      updatedAt: created,
    });
    counts.templates++;
    out.push({ slug, title: t.title, status: "template", members: 0 });
  }
}

type MemberRun = {
  spec: MemberSpec;
  user: SeedUser;
  today: string;
  joinAt: number;
  logs: LogRec[];
};

function seedChallenge(spec: ChallengeSpec, users: Map<string, SeedUser>, now: number, counts: Counts): { slug: string; members: number } {
  const cid = demoId("chl", spec.key);
  const crng = new Rng(`challenge:${spec.key}`);
  const pool = spec.notes ? crng.shuffle(spec.notes) : [];
  const step = spec.step ?? 1;

  // Join times first: the creator starts the challenge, everyone else joins later.
  const runs: MemberRun[] = [];
  for (const [i, m] of spec.members.entries()) {
    const user = users.get(m.handle);
    if (!user) throw new Error(`Unknown demo user ${m.handle}`);
    const rng = new Rng(`join:${spec.key}:${m.handle}`);
    const today = dateIn(user.tz, new Date(now));
    let joinAt = localTime(addDays(today, -m.daysAgo), rng.int(8, 19), rng.int(0, 59), user.tz);
    if (i > 0 && joinAt <= runs[0].joinAt) joinAt = runs[0].joinAt + rng.int(2, 20) * HOUR;
    runs.push({ spec: m, user, today, joinAt, logs: [] });
  }
  const createdAt = runs[0].joinAt;

  const slug = upsertChallenge(cid, spec.slug, {
    creatorId: runs[0].user.id,
    title: spec.title,
    tagline: spec.tagline,
    description: spec.description,
    emoji: spec.emoji,
    theme: spec.theme,
    category: spec.category,
    metric: spec.metric,
    status: "active",
    year: null,
    label: null,
    createdAt: isoAt(createdAt),
    updatedAt: isoAt(now),
  });
  counts.active_challenges++;

  for (const [i, r] of runs.entries()) simulateMember(spec, cid, r, i === 0, pool, step, now, counts);

  // Cheers between members.
  const rng = new Rng(`cheers:${spec.key}`);
  const itemBased = spec.metric.aggregation !== "sum";
  let lastAt = createdAt;
  for (const r of runs) {
    for (const log of r.logs) {
      lastAt = Math.max(lastAt, log.at);
      const others = runs.filter((o) => o.user.id !== r.user.id && o.joinAt < log.at);
      if (!others.length) continue;
      const p = log.crossed ? 0.85 : itemBased ? (log.note ? 0.7 : 0.45) : log.note ? 0.42 : 0.18;
      if (!rng.chance(p)) continue;
      let k = 1 + (rng.chance(0.45) ? 1 : 0) + (rng.chance(0.25) ? 1 : 0) + (log.crossed && rng.chance(0.5) ? 1 : 0);
      k = Math.min(k, others.length);
      for (const o of rng.shuffle(others).slice(0, k)) {
        const at = Math.min(log.at + rng.int(3, 600) * MIN, now - rng.int(1, 30) * MIN);
        if (at <= log.at) continue;
        exec("INSERT INTO cheers (log_id, user_id, created_at) VALUES (?, ?, ?)", log.id, o.user.id, isoAt(at));
        counts.cheers++;
      }
    }
  }
  exec("UPDATE challenges SET updated_at = ? WHERE id = ?", isoAt(lastAt), cid);
  return { slug, members: runs.length };
}

type Raw = { d: number; value: number | null; label: string | null; note: string | null; hour?: number; long?: boolean };

function rawLogs(spec: ChallengeSpec, m: MemberSpec, today: string, step: number, rng: Rng): Raw[] {
  const inGap = (d: number) => (m.gaps ?? []).some(([from, to]) => d <= from && d >= to);
  const out: Raw[] = [];
  if (m.items) {
    const explicit = m.items.every((it) => it.daysAgo != null);
    let days: number[];
    if (explicit) days = m.items.map((it) => it.daysAgo!);
    else {
      const avail: number[] = [];
      for (let d = m.daysAgo - 1; d >= 0; d--) if (!inGap(d)) avail.push(d);
      days = spreadPick(avail.length ? avail : [0], m.items.length, rng);
    }
    m.items.forEach((it, i) => out.push({ d: days[i], value: null, label: it.label, note: it.note ?? "" }));
    return out;
  }
  for (let d = m.daysAgo; d >= 0; d--) {
    if (inGap(d)) continue;
    const beat = m.beats?.find((b) => b.daysAgo === d);
    if (beat) {
      out.push({ d, value: beat.value ?? roundTo(rng.float(...(m.amount ?? [1, 2])), step), label: null, note: beat.note, long: beat.long });
      continue;
    }
    const date = addDays(today, -d);
    const wd = weekday(date);
    const phase = m.after && d <= m.after.daysAgo ? m.after : null;
    const amount = phase?.amount ?? m.amount ?? [1, 2];
    if (m.ritual && wd === m.ritual.weekday && d !== m.daysAgo) {
      const week = Math.floor((m.daysAgo - d) / 7);
      if ((m.ritual.every ?? 1) === 1 || week % (m.ritual.every ?? 1) === 0) {
        if (rng.chance(0.92)) {
          const notes = m.ritual.notes;
          out.push({ d, value: m.ritual.amount + rng.pick([-10, -5, 0, 0, 0, 5]), label: null, note: notes[week % notes.length], hour: m.ritual.hour });
        }
        continue;
      }
    }
    if (!phase && m.long && wd === m.long.weekday) {
      if (rng.chance(m.long.chance)) out.push({ d, value: roundTo(rng.float(...m.long.amount), step), label: null, note: null, long: true });
      continue;
    }
    const p = phase ? phase.weekdays[wd] : m.weekdays ? m.weekdays[wd] : (m.pace ?? 0.7);
    if (!rng.chance(p)) continue;
    out.push({ d, value: roundTo(rng.float(...amount), step), label: null, note: null });
  }
  return out;
}

function sourceFor(u: SeedUser, rng: Rng): string {
  if (u.agent === "virgil") return rng.chance(0.25) ? "web" : "virgil";
  return rng.chance(0.08) ? "web" : u.agent;
}

function campDue(startsOn: string, endsOn: string, week: number): string {
  const due = addDays(startsOn, week * 7);
  return due > endsOn ? endsOn : due;
}

function simulateMember(
  spec: ChallengeSpec,
  cid: string,
  r: MemberRun,
  isCreator: boolean,
  pool: string[],
  step: number,
  now: number,
  counts: Counts,
) {
  const { spec: m, user, today, joinAt } = r;
  const rng = new Rng(`member:${spec.key}:${m.handle}`);
  const tz = user.tz;
  const startsOn = dateIn(tz, new Date(joinAt));
  const endsOn = addYear(startsOn);
  const planAt = joinAt + rng.int(4, 18) * MIN;
  const replanAt = m.replan ? Math.max(planAt + HOUR, localTime(addDays(today, -m.replan.daysAgo), rng.int(19, 21), rng.int(0, 59), tz)) : null;
  const author = user.agent === "virgil" ? "virgil" : "agent";
  const acts: ActRow[] = [];

  // 1. Logs with real local timestamps.
  const raws = rawLogs(spec, m, today, step, rng);
  const logs: LogRec[] = [];
  for (const raw of raws) {
    const win = raw.hour != null ? ([raw.hour, raw.hour] as [number, number]) : rng.pick(user.hours);
    const hour = rng.int(win[0], win[1]);
    const minute = rng.int(0, 59);
    // Items and story beats matter, so if their time hasn't come yet today, they happened yesterday.
    const keep = raw.label != null || raw.note != null;
    let date = addDays(today, -raw.d);
    let at = localTime(date, hour, minute, tz);
    for (let back = 1; keep && at > now - 3 * MIN && back <= 2; back++) {
      date = addDays(today, -(raw.d + back));
      at = localTime(date, hour, minute, tz);
    }
    // Agents often log yesterday's progress the next morning.
    if (date < today && rng.chance(0.1)) {
      const next = localTime(addDays(date, 1), rng.int(7, 10), rng.int(0, 59), tz);
      if (next < now - 5 * MIN) at = next;
    }
    if (at < planAt + 5 * MIN) {
      at = planAt + rng.int(10, 120) * MIN;
      date = dateIn(tz, new Date(at));
    }
    if (at > now - 3 * MIN) continue;
    let note = raw.note;
    if (note == null) {
      if (spec.noteFor) note = spec.noteFor({ m, value: raw.value ?? 0, hour, long: !!raw.long, rng });
      else {
        const roll = rng.next();
        const rate = m.noteRate ?? 0.24;
        note = "";
        if (roll < rate) note = pool.shift() ?? "";
        if (!note && roll < rate + 0.14 && spec.shortNotes) note = rng.pick(spec.shortNotes);
      }
    }
    logs.push({
      id: id("log"),
      userId: user.id,
      date,
      at,
      value: raw.value,
      label: raw.label,
      note: note.trim(),
      source: sourceFor(user, rng),
      xp: 0,
      crossed: false,
      questId: null,
    });
  }
  logs.sort((a, b) => a.at - b.at);

  // 2. Some logs completed a quest the agent set earlier that week.
  const usedTitles = new Set<string>();
  const eligible = logs.filter((l) => l.at > planAt + 20 * HOUR);
  const questCount = spec.metric.aggregation === "sum" ? Math.min(9, Math.round(logs.length * 0.12)) : Math.floor(eligible.length * 0.5);
  type QuestRow = { id: string; tpl: QuestTpl; createdAt: number; dueOn: string | null; status: "open" | "done" | "skipped"; completedAt: number | null; logId: string | null };
  const quests: QuestRow[] = [];
  for (const log of spreadPick(eligible, questCount, rng)) {
    // Boss quests are a camp's final test, so nobody gets one in their first three weeks.
    const early = log.at - joinAt < 21 * DAY;
    const bad = (t: QuestTpl) => usedTitles.has(t.title) || (early && t.kind === "boss");
    let tpl = spec.doneQuest(log, rng);
    for (let tries = 0; tries < 8 && bad(tpl); tries++) tpl = spec.doneQuest(log, rng);
    if (bad(tpl)) continue;
    usedTitles.add(tpl.title);
    const createdAt = Math.max(planAt + MIN, log.at - rng.int(1, 4) * DAY - rng.int(0, 180) * MIN);
    let dueOn = addDays(dateIn(tz, new Date(createdAt)), tpl.kind === "boss" ? rng.int(8, 12) : rng.int(4, 6));
    if (dueOn < log.date) dueOn = log.date;
    const qid = id("qst");
    quests.push({ id: qid, tpl, createdAt, dueOn, status: "done", completedAt: log.at, logId: log.id });
    log.questId = qid;
    log.xp += tpl.xp;
  }

  // 3. Walk the history in order: XP, camps reached, levels.
  const doneAt = new Map<number, number>(); // camp index -> time reached
  let xp = 0;
  let total = 0;
  const seen = new Set<string>();
  for (const log of logs) {
    log.xp += 10 + (log.note.length >= 30 ? 5 : 0);
    const before = levelFor(xp).level;
    xp += log.xp;
    if (spec.metric.aggregation === "sum") total += log.value ?? 0;
    else if (spec.metric.aggregation === "count") total += log.value ?? 1;
    else {
      seen.add((log.label ?? "").trim().toLowerCase());
      total = seen.size;
    }
    const quest = quests.find((x) => x.logId === log.id);
    if (quest) acts.push({ kind: "quest_done", at: log.at, userId: user.id, data: { quest_id: quest.id, title: quest.tpl.title, log_id: log.id, xp: log.xp } });
    else
      acts.push({
        kind: "logged",
        at: log.at,
        userId: user.id,
        data: { log_id: log.id, value: log.value, label: log.label, unit: spec.metric.unit, metric: spec.metric.name, note: log.note.slice(0, 140), xp: log.xp },
      });
    spec.camps.forEach((c, ci) => {
      if (!doneAt.has(ci) && total >= c.target - 1e-9) {
        doneAt.set(ci, log.at);
        log.crossed = true;
        xp += MILESTONE_XP;
        acts.push({ kind: "milestone", at: log.at + 1000, userId: user.id, data: { milestone_id: `camp-${ci}`, title: c.title, emoji: c.emoji } });
      }
    });
    const after = levelFor(xp).level;
    if (after > before) acts.push({ kind: "level", at: log.at + 2000, userId: user.id, data: { level: after } });
  }

  // 4. Plans: v1 after intake, v2 if they re-planned after a lapse. Camp ids carry over.
  const campIds = spec.camps.map(() => id("cmp"));
  const milestones = (version: 1 | 2, cutoff: number): Milestone[] =>
    spec.camps.map((c, ci) => {
      const reached = doneAt.get(ci);
      const done = reached != null && reached <= cutoff ? reached : null;
      let due = campDue(startsOn, endsOn, c.week);
      if (version === 2 && m.replan && (done == null || done > replanAt!)) {
        due = addDays(due, m.replan.shiftWeeks * 7);
        if (due > endsOn) due = endsOn;
      }
      return { id: campIds[ci], title: c.title, detail: c.detail, target: c.target, due_on: due, emoji: c.emoji, done_at: done != null ? isoAt(done) : null };
    });
  // Fix milestone ids in activity rows now that camp ids exist.
  for (const a of acts) if (a.kind === "milestone") a.data.milestone_id = campIds[Number(String(a.data.milestone_id).slice(5))];

  const planRows: { version: number; at: number; summary: string; cadence: string; reason: string; ms: Milestone[] }[] = [
    {
      version: 1,
      at: planAt,
      summary: m.plan.summary,
      cadence: m.plan.cadence,
      reason: "First plan, from the intake conversation.",
      ms: milestones(1, replanAt ?? Number.POSITIVE_INFINITY),
    },
  ];
  if (m.replan && replanAt) {
    planRows.push({
      version: 2,
      at: replanAt,
      summary: m.replan.summary ?? m.plan.summary,
      cadence: m.replan.cadence ?? m.plan.cadence,
      reason: m.replan.reason,
      ms: milestones(2, Number.POSITIVE_INFINITY),
    });
  }

  // 5. This week's open quests, plus a couple skipped from earlier weeks.
  const lastPlanAt = replanAt ?? planAt;
  const monday = addDays(today, -((weekday(today) + 6) % 7));
  let weekStart = localTime(monday, rng.int(8, 10), rng.int(0, 59), tz);
  if (weekStart > now - 30 * MIN) weekStart = localTime(addDays(monday, -7), rng.int(8, 10), rng.int(0, 59), tz);
  if (weekStart < lastPlanAt) weekStart = lastPlanAt + rng.int(1, 3) * MIN;
  const weekDate = dateIn(tz, new Date(weekStart));
  const fresh = rng.shuffle(spec.openQuests).filter((t) => !usedTitles.has(t.title) && (t.kind !== "boss" || m.daysAgo >= 21));
  const openCount = Math.min(fresh.length, rng.int(3, 5));
  for (const tpl of fresh.slice(0, openCount)) {
    usedTitles.add(tpl.title);
    const span = tpl.kind === "daily" ? 6 : tpl.kind === "boss" ? rng.int(9, 14) : tpl.kind === "one_off" ? rng.int(2, 5) : rng.int(3, 6);
    let due = addDays(weekDate, span);
    if (due < today) due = addDays(today, rng.int(1, 4));
    quests.push({ id: id("qst"), tpl, createdAt: weekStart, dueOn: due, status: "open", completedAt: null, logId: null });
  }
  if (m.daysAgo >= 28) {
    for (const tpl of fresh.slice(openCount, openCount + rng.int(1, 2))) {
      const createdAt = Math.max(planAt + MIN, now - rng.int(15, 24) * DAY);
      quests.push({
        id: id("qst"),
        tpl,
        createdAt,
        dueOn: addDays(dateIn(tz, new Date(createdAt)), 5),
        status: "skipped",
        completedAt: null,
        logId: null,
      });
    }
  }

  // 6. Write it all.
  exec(
    `INSERT INTO memberships (challenge_id, user_id, role, status, joined_at, starts_on, ends_on) VALUES (?, ?, ?, 'active', ?, ?, ?)`,
    cid,
    user.id,
    isCreator ? "creator" : "member",
    isoAt(joinAt),
    startsOn,
    endsOn,
  );
  counts.memberships++;
  insertActivity(cid, { kind: isCreator ? "started" : "joined", at: joinAt, userId: user.id, data: isCreator ? { title: spec.title } : {} }, counts);
  for (const p of planRows) {
    exec(
      `INSERT INTO plans (id, challenge_id, user_id, version, summary_md, cadence, milestones_json, reason, author, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id("pln"),
      cid,
      user.id,
      p.version,
      p.summary,
      p.cadence,
      JSON.stringify(p.ms),
      p.reason,
      author,
      isoAt(p.at),
    );
    counts.plans++;
    insertActivity(cid, { kind: "plan", at: p.at, userId: user.id, data: { version: p.version, reason: p.reason.slice(0, 140) } }, counts);
  }
  for (const qr of quests) {
    exec(
      `INSERT INTO quests (id, challenge_id, user_id, title, detail, kind, xp, due_on, status, created_at, completed_at, log_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      qr.id,
      cid,
      user.id,
      qr.tpl.title,
      qr.tpl.detail,
      qr.tpl.kind,
      qr.tpl.xp,
      qr.dueOn,
      qr.status,
      isoAt(qr.createdAt),
      qr.completedAt != null ? isoAt(qr.completedAt) : null,
      qr.logId,
    );
    counts.quests[qr.status]++;
  }
  for (const l of logs) {
    exec(
      `INSERT INTO logs (id, challenge_id, user_id, logged_for, value, label, note, quest_id, xp, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      l.id,
      cid,
      user.id,
      l.date,
      l.value,
      l.label,
      l.note,
      l.questId,
      l.xp,
      l.source,
      isoAt(l.at),
    );
    counts.logs++;
  }
  for (const a of acts) insertActivity(cid, a, counts);

  r.logs = logs;
  user.firstJoin = Math.min(user.firstJoin, joinAt);
  user.lastLog = Math.max(user.lastLog, logs.at(-1)?.at ?? 0, lastPlanAt);
}

/** When each person's agent last acted, and when they signed up. */
function finishUsers(users: Map<string, SeedUser>, now: number, counts: Counts) {
  for (const u of users.values()) {
    const rng = new Rng(`user:${u.handle}`);
    const created = Number.isFinite(u.firstJoin) ? u.firstJoin - rng.int(2, 40) * MIN : now - 30 * DAY;
    let seen: number | null;
    if (u.agent === "muse") seen = Math.max(u.lastLog, now - rng.int(20, 18 * 60) * MIN);
    else if (u.agent === "mcp" || u.agent === "agent") seen = Math.max(u.lastLog, now - rng.int(3 * 60, 50 * 60) * MIN);
    else seen = u.lastLog || null;
    const seenAt = seen ? isoAt(Math.min(seen, now - MIN)) : null;
    exec("UPDATE users SET created_at = ?, agent_seen_at = ? WHERE id = ?", isoAt(created), seenAt, u.id);
    // A climber whose own AI is connected holds a key, as a real one would; nobody knows its secret.
    if (u.agent !== "virgil") {
      if (!one("SELECT 1 FROM api_keys WHERE user_id = ? AND revoked_at IS NULL", u.id)) {
        const key = `msk_${randomToken(24)}`;
        exec("INSERT INTO api_keys (id, user_id, key_hash, prefix, created_at) VALUES (?, ?, ?, ?, ?)", id("key"), u.id, sha256(key), key.slice(0, 10), isoAt(created));
      }
      exec("UPDATE api_keys SET last_used_at = ? WHERE user_id = ? AND revoked_at IS NULL", seenAt, u.id);
    }
    counts.users++;
  }
}

/** Seeds the demo data. Skips if it's already there, unless `force` (which rebuilds the history in place). */
export function seedDemo(opts: { force?: boolean } = {}): SeedSummary {
  const force = !!opts.force;
  if (!force && isSeeded()) {
    return { seeded: false, forced: false, reason: "Demo data is already there. Pass force: true to rebuild it.", counts: currentCounts(), challenges: seededChallengeList() };
  }
  stmts.clear();
  const now = Date.now();
  const counts = emptyCounts();
  const out: SeedSummary["challenges"] = [];
  tx(() => {
    if (force) resetDemoHistory();
    const users = new Map<string, SeedUser>();
    for (const u of USERS) users.set(u.handle, upsertUser(u, now));
    seedTemplates(now, counts, out);
    for (const spec of CHALLENGES) {
      const r = seedChallenge(spec, users, now, counts);
      out.push({ slug: r.slug, title: spec.title, status: "active", members: r.members });
    }
    finishUsers(users, now, counts);
  });
  stmts.clear();
  return { seeded: true, forced: force, counts, challenges: out };
}

// ---------- Read helpers for the admin route ----------

function currentCounts(): Counts {
  const who = "SELECT id FROM users WHERE is_demo = 1 AND substr(id, 1, 8) = 'usr_demo'";
  const n = (sql: string) => one<{ n: number }>(sql)!.n;
  return {
    users: n(`SELECT COUNT(*) n FROM (${who})`),
    templates: n("SELECT COUNT(*) n FROM challenges WHERE substr(id, 1, 8) = 'chl_demo' AND status = 'template'"),
    active_challenges: n("SELECT COUNT(*) n FROM challenges WHERE substr(id, 1, 8) = 'chl_demo' AND status = 'active'"),
    memberships: n(`SELECT COUNT(*) n FROM memberships WHERE user_id IN (${who})`),
    plans: n(`SELECT COUNT(*) n FROM plans WHERE user_id IN (${who})`),
    quests: {
      open: n(`SELECT COUNT(*) n FROM quests WHERE status = 'open' AND user_id IN (${who})`),
      done: n(`SELECT COUNT(*) n FROM quests WHERE status = 'done' AND user_id IN (${who})`),
      skipped: n(`SELECT COUNT(*) n FROM quests WHERE status = 'skipped' AND user_id IN (${who})`),
    },
    logs: n(`SELECT COUNT(*) n FROM logs WHERE user_id IN (${who})`),
    cheers: n(`SELECT COUNT(*) n FROM cheers WHERE user_id IN (${who})`),
    activity: n(`SELECT COUNT(*) n FROM activity WHERE user_id IN (${who})`),
  };
}

function seededChallengeList(): SeedSummary["challenges"] {
  return seededChallenges().map((c) => ({
    slug: c.slug,
    title: c.title,
    status: c.status,
    members: one<{ n: number }>("SELECT COUNT(*) n FROM memberships WHERE challenge_id = ? AND status != 'left'", c.id)!.n,
  }));
}

/** Every challenge the seed owns (templates and live ones). */
export function seededChallenges(): { id: string; slug: string; title: string; status: string; cover_path: string | null; creator_id: string | null }[] {
  const ids = [...TEMPLATES.map((t) => demoId("chl", `tpl-${t.slug}`)), ...CHALLENGES.map((c) => demoId("chl", c.key))];
  const rows = all<{ id: string; slug: string; title: string; status: string; cover_path: string | null; creator_id: string | null }>(
    `SELECT id, slug, title, status, cover_path, creator_id FROM challenges WHERE id IN (${ids.map(() => "?").join(",")})`,
    ...ids,
  );
  const order = new Map(ids.map((x, i) => [x, i]));
  return rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
}

type DemoSpace = { page: string; challengeId: string; slug: string; ownerId: string; target: "challenge" | "me"; request: string };

/** The pages the seed builds: each live challenge's shared page, and the members' own pages that ask for one. */
export function demoSpaces(): DemoSpace[] {
  const out: DemoSpace[] = [];
  for (const spec of CHALLENGES) {
    const cid = demoId("chl", spec.key);
    const row = one<{ slug: string; creator_id: string | null }>("SELECT slug, creator_id FROM challenges WHERE id = ?", cid);
    if (!row?.creator_id) continue;
    out.push({ page: row.slug, challengeId: cid, slug: row.slug, ownerId: row.creator_id, target: "challenge", request: spec.space });
    for (const m of spec.members) {
      if (!m.space) continue;
      const u = one<{ id: string; handle: string }>("SELECT id, handle FROM users WHERE id = ?", demoId("usr", m.handle));
      if (u) out.push({ page: `${row.slug}/${u.handle}`, challengeId: cid, slug: row.slug, ownerId: u.id, target: "me", request: m.space });
    }
  }
  return out;
}
