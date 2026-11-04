// Demo data for the live site: Zuckerberg-inspired templates plus seven active challenges
// with members, plans, quests, logs, cheers and a feed that reads like real people.
// History is generated relative to "now", so it stays fresh whenever it's seeded.
// Runs inside the Next server (better-sqlite3 doesn't run under Bun): POST /api/admin/seed.

import type BetterSqlite3 from "better-sqlite3";
import type { Milestone, Theme } from "@/lib/shared/types";
import { all, db, one, tx } from "./db";
import { levelFor, MILESTONE_XP } from "./facts";
import { addDays, addYear, dateIn, id, randomToken, sha256 } from "./util";
import { findCity } from "./cities";

// ---------- Spec types ----------

type AgentKind = "muse" | "mcp" | "virgil" | "agent";
type Avatar = "sky" | "mint" | "peach" | "lilac" | "sand" | "rose";
type Aggregation = "sum" | "count" | "distinct" | "latest";

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

type Camp = { title: string; detail: string; target: number; emoji: string } & ({ week: number } | { on: string });
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
  /** Local hour windows when they log in this challenge, when it isn't their usual time (a day's steps get logged at night). */
  hours?: [number, number][];
  // Daily logging (sum metrics, and count metrics logged once a day)
  pace?: number;
  weekdays?: number[]; // chance per weekday, Sunday first
  amount?: [number, number];
  long?: { weekday: number; chance: number; amount: [number, number] };
  after?: { daysAgo: number; weekdays: number[]; amount: [number, number] };
  ritual?: { weekday: number; amount: number; hour: number; notes: string[]; every?: number };
  beats?: Beat[];
  noteRate?: number;
  // Running and walking notes
  paceSec?: number;
  places?: string[];
  km?: boolean;
  // Item logging (count / distinct metrics)
  items?: Item[];
  /** What this member asks the codegen model for when building their own page. */
  space?: string;
};

type NoteCtx = { m: MemberSpec; value: number; hour: number; long: boolean; rng: Rng };

/** What the seed needs to write a challenge's history: its people, their logs, plans, camps and quests. */
type HistorySpec = {
  key: string;
  slug: string;
  title: string;
  metric: { name: string; unit: string; target: number; aggregation: Aggregation };
  step?: number;
  camps: Camp[];
  members: MemberSpec[];
  openQuests: QuestTpl[];
  doneQuest: (log: { value: number | null; label: string | null }, rng: Rng) => QuestTpl;
  notes?: string[];
  shortNotes?: string[];
  noteFor?: (ctx: NoteCtx) => string;
};

type ChallengeSpec = HistorySpec & {
  tagline: string;
  description: string;
  emoji: string;
  theme: Theme;
  category: string;
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

/** Where each demo climber lives, in their own time zone, for the world map. */
const DEMO_CITIES: Record<string, [name: string, country: string]> = {
  danielokafor: ["London", "GB"],
  sofiam: ["Madrid", "ES"],
  kenjimorita: ["Osaka", "JP"],
  hannahlevi: ["New York City", "US"],
  arjunm: ["San Francisco", "US"],
  chloedubois: ["Montreal", "CA"],
  tomasherrera: ["Houston", "US"],
  ingrid: ["Oslo", "NO"],
  weizhang: ["Singapore", "SG"],
  femi: ["Berlin", "DE"],
  rachelkim: ["Seattle", "US"],
  noahb: ["Denver", "US"],
  amara: ["Atlanta", "US"],
  lucasf: ["Porto", "PT"],
  yukitanaka: ["Tokyo", "JP"],
  graceoc: ["Dublin", "IE"],
  tobyreid: ["London", "GB"],
  marisol: ["Los Angeles", "US"],
  raviiyer: ["Bengaluru", "IN"],
  emmal: ["Stockholm", "SE"],
  samwhit: ["Portland", "US"],
  jordanruns: ["Boston", "US"],
  mayac: ["Los Angeles", "US"],
  aidenm: ["Kansas City", "US"],
  lenafischer: ["Munich", "DE"],
  priyar: ["Toronto", "CA"],
  kwame: ["Manchester", "GB"],
  jiwoo: ["Seoul", "KR"],
  elenap: ["Philadelphia", "US"],
  claireb: ["Bristol", "GB"],
  marcob: ["Milan", "IT"],
  nadiah: ["Paris", "FR"],
  carmenontheroad: ["Phoenix", "US"],
  tylerb: ["Nashville", "US"],
  mianguyen: ["Austin", "US"],
  ellie808: ["Honolulu", "US"],
  benlarsen: ["Minneapolis", "US"],
  olliegrant: ["Edinburgh", "GB"],
  anacosta: ["Lisbon", "PT"],
  rohank: ["Mumbai", "IN"],
  helennovak: ["Chicago", "US"],
  waltjensen: ["Omaha", "US"],
  jadedraws: ["Pittsburgh", "US"],
  joannareyes: ["San Antonio", "US"],
  paolosantos: ["Dubai", "AE"],
  debcollins: ["Charlotte", "US"],
  oscarruns: ["Vancouver", "CA"],
};


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
  { handle: "waltjensen", name: "Walt Jensen", tz: "America/Chicago", avatar: "sand", agent: "virgil", style: "Old school. Short messages. Just tell me the number.", hours: [[6, 7], [19, 20]] },
  { handle: "jadedraws", name: "Jade Thompson", tz: "America/New_York", avatar: "lilac", agent: "muse", agentName: "Olive", style: "Practical. Freelance money is lumpy, so plan for lumpy months.", hours: [[9, 10], [20, 22]] },
  { handle: "joannareyes", name: "Joanna Reyes", tz: "America/Chicago", avatar: "peach", agent: "virgil", style: "Warm, but keep me organized. Two teenagers, four calendars.", hours: [[6, 7], [20, 22]] },
  { handle: "paolosantos", name: "Paolo Santos", tz: "Asia/Dubai", avatar: "sky", agent: "muse", agentName: "Tala", style: "Warm. I miss home, so help me keep the calls going.", hours: [[21, 23]] },
  { handle: "debcollins", name: "Deb Collins", tz: "America/New_York", avatar: "rose", agent: "virgil", style: "Straightforward. I'm 52 and stubborn, use it.", hours: [[6, 7], [18, 20]] },
  { handle: "tobyreid", name: "Toby Reid", tz: "Europe/London", avatar: "sky", agent: "muse", agentName: "Pip", style: "Correct my French, don't flatter it.", hours: [[7, 8], [20, 22]] },
  { handle: "marisol", name: "Marisol Vega", tz: "America/Los_Angeles", avatar: "peach", agent: "muse", agentName: "Saffron", style: "Hype me up, then tell me what to cook next.", hours: [[18, 21]] },
  { handle: "oscarruns", name: "Oscar", tz: "America/Vancouver", avatar: "sky", agent: "muse", style: "Direct. Give me the plan and hold me to it.", hours: [[6, 8], [17, 19]] },
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

const STEP_PHRASES = [
  "walked to the shops",
  "lunch walk",
  "two laps of the park after dinner",
  "the long way home",
  "rain jacket, worth it",
  "podcast walk",
  "took the stairs all day",
  "missed the bus, walked instead",
  "out with a friend",
  "paced the hallway for the last 900",
  "errands on foot",
  "walked through a long phone call",
  "late loop around the block to make it",
  "slow walk, sore legs",
  "sunset walk",
  "headphones off, just walking",
];

function stepsNote({ m, rng }: NoteCtx): string {
  const r = rng.next();
  if (r < 0.35) return "";
  const steps = (rng.chance(0.12) ? rng.int(15000, 23000) : rng.int(10050, 14500)).toLocaleString("en-US");
  const phrase = m.places && rng.chance(0.5) ? rng.pick(m.places) : rng.pick(STEP_PHRASES);
  if (r < 0.6) return `${steps} steps`;
  if (r < 0.9) return `${steps} · ${phrase}`;
  return phrase.charAt(0).toUpperCase() + phrase.slice(1) + ".";
}

const SCREEN_PHRASES = [
  "phone charged in the hallway",
  "read instead of scrolling",
  "mostly maps and messages",
  "left it at home for the walk",
  "grayscale is weirdly effective",
  "deleted the app again",
  "picked it up out of habit, put it back",
  "long call home, worth every minute",
  "news on the laptop instead",
  "app limit kicked in at 9, let it",
  "cooked from a paper recipe",
  "quiet evening, good evening",
  "alarm clock by the bed, phone in the kitchen",
  "lots of photos at a birthday, still under",
  "group chat muted after 8",
];

function screenNote({ rng }: NoteCtx): string {
  const r = rng.next();
  if (r < 0.3) return "";
  const min = rng.int(35, 118);
  const time = min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}` : `${min} min`;
  const phrase = rng.pick(SCREEN_PHRASES);
  if (r < 0.55) return time;
  if (r < 0.9) return `${time} · ${phrase}`;
  return phrase.charAt(0).toUpperCase() + phrase.slice(1) + ".";
}

const MEDITATION_NOTES = [
  "Ten minutes before coffee. My mind was a pinball machine the whole time.",
  "Body scan in bed. Made it to the knees awake.",
  "Counted breaths to ten and started over about thirty times. Apparently that's the practice.",
  "Sat by the open window. Birds, a scooter, a neighbour's radio.",
  "Walking meditation to the station. Felt every step on the cold pavement.",
  "Kept planning tomorrow's meeting. Noticed it, came back. Again and again.",
  "First time the ten minutes felt short.",
  "Sat in the car before going into work.",
  "Headache today. Just breathed and didn't try to fix anything.",
  "Loving-kindness for the first time. Wishing myself well felt awkward.",
  "Late. Ten minutes on the bathroom floor because it was the only quiet room.",
  "Noticed my jaw was clenched. It's always clenched.",
  "Twelve minutes. The timer went and I kept going.",
  "Restless. Opened my eyes three times to check the timer.",
  "Tried noting: thinking, hearing, thinking, itching.",
  "Sat after an argument. Didn't fix it, but I went back calmer.",
  "Rain on the window the whole time. Easiest sit in weeks.",
  "Dozed off for a minute, so I did the last five again.",
  "Box breathing before a hard phone call.",
  "Sat on a bench in the park. Cold, clear, good.",
  "Guided session on sleep. Long exhale, longer than the inhale.",
  "Mind was quiet for maybe three breaths in a row. A record.",
  "Hotel room. Folded the duvet into a cushion.",
  "Noticed the urge to grab my phone the second the timer ended.",
  "One word on each out-breath: here. Worked better than counting.",
  "Sat right after waking, before the day could get in.",
  "Sadness came up. Let it. Ten minutes felt long.",
  "Couldn't settle until minute seven. Then it was fine.",
  "Second sit of the day, just because.",
  "Eyes open, looking at a candle. Easier than closing them.",
  "Breath at the nostrils: cool in, warm out.",
  "Long day. Those ten minutes were the only part that was mine.",
  "Heard the fridge hum for the first time in years.",
  "No app today, just a kitchen timer.",
  "Sore back. Did it lying on the floor.",
  "Thought about nothing for a moment. Then thought about how I'd thought about nothing.",
  "Sat before a job interview. Hands stopped shaking.",
  "The neighbours were drilling. Made the drill the thing I paid attention to.",
];

const DINNER_NOTES = [
  "Nobody rushed off. We sat for an hour after the plates were empty.",
  "Leftovers, and the best conversation of the week.",
  "Soup and bread. Quiet, in a good way.",
  "Everyone was tired. Ate together anyway and felt better for it.",
  "Talked about the news for a bit, then about nothing, which was better.",
  "Somebody told a story I'd never heard before.",
  "Late dinner, almost nine. Worth waiting for.",
  "Long argument about the best pasta shape. No winner.",
  "Tried a new recipe. Mixed reviews, empty plates.",
  "Candles on the table for no reason. Stayed for dessert.",
  "Short dinner, but everyone was there.",
  "Laughed about an old holiday photo until the food went cold.",
  "Went around the table: best and worst part of the day.",
  "Ate outside while it was still warm enough.",
  "A hard topic came up. We stayed with it.",
  "Phones in a basket by the door. Nobody asked for them back.",
  "Planned the next one before this one was over.",
  "Breakfast for dinner. Pancakes at 7pm feel like breaking a rule.",
];

const SPANISH_NOTES = [
  "Rolled my first r. Then couldn't do it again for an hour.",
  "Ser vs estar. I'm told it gets easier.",
  "Duolingo at lunch. The owl is relentless.",
  "An episode of a Spanish show with Spanish subtitles. Caught maybe a fifth.",
  "Learned the days of the week. Miércoles is my favourite word now.",
  "Flashcards before bed. The food words are sticking.",
  "Talked through my day out loud on the way home. Lots of eh, bueno.",
  "Coffee Break Spanish while making dinner.",
  "Wrote five sentences about my family. The app marked two of them right.",
  "Numbers to a hundred. Sesenta and setenta keep swapping places.",
  "Read a menu out loud at a Mexican place. They answered in Spanish. I nodded a lot.",
  "Shadowed a 2-minute podcast clip until I sounded less like a robot.",
  "Learned me gustaría. I would like. Polite and useful.",
  "Noun genders. La mano, el día. Who decided this.",
  "Past tense review. Fui, fuiste, fue.",
  "Looked up every word of a song a coworker likes.",
  "Directions: a la derecha, a la izquierda, todo recto.",
  "Changed my phone's language to Spanish. Regret it a little.",
  "Estoy aprendiendo español. I'm learning Spanish. Said it to the mirror ten times.",
  "The subjunctive turned up in a podcast. Closed the app.",
  "Read a children's book with my coffee. Understood the whole plot, which was about a duck.",
  "Wrote my shopping list in Spanish.",
  "Slow news podcast on the commute. Got the weather and one headline.",
  "Tongue twister practice. Tres tristes tigres.",
  "Verb drills. Tener, poder, querer.",
  "Ordered at the Colombian bakery in Spanish. Café con leche, por favor. It worked.",
  "Listened to the same dialogue five times. The fifth time it slowed down.",
  "Learned embarazada means pregnant, not embarrassed. Glad it was the app that taught me.",
  "Practiced booking a table on the phone. Lots of numbers.",
  "False friends today: actual means current.",
  "Long session. Went back through every note from the month.",
  "Only had time for flashcards. Did them in line at the pharmacy.",
  "Described my morning in five sentences without notes.",
  "Tried thinking in Spanish on a walk. Ran out of words at the corner.",
  "Reflexive verbs. Me levanto, me ducho, me voy.",
  "Cooking video from Mexico City. Understood the ingredients, mostly.",
  "Por vs para. Read three explanations. Still guessing.",
];

const SAVINGS_NOTES = [
  "Skipped takeout twice this week and moved what it would have cost.",
  "Sold a jacket I never wore.",
  "Cashback from the card, straight in.",
  "Brought lunch every day this week.",
  "Birthday money from my aunt. In before I could spend it.",
  "Returned something I didn't need. The refund goes here.",
  "Cancelled a streaming service I forgot I had.",
  "No-spend weekend. Walked, cooked, read. Moved the difference.",
  "Sold my old phone.",
  "Coffee at home all week.",
  "Found a cheaper phone plan. The difference comes here every month now.",
  "Electric bill came in under budget.",
  "What was left of the grocery budget.",
  "Library instead of buying books this month.",
];

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
        replan: {
          daysAgo: 11,
          shiftWeeks: 0,
          reason: "The first video call with Lí's mother went better than planned. Calls go from once a month to every other Sunday, and each evening now ends with one line of the wedding toast. Same camps, same summit.",
          summary:
            "Helen's son marries Lí in Chengdu next October, and Helen wants to talk with Lí's parents for twenty minutes in Mandarin, and give a short toast at the wedding. Twenty-five minutes every evening after dinner, ending with one line of the toast. A lesson with Lin every Saturday morning, and a video call with Lí's mother every other Sunday.",
          cadence: "Every evening, 25 min. Lin on Saturdays, Lí's mother every other Sunday.",
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
        daysAgo: 228,
        items: [
          { label: "Wonderwall", note: "Of course it was Wonderwall. Capo 2. My flatmate has asked me to stop." },
          { label: "Horse with No Name", note: "Two chords. Felt like cheating, counts anyway." },
          { label: "Riptide", note: "The F chord still buzzes. Playing it anyway." },
          { label: "Stand by Me", note: "Played it for my nan on a video call. She sang along." },
          { label: "Free Fallin'" },
          { label: "Brown Eyed Girl", note: "Six songs, and the F barre rings clean now. Mostly." },
          { label: "Bad Moon Rising" },
          { label: "Creep", note: "The B to C change. Two weeks of it. Worth it." },
          { label: "Zombie" },
          { label: "Here Comes the Sun", note: "Capo 7. Played it at the pub's open mic. Ten songs, and real people clapped." },
          { label: "Ring of Fire" },
          { label: "Wonderful Tonight", note: "Played it at my sister's engagement party. Dad filmed it." },
          { label: "Hey There Delilah" },
          { label: "Something" },
          { label: "Blackbird", note: "Fifteen. Fingerpicking, three months on and off. My fingers finally know where to go." },
        ],
        plan: {
          summary:
            "Ollie had a guitar under his bed for six years. Fifteen minutes a night, a new song every two weeks, starting with four-chord songs and working up to barre chords by the autumn.",
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

  // ----- Steps -----
  {
    key: "steps",
    slug: "walk-10-000-steps-a-day",
    title: "Walk 10,000 steps a day",
    tagline: "Ten thousand steps on 300 days of the year. Every step counts, not just the walks.",
    description:
      "Walk 10,000 steps a day, and count the days you make it. The summit is 300 days: that leaves room for sick days, long flights and the odd day on the sofa.\n\n" +
      "Log once a day, after your phone or watch passes 10,000. Errands, stairs and pacing through phone calls all count. Put the number in the note if you like.",
    emoji: "running",
    theme: "teal",
    category: "fitness",
    metric: { name: "10,000-step days", unit: "days", target: 300, aggregation: "count" },
    camps: [
      { title: "First week of 10,000s", detail: "Seven days over 10,000. They don't have to be in a row.", target: 7, week: 2, emoji: "running" },
      { title: "A route of your own", detail: "30 days, and one regular walk you look forward to.", target: 30, week: 6, emoji: "map" },
      { title: "100 days", detail: "A hundred days over 10,000.", target: 100, week: 18, emoji: "flag" },
      { title: "Halfway: 150 days", detail: "Walking is just what you do now.", target: 150, week: 27, emoji: "camp" },
      { title: "225 days", detail: "Three quarters of the way, on foot.", target: 225, week: 40, emoji: "trophy" },
      { title: "300 days", detail: "Three hundred days of 10,000 steps.", target: 300, week: 52, emoji: "summit" },
    ],
    noteFor: stepsNote,
    members: [
      {
        handle: "graceoc",
        daysAgo: 74,
        pace: 0.84,
        gaps: [[44, 40]],
        places: ["the canal from Portobello to Baggot Street", "Sandymount Strand", "the pier at Dún Laoghaire", "Phoenix Park", "the Herbert Park loop"],
        beats: [
          { daysAgo: 74, note: "Day one. 10,312, and most of it was walking to the shop twice because I forgot the milk." },
          { daysAgo: 47, note: "Walking is the only thing that's helped this week. Out to the Bull Wall and back." },
          { daysAgo: 39, note: "Back after a few days I couldn't. Small loop, just over." },
          { daysAgo: 12, note: "The pier at Dún Laoghaire twice with my sister. 16,000, and we talked the whole way." },
        ],
        plan: {
          summary:
            "Grace sits at a desk all day and wants walking to be the one thing that happens no matter what. A walk on her lunch break most days, the canal on the way home, and a long one by the sea on Sundays. Missed days don't need making up: the summit has room for them.",
          cadence: "Every day. Lunch walk, and the canal home.",
        },
      },
      {
        handle: "weizhang",
        daysAgo: 66,
        pace: 0.88,
        hours: [[21, 23]],
        places: ["East Coast Park at 6:30", "the Rail Corridor", "the MacRitchie boardwalk", "the Marina Bay loop", "the Bishan park connector"],
        beats: [
          { daysAgo: 66, note: "10,480. Walked from Tanjong Pagar to the office instead of changing lines." },
          { daysAgo: 30, note: "Rain all day. 10,050, from laps of the office floor at lunch." },
          { daysAgo: 8, note: "Rail Corridor, Buona Vista to Hillview. 21,300." },
        ],
        plan: {
          summary:
            "Wei works long days at a desk, and Singapore's heat rules out a midday walk. The plan is a 6:30 walk at East Coast Park before work, getting off the MRT one stop early, and a long walk on Sundays along the Rail Corridor.",
          cadence: "Daily. 6:30 walk, and one stop early on the MRT.",
        },
      },
      {
        handle: "waltjensen",
        daysAgo: 52,
        pace: 0.93,
        gaps: [[21, 19]],
        hours: [[19, 21]],
        places: ["around Lake Nokomis", "the Minnehaha Creek trail", "my old route on 38th Street", "the skyway downtown", "the mall loop at Southdale"],
        beats: [
          { daysAgo: 52, note: "Carried mail for 31 years. Retired in June. Turns out my legs still want the route." },
          { daysAgo: 33, note: "Walked my old route on 38th Street. Three people waved. One asked if I was back." },
          { daysAgo: 18, note: "Head cold, three days off. Back out. Short and slow." },
          { daysAgo: 4, note: "First morning in the mall at Southdale with the 7am walkers. They have a club. I'm in it now." },
        ],
        plan: {
          summary:
            "Walt walked 15 miles a day with a mailbag for 31 years and retired in June. He wants to keep his legs and his routine. Two walks a day, one in the morning and one after supper, around Lake Nokomis while the weather holds, and the indoor mall loop once it doesn't.",
          cadence: "Twice a day. Mall loop in deep winter.",
        },
      },
      {
        handle: "marcob",
        daysAgo: 44,
        pace: 0.74,
        gaps: [[33, 17]],
        places: ["along the Naviglio Grande", "Parco Sempione", "the walk home from Porta Venezia", "Monte Stella", "Città Studi to the Duomo"],
        beats: [
          { daysAgo: 44, note: "Joined to stop taking the tram for four stops. 10,400, mostly the walk home." },
          { daysAgo: 16, note: "Deadline over. Walked from the office to the Duomo and kept going." },
        ],
        plan: {
          summary:
            "Marco wants to stop taking the tram for short trips. He walks home from work most evenings and takes a long walk along the canals on Sundays. Busy weeks are allowed to be busy.",
          cadence: "Walk home from work. Long walk on Sundays.",
        },
        replan: {
          daysAgo: 16,
          shiftWeeks: 2,
          reason: "A work deadline took two and a half weeks, and the walks with it. Camps moved back two weeks; the walk home stays the base.",
        },
      },
      {
        handle: "samwhit",
        daysAgo: 33,
        pace: 0.7,
        places: ["the stroller loop around Echo Park Lake", "the farmers market and back on foot", "around the block twice after bedtime"],
        beats: [
          { daysAgo: 33, note: "The stroller walk after dinner is official now." },
          { daysAgo: 10, note: "She walked the last block herself. Slowest 400 steps of my life." },
        ],
        plan: {
          summary:
            "Sam has a toddler and a long commute, so the walks fit around both: a stroller walk after dinner, a lunch walk on office days, and the farmers market on foot on Saturdays.",
          cadence: "Most days. Stroller walk after dinner.",
        },
      },
    ],
    openQuests: [
      q("Get off one stop early", "Bus, train or tram. Every day this week.", "daily", 10),
      q("A 10-minute walk after dinner", "Before the sofa. Every evening this week.", "daily", 10),
      q("Walk somewhere you'd normally drive", "The shop, the post office, a friend's place. Leave the keys at home.", "weekly", 20),
      q("Find a rainy-day route", "A mall, a museum, a covered market or an office stairwell. Walk it once.", "one_off", 15),
      q("Take one call on foot", "Any call that doesn't need a screen.", "weekly", 15),
      q("Check your steps at 6pm", "Under 6,000? Plan the evening walk now, not at 10.", "daily", 10),
      q("Walk with someone", "A friend, a neighbour, your kid, a dog.", "one_off", 15),
      q("Map a 5 km loop from your door", "One you can walk in 45 minutes without thinking.", "one_off", 15),
      q("Walk somewhere new", "A street, a park or a path you've never walked. An hour, no destination.", "weekly", 20),
      q("Walk 20,000 steps in one day", "A half-day walk somewhere new, with a lunch stop.", "boss", 70),
      q("Seven days in a row over 10,000", "No gaps this week, even if the last one is laps of the kitchen.", "boss", 80),
    ],
    doneQuest: (_log, rng) =>
      rng.pick([
        q("Walk one errand you'd normally drive to", "The shop, the post office, the library.", "weekly", 20),
        q("Lunch walk, three days this week", "Twenty minutes, phone in your pocket.", "weekly", 20),
        q("Get off one stop early", "Every day this week.", "daily", 10),
        q("Evening loop after dinner", "Ten minutes before the sofa.", "daily", 10),
        q("Walk with someone", "A friend, a neighbour, your kid, a dog.", "one_off", 15),
        q("Take the stairs all day", "Every flight, every time.", "daily", 10),
        q("Find a rainy-day route", "Somewhere indoors you can walk 3,000 steps.", "one_off", 15),
        q("A long walk this weekend", "Two hours somewhere new, no rush.", "weekly", 25),
        q("Take one call on foot", "Any call that doesn't need a screen.", "weekly", 15),
        q("Five days over 10,000 this week", "Plan the walks on Sunday night.", "weekly", 25),
        q("Walk 20,000 steps in one day", "A half-day walk with a lunch stop.", "boss", 70),
      ]),
    space:
      "A park map at dawn in teal and soft green: winding footpaths, a pond, a few trees. Lead with the days everyone together has made 10,000 steps, as one big number. Then a 6-week strip of small footprints, one per day, darker when more people made it that day. Give each member a footpath across the map with their days toward 300 marked along it. End with the newest notes as little signposts: they often carry the day's step count and where people walked.",
  },

  // ----- Savings -----
  {
    key: "savings",
    slug: "save-three-months-of-expenses",
    title: "Save three months of expenses",
    tagline: "A cushion of three months, built one transfer at a time.",
    description:
      "Build an emergency fund that covers three months of rent, food and bills, kept in its own account and touched only for real emergencies.\n\n" +
      "The summit is $9,000: three months at $3,000. If your months cost more, keep going past it. Log each deposit in dollars, converting at the day's rate if you save in another currency.",
    emoji: "money",
    theme: "sand",
    category: "money",
    metric: { name: "amount saved", unit: "dollars", target: 9000, aggregation: "sum" },
    camps: [
      { title: "A $500 buffer", detail: "Enough for a car repair or a vet bill, in its own account.", target: 500, week: 4, emoji: "money" },
      { title: "Transfers on autopilot", detail: "$1,500 saved, and a transfer that runs on payday without you.", target: 1500, week: 10, emoji: "calendar" },
      { title: "One month covered", detail: "$3,000: rent, food and bills for a month.", target: 3000, week: 18, emoji: "shield" },
      { title: "Halfway: $4,500", detail: "Six weeks of breathing room.", target: 4500, week: 26, emoji: "camp" },
      { title: "Two months covered", detail: "$6,000. Time to think if work goes wrong.", target: 6000, week: 35, emoji: "flag" },
      { title: "Three months covered", detail: "$9,000 that's there when you need it.", target: 9000, week: 52, emoji: "summit" },
    ],
    notes: SAVINGS_NOTES,
    shortNotes: ["Round-ups", "Cashback", "No-spend day", "Brought lunch", "Skipped takeout"],
    members: [
      {
        handle: "tylerb",
        daysAgo: 200,
        weekdays: [0.04, 0.02, 0.02, 0.02, 0.02, 0.03, 0.08],
        amount: [20, 75],
        ritual: {
          weekday: 5,
          every: 2,
          amount: 300,
          hour: 18,
          notes: [
            "Payday. Rent and bills paid, the rest moved.",
            "Payday transfer.",
            "",
            "Payday. Didn't even have to think about it.",
            "Payday transfer.",
            "",
          ],
        },
        beats: [
          { daysAgo: 200, value: 250, note: "The transmission went in January and lived on a credit card until April. Never again. Opened a separate account today." },
          { daysAgo: 41, value: 180, note: "Sold the old mountain bike on Marketplace." },
          { daysAgo: 17, value: 120, note: "Refereed two youth games on the weekend. That money comes here now." },
        ],
        plan: {
          summary:
            "Tyler's car died in January and the repair sat on a credit card for three months. Every other Friday, when he's paid, whatever is left after rent and bills (usually about $300) moves to a separate account, and anything extra goes in too: refereeing money, things he sells. Road trips come out of a different pot.",
          cadence: "Every other Friday, on payday. Extras when they come.",
        },
      },
      {
        handle: "jordanruns",
        daysAgo: 63,
        weekdays: [0.03, 0, 0.03, 0.03, 0.03, 0.03, 0.05],
        amount: [25, 90],
        ritual: {
          weekday: 1,
          amount: 150,
          hour: 6,
          notes: ["Monday sweep.", "", "What was left of last week's budget.", "Monday sweep. Spreadsheet says on pace.", "", "Monday sweep.", "Monday sweep. Checked the gap to the next camp."],
        },
        beats: [
          { daysAgo: 63, value: 400, note: "Moved what was sitting in checking to start. Spreadsheet built, obviously." },
          { daysAgo: 35, value: 165, note: "Swept what was left in checking at the end of the month." },
          { daysAgo: 28, value: 210, note: "Sold my old GPS watch." },
          { daysAgo: 5, value: 140, note: "Month-end sweep." },
        ],
        plan: {
          summary:
            "Jordan likes a spreadsheet and hates surprises. Every Monday before he's awake, whatever is left of last week's budget (usually about $150) moves to a high-yield account, and at the end of each month he sweeps in what's left in checking. He checks the gap to the next camp on Sundays.",
          cadence: "Every Monday. Month-end sweep.",
        },
      },
      {
        handle: "jadedraws",
        daysAgo: 55,
        weekdays: [0.04, 0.05, 0.05, 0.05, 0.05, 0.05, 0.04],
        amount: [20, 60],
        beats: [
          { daysAgo: 55, value: 300, note: "Freelance means some months are great and some are scary. New rule from today: 20% of every invoice goes straight to savings." },
          { daysAgo: 47, value: 440, note: "The bakery rebrand invoice cleared. Moved 20% before I could think about it." },
          { daysAgo: 31, value: 160, note: "Slow month. Small invoice, same rule." },
          { daysAgo: 22, value: 900, note: "The big one cleared. Brochure and website for a dental practice." },
          { daysAgo: 9, value: 360, note: "Paid late, but paid." },
          { daysAgo: 2, value: 240, note: "Logo job for a friend's coffee cart. 20% in." },
        ],
        plan: {
          summary:
            "Jade is a freelance designer, so her income comes in lumps. Twenty percent of every invoice moves to savings the day it clears, and in months with no invoices she aims for $100 from trimming spending. Quiet months are expected and planned for.",
          cadence: "The day each invoice clears.",
        },
        replan: {
          daysAgo: 30,
          shiftWeeks: 2,
          reason: "A client paid six weeks late. Camps moved back two weeks; the 20% rule stays.",
        },
      },
      {
        handle: "sofiam",
        daysAgo: 48,
        weekdays: [0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03],
        amount: [20, 50],
        ritual: {
          weekday: 1,
          every: 4,
          amount: 540,
          hour: 13,
          notes: ["Salary in. €500 to the fund, converted at today's rate.", "Payday. €500 moved.", "€500 to the fund. The dollar moved again, so a slightly different number."],
        },
        beats: [{ daysAgo: 48, value: 650, note: "I save in euros and log dollars at the day's rate, so the group's numbers add up. €600 to start." }],
        plan: {
          summary:
            "Sofía lives in Madrid and saves in euros. €500 moves to a separate account on payday each month, plus whatever is left of her monthly budget at the end. She logs dollars at the day's rate so the group's numbers add up.",
          cadence: "Monthly, on payday.",
        },
      },
      {
        handle: "benlarsen",
        daysAgo: 12,
        pace: 0,
        beats: [
          { daysAgo: 12, value: 400, note: "Starting with $400." },
          { daysAgo: 5, value: 200, note: "Payday. $200." },
        ],
        plan: {
          summary: "Ben's furnace is 22 years old and he'd rather be ready when it goes. $200 every payday. Nothing fancy.",
          cadence: "Every payday.",
        },
      },
    ],
    openQuests: [
      q("Open a separate savings account", "One with no card attached. Name it after what it's for.", "one_off", 20),
      q("Set up an automatic transfer for payday", "Even $25. The point is that it happens without you.", "one_off", 25),
      q("Add up one month of real spending", "Rent, food, bills, transport. From last month's statements, not a guess.", "one_off", 25),
      q("Sell one thing you don't use", "Marketplace, a yard sale, a friend. Straight into the fund.", "weekly", 20),
      q("A no-spend weekend", "Only what's already in the fridge. Move what you'd have spent.", "weekly", 25),
      q("Cancel one subscription", "Move this month's price into savings.", "one_off", 15),
      q("Compare your account's interest rate", "Check two other banks. Switch if yours pays almost nothing.", "one_off", 15),
      q("Cook every dinner this week", "No delivery. Move the difference on Sunday.", "weekly", 25),
      q("Round up this week's spending", "Round every purchase to the next $10 and move the difference.", "weekly", 15),
      q("Write down what counts as an emergency", "Job loss, health, car, home. A sale isn't one.", "one_off", 15),
      q("Save $1,000 in one month", "Payday transfer plus every extra. Plan it on the 1st.", "boss", 80),
    ],
    doneQuest: (_log, rng) =>
      rng.pick([
        q("Move money the day it comes in", "Before anything else gets paid.", "weekly", 20),
        q("Sell one thing you don't use", "Straight into the fund.", "weekly", 20),
        q("A no-spend weekend", "Move what you'd have spent.", "weekly", 25),
        q("Cancel one subscription", "Move this month's price into savings.", "one_off", 15),
        q("Cook every dinner this week", "Move the difference on Sunday.", "weekly", 25),
        q("Round up this week's spending", "To the next $10, and move the difference.", "weekly", 15),
        q("Bring lunch four days this week", "Move what the café would have cost.", "weekly", 20),
        q("Put a windfall straight in", "A refund, a gift, a bonus: in before it's spent.", "one_off", 20),
        q("Save $1,000 in one month", "Payday transfer plus every extra.", "boss", 80),
      ]),
    space:
      "A kitchen shelf of glass jars in warm sand and honey tones, one jar per member, filling with gold coins toward their own $9,000, with faint lines on the glass at one, two and three months. Above the shelf, the total everyone has saved together as one big number, with no progress bar: three months is each person's own goal, not the group's. Below, a bar chart of deposits per week for the last 10 weeks, and the newest notes as small paper tags tied to the jars.",
  },

  // ----- Meditation -----
  {
    key: "meditate",
    slug: "meditate-10-minutes-a-day",
    title: "Meditate 10 minutes a day",
    tagline: "Ten minutes, most days of the year. Any style, any app, any chair.",
    description:
      "Sit for ten minutes a day. Breathing, a body scan, a guided app, a slow walk: any practice counts if it's ten minutes and your attention is on it.\n\n" +
      "Log once on each day you've done your ten minutes. The summit is 330 days, which leaves about a month for the days life wins.",
    emoji: "mindful",
    theme: "lilac",
    category: "mindful",
    metric: { name: "days meditated", unit: "days", target: 330, aggregation: "count" },
    camps: [
      { title: "Seven sits", detail: "Seven days with ten minutes. The same time each day helps.", target: 7, week: 2, emoji: "mindful" },
      { title: "A spot of your own", detail: "30 days, and one place at home that's just for sitting.", target: 30, week: 5, emoji: "seedling" },
      { title: "100 days", detail: "A hundred days of ten minutes.", target: 100, week: 17, emoji: "flag" },
      { title: "Halfway: 165 days", detail: "Try one longer sit: twenty minutes.", target: 165, week: 26, emoji: "camp" },
      { title: "250 days", detail: "Ten minutes is just part of the day now.", target: 250, week: 40, emoji: "sparkles" },
      { title: "330 days", detail: "Three hundred and thirty days of sitting still.", target: 330, week: 52, emoji: "summit" },
    ],
    notes: MEDITATION_NOTES,
    shortNotes: ["Breath counting", "Body scan", "Guided, 10 min", "Insight Timer", "Headspace", "Walking meditation", "Before coffee", "Before bed", "Box breathing"],
    members: [
      {
        handle: "yukitanaka",
        daysAgo: 73,
        pace: 0.9,
        ritual: {
          weekday: 6,
          amount: 1,
          hour: 8,
          notes: [
            "Saturday zazen at the temple near my station.",
            "Zazen. Forty minutes, legs asleep by the end.",
            "Temple zazen. The monk straightened my back with one finger.",
            "",
            "Zazen in the rain. Only four of us came.",
            "Zazen. The bell at the end sounded different today. Or I did.",
            "",
          ],
        },
        beats: [
          { daysAgo: 73, note: "Starting small. Ten minutes after my bath, before bed." },
          { daysAgo: 40, note: "Falling asleep has been easier since I started this." },
          { daysAgo: 11, note: "Sat on the train home with my eyes closed and missed my stop. Worth it." },
        ],
        plan: {
          summary:
            "Yuki wants a calmer end to long workdays. Ten minutes after her bath each night, on a folded blanket by the window, with a timer and no app. On Saturday mornings, zazen at the temple near her station.",
          cadence: "Nightly, 10 min after the bath. Zazen on Saturdays.",
        },
      },
      {
        handle: "nadiah",
        daysAgo: 61,
        pace: 0.82,
        beats: [
          { daysAgo: 61, note: "Ten minutes on the 7:42 to La Défense, eyes closed, headphones in, nothing playing." },
          { daysAgo: 30, note: "Tried sitting at home instead of on the train. Harder. The train has a better rhythm." },
          { daysAgo: 6, note: "My mother asked what I do every morning with my eyes shut. Taught her the breath count." },
        ],
        plan: {
          summary:
            "Nadia meditates on the train to work, ten minutes with headphones in and nothing playing, and sits longer at home on weekends. She writes one line about each sit in her commonplace book.",
          cadence: "Weekdays on the train, weekends at home.",
        },
      },
      {
        handle: "emmal",
        daysAgo: 50,
        weekdays: [0.95, 0.7, 0.75, 0.7, 0.75, 0.65, 0.7],
        beats: [
          { daysAgo: 50, note: "Candle, blanket, ten minutes. Very me." },
          { daysAgo: 20, note: "Dark by four now. Sitting by candlelight feels right." },
        ],
        plan: {
          summary:
            "Emma wants ten quiet minutes at the end of the day. She sits on the sofa with a candle and a guided session from Insight Timer, and on Sundays she does twenty minutes with tea after.",
          cadence: "Evenings, 10 min. Twenty on Sundays.",
        },
      },
      {
        handle: "chloedubois",
        daysAgo: 36,
        pace: 0.74,
        gaps: [[20, 17]],
        beats: [
          { daysAgo: 36, note: "Night-shift brain needs this. Ten minutes in the car before I drive home." },
          { daysAgo: 16, note: "Four nights in a row and no sits. Back. Did it on the bedroom floor before sleeping." },
          { daysAgo: 5, note: "Body scan after a rough shift. Slept six hours straight, which never happens." },
        ],
        plan: {
          summary:
            "Chloé works night shifts. On shift days she sits for ten minutes in her car before driving home; on days off she sits in the morning before coffee. Shift weeks are allowed to be patchy.",
          cadence: "After every shift, and mornings off.",
        },
        replan: {
          daysAgo: 16,
          shiftWeeks: 0,
          reason: "Four night shifts in a row and the car sits kept getting skipped. Moved the shift-day sit to the bedroom floor before sleep. Same camps.",
          summary:
            "Chloé works night shifts. On shift days she sits for ten minutes on the bedroom floor before she sleeps; on days off she sits in the morning before coffee. Shift weeks are allowed to be patchy.",
          cadence: "Before sleep on shift days, mornings off.",
        },
      },
      {
        handle: "arjunm",
        daysAgo: 15,
        pace: 0.72,
        noteRate: 0.15,
        beats: [
          { daysAgo: 15, note: "Can I sit still for ten minutes? We're about to find out." },
          { daysAgo: 4, note: "First sit without checking the timer. Disproportionately proud of this." },
        ],
        plan: {
          summary:
            "Arjun is fidgety and knows it. Ten minutes with a guided session every night right after brushing his teeth, so it hangs on a habit he already has, and no timer-free sits until guided ones feel easy.",
          cadence: "Nightly, after brushing teeth.",
        },
      },
    ],
    openQuests: [
      q("Same time, same place, all week", "Pick a spot and a time that already exist in your day.", "weekly", 20),
      q("Sit without an app once", "Just a timer. Notice what's different.", "one_off", 15),
      q("Try a body scan", "Toes to head, ten minutes. Lying down is fine.", "weekly", 15),
      q("Count breaths to ten", "Start over each time you lose count. Every day this week.", "daily", 10),
      q("A walking meditation", "Ten minutes, slow, attention on your feet.", "weekly", 15),
      q("Sit before you check your phone", "First thing after waking, every day this week.", "daily", 10),
      q("Write one line after each sit", "What was loud today? One line, then close the notebook.", "weekly", 15),
      q("Try loving-kindness", "Ten minutes: yourself, someone you love, someone difficult.", "weekly", 20),
      q("Set up a corner for sitting", "A cushion or a chair, a blanket, nothing else.", "one_off", 15),
      q("A 20-minute sit", "Once this week. Notice where it gets hard.", "boss", 60),
      q("Seven days in a row", "Ten minutes, every day this week, no exceptions.", "boss", 70),
    ],
    doneQuest: (_log, rng) =>
      rng.pick([
        q("Same time, same place, all week", "Hang it on something you already do.", "weekly", 20),
        q("Sit without an app once", "Just a timer.", "one_off", 15),
        q("Try a body scan", "Toes to head. Lying down is fine.", "weekly", 15),
        q("Count breaths to ten", "Start over each time you lose count.", "daily", 10),
        q("A walking meditation", "Ten minutes, attention on your feet.", "weekly", 15),
        q("Sit before you check your phone", "First thing after waking.", "daily", 10),
        q("Write one line after each sit", "What was loud today?", "weekly", 15),
        q("Try loving-kindness", "Yourself, someone you love, someone difficult.", "weekly", 20),
        q("A 20-minute sit", "Once this week.", "boss", 60),
      ]),
    space:
      "A quiet room at twilight in soft lilac: a cushion, a low window, one candle, lots of empty space. Lead with the days everyone has sat together as one calm number, with no progress bar: 330 days is each person's own goal, not the group's. Then a 6-week grid of small circles, one per day, glowing brighter the more people sat that day. Give each member a string of beads, one bead per day sat, toward their own 330. Show the newest notes as journal lines in a light serif.",
  },

  // ----- Family dinners -----
  {
    key: "dinners",
    slug: "share-100-dinners-with-family",
    title: "Share 100 dinners with family",
    tagline: "About two a week. Sit down together and stay for the whole meal.",
    description:
      "Have 100 dinners with family this year, about two a week. A dinner counts when you sit down together and stay for the whole meal, with no other screens at the table. Takeout counts. Video dinners with family far away count. Family is whoever you call family.\n\n" +
      "Log each dinner, with a line about who was there or what you talked about.",
    emoji: "cheer",
    theme: "peach",
    category: "social",
    metric: { name: "family dinners", unit: "dinners", target: 100, aggregation: "count" },
    camps: [
      { title: "First five dinners", detail: "Five dinners together, phones in another room.", target: 5, week: 3, emoji: "cooking" },
      { title: "A standing night", detail: "15 dinners, and one night a week that's always family dinner.", target: 15, week: 8, emoji: "calendar" },
      { title: "Invite someone you miss", detail: "25 dinners, one of them with a grandparent, a cousin or an old friend who's family.", target: 25, week: 13, emoji: "letter" },
      { title: "Halfway: 50 dinners", detail: "Fifty evenings around a table.", target: 50, week: 26, emoji: "camp" },
      { title: "Someone else cooks", detail: "75 dinners. One cooked by a kid, a partner, or a parent who never cooks.", target: 75, week: 39, emoji: "highfive" },
      { title: "100 dinners", detail: "A hundred dinners together.", target: 100, week: 52, emoji: "summit" },
    ],
    notes: DINNER_NOTES,
    shortNotes: ["Pasta night", "Soup and bread", "Leftovers", "Takeout, on real plates", "Tacos", "Rice and stew", "Roast chicken", "Curry"],
    members: [
      {
        handle: "joannareyes",
        daysAgo: 77,
        weekdays: [0, 0.2, 0.35, 0.12, 0.3, 0.35, 0.25],
        hours: [[20, 22]],
        ritual: {
          weekday: 0,
          amount: 1,
          hour: 20,
          notes: [
            "Sunday dinner. Maddie made the rice, Eli made a mess.",
            "Sunday. Enchiladas, and Eli told us about his science project without being asked.",
            "Sunday dinner with Dan's mom. She brought pan dulce for after.",
            "",
            "Sunday. Phones in the basket. Maddie lasted the whole meal and didn't complain once.",
            "Sunday caldo. First cold evening of the year.",
            "Sunday. Eli asked if a friend could stay for dinner. Of course.",
            "",
            "Sunday. We planned the holidays and nobody fought about it.",
            "Sunday dinner. Dan told the story of how we met, badly, and the kids corrected him.",
            "Sunday. Tamales from the place on Zarzamora, and a long talk about colleges.",
          ],
        },
        beats: [
          { daysAgo: 77, note: "Two teenagers, a volleyball schedule and a husband on night shifts. We were eating in four different rooms. Starting with Sundays." },
          { daysAgo: 52, note: "First weeknight with all four of us since school started. Tacos. Nobody looked at a phone." },
          { daysAgo: 29, note: "Maddie cooked for the first time. Spaghetti, slightly crunchy. We ate every bite." },
          { daysAgo: 7, note: "Dan switched to day shifts. Weeknight dinners are suddenly easy." },
        ],
        after: { daysAgo: 7, weekdays: [0, 0.4, 0.55, 0.3, 0.5, 0.45, 0.3], amount: [1, 1] },
        plan: {
          summary:
            "Joanna's family eats in four different rooms most nights: two teenagers with practice and part-time jobs, and a husband on shifts. The plan starts with Sunday dinner every week, no exceptions, then adds one weeknight that fits everyone's schedule, with the kids picking the menu on that one.",
          cadence: "Every Sunday, plus one weeknight.",
        },
        replan: {
          daysAgo: 7,
          shiftWeeks: 0,
          reason: "Dan moved to day shifts, so weeknights are open. Two weeknights instead of one, same camps.",
          summary:
            "Joanna's family used to eat in four different rooms. Now Dan is on day shifts, so the plan is Sunday dinner every week, no exceptions, plus two weeknights that fit around volleyball and work, with the kids picking the menu on one of them.",
          cadence: "Every Sunday, plus two weeknights.",
        },
      },
      {
        handle: "helennovak",
        daysAgo: 58,
        weekdays: [0.35, 0.1, 0.1, 0.12, 0, 0.2, 0.85],
        hours: [[19, 22]],
        ritual: {
          weekday: 4,
          amount: 1,
          hour: 21,
          notes: [
            "Thursday dinner with Peter and Lí. Lí taught me to say this is delicious: hǎo chī.",
            "Peter and Lí came over. We talked about the wedding guest list for two hours.",
            "Thursday. Lí brought her dad's chili oil. Frank's eyes watered and he kept eating.",
            "",
            "Thursday dinner. Peter did the dishes without being asked.",
            "Thursday. We looked at venue photos from Chengdu on the laptop after dessert.",
            "",
            "Thursday. Lí and I made dumplings together. Mine looked like small potatoes.",
          ],
        },
        beats: [
          { daysAgo: 58, note: "Peter and Lí moved twenty minutes away. Thursdays are ours now, and I'm counting them." },
          { daysAgo: 20, note: "Dinner by video with Lí's parents in Chengdu. Our dinner, their breakfast. Everyone waved a lot." },
        ],
        plan: {
          summary:
            "Helen wants her son Peter and his fiancée Lí at her table every week in the year before their wedding. Thursday dinner is fixed, Frank cooks on Saturdays, and once a month the whole family eats by video with Lí's parents in Chengdu: dinner in Chicago, breakfast in Chengdu.",
          cadence: "Thursdays with Peter and Lí. Saturdays at home.",
        },
      },
      {
        handle: "marcob",
        daysAgo: 41,
        weekdays: [0, 0.05, 0.1, 0.12, 0.05, 0.1, 0.15],
        gaps: [[31, 25]],
        ritual: {
          weekday: 0,
          amount: 1,
          hour: 22,
          notes: [
            "Sunday at my parents' in Monza. Risotto, and my father's opinions on the government.",
            "Sunday dinner. My sister brought her new boyfriend. He survived.",
            "Sunday. Mamma made ossobuco and sent me home with two containers.",
            "",
            "Sunday at my parents'. Papà fell asleep at the table at ten. Tradition.",
            "Sunday. Nonna came too. She asked twice when I'm getting married.",
          ],
        },
        beats: [
          { daysAgo: 41, note: "Joined because I eat at my parents' most Sundays and I want that to stay true." },
          { daysAgo: 18, note: "Cooked for my sister in my tiny flat. Two chairs, one of them is a stool." },
        ],
        plan: {
          summary: "Marco has dinner at his parents' in Monza most Sundays and wants to keep it that way. Sundays are the base, plus a weeknight with his sister when their schedules line up.",
          cadence: "Sundays in Monza. A weeknight with his sister when it works.",
        },
      },
      {
        handle: "paolosantos",
        daysAgo: 46,
        weekdays: [0, 0.08, 0.05, 0.25, 0.05, 0.15, 0.2],
        noteRate: 0,
        ritual: {
          weekday: 0,
          amount: 1,
          hour: 16,
          notes: [
            "Sunday video dinner with home. Their dinner, my late lunch. Mama made sinigang and showed me the pot.",
            "Video dinner. My niece fell asleep on Papa's shoulder halfway through.",
            "Sunday call. Everybody talked at once. Perfect.",
            "",
            "Video dinner. Lola joined from her room on my sister's tablet.",
            "Sunday. I cooked adobo from Mama's recipe while she cooked hers, and we ate together.",
            "Video dinner. Brownout in Quezon City halfway through, so they finished by candlelight.",
          ],
        },
        beats: [
          { daysAgo: 46, note: "I work in Dubai and my family is in Manila. We've done Sunday video calls for years. Now we eat during them, and I'm counting them." },
          { daysAgo: 25, note: "Dinner with my cousin Jun in Karama. Kare-kare from the Filipino place, almost like home." },
          { daysAgo: 12, note: "Booked my flight home for Christmas. Real dinners at a real table coming." },
        ],
        plan: {
          summary:
            "Paolo works in Dubai and his family lives in Manila. Sunday is a video dinner with everyone (their dinner, his late lunch), and his cousin Jun, who also lives in Dubai, comes over during the week when their shifts allow.",
          cadence: "Sunday video dinner. A weeknight with Jun.",
        },
      },
      {
        handle: "mianguyen",
        daysAgo: 20,
        weekdays: [0.6, 0.1, 0.15, 0.1, 0.1, 0.2, 0.3],
        hours: [[20, 22]],
        noteRate: 0.2,
        beats: [
          { daysAgo: 20, note: "Twelve-hour shifts mean I mostly eat in the car. My parents are 25 minutes away. Starting there." },
          { daysAgo: 6, note: "Phở at my parents'. Mom sent me home with the leftover broth, as always." },
        ],
        plan: {
          summary:
            "Mia works twelve-hour shifts, three or four a week. On her days off she drives to her parents' in Sugar Land for dinner, and once a week she eats with her brother in Austin over video.",
          cadence: "Days off, at her parents'.",
        },
      },
    ],
    openQuests: [
      q("Pick a standing dinner night", "One night a week that's always family dinner. Put it in everyone's calendar.", "one_off", 20),
      q("Phones in a basket", "By the door, every dinner this week.", "weekly", 20),
      q("Ask one question nobody's asked before", "Like: what did you change your mind about this year? Then listen to the whole answer.", "weekly", 15),
      q("Let someone else plan the menu", "A kid, a partner, a parent. You do the shopping.", "weekly", 20),
      q("Eat at the table, not the sofa", "Every dinner this week.", "weekly", 20),
      q("Two weeknight dinners this week", "Look at everyone's schedule on Sunday and find two nights.", "weekly", 25),
      q("Stay for dessert", "Even if dessert is an orange. Ten more minutes at the table.", "weekly", 15),
      q("Start a dinner question jar", "Everyone writes three questions. Pull one at each dinner.", "one_off", 15),
      q("Cook a recipe from your family", "Call whoever makes it best and ask them to talk you through it.", "boss", 50),
      q("Invite someone you haven't eaten with in a year", "A grandparent, a cousin, an aunt. Video counts if they're far.", "boss", 60),
    ],
    doneQuest: (_log, rng) =>
      rng.pick([
        q("Phones in a basket", "By the door, every dinner this week.", "weekly", 20),
        q("Two weeknight dinners this week", "Find two nights everyone is home.", "weekly", 25),
        q("Let someone else plan the menu", "You do the shopping.", "weekly", 20),
        q("Eat at the table, not the sofa", "Every dinner this week.", "weekly", 20),
        q("Ask one question nobody's asked before", "And listen to the whole answer.", "weekly", 15),
        q("Stay for dessert", "Ten more minutes at the table.", "weekly", 15),
        q("Start a dinner question jar", "Three questions each.", "one_off", 15),
        q("Cook a recipe from your family", "Call whoever makes it best and ask how.", "boss", 50),
        q("Invite someone you haven't eaten with in a year", "Video counts if they're far.", "boss", 60),
      ]),
    space:
      "A long dinner table seen from above in warm peach and candlelight: one place setting per member, with a small stack of plates by each one for the dinners they've logged. Lead with the dinners everyone has shared together as one big number, with no progress bar: 100 is each family's own goal, not the group's. Then a 6-week strip of tiny plates, one row per day, and the newest notes as handwritten place cards. Keep it warm and unhurried.",
  },

  // ----- New places -----
  {
    key: "places",
    slug: "visit-12-places-you-ve-never-been",
    title: "Visit 12 places you've never been",
    tagline: "One new place a month. A town, a trail, a neighbourhood, a country.",
    description:
      "Go somewhere you've never been, once a month. It can be far away or forty minutes from home: a town, a park, a neighbourhood, an island, a museum. A place counts when you've never been there before and you spend at least a few hours in it.\n\n" +
      "Log each place by name, with a line about what you found.",
    emoji: "pin",
    theme: "lilac",
    category: "travel",
    metric: { name: "new places", unit: "places", target: 12, aggregation: "distinct" },
    camps: [
      { title: "First new place", detail: "Somewhere within an hour of home that you've never been.", target: 1, week: 3, emoji: "pin" },
      { title: "Three new places", detail: "One of them a place you've always driven past.", target: 3, week: 11, emoji: "map" },
      { title: "A night away", detail: "Four places, one far enough to sleep there.", target: 4, week: 17, emoji: "camp" },
      { title: "Halfway: six places", detail: "Go to one of them alone.", target: 6, week: 26, emoji: "compass" },
      { title: "Nine places", detail: "One you've been saying you'd go to for years.", target: 9, week: 39, emoji: "flag" },
      { title: "Twelve places", detail: "A year of new places.", target: 12, week: 52, emoji: "summit" },
    ],
    members: [
      {
        handle: "amara",
        daysAgo: 80,
        items: [
          { label: "Dia Beacon", note: "Train up the Hudson, then hours in those huge quiet rooms. Brought a book for the ride back and never opened it.", daysAgo: 72 },
          { label: "Storm King Art Center", note: "Stayed the night at an inn nearby to be there when it opened. Giant sculptures in a valley of trees just turning.", daysAgo: 51 },
          { label: "The Morgan Library", note: "Twenty minutes from my office and I'd never been. Three floors of books with hidden staircases.", daysAgo: 30 },
          { label: "City Island", note: "A fishing village in the Bronx. Fried clams on a bench by the water.", daysAgo: 9 },
        ],
        plan: {
          summary:
            "Amara wants to stop saying 'one day I'll go'. One new place a month, most of them a train ride from New York, with a trip abroad in spring. She takes a book set in or near each place.",
          cadence: "One place a month, usually on a weekend.",
        },
      },
      {
        handle: "anacosta",
        daysAgo: 63,
        items: [
          { label: "Sintra", note: "My whole life in Lisbon and I'd never gone. Pena Palace in the fog, like a cake in a cloud.", daysAgo: 58 },
          { label: "Comporta", note: "Rice fields and an empty beach in October. Ate clams with my sister.", daysAgo: 33 },
          { label: "Évora", note: "A Roman temple in the middle of town, and a chapel lined with bones. My sister wouldn't go in.", daysAgo: 6 },
        ],
        plan: {
          summary:
            "Ana has lived in Lisbon all her life and has seen very little of Portugal. One place a month by train or in her sister's car, and the Azores in summer if she saves enough.",
          cadence: "One trip a month.",
        },
      },
      {
        handle: "olliegrant",
        daysAgo: 47,
        items: [
          { label: "Margate", note: "Chips on the sea wall until a gull took one. Turner Contemporary was free and excellent.", daysAgo: 41 },
          { label: "Hastings", note: "Old town, fishing huts and the steepest funicular in Britain. Bought a smoked fish I don't know how to eat.", daysAgo: 20 },
          { label: "Whitstable", note: "Oysters for the first time. Tastes like the sea, chewier.", daysAgo: 3 },
        ],
        plan: {
          summary:
            "Ollie has lived in London for eight years and only knows it and his parents' town. One new place a month, a day trip by train, and he has to eat something local each time, even if it scares him.",
          cadence: "A day trip a month, by train.",
        },
      },
      {
        handle: "rachelkim",
        daysAgo: 35,
        items: [
          { label: "Jiufen", note: "A free afternoon after the Taipei meetings. A teahouse on the hill, lanterns, rain. Finally saw something besides the office.", daysAgo: 21 },
          { label: "Joshua Tree", note: "Drove out the weekend I got back. Slept under the stars, which I now recommend over hotels.", daysAgo: 11 },
        ],
        plan: {
          summary:
            "Rachel travels for work two weeks a month and has seen the inside of a lot of hotels. The plan is one new place on each trip, even if it's only an afternoon, and one near home on the weeks she's back.",
          cadence: "One per trip, one near home each month.",
        },
      },
    ],
    openQuests: [
      q("List ten places within two hours of home", "Ones you've never been to. Star the easiest one.", "one_off", 15),
      q("Book the next one", "A train ticket, a free Saturday, a friend if you want one.", "one_off", 20),
      q("Ask a local what you shouldn't miss", "Then go there first.", "weekly", 15),
      q("Eat one thing you can only get there", "Ask in a shop, not online.", "weekly", 15),
      q("Take one photo that isn't the famous view", "A door, a sign, a breakfast.", "weekly", 10),
      q("Walk a part of your own city you've never seen", "A park, a neighbourhood, a market. Two hours, on foot.", "weekly", 20),
      q("Send a postcard from the next place", "To yourself, or to someone who'd like it.", "weekly", 10),
      q("Go somewhere alone", "A day trip with nobody to agree with.", "boss", 60),
      q("Spend a night somewhere new", "A guesthouse, a campsite, a friend's sofa.", "boss", 70),
    ],
    doneQuest: (log) => q(`Go to ${log.label}`, "A few hours at least, and eat something local.", "weekly", 30),
    space:
      "A traveller's passport opened flat, on soft lilac paper with faded ink stamps. Every place anyone has logged becomes a stamp with its name, the date and who went. Lead with how many new places the group has been to together. Then each member's own passport page, with twelve stamp boxes that fill as they go. Show the newest notes as short postcard backs.",
  },

  // ----- Screen time -----
  {
    key: "screentime",
    slug: "keep-screen-time-under-2-hours-a-day",
    title: "Keep screen time under 2 hours a day",
    tagline: "Two hours of phone a day, tops. Get your evenings back.",
    description:
      "Keep your phone's screen time under two hours a day. A work computer doesn't count; your phone does, all of it, maps and messages included.\n\n" +
      "Check your phone's screen time before bed and log the day if you're under two hours. The summit is 300 days: the other 65 are flights, sick days and days when the phone was the right tool.",
    emoji: "hourglass",
    theme: "night",
    category: "mindful",
    metric: { name: "days under 2 hours", unit: "days", target: 300, aggregation: "count" },
    camps: [
      { title: "Three days under two hours", detail: "Turn on the screen time report and see where the hours go.", target: 3, week: 1, emoji: "hourglass" },
      { title: "Phone sleeps outside the bedroom", detail: "30 days, and a charger in the hallway.", target: 30, week: 6, emoji: "sleep" },
      { title: "100 days", detail: "A hundred days under two hours.", target: 100, week: 18, emoji: "flag" },
      { title: "Halfway: 150 days", detail: "Delete the app you open without thinking.", target: 150, week: 27, emoji: "camp" },
      { title: "225 days", detail: "Most days the phone is just a tool now.", target: 225, week: 40, emoji: "lock" },
      { title: "300 days", detail: "Three hundred days under two hours.", target: 300, week: 52, emoji: "summit" },
    ],
    noteFor: screenNote,
    members: [
      {
        handle: "elenap",
        daysAgo: 68,
        weekdays: [0.55, 0.85, 0.85, 0.8, 0.85, 0.7, 0.5],
        hours: [[21, 23]],
        beats: [
          { daysAgo: 68, note: "Last week's average was 5 hours 12 minutes. Writing it down so I can't pretend." },
          { daysAgo: 45, note: "Turned the phone grayscale. It's so much less interesting in grey." },
          { daysAgo: 15, note: "Deleted Instagram for the third time. This time my sister changed the password." },
        ],
        plan: {
          summary:
            "Elena's phone was taking five hours a day, mostly in bed and on the subway. The phone charges in the kitchen overnight, the subway is for paper books, and social apps live only on the laptop.",
          cadence: "Check screen time every night at 10.",
        },
      },
      {
        handle: "raviiyer",
        daysAgo: 60,
        pace: 0.8,
        hours: [[22, 23]],
        beats: [
          { daysAgo: 60, note: "The phone already goes in another room while I read. Now it stays there all evening." },
          { daysAgo: 27, note: "Back under after a weekend wedding with photos everywhere. Worth it." },
          { daysAgo: 7, note: "Muted the office group chat after 7pm. Huge." },
        ],
        plan: {
          summary:
            "Ravi already keeps his phone in another room while he reads. Now it stays there all evening, work chat is muted after 7, and the commute is for essays and books, not feeds.",
          cadence: "Every evening. Phone in the hallway from 8.",
        },
      },
      {
        handle: "aidenm",
        daysAgo: 39,
        pace: 0.62,
        gaps: [[24, 18]],
        hours: [[21, 23]],
        beats: [
          { daysAgo: 39, note: "Six hours a day, on average. Mostly sports. Ouch." },
          { daysAgo: 17, note: "Lost a week to the playoffs. Back. Scores once, then the phone goes in a drawer." },
        ],
        plan: {
          summary:
            "Aiden averages six hours a day, most of it sports apps and highlights. Games get watched on the TV with other people, not alone on the phone, and the phone lives in a kitchen drawer after dinner.",
          cadence: "Every night. Phone in the drawer after dinner.",
        },
        replan: {
          daysAgo: 17,
          shiftWeeks: 1,
          reason: "A week of playoff games blew the budget every day. Camps moved back a week, and one new rule: check the scores once after dinner, then the drawer.",
          cadence: "Every night. Scores once, then the drawer.",
        },
      },
      {
        handle: "hannahlevi",
        daysAgo: 26,
        pace: 0.72,
        hours: [[21, 22]],
        beats: [
          { daysAgo: 26, note: "Grading on paper again. The phone keeps sneaking in between essays." },
          { daysAgo: 9, note: "Left the phone in the car at the farmers market. Didn't miss it once." },
        ],
        plan: {
          summary:
            "Hannah wants her evenings back for herself. The phone goes on the charger by the front door when she gets home, grading happens on paper, and the two apps she opens most get 30 minutes a day.",
          cadence: "Evenings. Phone by the door.",
        },
      },
    ],
    openQuests: [
      q("Find your top three apps", "Open the screen time report and write down where the hours go.", "one_off", 15),
      q("Charge the phone outside the bedroom", "Every night this week. Get a cheap alarm clock.", "weekly", 25),
      q("Set a limit on your worst app", "30 minutes a day. Don't raise it when it runs out.", "one_off", 20),
      q("Turn on grayscale", "For a week. Colour is half the pull.", "weekly", 15),
      q("Move social apps off the home screen", "Into a folder on the last page.", "one_off", 10),
      q("Leave the phone at home for one walk", "Twenty minutes, nothing in your pocket.", "weekly", 15),
      q("Mute every group chat after 8pm", "They'll still be there in the morning.", "one_off", 15),
      q("Read on paper before bed", "Ten pages, every night this week.", "daily", 10),
      q("A phone-free Saturday morning", "Phone in a drawer until noon.", "boss", 50),
      q("A whole day under one hour", "Plan it the night before: route written down, calls only.", "boss", 70),
    ],
    doneQuest: (_log, rng) =>
      rng.pick([
        q("Charge the phone outside the bedroom", "Every night this week.", "weekly", 25),
        q("Turn on grayscale", "For a week.", "weekly", 15),
        q("Leave the phone at home for one walk", "Nothing in your pocket.", "weekly", 15),
        q("Read on paper before bed", "Ten pages, every night this week.", "daily", 10),
        q("Set a limit on your worst app", "30 minutes a day.", "one_off", 20),
        q("Move social apps off the home screen", "Into a folder on the last page.", "one_off", 10),
        q("Mute every group chat after 8pm", "They'll still be there in the morning.", "one_off", 15),
        q("Check screen time before bed", "Every night this week. Just look.", "daily", 10),
        q("A phone-free Saturday morning", "Phone in a drawer until noon.", "boss", 50),
      ]),
    space:
      "A quiet town under a night sky in deep navy: each member is a lit window, and every day they've logged under two hours adds a star above their roof. Lead with the evenings everyone has won back together, as one big number with no progress bar: 300 days is each person's own goal, not the group's. Then a 6-week strip of moons, fuller on the days more people made it. End with the newest notes, which often carry the day's screen time and what people did instead.",
  },

  // ----- Spanish -----
  {
    key: "spanish",
    slug: "hold-a-15-minute-conversation-in-spanish",
    title: "Hold a 15-minute conversation in Spanish",
    tagline: "About 20 minutes a day, from hola to a real 15-minute chat.",
    description:
      "Start Spanish from zero, or from school Spanish you've forgotten, and end the year with a 15-minute conversation with a native speaker, all in Spanish.\n\n" +
      "Practice time is the shared yardstick: about 20 minutes a day adds up to 120 hours. Lessons, apps, flashcards, podcasts, shows and talking to yourself in the car all count. Log minutes.",
    emoji: "chat",
    theme: "rose",
    category: "language",
    metric: { name: "practice minutes", unit: "min", target: 7200, aggregation: "sum" },
    step: 5,
    camps: [
      { title: "Sounds and greetings", detail: "The five vowels, the tapped r, and introducing yourself in four sentences.", target: 300, week: 3, emoji: "language" },
      { title: "Order a whole meal", detail: "Food, numbers and please. Start to finish, without English.", target: 1000, week: 9, emoji: "cooking" },
      { title: "Tell a story in the past", detail: "One minute about what you did last weekend.", target: 2400, week: 18, emoji: "pencil" },
      { title: "First 5-minute chat", detail: "Five minutes with a tutor or a partner, no English.", target: 3600, week: 26, emoji: "chat" },
      { title: "10 minutes about your life", detail: "Work, family and plans, with someone who won't slow down much.", target: 5400, week: 39, emoji: "microphone" },
      { title: "15 minutes, all in Spanish", detail: "A real 15-minute conversation with a native speaker.", target: 7200, week: 52, emoji: "summit" },
    ],
    notes: SPANISH_NOTES,
    shortNotes: ["Duolingo", "Flashcards", "Podcast on the commute", "Verb drills", "Anki review", "Shadowing", "Quick review before bed"],
    members: [
      {
        handle: "mianguyen",
        daysAgo: 64,
        pace: 0.75,
        amount: [10, 30],
        ritual: {
          weekday: 1,
          amount: 50,
          hour: 19,
          notes: [
            "Lesson with Marisol. Body parts, for work. Me duele aquí: it hurts here.",
            "Marisol lesson: asking about pain on a scale of one to ten.",
            "Lesson with Marisol. We role-played a mother asking about her son's medicine.",
            "",
            "Marisol: the past tense, so patients can tell me what happened.",
            "Lesson with Marisol. Only Spanish for the first fifteen minutes.",
            "Marisol lesson: numbers and times, for medication schedules.",
            "",
            "Lesson with Marisol. She talked at normal speed for a whole minute and I followed it.",
          ],
        },
        beats: [
          { daysAgo: 64, value: 20, note: "Half my patients' families speak Spanish, and I'm tired of waiting for the interpreter line. Day one: greetings and the five vowels." },
          { daysAgo: 37, value: 25, note: "Asked a patient's mom in Spanish if she wanted water. She smiled and said yes. Small, and huge." },
          { daysAgo: 10, value: 30, note: "Understood a whole question from a patient's grandfather without asking him to repeat it." },
        ],
        plan: {
          summary:
            "Mia is a nurse in Houston, and many of her patients' families speak Spanish. Short sessions on the drive and between shifts, a lesson with Marisol every Monday on what she actually says at work, and one longer session on each day off.",
          cadence: "Most days, 15–25 min. Marisol every Monday.",
        },
      },
      {
        handle: "tomasherrera",
        daysAgo: 55,
        pace: 0.7,
        amount: [15, 30],
        noteRate: 0.2,
        ritual: {
          weekday: 0,
          amount: 40,
          hour: 20,
          notes: [
            "Sunday call with Abuela in San Antonio. Mostly her talking, mostly me understanding.",
            "Called Abuela. Answered in Spanish the whole time. She noticed, and went quiet for a second.",
            "Abuela told the story of crossing at Laredo in 1961. Understood all of it.",
            "",
            "Call with Abuela. She's correcting my grammar now, which means she thinks I can take it.",
            "Abuela: recipes. Wrote down her tamales in Spanish.",
            "",
          ],
        },
        beats: [
          { daysAgo: 55, value: 25, note: "I've understood my grandmother's Spanish my whole life and always answered in English. Fixing that." },
          { daysAgo: 20, value: 30, note: "Read the Spanish half of a device manual to see if I could. I could." },
        ],
        plan: {
          summary:
            "Tomás grew up understanding Spanish and answering in English. He understands far more than he can say, so the plan is mostly speaking: shadowing, talking through his day out loud on the drive, and a Sunday call with his grandmother where he only answers in Spanish.",
          cadence: "Daily on the drive, 20 min. Abuela every Sunday.",
        },
      },
      {
        handle: "benlarsen",
        daysAgo: 42,
        pace: 0.65,
        amount: [10, 20],
        noteRate: 0.1,
        ritual: {
          weekday: 6,
          amount: 20,
          hour: 12,
          notes: ["Practice. Talked to two parents in Spanish.", "Practice. Said bien hecho about forty times.", "", "Practice. Asked Diego's dad about the tournament. Got most of it.", ""],
        },
        beats: [
          { daysAgo: 42, value: 15, note: "I coach my son's soccer team. Half the parents speak Spanish. I want to talk to them." },
          { daysAgo: 14, value: 20, note: "Gave the whole halftime talk in Spanish. A short one." },
        ],
        plan: {
          summary:
            "Ben coaches his son's under-10 soccer team, and half the parents speak Spanish. Fifteen minutes of an app at lunch on weekdays, and on Saturdays he practises what he'll say at the field.",
          cadence: "Weekdays at lunch, 15 min. Saturdays at the field.",
        },
      },
      {
        handle: "kwame",
        daysAgo: 11,
        pace: 0.85,
        amount: [10, 20],
        noteRate: 0.15,
        beats: [
          { daysAgo: 11, value: 15, note: "Moving to Valencia for work next summer. Starting from nothing." },
          { daysAgo: 3, value: 20, note: "Ordered at the Spanish café near work. The barista answered in Spanish and I understood her." },
        ],
        plan: {
          summary: "Kwame moves to Valencia for work next summer. Fifteen minutes a day on the bus to start, and a tutor from January once the basics are in.",
          cadence: "Daily on the bus, 15 min.",
        },
      },
    ],
    openQuests: [
      q("Vowels and the tapped r: 10 minutes a day", "Record pero and perro. Compare them with a native speaker's recording.", "daily", 10),
      q("Introduce yourself without notes", "Name, city, work and one thing you like. Out loud.", "weekly", 20),
      q("Learn 20 food words", "Enough to read the top of a menu.", "weekly", 20),
      q("Shadow one podcast clip", "Pick 60 seconds. Repeat it five times until you sound like the speaker.", "weekly", 20),
      q("Describe your morning in 5 sentences", "Present tense. Say them out loud without reading.", "weekly", 20),
      q("Watch one episode with Spanish subtitles", "Pause and write down three words you hear more than once.", "weekly", 20),
      q("Clear the flashcard backlog", "Zero due cards before Sunday.", "one_off", 15),
      q("Ser or estar: 15 sentences", "Write them, then check them with a tutor or an app.", "weekly", 20),
      q("Talk through your day out loud", "Two minutes in the car or on a walk, no English. Mistakes are fine.", "daily", 10),
      q("Order something in Spanish", "Coffee, tacos, anything. Count it even if they answer in English.", "boss", 60),
      q("5-minute chat, no English", "With a tutor or a language partner. Ask them to stop you if you switch.", "boss", 80),
    ],
    doneQuest: (_log, rng) =>
      rng.pick([
        q("Learn the numbers 1 to 100", "Then read five prices out loud.", "weekly", 20),
        q("Introduce yourself without notes", "Name, city, work, one hobby.", "weekly", 20),
        q("Learn 15 food words", "Enough to order a meal.", "weekly", 20),
        q("Shadow a podcast clip five times", "60 seconds, same clip.", "weekly", 20),
        q("Review every flashcard due this week", "Little and often.", "weekly", 15),
        q("Ask for directions in a role play", "Left, right, straight on, how far.", "weekly", 20),
        q("Present tense of ten common verbs", "Ser, estar, tener, ir, hacer and five more.", "weekly", 25),
        q("Describe your home in 6 sentences", "Rooms, furniture, the view.", "weekly", 20),
        q("Listen to one slow podcast episode", "No pausing. Note what you understood.", "weekly", 15),
        q("Write five sentences in the past tense", "What you did last weekend.", "weekly", 20),
        q("Change your phone to Spanish for a day", "Notice which words you guess right.", "one_off", 15),
        q("Order coffee in Spanish", "Count it even if they reply in English.", "boss", 60),
      ]),
    space:
      "A whitewashed street in a Spanish town, rose and terracotta, with bougainvillea over the doors. Lead with the group's combined practice hours as one big number, with no progress bar under it: 120 hours is each learner's own goal, not the group's. Then a 6-week strip of painted tiles, one per day, deeper in colour the more people practiced. Show the newest notes as chalk on little café boards (they mention lessons with Marisol, calls with family and practice in the car). End with each member's minutes toward their own 7,200 as a row of tiles that fill in.",
  },

  // ----- Cooking -----
  {
    key: "cook",
    slug: "cook-100-meals-from-scratch",
    title: "Cook 100 meals from scratch",
    tagline: "Two meals a week from raw ingredients. Simple counts. Jars don't.",
    description:
      "Cook 100 meals from scratch this year, about two a week. A meal counts when you made it yourself from raw ingredients: chopped, seasoned and cooked. Dried pasta, stock and spices are fine; a jar of sauce or a meal kit isn't.\n\n" +
      "Log each meal with the dish's name and a line about how it went.",
    emoji: "cooking",
    theme: "mint",
    category: "cooking",
    metric: { name: "meals cooked", unit: "meals", target: 100, aggregation: "count" },
    camps: [
      { title: "First five meals", detail: "Five meals from raw ingredients. Simple is fine.", target: 5, week: 3, emoji: "cooking" },
      { title: "Five dishes from memory", detail: "15 meals, and five dishes you can cook without a recipe.", target: 15, week: 8, emoji: "pencil" },
      { title: "Cook for someone else", detail: "25 meals, one of them for friends or family.", target: 25, week: 13, emoji: "highfive" },
      { title: "Halfway: 50 meals", detail: "Bake your own bread for one of them.", target: 50, week: 26, emoji: "camp" },
      { title: "A dish you've only ever ordered", detail: "75 meals, one of them a takeout favourite made at home.", target: 75, week: 39, emoji: "sparkles" },
      { title: "100 meals", detail: "A hundred meals from scratch.", target: 100, week: 52, emoji: "summit" },
    ],
    members: [
      {
        handle: "femi",
        daysAgo: 76,
        items: [
          { label: "Jollof rice", note: "My mum's recipe over the phone. She said it needs more pepper. It always needs more pepper." },
          { label: "Shakshuka", note: "Easiest thing I've ever made that looks impressive." },
          { label: "Spaghetti aglio e olio", note: "" },
          { label: "Egusi soup", note: "Found egusi at the African shop in Wedding. Took two hours. Worth it." },
          { label: "Chicken stir-fry", note: "Cut everything before turning on the heat this time. Game changer." },
          { label: "Lentil soup", note: "" },
          { label: "Fried plantain and eggs", note: "Breakfast for dinner." },
          { label: "Käsespätzle", note: "My flatmate taught me. The spätzle press is a whole workout." },
          { label: "Pepper soup", note: "Too spicy for my flatmate. Perfect for me." },
          { label: "Chili con carne", note: "" },
          { label: "Suya chicken thighs", note: "Ground the peanuts for the spice myself. The kitchen smelled like Lagos." },
          { label: "Red lentil dal", note: "Rohan's recipe from his notes here. Thanks, Rohan." },
          { label: "Fish stew with peppers", note: "" },
          { label: "Jollof rice, again", note: "Mum says this one is nearly right. Nearly." },
        ],
        plan: {
          summary:
            "Femi has lived on takeaway and his flatmate's leftovers for two years. Two meals a week to start, one from his mum's Nigerian recipes and one quick weeknight dish, and one big cook a week. He shops at the market on Saturday so there's always something fresh to use.",
          cadence: "Two meals a week, one of them a big cook.",
        },
      },
      {
        handle: "rohank",
        daysAgo: 60,
        hours: [[20, 22]],
        items: [
          { label: "Dal tadka", note: "Everything chopped first, a timer for each step. Mum's version, written down properly this time." },
          { label: "Jeera rice", note: "Washed the rice three times. Fluffy. Noted for next time." },
          { label: "Aloo posto", note: "A Kolkata classic. Grinding poppy seed paste by hand is a forearm workout." },
          { label: "Egg curry", note: "" },
          { label: "Masoor dal with spinach", note: "" },
          { label: "Chicken kosha", note: "Three hours of slow browning. The onions decide when you're done, not you." },
          { label: "Rajma", note: "Pressure cooker, four whistles. Wrote it down." },
          { label: "Paneer bhurji", note: "Made the paneer from milk too. Lemon juice, a cloth and patience." },
          { label: "Begun bhaja", note: "Fried aubergine slices. Simple and perfect." },
          { label: "Khichuri", note: "Rainy-day food." },
          { label: "Rui fish curry", note: "Fish from the market. Mum approved over video." },
          { label: "Chana masala", note: "" },
        ],
        plan: {
          summary:
            "Rohan treats cooking the way he treats guitar practice: one technique a week, written up after. He's working through his mother's Bengali recipes in order of difficulty, two meals a week, with notes on what changed each time.",
          cadence: "Two evenings a week.",
        },
      },
      {
        handle: "carmenontheroad",
        daysAgo: 44,
        items: [
          { label: "Black bean tacos", note: "", daysAgo: 42 },
          { label: "Green chile stew", note: "Two-burner stove, one pot, Hatch chiles from a roadside stand. Best thing I've made in the van.", daysAgo: 40 },
          { label: "Campfire potatoes", note: "Foil packets in the coals. Took forever. Ate them in the dark.", daysAgo: 33 },
          { label: "Huevos rancheros", note: "Morning at Great Basin. Salsa from a tomato and one jalapeño.", daysAgo: 29 },
          { label: "Trout with lemon", note: "Bought it from a man at the lake and cleaned it myself. Proud, and slightly shaken.", daysAgo: 22 },
          { label: "Pasta with roasted squash", note: "Squash from a farm stand in Idaho.", daysAgo: 15 },
          { label: "Lentil soup", note: "Snowed in at a campground. Soup weather.", daysAgo: 12 },
          { label: "Bison chili", note: "Bison from a ranch store in Cody.", daysAgo: 8 },
          { label: "Corn chowder", note: "Sweet corn from the honor-box farm stand in the Sandhills.", daysAgo: 2 },
        ],
        plan: {
          summary:
            "Carmen lives in her van this year and cooks on a two-burner stove. Two real meals a week from whatever the local farm stands and markets have, with one-pot recipes that don't need an oven.",
          cadence: "Two meals a week, wherever she's parked.",
        },
      },
      {
        handle: "emmal",
        daysAgo: 38,
        items: [
          { label: "Meatballs with lingonberries", note: "Mormor's recipe card, splattered from fifty years of use." },
          { label: "Salmon with dill potatoes", note: "" },
          { label: "Kalops", note: "Beef stew with allspice. The flat smelled like Christmas." },
          { label: "Mushroom risotto", note: "Chanterelles from the market, probably the last of the year." },
          { label: "Raggmunk", note: "Potato pancakes with bacon and lingonberries. Messy, glorious." },
          { label: "Fish soup", note: "" },
          { label: "Pea soup and pancakes", note: "Proper Swedish comfort food." },
          { label: "Jansson's temptation", note: "Too early for Christmas. Didn't care." },
        ],
        plan: {
          summary:
            "Emma wants one slow cook a week and one easy weeknight dish. She's working through her grandmother's recipe box one card at a time, and writes a note on the back of each card after.",
          cadence: "One slow cook, one easy weeknight dish.",
        },
      },
      {
        handle: "jordanruns",
        daysAgo: 25,
        hours: [[19, 21]],
        items: [
          { label: "Chicken, rice and broccoli", note: "Meal prep for four days. Macros in the spreadsheet." },
          { label: "Turkey chili", note: "Big batch, five portions. The freezer is full." },
          { label: "Salmon and sweet potato", note: "" },
          { label: "Pasta with homemade marinara", note: "First sauce from actual tomatoes. Long run tomorrow, so the carbs are justified." },
          { label: "Banana pancakes", note: "After the long run." },
          { label: "Lentil curry", note: "" },
        ],
        plan: {
          summary:
            "Jordan eats the same three takeout meals on rotation. The plan is one batch cook a week that feeds him for four days, and one fresh meal in between, built around his running.",
          cadence: "One batch cook and one fresh meal a week.",
        },
      },
    ],
    openQuests: [
      q("Learn to dice an onion properly", "Watch one video, then dice two onions. Freeze what you don't use.", "one_off", 15),
      q("Plan three dinners before you shop", "Write the list from the plan, not the other way round.", "weekly", 20),
      q("Make stock from scraps", "Onion ends, carrot peel, a chicken carcass or a parmesan rind. Freeze it.", "weekly", 20),
      q("Cook one dish without a recipe", "Something you've made twice. Taste as you go.", "weekly", 25),
      q("Use up everything in the fridge", "One meal from what's already there. No shopping.", "weekly", 20),
      q("Sharpen your knife", "Or get it sharpened. Everything gets easier.", "one_off", 10),
      q("Make a sauce from scratch", "Tomato, béchamel or a simple pan sauce.", "weekly", 20),
      q("Ask someone for their family recipe", "Write it down while they talk you through it.", "one_off", 15),
      q("Cook for someone else", "A friend, a neighbour, family. Ask them what they'd change.", "boss", 60),
      q("Bake a loaf of bread", "A simple no-knead one. It takes time, not skill.", "boss", 50),
      q("Cook a dish you'd normally order", "Your usual takeout order, from scratch.", "boss", 70),
    ],
    doneQuest: (log) => q(`Cook: ${log.label}`, "From raw ingredients. Taste as you go.", "weekly", 25),
    space:
      "A recipe box on a kitchen counter in fresh mint and cream. Lead with the meals everyone has cooked together. File every logged dish as a handwritten index card behind its cook's tab, with their note on the back when tapped. Show each cook's progress to 100 as a row of small plates that fill in, and the five newest dishes on a little chalkboard menu.",
  },

  // ----- Push-ups -----
  {
    key: "pushups",
    slug: "do-100-push-ups-in-a-row",
    title: "Do 100 push-ups in a row",
    tagline: "One unbroken set of 100 by the end of the year. Test once a week and log the whole set.",
    description:
      "Build up to 100 push-ups in one set, with no resting on the floor or your knees. A push-up counts when your chest comes down to a fist's height off the floor and your body stays straight.\n\n" +
      "Test your max about once a week, fresh and warmed up, and log the whole set: if you did 27, log 27. Your newest test is your level, so an off day shows too. Training days don't need a log.",
    emoji: "boxing",
    theme: "teal",
    category: "fitness",
    metric: { name: "max set", unit: "push-ups", target: 100, aggregation: "latest" },
    camps: [
      { title: "Clean form, 20 in a row", detail: "Chest to a fist off the floor, body straight, twenty times.", target: 20, week: 3, emoji: "target" },
      { title: "35 in a row", detail: "Train three days a week and test on a fourth.", target: 35, week: 12, emoji: "boxing" },
      { title: "Halfway: 50", detail: "Fifty without stopping.", target: 50, week: 22, emoji: "camp" },
      { title: "65 in a row", detail: "Past where most people stop.", target: 65, week: 32, emoji: "flag" },
      { title: "80 in a row", detail: "Pace matters now: steady, not fast.", target: 80, week: 42, emoji: "trophy" },
      { title: "100 in a row", detail: "One unbroken set of 100.", target: 100, week: 52, emoji: "summit" },
    ],
    members: [
      {
        handle: "mayac",
        daysAgo: 75,
        pace: 0,
        beats: [
          { daysAgo: 75, value: 24, note: "First test. The last three were ugly." },
          { daysAgo: 68, value: 27, note: "New best." },
          { daysAgo: 61, value: 31, note: "Three sets of 15 on training days, one test a week." },
          { daysAgo: 54, value: 33, note: "The morning after a long run." },
          { daysAgo: 47, value: 31, note: "Slept badly. Two fewer than last week, logging it anyway." },
          { daysAgo: 40, value: 38, note: "Slowed down and breathed. That was the whole trick." },
          { daysAgo: 33, value: 40, note: "" },
          { daysAgo: 19, value: 43, note: "Straight after a 10-mile run." },
          { daysAgo: 4, value: 46, note: "Fifty is close." },
        ],
        plan: {
          summary:
            "Maya runs a lot and has never trained her upper body. Three short sessions a week after runs (sets of about two thirds of her best, a minute's rest between), and one max test a week, first thing in the morning before coffee.",
          cadence: "Three short sessions a week, one max test.",
        },
      },
      {
        handle: "kenjimorita",
        daysAgo: 66,
        pace: 0,
        beats: [
          { daysAgo: 66, value: 31, note: "First test. Checked my form in the mirror." },
          { daysAgo: 59, value: 33, note: "" },
          { daysAgo: 52, value: 36, note: "Five easy push-ups every time I go to the kitchen." },
          { daysAgo: 38, value: 40, note: "Sore chest, happy." },
          { daysAgo: 31, value: 41, note: "Barely. Right shoulder complained after." },
          { daysAgo: 24, value: 37, note: "First test since the shoulder. Stopped early on purpose." },
          { daysAgo: 17, value: 45, note: "The extra rest days are paying off." },
          { daysAgo: 10, value: 47, note: "Maya is at 43. Noted." },
        ],
        plan: {
          summary:
            "Kenji wants to beat everyone here and knows he has to beat his own number first. Five easy push-ups every time he gets up from his desk, two harder sessions a week, and a test once a week.",
          cadence: "Easy sets daily. One test a week.",
        },
        replan: {
          daysAgo: 30,
          shiftWeeks: 1,
          reason: "Right shoulder twinged after testing two days in a row. One test a week, never the day after a hard session, and camps moved back a week.",
        },
      },
      {
        handle: "debcollins",
        daysAgo: 57,
        pace: 0,
        beats: [
          { daysAgo: 57, value: 6, note: "I'm 52 and I've only ever done them on my knees. Six real ones. Here we go." },
          { daysAgo: 50, value: 8, note: "" },
          { daysAgo: 43, value: 10, note: "Double digits." },
          { daysAgo: 36, value: 11, note: "" },
          { daysAgo: 29, value: 14, note: "My grandson counted out loud for me." },
          { daysAgo: 22, value: 16, note: "" },
          { daysAgo: 15, value: 19, note: "Arms shaking, smile on my face." },
          { daysAgo: 6, value: 21, note: "Never thought I'd see twenty." },
        ],
        plan: {
          summary:
            "Deb is 52 and started with six full push-ups. Incline push-ups against the kitchen counter on weekdays, slow lowering push-ups twice a week, and a test on the floor once a week. Wrists and shoulders get a warm-up every time.",
          cadence: "Weekdays, 10 min. One test a week.",
        },
      },
      {
        handle: "tylerb",
        daysAgo: 30,
        pace: 0,
        beats: [
          { daysAgo: 30, value: 35, note: "Did push-ups every day for high school football and none since." },
          { daysAgo: 23, value: 38, note: "" },
          { daysAgo: 16, value: 40, note: "" },
          { daysAgo: 9, value: 42, note: "Kenji's at 47. I see you." },
        ],
        plan: {
          summary: "Tyler did push-ups for high school football and hasn't since. Three sessions a week after work with ladder sets (one, two, three, up to ten and back down), and a test every week.",
          cadence: "Three evenings a week, after work.",
        },
      },
      {
        handle: "olliegrant",
        daysAgo: 7,
        pace: 0,
        beats: [
          { daysAgo: 7, value: 19, note: "Bet my flatmate a curry I'd get to 100 before he does." },
          { daysAgo: 1, value: 21, note: "He's on 15." },
        ],
        plan: {
          summary: "Ollie has a bet with his flatmate. Three sets of push-ups before guitar practice most evenings, and a test once a week.",
          cadence: "Most evenings. One test a week.",
        },
      },
    ],
    openQuests: [
      q("Film one push-up from the side", "Check: chest to a fist off the floor, hips in line.", "one_off", 15),
      q("Three training days this week", "Sets of about two thirds of your best, a minute's rest between.", "weekly", 25),
      q("Five easy push-ups at every break", "Every time you get up from your desk, all week.", "daily", 10),
      q("Slow lowering push-ups", "Five push-ups, lowering for a count of five. Twice this week.", "weekly", 20),
      q("Test your max on the same day each week", "Fresh, warmed up, same time of day.", "weekly", 20),
      q("Ladder set", "1, 2, 3 up to 10, a breath between each. Then back down.", "weekly", 25),
      q("Plank for a minute after training", "Every training day. The last push-ups are about your core.", "daily", 10),
      q("Warm up wrists and shoulders", "Circles and a few against the wall before every set.", "daily", 10),
      q("Take an easy week", "Two light sessions only, then test.", "one_off", 15),
      q("Beat your best by two", "On your usual test day. Two more than last time.", "boss", 60),
    ],
    doneQuest: (_log, rng) =>
      rng.pick([
        q("Three training days this week", "Two thirds of your best per set.", "weekly", 25),
        q("Five easy push-ups at every break", "All week.", "daily", 10),
        q("Slow lowering push-ups", "Lower for a count of five.", "weekly", 20),
        q("Ladder set", "1 up to 10 and back down.", "weekly", 25),
        q("Test your max on the same day each week", "Fresh and warmed up.", "weekly", 20),
        q("Plank for a minute after training", "Every training day.", "daily", 10),
        q("Film one push-up from the side", "Check depth and hips.", "one_off", 15),
      ]),
    space:
      "A gym chalkboard in teal and chalk white. Each member's newest test is drawn as a chalk tally in bundles of five, with their name and the date they tested. Lead with the biggest set anyone here has done, and how many members are past each camp (20, 35, 50, 65, 80). Show each member's tests over time as a small chalk line chart, and the newest notes in chalk handwriting.",
  },

  // ----- Summits -----
  {
    key: "summits",
    slug: "hike-12-summits",
    title: "Hike 12 summits",
    tagline: "A summit a month, on your own two feet. Every top counts once.",
    description:
      "Walk to the top of 12 different summits this year, about one a month. Any summit counts if you walk up it from the bottom: a local hill, a famous peak, a volcano. Cable cars and summit roads don't.\n\n" +
      "Log each summit by name, with its height if you know it and a line about the day.",
    emoji: "hiking",
    theme: "sky",
    category: "fitness",
    metric: { name: "summits", unit: "summits", target: 12, aggregation: "distinct" },
    camps: [
      { title: "First summit", detail: "A small one close to home. Pack more water than you think.", target: 1, week: 4, emoji: "hiking" },
      { title: "Three summits", detail: "Learn to read the forecast, and turn back when it says so.", target: 3, week: 12, emoji: "compass" },
      { title: "A full day out", detail: "Five summits, one of them a hike of six hours or more.", target: 5, week: 20, emoji: "backpack" },
      { title: "Halfway: six summits", detail: "Half the year's tops.", target: 6, week: 26, emoji: "camp" },
      { title: "Nine summits", detail: "Take a friend up their first one.", target: 9, week: 39, emoji: "flag" },
      { title: "Twelve summits", detail: "Twelve tops in a year.", target: 12, week: 52, emoji: "summit" },
    ],
    members: [
      {
        handle: "noahb",
        daysAgo: 82,
        items: [
          { label: "Mount Sanitas", note: "Boulder's local hill. 1,300 feet of rock stairs, and my lungs aren't used to the altitude yet.", daysAgo: 78 },
          { label: "Mount Bierstadt", note: "First fourteener, 14,065 ft. Started at 5am to beat the afternoon storms. Worth every step.", daysAgo: 64 },
          { label: "Twin Sisters Peaks", note: "Longs Peak right across the valley. Hail for ten minutes on the way down.", daysAgo: 41 },
          { label: "Green Mountain", note: "Short one before work. Watched the sun come up over Denver.", daysAgo: 18 },
        ],
        plan: {
          summary:
            "Noah moved to Denver last year and keeps looking at the mountains from his window. The plan alternates foothill summits close to town with one big peak a month while the weather holds, then snowshoe summits over the winter.",
          cadence: "A summit a month, early starts.",
        },
      },
      {
        handle: "lenafischer",
        daysAgo: 70,
        hours: [[16, 19]],
        items: [
          { label: "Herzogstand", note: "The classic first one from Munich. Train to Kochel, bus, up. The fog lifted at the top.", daysAgo: 66 },
          { label: "Wendelstein", note: "1,838 m. Walked up while the cog railway passed us twice. Took it down, which the rules allow.", daysAgo: 45 },
          { label: "Benediktenwand", note: "1,801 m, a long day with 1,100 m of climb. Ibex near the top.", daysAgo: 24 },
          { label: "Jochberg", note: "A quick one before the snow. Sunrise over the Kochelsee.", daysAgo: 10 },
        ],
        plan: {
          summary:
            "Lena hikes the Bavarian Pre-Alps by train from Munich. A summit every three weeks until the snow, with her weekly long run for fitness, then two snowshoe summits in winter and the bigger peaks from May.",
          cadence: "Every third weekend, first train out.",
        },
      },
      {
        handle: "ellie808",
        daysAgo: 60,
        items: [
          { label: "Koko Head", note: "1,048 steps up old railway ties. I thought I was fit.", daysAgo: 55 },
          { label: "Diamond Head", note: "The tourist hike, I know. Sunrise from the top was still something.", daysAgo: 40 },
          { label: "Kuliouou Ridge", note: "Steep and muddy, and the view across to the windward side made me sit down.", daysAgo: 19 },
        ],
        plan: {
          summary:
            "Ellie lives in Honolulu, where flights to anywhere cost a fortune, so this year's summits are mostly on Oahu: ridges and craters, early, before the heat. One neighbor-island trip if a fare sale comes up.",
          cadence: "One ridge a month, at sunrise.",
        },
      },
      {
        handle: "claireb",
        daysAgo: 52,
        items: [
          { label: "Arthur's Seat", note: "It's practically in my back garden. Should have done it years ago. The wind tried to take my hat.", daysAgo: 50 },
          { label: "Ben Lomond", note: "First Munro, 974 m. Rain, sun, hail, sun, in that order.", daysAgo: 31 },
          { label: "Ben Vorlich", note: "Second Munro. Saw nothing at the top but cloud. Ticked it anyway.", daysAgo: 8 },
        ],
        plan: {
          summary:
            "Claire lives in Edinburgh and wants to start on the Munros. Hills she can reach by train or bus for now, a Munro whenever a friend with a car is going, and nothing in the Highlands in winter until she's done a proper winter skills course.",
          cadence: "A hill a month. Munros when there's a lift.",
        },
      },
      {
        handle: "jiwoo",
        daysAgo: 36,
        hours: [[9, 11]],
        items: [
          { label: "Inwangsan", note: "Ten minutes from the office. Night views of the city from the rocks.", daysAgo: 33 },
          { label: "Baegundae, Bukhansan", note: "836 m, the highest point in Seoul. Half the city was on the trail. Kimbap at the top.", daysAgo: 19 },
          { label: "Gwanaksan", note: "Steep granite, with ropes in places. Sunrise from the top, then the first bus back.", daysAgo: 5 },
        ],
        plan: {
          summary:
            "Ji-woo runs along the Han River and wants the mountains around Seoul too. Most of them are a subway ride away, so the plan is a summit every other weekend at dawn, after a short run the day before.",
          cadence: "Every other weekend at dawn.",
        },
      },
    ],
    openQuests: [
      q("Pick your next summit and check the forecast", "Choose a backup in case the weather turns.", "one_off", 15),
      q("Pack the ten essentials", "Map, light, layers, food, water, first aid and the rest. Leave the bag packed.", "one_off", 15),
      q("Hike an hour with a full pack", "Uphill, with the bag you'll carry on the big day.", "weekly", 20),
      q("Climb 500 m of stairs", "In a building or on a hill. Two sessions this week.", "weekly", 20),
      q("Start before sunrise", "Headlamp on, at the trailhead at first light.", "weekly", 25),
      q("Learn the way down first", "Check the descent before you start up. Most slips happen there.", "one_off", 15),
      q("A long walk on tired legs", "Two hours the day after a hard workout.", "weekly", 20),
      q("A summit with 1,000 m of climb", "A full day. Turn back at the time you set, not at the top.", "boss", 80),
      q("Take someone up their first summit", "A friend, a cousin, a colleague.", "boss", 60),
    ],
    doneQuest: (log) => q(`Reach the top of ${log.label}`, "Check the forecast, start early, turn back if it turns.", "weekly", 30),
    space:
      "A topographic trail map in snowy sky blue and white: contour lines, small peaks, dotted routes. Every summit anyone has logged is a peak marker with its name, who climbed it and when. Lead with how many different summits the group has climbed together. Give each member a ridge line of twelve peaks that fill in as they climb, and show the newest notes as trail-register entries.",
  },

  // ----- French -----
  {
    key: "french",
    slug: "learn-french",
    title: "Learn French",
    tagline: "From ordering a croissant to a real conversation, one evening at a time.",
    description:
      "Get to a real conversation in French: B1, where you can follow people talking at a normal pace and say what you mean, even with mistakes.\n\n" +
      "Log the hours you practise: lessons, homework, podcasts, a conversation, a film without subtitles.",
    emoji: "chat",
    theme: "sky",
    category: "language",
    metric: { name: "hours practised", unit: "hours", target: 300, aggregation: "sum" },
    step: 0.25,
    camps: [
      { title: "Bonjour, for real", detail: "Ten hours in. Greetings, numbers, ordering.", target: 10, week: 3, emoji: "chat" },
      { title: "A1: the present tense", detail: "Talk about your day without English.", target: 50, week: 10, emoji: "seedling" },
      { title: "A2: the past and the future", detail: "Tell a story about last weekend.", target: 120, week: 22, emoji: "books" },
      { title: "First conversation", detail: "Twenty minutes with a native speaker, no switching.", target: 180, week: 32, emoji: "microphone" },
      { title: "A film without subtitles", detail: "Follow the plot of a French film on your own.", target: 240, week: 42, emoji: "target" },
      { title: "B1", detail: "Pass a B1 practice exam.", target: 300, week: 52, emoji: "summit" },
    ],
    notes: [
      "Podcast on the walk to work. Understood maybe half. Last month it was a quarter.",
      "Thirty Anki cards and two grammar exercises. My brain is soup.",
      "Watched Dix pour cent with French subtitles. Caught three jokes on my own.",
      "Wrote a paragraph about my weekend. Eleven mistakes, all gender. Le, la, le, la.",
      "Shadowed a news clip ten times. My r is still a disaster.",
      "Read a whole page of Le Petit Prince without the dictionary.",
      "Fifty new words this week, mostly kitchen. Can now name everything in my fridge.",
      "Conversation club at the library. Talked about football for twenty minutes.",
      "Dictation: 14 mistakes. It used to be over twenty.",
      "Listened to a podcast at normal speed and only rewound twice.",
      "Watched the news at 9pm. Understood the weather and most of the sport.",
    ],
    shortNotes: ["Anki", "Tutor", "Podcast", "Homework", "Shadowing", "Grammar drills", "Conversation club", "Reading"],
    members: [
      {
        handle: "tobyreid",
        daysAgo: 214,
        pace: 0.82,
        amount: [0.5, 1.25],
        long: { weekday: 6, chance: 0.6, amount: [1.5, 2.5] },
        noteRate: 0.05,
        beats: [
          { daysAgo: 214, value: 0.75, note: "Starting today. We move to Lyon next summer and I can say merci and that's it." },
          { daysAgo: 211, value: 1, note: "First lesson with a tutor. Forty minutes of me apologising in two languages." },
          { daysAgo: 190, value: 0.5, note: "Ordered at the bakery without switching to English. She didn't switch either." },
          { daysAgo: 170, value: 1, note: "Passé composé with être. Finally clicked: the house of être, all the verbs that move." },
          { daysAgo: 150, value: 1, note: "First lesson with my tutor where I didn't check the time once." },
          { daysAgo: 125, value: 1, note: "Imparfait or passé composé. The rule is simple until you try to use it." },
          { daysAgo: 110, value: 0.5, note: "Called the post office in French. Hung up shaking, but the parcel is coming." },
          { daysAgo: 94, value: 2, note: "Weekend in Lyon to look at flats. Did the whole viewing in French. Slowly, but in French." },
          { daysAgo: 80, value: 1, note: "Tutor says my accent is getting 'moins anglais'. Taking it." },
          { daysAgo: 60, value: 0.5, note: "Texted our future landlord in French. He replied in French. A real exchange." },
          { daysAgo: 45, value: 1, note: "Subjunctive after il faut que. Drilled it until it felt boring, which is the point." },
          { daysAgo: 41, value: 1.5, note: "Twenty minutes with my tutor and we never switched to English." },
          { daysAgo: 20, value: 0.75, note: "Wrote my first work email in French. A colleague in Lyon fixed two words." },
          { daysAgo: 3, value: 1.25, note: "Watched a French film without subtitles for the first time. Lost the plot twice and found it again." },
        ],
        plan: {
          summary:
            "Toby moves to Lyon next summer and wants to get through daily life and work conversations in French by then. Short sessions every evening (Anki, one grammar point, a podcast on the walk home), a tutor on Tuesdays, and a longer session on Saturday mornings.",
          cadence: "Every evening 30–60 min, tutor on Tuesdays, Saturday mornings longer.",
        },
      },
      {
        handle: "kwame",
        daysAgo: 120,
        pace: 0.6,
        amount: [0.25, 0.75],
        gaps: [[70, 58]],
        beats: [
          { daysAgo: 120, value: 0.5, note: "My daughter does French at school and corrects me. Not for much longer." },
          { daysAgo: 57, value: 0.5, note: "Back after two weeks of overtime. Ten minutes of Anki, just to restart." },
        ],
        plan: {
          summary: "Kwame learns alongside his daughter's school French: an app on the bus, her homework together on Sundays, and a podcast for beginners.",
          cadence: "Most days 15–30 min, Sundays with Ama.",
        },
      },
      {
        handle: "lucasf",
        daysAgo: 160,
        pace: 0.55,
        amount: [0.5, 1],
        beats: [{ daysAgo: 160, value: 1, note: "Português helps more than I expected. The spelling does not." }],
        plan: {
          summary: "Lucas speaks Portuguese and Spanish, so the plan skips the basics: a podcast a day, a French novel with a dictionary, and a conversation exchange online on Thursdays.",
          cadence: "Daily podcast, Thursday exchange.",
        },
      },
    ],
    openQuests: [
      q("Thirty Anki cards before bed", "New words first, then the ones you missed yesterday.", "daily", 10),
      q("Shadow one minute of a podcast", "Repeat it out loud until it sounds like them.", "daily", 10),
      q("Write five sentences about your day", "In the past tense. Send them to your tutor or your Muse to correct.", "daily", 15),
      q("Order something in French", "A coffee, a bus ticket, a phone call. No switching.", "weekly", 20),
      q("One episode without subtitles", "Note three phrases you heard and look them up after.", "weekly", 20),
      q("Twenty minutes of conversation", "With a tutor, an exchange partner or a neighbour.", "weekly", 25),
      q("A B1 practice listening test", "Mark it honestly. Note what tripped you up.", "boss", 60),
    ],
    doneQuest: (_log, rng) =>
      rng.pick([
        q("Twenty minutes of conversation", "With a tutor, an exchange partner or a neighbour.", "weekly", 25),
        q("One episode without subtitles", "Note three phrases you heard and look them up after.", "weekly", 20),
        q("Write five sentences about your day", "In the past tense, then fix them.", "daily", 15),
        q("Drill the passé composé with être", "Twenty sentences, out loud.", "weekly", 20),
        q("Read two pages of a French book", "Underline words, look up only five.", "weekly", 20),
      ]),
    space:
      "A Paris café chalkboard and a French exercise notebook (cahier with blue grid lines and a red margin). Lead with each learner's hours toward B1 drawn as a path through the CEFR levels A1, A2, B1. Show the newest notes as lines written in the notebook, and a 'mot du jour' corner. Chalk white, cream paper, French blue and a touch of red.",
  },

  // ----- 100 different dishes -----
  {
    key: "dishes",
    slug: "cook-100-different-dishes",
    title: "Cook 100 different dishes",
    tagline: "A hundred dishes you've never cooked before, from your own kitchen.",
    description:
      "Cook 100 dishes you've never made before, one at a time, from scratch. Breakfasts, soups, breads and desserts all count.\n\n" +
      "Log each new dish when it's on the table.",
    emoji: "cooking",
    theme: "peach",
    category: "cooking",
    metric: { name: "different dishes cooked", unit: "dishes", target: 100, aggregation: "distinct" },
    camps: [
      { title: "First five dishes", detail: "Five things you'd never cooked before.", target: 5, week: 3, emoji: "cooking" },
      { title: "A dozen, and one bread", detail: "Twelve dishes, one of them a bread.", target: 12, week: 8, emoji: "seedling" },
      { title: "Quarter century", detail: "Twenty-five dishes, and a dinner for friends.", target: 25, week: 16, emoji: "flag" },
      { title: "Halfway: fifty dishes", detail: "Fifty dishes, from at least ten countries.", target: 50, week: 28, emoji: "camp" },
      { title: "Seventy-five", detail: "A hard one: a laminated dough or a whole fish.", target: 75, week: 40, emoji: "target" },
      { title: "A hundred dishes", detail: "Cook your favourite three for the people who ate the rest.", target: 100, week: 52, emoji: "summit" },
    ],
    members: [
      {
        handle: "marisol",
        daysAgo: 238,
        items: [
          { label: "Shakshuka", note: "The first new one. Eggs a bit too set, but I'm already making it again." },
          { label: "Pan con tomate" },
          { label: "French omelette", note: "Third try. Pale, rolled, no colour. Felt like a magic trick." },
          { label: "Miso soup" },
          { label: "Focaccia", note: "Dimpled it with my whole hand. Gone in an hour." },
          { label: "Pad kra pao" },
          { label: "Chicken adobo", note: "My grandmother's recipe, over the phone, in two languages." },
          { label: "Gazpacho" },
          { label: "Dal tadka" },
          { label: "Tortilla de patatas", note: "The flip. Over the sink. It held." },
          { label: "Banana bread" },
          { label: "Sourdough loaf", note: "Named the starter Gloria. Gloria is a beast." },
          { label: "Bibimbap" },
          { label: "Pozole rojo", note: "Took all day. Worth every minute." },
          { label: "Caesar salad from scratch" },
          { label: "Chicken katsu" },
          { label: "Ratatouille" },
          { label: "Pierogi", note: "Made 60, froze 40. Future me says thanks." },
          { label: "Pho bo", note: "Charred the onion and ginger on the gas flame. The whole flat smells of star anise." },
          { label: "Tiramisu" },
          { label: "Falafel" },
          { label: "Hummus" },
          { label: "Carbonara", note: "No cream. An Italian friend watched me like a hawk." },
          { label: "Kimchi fried rice" },
          { label: "Fish tacos", note: "Friends over, twelve tacos, zero leftovers. Camp three!" },
          { label: "Butter chicken" },
          { label: "Gnocchi" },
          { label: "Lemon tart" },
          { label: "Arepas" },
          { label: "Massaman curry" },
          { label: "Bao buns", note: "Pleats are hard. Taste is easy." },
          { label: "Paella", note: "Got the socarrat. Heard it crackle and didn't stir." },
          { label: "Ceviche" },
          { label: "Moussaka" },
          { label: "Laksa" },
          { label: "Churros" },
          { label: "Jollof rice", note: "A Nigerian friend says it's good. A Ghanaian friend says it's wrong. Both had seconds." },
          { label: "Spanakopita" },
          { label: "Ramen with tonkotsu broth", note: "Twelve hours of broth. The neighbours asked what I was doing." },
          { label: "Okonomiyaki" },
          { label: "Chiles rellenos" },
          { label: "Beef bourguignon" },
          { label: "Pavlova" },
          { label: "Gyoza" },
          { label: "Tom kha gai" },
          { label: "Pastel de nata" },
          { label: "Bánh xèo" },
          { label: "Risotto alla milanese" },
          { label: "Khachapuri", note: "An egg in a boat of bread. The best thing I've made all year." },
          { label: "Lamb tagine", note: "Halfway. Fifty dishes. Celebrated with the tagine and too much couscous." },
          { label: "Empanadas" },
          { label: "Fesenjan" },
          { label: "Chocolate soufflé", note: "It rose! Took a photo before it fell." },
          { label: "Char siu" },
          { label: "Mapo tofu" },
          { label: "Pasta e fagioli" },
          { label: "Green curry" },
          { label: "Cornbread" },
          { label: "Biryani", note: "Layered, sealed with dough, and opened at the table. Applause." },
          { label: "Croissants", note: "Three days, 27 layers, one tiny kitchen covered in flour." },
          { label: "Whole roast fish" },
          { label: "Pupusas" },
          { label: "Pad thai" },
          { label: "Borscht" },
          { label: "Crème brûlée" },
          { label: "Tteokbokki" },
          { label: "Mole poblano", note: "Twenty-two ingredients. My blender will never be the same." },
          { label: "Bouillabaisse" },
          { label: "Injera with misir wot", note: "Fermented the batter for three days. Ate with my hands." },
          { label: "Peking-style duck" },
          { label: "Baklava" },
          { label: "Eggs Benedict", note: "Number 72. Hollandaise on the second try." },
        ],
        plan: {
          summary:
            "Marisol cooks the same eight dinners on rotation and wants out. Two new dishes a week: an easy one on a weeknight and a project on Sunday, a bread every month, and a dinner for friends at each camp.",
          cadence: "Two new dishes a week: one weeknight, one Sunday project.",
        },
      },
      {
        handle: "rachelkim",
        daysAgo: 140,
        items: [
          { label: "Kimchi jjigae", note: "Mum's version. I called her twice." },
          { label: "Overnight oats" },
          { label: "Shakshuka" },
          { label: "Japchae" },
          { label: "Spaghetti aglio e olio", note: "Hotel kitchenette. A camping stove and one pan. It counts." },
          { label: "Lentil soup" },
          { label: "Bulgogi" },
          { label: "Galette des rois" },
          { label: "Thai green curry" },
          { label: "Dakgalbi", note: "Home for a week, finally a real kitchen." },
          { label: "Banana pancakes" },
          { label: "Minestrone" },
          { label: "Cacio e pepe", note: "Clumped twice. Third time silky." },
          { label: "Gyeranjjim" },
          { label: "Chocolate chip cookies" },
          { label: "Salmon teriyaki" },
          { label: "Pumpkin soup" },
          { label: "Kimbap", note: "Rolled twelve, sliced them all crooked, ate them anyway." },
        ],
        plan: {
          summary: "Rachel travels three weeks a month, so the plan works with hotel kitchenettes on the road and longer projects when she's home.",
          cadence: "One new dish a week, wherever the kitchen is.",
        },
      },
    ],
    openQuests: [
      q("Pick next week's two dishes", "One easy, one project. Shop on Saturday.", "weekly", 15),
      q("Cook a dish from a country you've never cooked from", "Look up how people actually make it at home.", "weekly", 25),
      q("Bake a bread", "Any bread. Knead it by hand.", "weekly", 25),
      q("Cook without a recipe on the counter", "Read it twice, then put it away.", "weekly", 20),
      q("A dinner for four", "Three dishes, one of them new.", "boss", 60),
      q("Make a dough by hand", "Pasta, dumplings or pastry.", "weekly", 20),
    ],
    doneQuest: (log) => q(`Cook ${log.label}`, "From scratch, start to finish.", "weekly", 25),
    space:
      "A chef's pass at the end of service: a long steel counter with order tickets clipped above it and plates coming out. Lead with the number of different dishes cooked, then each cook's plates as a grid of 100 round plates that fill with the dish's name as they cook them. Show the newest dishes as tickets on the rail. Warm kitchen colours: brushed steel, paper tickets, tomato red and herb green.",
  },

  // ----- Camino de Santiago -----
  {
    key: "camino",
    slug: "hike-the-camino-de-santiago",
    title: "Hike the Camino de Santiago",
    tagline: "772 km across Spain, from the Pyrenees to Santiago, in stages that fit your year.",
    description:
      "Walk the Camino Francés from Saint-Jean-Pied-de-Port to Santiago de Compostela, about 772 km, in one go or in stages across the year.\n\n" +
      "Log each day on the Camino in kilometres, with where you slept.",
    emoji: "map",
    theme: "sand",
    category: "travel",
    metric: { name: "km walked on the Camino", unit: "km", target: 772, aggregation: "sum" },
    camps: [
      { title: "Over the Pyrenees", detail: "Saint-Jean to Roncesvalles, the hardest day.", target: 25, week: 6, emoji: "summit" },
      { title: "Pamplona", detail: "The first city, 68 km in.", target: 68, week: 6, emoji: "flag" },
      { title: "Burgos", detail: "The cathedral, and the end of La Rioja.", target: 286, week: 8, emoji: "camp" },
      { title: "León", detail: "Across the Meseta, the long flat middle.", target: 465, week: 20, emoji: "map" },
      { title: "Sarria", detail: "Over O Cebreiro into Galicia. 115 km to go.", target: 657, week: 31, emoji: "compass" },
      { title: "Santiago de Compostela", detail: "The cathedral square, and the Compostela.", target: 772, week: 37, emoji: "trophy" },
    ],
    members: [
      {
        handle: "graceoc",
        daysAgo: 236,
        pace: 0,
        beats: [
          { daysAgo: 196, value: 25, note: "Saint-Jean to Roncesvalles. 1,200 m of climb in the rain. Pilgrims' mass at night and I nearly cried." },
          { daysAgo: 195, value: 22, note: "Roncesvalles to Zubiri. Knees complaining on the way down." },
          { daysAgo: 194, value: 21, note: "Zubiri to Pamplona. Pintxos with an Australian couple and a Korean student." },
          { daysAgo: 193, value: 24, note: "Pamplona to Puente la Reina, over the Alto del Perdón." },
          { daysAgo: 192, value: 22, note: "Puente la Reina to Estella." },
          { daysAgo: 191, value: 21, note: "Estella to Los Arcos. The wine fountain at Irache is real." },
          { daysAgo: 190, value: 28, note: "Los Arcos to Logroño. Blisters, plural." },
          { daysAgo: 189, value: 29, note: "Logroño to Nájera. Vineyards all day." },
          { daysAgo: 188, value: 21, note: "Nájera to Santo Domingo. There really are live chickens in the cathedral." },
          { daysAgo: 187, value: 23, note: "Santo Domingo to Belorado." },
          { daysAgo: 186, value: 24, note: "Belorado to San Juan de Ortega. Garlic soup at the monastery." },
          { daysAgo: 185, value: 26, note: "Into Burgos. Trip one done: 286 km. Home tomorrow, back in the summer." },
          { daysAgo: 108, value: 31, note: "Back in Burgos. Onto the Meseta: Burgos to Hontanas, wheat to the horizon." },
          { daysAgo: 107, value: 28, note: "Hontanas to Boadilla del Camino. Started at 5am to beat the heat." },
          { daysAgo: 106, value: 25, note: "Boadilla to Carrión de los Condes along the canal." },
          { daysAgo: 105, value: 27, note: "Carrión to Terradillos. 17 km without a single village. Long day." },
          { daysAgo: 104, value: 31, note: "Terradillos to El Burgo Ranero. Halfway point in Sahagún, got the certificate." },
          { daysAgo: 103, value: 19, note: "El Burgo Ranero to Mansilla de las Mulas." },
          { daysAgo: 102, value: 18, note: "Into León. Trip two done: 465 km. The cathedral windows at sunset." },
          { daysAgo: 29, value: 25, note: "Last trip. León to San Martín del Camino. Autumn now, cold mornings." },
          { daysAgo: 28, value: 24, note: "San Martín to Astorga. Chocolate museum. Of course." },
          { daysAgo: 27, value: 20, note: "Astorga to Rabanal del Camino. Gregorian chant at vespers." },
          { daysAgo: 26, value: 25, note: "Over the Cruz de Ferro to Molinaseca. Left the stone I carried from Dublin." },
          { daysAgo: 25, value: 31, note: "Molinaseca to Villafranca del Bierzo, past the Templar castle." },
          { daysAgo: 24, value: 28, note: "Up to O Cebreiro. Into Galicia, into the fog." },
          { daysAgo: 23, value: 21, note: "O Cebreiro to Triacastela. Downhill all day, cows on the path." },
          { daysAgo: 22, value: 18, note: "Triacastela to Sarria. 657 km. 115 to go, and I booked the last week for the end of November." },
        ],
        plan: {
          summary:
            "Grace can't take five weeks off, so she walks the Camino in three trips: Saint-Jean to Burgos at the end of April, Burgos to León in the summer, León to Sarria in October, and the last 115 km to Santiago in late November. Between trips, long walks at home on Saturdays with the pack.",
          cadence: "Three trips of a week or two, and a long walk with the pack on Saturdays.",
        },
      },
      {
        handle: "marcob",
        daysAgo: 200,
        pace: 0,
        beats: [
          { daysAgo: 196, value: 25, note: "Met Grace at the albergue in Saint-Jean. Walking together as far as Burgos." },
          { daysAgo: 195, value: 22, note: "Zubiri. My boots are too new. Lesson learned." },
          { daysAgo: 194, value: 21, note: "Pamplona. Running of the bulls street, no bulls, many pilgrims." },
          { daysAgo: 193, value: 24, note: "Alto del Perdón. The iron pilgrims on the ridge." },
          { daysAgo: 192, value: 22, note: "Estella." },
          { daysAgo: 191, value: 21, note: "Los Arcos." },
          { daysAgo: 190, value: 28, note: "Logroño. Calle Laurel, one pintxo per bar." },
          { daysAgo: 189, value: 29, note: "Nájera." },
          { daysAgo: 188, value: 21, note: "Santo Domingo." },
          { daysAgo: 187, value: 23, note: "Belorado." },
          { daysAgo: 186, value: 24, note: "San Juan de Ortega." },
          { daysAgo: 185, value: 26, note: "Burgos. 286 km. The rest next year, maybe." },
        ],
        plan: {
          summary: "Marco walks the first stretch with friends from Milan, as far as Burgos, and decides on the rest after the summer.",
          cadence: "One trip at the end of April.",
        },
      },
    ],
    openQuests: [
      q("A Saturday walk of 20 km with the pack", "Same boots, same socks as on the Camino.", "weekly", 25),
      q("Book the albergues for the last week", "Sarria to Santiago fills up early.", "one_off", 15),
      q("Two back-to-back long walks", "Saturday and Sunday, 15 km each.", "weekly", 30),
      q("Check the pack weighs under 8 kg", "Weigh it, then take one thing out.", "one_off", 15),
      q("Walk into Santiago", "The last 115 km and the cathedral square.", "boss", 100),
    ],
    doneQuest: (log, rng) =>
      rng.pick([
        q("Walk the next stage", "Start before sunrise, stop at the next albergue.", "daily", 20),
        q("Get the credencial stamped twice", "One at the albergue, one at a café or church.", "daily", 10),
        q("Look after your feet", "Vaseline in the morning, dry socks at lunch.", "daily", 10),
      ]),
    space:
      "A hand-drawn trail map of the Camino Francés across northern Spain, from Saint-Jean-Pied-de-Port to Santiago de Compostela, with the stage towns as dots along a dotted yellow-arrow path (Pamplona, Logroño, Burgos, León, Astorga, O Cebreiro, Sarria, Santiago). Each pilgrim is a marker at the km they've walked. Lead with the km walked and what's left to Santiago, and show the newest days as stamps in a pilgrim's credencial. Dusty sand, ochre, sky blue and the yellow Camino arrow.",
  },

  // ----- Oscar's half marathon -----
  {
    key: "oscar-half",
    slug: "strong-half-marathon",
    title: "Run a strong SF half marathon",
    tagline: "Prove your training on those SF hills and finish with gas left.",
    description:
      "The SF Marathon's half on July 25, run well. Three runs a week (easy, a workout and a long run that grows a little each week), strength on other days, and a taper into race day.\n\n" +
      "Log each run in miles, with its time and pace in the note.",
    emoji: "running",
    theme: "peach",
    category: "fitness",
    metric: { name: "miles run", unit: "mi", target: 600, aggregation: "sum" },
    step: 0.1,
    camps: [
      { title: "Base is back", detail: "You can run 60 minutes without stopping.", target: 50, on: "2026-11-29", emoji: "flag" },
      { title: "Run a fast 10K", detail: "Speed and hills feel controlled, not survival.", target: 220, on: "2027-02-14", emoji: "target" },
      { title: "Nail the 12 miler", detail: "You hold pace when tired past mile 10.", target: 380, on: "2027-04-25", emoji: "map" },
      { title: "Tune up half", detail: "Race pace feels familiar for 10 miles.", target: 520, on: "2027-06-20", emoji: "summit" },
      { title: "Race day", detail: "13.1 miles through SF, strong to the line.", target: 600, on: "2027-07-25", emoji: "trophy" },
    ],
    members: [
      {
        handle: "oscarruns",
        daysAgo: 28,
        weekdays: [0, 0, 0, 0, 0, 0, 0],
        beats: [
          { daysAgo: 28, value: 1.5, note: "First run · 16:45 · 11:10/mi · 1.5 miles easy at Jonathan Rogers Park, 3 laps, feeling great." },
          { daysAgo: 26, value: 1.5, note: "Easy run · 16:33 · 11:02/mi · Same 3 laps. Legs a bit heavy, kept it slow." },
          { daysAgo: 24, value: 2, long: true, note: "Long run · 22:48 · 11:24/mi · 4 laps of Jonathan Rogers Park. Walked 30 seconds after lap 3." },
          { daysAgo: 21, value: 2, note: "Easy run · 21:56 · 10:58/mi · Main Street down to the park and back." },
          { daysAgo: 19, value: 2.1, note: "Workout · 22:14 · 10:35/mi · Easy mile, then 4 strides of 20 seconds." },
          { daysAgo: 17, value: 2.6, long: true, note: "Long run · 28:52 · 11:06/mi · Seawall from Science World. First time past 2.5." },
          { daysAgo: 14, value: 2.2, note: "Easy run · 23:48 · 10:49/mi · Jonathan Rogers Park, 4 laps and a bit." },
          { daysAgo: 12, value: 2.5, note: "Workout · 25:40 · 10:16/mi · Tempo: the middle mile at 9:52." },
          { daysAgo: 10, value: 3.1, long: true, note: "Long run · 34:03 · 10:59/mi · First 5K ever. Trout Lake loops, ran the whole thing." },
          { daysAgo: 7, value: 2.4, note: "Easy run · 25:53 · 10:47/mi · Rain. Went anyway." },
          { daysAgo: 5, value: 2.6, note: "Workout · 26:23 · 10:09/mi · Hill repeats at Queen Elizabeth Park, 5 x 1 minute." },
          { daysAgo: 3, value: 3.6, long: true, note: "Long run · 39:22 · 10:56/mi · Seawall again. Tried a gel at mile 2." },
          { daysAgo: 1, value: 2.5, note: "Easy run · 26:42 · 10:41/mi · Back to Jonathan Rogers Park. 5 laps, felt easy." },
        ],
        plan: {
          summary:
            "Oscar runs three times a week: an easy run, a workout and a long run that grows a little each week, most of it slow enough to talk. He lifts on three other days and keeps one full rest day. The long run grows from 1.5 miles to 12 by late April. June is race pace and SF hills, then a two-week taper into race day at the SF Marathon on July 25.",
          cadence: "3 runs + 3 strength days a week, 1 rest day. Check-in Sun.",
        },
        space:
          "Make my page a running log like the best running apps: clean, sporty and all about my runs. Open with race day at the SF Marathon: one big count of the days until it, the race date, and a progress line from my first run to race day with each camp of my plan as a dot on it: the first run's date under its left end, race day's date under its right end, and only the next camp named, above the line. Then four stat tiles: total miles, longest run, average pace and this week's miles. Then a bar chart of my weekly miles, one bar per week since I started, with this week's bar highlighted. Weeks run Monday to Sunday, counted from the runs' own dates, in the chart and in the this-week tile alike. Then my newest five runs, each a card like a run activity: its name and date, then distance, pace and time side by side in big numbers with small units, so a pace like 10:56 /mi fits on a phone, and the rest of the note under it in small text. Then my earlier runs, one compact line each: date, name, distance and pace. Last, my personal bests in one row: longest run, fastest pace, and my first 5K, which is my earliest run of 3.1 miles or more. Each run's note starts with its name, time and pace, like \"Long run · 39:22 · 10:56/mi · ...\". White cards, one bold orange accent, crisp numbers, thin dividers. No maps, no favourites or stars, no buttons.",
      },
    ],
    openQuests: [
      q("Long run: 4 miles easy", "Slow enough to talk the whole way. Walk breaks are fine.", "weekly", 30),
      q("Tempo: the middle mile at 9:45", "An easy mile either side.", "weekly", 25),
      q("Easy run: 2.5 miles", "Any route. Keep it relaxed.", "weekly", 20),
      q("Strength: legs and core, three times", "Squats, lunges, calf raises, plank. 30 minutes.", "weekly", 20),
      q("Sign up for the SF Marathon half", "Make race day real.", "one_off", 15),
    ],
    doneQuest: (log) => {
      const v = log.value ?? 0;
      if (v >= 3) return q(`Long run: ${v} miles easy`, "Slow enough to talk. Walk breaks are fine.", "weekly", 30);
      return q("Three runs this week", "An easy run, a workout and a long run.", "weekly", 25);
    },
    space:
      "A dawn park loop seen from above, with mile cones out to a half-marathon finish arch at 13.1. Lead with the miles everyone has run together, then each runner's longest run as a figure on the loop, and the newest runs as small race-bib cards with their notes.",
  },
];

// ---------- The film's friends ----------

/**
 * Challenges the film's friends started on the live site, each from its own account. The seed gives each a lived-in
 * history like a demo climber's, at its own stage of the year: the slug is the live challenge, the one member its
 * creator, whose account it labels demo. Their covers, Muses and pages stay as they are.
 */
const FRIENDS: HistorySpec[] = [
  {
    key: "friend-bek",
    slug: "send-a-v5-boulder-cleanly",
    title: "Send a V5 boulder cleanly",
    metric: { name: "top v-grade sent", unit: "V", target: 5, aggregation: "latest" },
    camps: [
      { title: "Lock in clean V2", detail: "Every V2 in the gym, clean.", target: 2, week: 3, emoji: "flag" },
      { title: "Break into V3", detail: "Your first V3 send.", target: 3, week: 13, emoji: "camp" },
      { title: "Hold steady at V4", detail: "V4s in a normal session, not just on a good day.", target: 4, week: 26, emoji: "target" },
      { title: "Project your V5", detail: "One V5, worked move by move.", target: 5, week: 39, emoji: "map" },
      { title: "Send V5 for real", detail: "Top out clean, no dabs.", target: 5, week: 52, emoji: "summit" },
    ],
    members: [
      {
        handle: "bek",
        daysAgo: 230,
        pace: 0,
        beats: [
          { daysAgo: 230, value: 1, note: "First session logged. Every V1 clean, close on the V2s, fell off every V3." },
          { daysAgo: 216, value: 2, note: "Clean V2 circuit: five problems, no falls." },
          { daysAgo: 198, value: 2, note: "First time on the fingerboard. Humbling." },
          { daysAgo: 181, value: 3, note: "First V3! The blue one in the cave. I may have yelled." },
          { daysAgo: 170, value: 3, note: "Two more V3s. The footwork drills are paying off." },
          { daysAgo: 152, value: 3, note: "Filmed my attempts. My hips are way too far from the wall." },
          { daysAgo: 131, value: 3, note: "Deload week done. Fingers feel strong again." },
          { daysAgo: 110, value: 3, note: "Sent the slab V3 everyone avoids." },
          { daysAgo: 92, value: 4, note: "V4!! The crimpy one on the overhang, after eleven sessions on it." },
          { daysAgo: 75, value: 4, note: "Second V4, with a heel hook I'd never have tried in spring." },
          { daysAgo: 58, value: 4, note: "First weekend outside, at Joshua Tree. A V3 and a V4 on real rock." },
          { daysAgo: 40, value: 4, note: "Three V4s in one session. V4 is my normal now." },
          { daysAgo: 24, value: 4, note: "Started projecting the V5 in the corner. Got the first three moves." },
          { daysAgo: 9, value: 4, note: "Linked the V5's crux for the first time. Fell on the last move." },
          { daysAgo: 2, value: 4, note: "V4 repeats and ten goes on the V5. So close." },
        ],
        plan: {
          summary:
            "Bek climbs solid V2 and wants a real V5 by next autumn. Two strength sessions and one volume session a week, one project at a time, filmed attempts to fix the beta, and a deload week every month to keep the fingers healthy.",
          cadence: "3 bouldering sessions a week, check-in on Sundays.",
        },
      },
    ],
    openQuests: [
      q("Ten tries on the V5, then rest", "Film the last three. Watch them before the next session.", "weekly", 25),
      q("Fingerboard: 7 seconds on, 3 off", "Six hangs, three sets. Stop at the first tweak.", "weekly", 20),
      q("Silent feet on five V3s", "No sound when your foot lands on the hold.", "weekly", 15),
      q("A rest day you don't skip", "Stretch, walk, sleep.", "weekly", 10),
      q("Send the V5", "Top out clean, no dabs.", "boss", 100),
    ],
    doneQuest: (log) => q(`Send a V${log.value ?? 3} in one session`, "Warm up properly first.", "weekly", 25),
  },
  {
    key: "friend-joshua",
    slug: "read-the-odyssey-in-ancient-greek",
    title: "Read the Odyssey in Ancient Greek",
    metric: { name: "lines of homer read in greek", unit: "lines", target: 12110, aggregation: "sum" },
    camps: [
      { title: "First hundred lines", detail: "The proem and Athena at Ithaca.", target: 100, week: 3, emoji: "seedling" },
      { title: "Through book four", detail: "Telemachus finds out his father might be alive.", target: 2000, week: 15, emoji: "books" },
      { title: "Past the sirens", detail: "Book twelve: the wanderings, done.", target: 6000, week: 28, emoji: "map" },
      { title: "Ithaca in sight", detail: "Odysseus home in disguise.", target: 9500, week: 42, emoji: "compass" },
      { title: "The whole Odyssey", detail: "All 12,110 lines, in Greek.", target: 12110, week: 52, emoji: "summit" },
    ],
    shortNotes: ["Reread", "With the audio", "Vocab review", "Morning lines", "Late lines"],
    members: [
      {
        handle: "joshua",
        daysAgo: 222,
        pace: 0.75,
        amount: [28, 54],
        noteRate: 0.1,
        beats: [
          { daysAgo: 222, note: "Andra moi ennepe, Mousa. Read the first line out loud ten times before I could stop." },
          { daysAgo: 200, note: "Telemachus finally speaks up in the assembly. So did I, to my cat, in Greek." },
          { daysAgo: 183, note: "Nestor tells the same story three ways. I now know four words for ship." },
          { daysAgo: 158, note: "Book four is long. Menelaus will not stop talking. Pushing through." },
          { daysAgo: 137, note: "Calypso's island. The participles are getting easier, the longing isn't." },
          { daysAgo: 119, note: "Nausicaa and the laundry. My favourite scene so far." },
          { daysAgo: 105, value: 40, note: "Forty lines with only three dictionary lookups. A record." },
          { daysAgo: 73, note: "The Cyclops! Outis, Nobody. The pun works so much better in Greek." },
          { daysAgo: 58, note: "Aeolus and the bag of winds. Of course the crew opened it." },
          { daysAgo: 48, note: "Circe turns them into pigs. Learned the word for pig: sus. Unforgettable." },
          { daysAgo: 40, value: 20, note: "Rough week, only twenty lines a night. Twenty lines is still twenty lines." },
          { daysAgo: 30, note: "The underworld, book eleven. Achilles would rather be a living farmhand. Heavy." },
          { daysAgo: 12, note: "The Sirens. Read it with the audio and the hexameter finally sounded like music." },
          { daysAgo: 7, note: "Scylla and Charybdis. Six men gone in four lines." },
          { daysAgo: 1, note: "Odysseus wakes up on Ithaca and doesn't recognise it. Neither did I: new words everywhere." },
        ],
        plan: {
          summary:
            "Joshua reads all 12,110 lines with a beginner's Homer reader, its vocabulary and notes. Short sessions most days beat long weekend slogs, with rereading and the audio to hear the hexameter. The year moves in arcs: the Telemachy, the wanderings, then the homecoming.",
          cadence: "Most days, 25 minutes. Check-in on Sundays.",
        },
      },
    ],
    openQuests: [
      q("Read 40 lines with the audio", "Read them first, then listen, then read again.", "daily", 15),
      q("Learn twenty words from book thirteen", "The ones that come back more than twice.", "weekly", 20),
      q("Reread last week's lines without notes", "Mark every word you still had to look up.", "weekly", 20),
      q("Scan five lines of hexameter", "Long, short, short. Out loud.", "weekly", 15),
      q("Finish book thirteen", "Odysseus back on Ithaca.", "boss", 60),
    ],
    doneQuest: (_log, rng) =>
      rng.pick([
        q("Read 40 lines with the audio", "Read them first, then listen, then read again.", "daily", 15),
        q("Reread last week's lines without notes", "Mark every word you still had to look up.", "weekly", 20),
        q("Learn twenty new words", "The ones that come back more than twice.", "weekly", 20),
      ]),
  },
  {
    key: "friend-julaiti",
    slug: "publish-24-videos-in-a-year",
    title: "Publish 24 videos in a year",
    metric: { name: "videos published", unit: "videos", target: 24, aggregation: "count" },
    camps: [
      { title: "First upload done", detail: "Shot on a phone, published anyway.", target: 1, week: 3, emoji: "flag" },
      { title: "Find your format", detail: "Six videos and one format you can repeat.", target: 6, week: 13, emoji: "camera" },
      { title: "Halfway library", detail: "Twelve videos on the channel.", target: 12, week: 26, emoji: "camp" },
      { title: "Confident creator run", detail: "Eighteen, and filming in batches.", target: 18, week: 39, emoji: "rocket" },
      { title: "Twenty-four video catalog", detail: "Two a month for a year.", target: 24, week: 52, emoji: "summit" },
    ],
    members: [
      {
        handle: "julaiti",
        daysAgo: 226,
        items: [
          { label: "What I'll make this year", note: "First video. Two minutes, shot on my phone, nine takes. Published." },
          { label: "My desk setup for $200", note: "The light was terrible. People watched anyway." },
          { label: "A day of deep work, in 60 seconds" },
          { label: "Three apps I deleted this month", note: "Most views so far. Short and specific wins." },
          { label: "How I plan a video in 20 minutes" },
          { label: "I tried cold showers for 30 days", note: "Found the format: a 30-day try, then what changed. Six videos, camp two." },
          { label: "I tried waking up at 5am for 30 days" },
          { label: "My editing workflow, start to finish" },
          { label: "I tried no social media for 30 days", note: "First video over 10,000 views. Read every comment." },
          { label: "Filming 4 videos in one Saturday", note: "Batch day worked. Four scripts, one outfit change." },
          { label: "I tried learning to draw for 30 days" },
          { label: "Halfway: what 12 videos taught me", note: "Twelve videos. Made one about it, obviously." },
          { label: "I tried running every day for 30 days" },
          { label: "The camera I actually use" },
          { label: "I tried cooking every meal for 30 days" },
          { label: "Why my first videos were bad", note: "Watched video one again. Cringed. Kept it up." },
          { label: "I tried a 30-day digital detox with my family", note: "Seventeen. My mum is in this one and she was the star." },
        ],
        plan: {
          summary:
            "Julaiti publishes two videos a month. Short phone videos first to lower the bar, then one format he can repeat, then filming in batches so busy weeks still ship. The year ends with a small series and one flagship video.",
          cadence: "One shoot-and-edit block a week, check-in on Sundays.",
        },
      },
    ],
    openQuests: [
      q("Write the next two scripts", "One page each. Hook in the first line.", "weekly", 20),
      q("A batch Saturday: film two videos", "Same setup, one outfit change.", "weekly", 30),
      q("Edit in one sitting", "Ninety minutes, then export.", "weekly", 20),
      q("Reply to every comment on the last video", "Note one idea for a future video.", "weekly", 10),
      q("Plan the flagship video", "The one you'll put at the top of the channel.", "boss", 60),
    ],
    doneQuest: (log) => q(`Publish "${log.label}"`, "Thumbnail, title, publish. Don't polish forever.", "weekly", 30),
  },
  {
    key: "friend-guzus",
    slug: "collect-1-million-in-twelve-months",
    title: "Collect $1 million in twelve months",
    metric: { name: "dollars collected", unit: "$", target: 1000000, aggregation: "sum" },
    camps: [
      { title: "First ten thousand", detail: "Proof that someone pays for the offer.", target: 10000, week: 3, emoji: "flag" },
      { title: "Repeatable hundred k", detail: "The same offer, sold again and again.", target: 100000, week: 13, emoji: "chart" },
      { title: "Scale past yourself", detail: "Contractors and partners, so income grows past your hours.", target: 350000, week: 26, emoji: "rocket" },
      { title: "Two thirds banked", detail: "$650,000 collected.", target: 650000, week: 39, emoji: "money" },
      { title: "Million collected", detail: "One million dollars, in twelve months.", target: 1000000, week: 52, emoji: "summit" },
    ],
    members: [
      {
        handle: "guzus",
        daysAgo: 228,
        pace: 0,
        beats: [
          { daysAgo: 221, value: 4000, note: "First client, first invoice paid. A two-week AI automation audit." },
          { daysAgo: 209, value: 6500, note: "Second audit. Ten thousand: the offer works." },
          { daysAgo: 193, value: 12000, note: "Raised the price. They said yes without blinking." },
          { daysAgo: 178, value: 15000, note: "Turned the audit into a fixed six-week build." },
          { daysAgo: 160, value: 18000, note: "Referral from client two." },
          { daysAgo: 147, value: 22000, note: "Twenty sales calls this month, three closed." },
          { daysAgo: 133, value: 25000, note: "Repeatable hundred k. Same offer, same deck, every time." },
          { daysAgo: 118, value: 30000, note: "First contractor hired. I stopped doing the builds myself." },
          { daysAgo: 104, value: 38000, note: "Biggest deal so far: a logistics company, three teams." },
          { daysAgo: 89, value: 42000, note: "Partner agency resells the offer now." },
          { daysAgo: 72, value: 45000, note: "Two contractors, two builds at once." },
          { daysAgo: 55, value: 48000, note: "Third partner signed. The pipeline is the biggest it has been." },
          { daysAgo: 38, value: 36000, note: "Slower month. A deal slipped to next quarter." },
          { daysAgo: 21, value: 33000, note: "Productized the audit, clients book it from the website now. Past $350,000: scale past yourself, done." },
          { daysAgo: 6, value: 38000, note: "$412,500 collected. Two-thirds is next." },
        ],
        plan: {
          summary:
            "Guzus won't get there from one job, so the plan is one high-ticket offer sold hard: ten thousand fast to prove demand, a repeatable sales system next, then contractors and partners so income grows past his hours. The last months push volume with the system that works.",
          cadence: "5 focused sessions a week, 60–90 min. Check-in on Sundays.",
        },
      },
    ],
    openQuests: [
      q("Twenty sales conversations this week", "Log every one, even the no's.", "weekly", 25),
      q("Follow up on every open proposal", "A short note with one new reason to say yes.", "weekly", 15),
      q("Ask your three best clients for a referral", "By name: who else should hear about this?", "weekly", 20),
      q("Raise the price on the next proposal", "Ten percent. See what happens.", "one_off", 20),
      q("Close a deal over $50,000", "The biggest one yet.", "boss", 80),
    ],
    doneQuest: (_log, rng) =>
      rng.pick([
        q("Twenty sales conversations this week", "Log every one, even the no's.", "weekly", 25),
        q("Send three proposals", "Same offer, written for each client.", "weekly", 20),
        q("Follow up on every open proposal", "A short note with one new reason to say yes.", "weekly", 15),
      ]),
  },
  {
    key: "friend-tasos",
    slug: "taste-20-different-cuisines-in-a-year",
    title: "Taste 20 different cuisines in a year",
    metric: { name: "different cuisines tried", unit: "cuisines", target: 20, aggregation: "distinct" },
    camps: [
      { title: "First three tastes", detail: "Three cuisines you'd never eaten.", target: 3, week: 3, emoji: "flag" },
      { title: "Across eight regions", detail: "Eight cuisines, on at least four continents.", target: 8, week: 13, emoji: "map" },
      { title: "Baker's dozen plates", detail: "Thirteen cuisines.", target: 13, week: 26, emoji: "compass" },
      { title: "Down to the last three", detail: "Seventeen down.", target: 17, week: 39, emoji: "camp" },
      { title: "Twenty cuisine finish", detail: "A final tasting week, and all twenty ranked.", target: 20, week: 52, emoji: "trophy" },
    ],
    members: [
      {
        handle: "tasos",
        daysAgo: 210,
        items: [
          { label: "Ethiopian", note: "Doro wat and injera, eaten with my hands. 5/5." },
          { label: "Georgian", note: "Khachapuri adjaruli. Cheese, butter, an egg. 5/5." },
          { label: "Peruvian", note: "Ceviche with leche de tigre. 4/5." },
          { label: "Burmese", note: "Tea leaf salad. Crunchy, sour, nothing like I expected. 5/5." },
          { label: "Lebanese", note: "Cooked it myself: fattoush and toum. 4/5." },
          { label: "Filipino", note: "Sisig at a food truck. 4/5." },
          { label: "Uzbek", note: "Plov at a friend's family dinner. They sent me home with a whole container. 5/5." },
          { label: "Korean", note: "Ganjang gejang, raw crab in soy. Brave. 3/5." },
          { label: "Sichuan", note: "Mapo tofu that numbed my whole face. 5/5." },
          { label: "Oaxacan", note: "Mole negro, made at home, all afternoon. 4/5." },
          { label: "Eritrean", note: "Zigni at the place two blocks from the Ethiopian one. Different, and both great." },
          { label: "Malaysian", note: "Nasi lemak for breakfast. 5/5." },
          { label: "Nigerian", note: "Egusi soup and pounded yam. Thirteen cuisines. 4/5." },
          { label: "Sri Lankan", note: "Hoppers with an egg in the middle. Fourteen. 5/5." },
        ],
        plan: {
          summary:
            "Tasos works through a list of 20 cuisines, mixing restaurants and his own kitchen: an easy local one, then a harder one that needs planning. Each gets the dish, where he had it and a rating out of 5. The year ends with a tasting week and all twenty ranked.",
          cadence: "A new cuisine every week or two.",
        },
      },
    ],
    openQuests: [
      q("Book the next two tastings", "One restaurant, one dinner at home.", "weekly", 15),
      q("Cook a cuisine you've only eaten out", "Ask the restaurant what to try first.", "weekly", 25),
      q("Ask someone from that country where to eat", "Go where they go.", "weekly", 15),
      q("Rank your top five so far", "With one line on why.", "one_off", 15),
      q("A tasting week: three cuisines in seven days", "The last three on your list.", "boss", 60),
    ],
    doneQuest: (log) => q(`Try ${log.label} food`, "The dish people from there love most.", "weekly", 25),
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

/**
 * Removes everything demo people did in the demo challenges, but keeps the demo users and challenges (and their covers
 * and spaces), and what demo people did in challenges they started themselves on the live site.
 */
function resetDemoHistory() {
  const who = "SELECT id FROM users WHERE is_demo = 1 AND substr(id, 1, 8) = 'usr_demo'";
  const inDemo = "substr(challenge_id, 1, 8) = 'chl_demo'";
  exec(`DELETE FROM cheers WHERE user_id IN (${who}) AND log_id IN (SELECT id FROM logs WHERE ${inDemo})`);
  exec(`DELETE FROM activity WHERE user_id IN (${who}) AND kind != 'space' AND ${inDemo}`);
  exec(`DELETE FROM logs WHERE user_id IN (${who}) AND ${inDemo}`);
  exec(`DELETE FROM quests WHERE user_id IN (${who}) AND ${inDemo}`);
  exec(`DELETE FROM plans WHERE user_id IN (${who}) AND ${inDemo}`);
  exec(`DELETE FROM memberships WHERE user_id IN (${who}) AND ${inDemo}`);
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

/** Join times: the creator starts the challenge, everyone else joins later. */
function joinRuns(spec: HistorySpec, users: Map<string, SeedUser>, now: number): MemberRun[] {
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
  return runs;
}

function seedChallenge(spec: ChallengeSpec, users: Map<string, SeedUser>, now: number, counts: Counts): { slug: string; members: number } {
  const cid = demoId("chl", spec.key);
  const runs = joinRuns(spec, users, now);
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
    createdAt: isoAt(runs[0].joinAt),
    updatedAt: isoAt(now),
  });
  counts.active_challenges++;
  seedHistory(spec, cid, runs, now, counts);
  return { slug, members: runs.length };
}

/** Each member's history in the challenge, then the cheers between them. */
function seedHistory(spec: HistorySpec, cid: string, runs: MemberRun[], now: number, counts: Counts) {
  const crng = new Rng(`challenge:${spec.key}`);
  const pool = spec.notes ? crng.shuffle(spec.notes) : [];
  const step = spec.step ?? 1;
  for (const [i, r] of runs.entries()) simulateMember(spec, cid, r, i === 0, pool, step, now, counts);

  // Cheers between members.
  const rng = new Rng(`cheers:${spec.key}`);
  let lastAt = runs[0].joinAt;
  for (const r of runs) {
    for (const log of r.logs) {
      lastAt = Math.max(lastAt, log.at);
      const others = runs.filter((o) => o.user.id !== r.user.id && o.joinAt < log.at);
      if (!others.length) continue;
      const p = log.crossed ? 0.85 : log.label != null ? (log.note ? 0.7 : 0.45) : log.note ? 0.42 : 0.18;
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
}

/**
 * One of the film's friends' challenges, given its history afresh: what its creator did in it before is replaced, and
 * their account is labelled demo and guided by Muse. Anyone else's part in it stays.
 */
function seedFriend(spec: HistorySpec, now: number, counts: Counts): string | null {
  const m = spec.members[0];
  const row = one<{ cid: string; uid: string; name: string; tz: string; avatar: Avatar; style: string | null }>(
    `SELECT c.id AS cid, u.id AS uid, u.display_name AS name, u.timezone AS tz, u.avatar, u.motivation_style AS style
       FROM challenges c JOIN users u ON u.id = c.creator_id WHERE c.slug = ? AND u.handle = ?`,
    spec.slug,
    m.handle,
  );
  if (!row) return null;
  exec("DELETE FROM cheers WHERE log_id IN (SELECT id FROM logs WHERE challenge_id = ? AND user_id = ?)", row.cid, row.uid);
  exec("DELETE FROM activity WHERE challenge_id = ? AND user_id = ? AND kind != 'space'", row.cid, row.uid);
  for (const table of ["logs", "quests", "plans", "memberships"]) exec(`DELETE FROM ${table} WHERE challenge_id = ? AND user_id = ?`, row.cid, row.uid);
  const user: SeedUser = {
    handle: m.handle,
    name: row.name,
    tz: row.tz,
    avatar: row.avatar,
    style: row.style ?? "",
    agent: "muse",
    hours: [[19, 22]],
    id: row.uid,
    firstJoin: Number.POSITIVE_INFINITY,
    lastLog: 0,
  };
  const runs = joinRuns(spec, new Map([[m.handle, user]]), now);
  seedHistory(spec, row.cid, runs, now, counts);
  const joined = runs[0].joinAt;
  exec("UPDATE challenges SET created_at = ? WHERE id = ?", isoAt(joined), row.cid);
  exec(
    "UPDATE users SET is_demo = 1, agent_kind = 'muse', created_at = ?, agent_seen_at = ? WHERE id = ?",
    isoAt(joined - 10 * MIN),
    isoAt(Math.min(user.lastLog, now - MIN)),
    row.uid,
  );
  return spec.slug;
}

type Raw = { d: number; value: number | null; label: string | null; note: string | null; hour?: number; long?: boolean };

function rawLogs(spec: HistorySpec, m: MemberSpec, today: string, step: number, rng: Rng): Raw[] {
  const inGap = (d: number) => (m.gaps ?? []).some(([from, to]) => d <= from && d >= to);
  // A count log is one of something, so like a real one it carries no number.
  const val = (v: number) => (spec.metric.aggregation === "count" ? null : v);
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
      out.push({ d, value: val(beat.value ?? roundTo(rng.float(...(m.amount ?? [1, 2])), step)), label: null, note: beat.note, long: beat.long });
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
          out.push({ d, value: val(m.ritual.amount + rng.pick([-10, -5, 0, 0, 0, 5])), label: null, note: notes[week % notes.length], hour: m.ritual.hour });
        }
        continue;
      }
    }
    if (!phase && m.long && wd === m.long.weekday) {
      if (rng.chance(m.long.chance)) out.push({ d, value: val(roundTo(rng.float(...m.long.amount), step)), label: null, note: null, long: true });
      continue;
    }
    const p = phase ? phase.weekdays[wd] : m.weekdays ? m.weekdays[wd] : (m.pace ?? 0.7);
    if (!rng.chance(p)) continue;
    out.push({ d, value: val(roundTo(rng.float(...amount), step)), label: null, note: null });
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
  spec: HistorySpec,
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
    const win = raw.hour != null ? ([raw.hour, raw.hour] as [number, number]) : rng.pick(m.hours ?? user.hours);
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
  const questCount = m.items ? Math.floor(eligible.length * 0.5) : Math.min(9, Math.round(logs.length * 0.12));
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
    else if (spec.metric.aggregation === "latest") total = log.value ?? total;
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
      let due = "on" in c ? c.on : campDue(startsOn, endsOn, c.week);
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

/** Puts each demo climber at their city on the world map. */
export function placeDemoClimbers(): number {
  let n = 0;
  for (const u of USERS) {
    const [name, cc] = DEMO_CITIES[u.handle] ?? [];
    const c = name ? findCity(name, cc) : null;
    if (!c) continue;
    exec("UPDATE users SET city = ? WHERE id = ?", c.key, demoId("usr", u.handle));
    n++;
  }
  return n;
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
    for (const spec of FRIENDS) if (seedFriend(spec, now, counts)) out.push({ slug: spec.slug, title: spec.title, status: "active", members: 1 });
    finishUsers(users, now, counts);
    placeDemoClimbers();
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
