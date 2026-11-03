# Footnotes — project brief

Footnotes is a travel guide that lives in your glasses. It sees what you see, knows where you are, and tells you about the place you're walking through at the moment it becomes interesting, so you can keep your head up and your phone in your pocket.

> Keep your head up. The world has footnotes.

This brief describes the product vision. It says what the product must do and why, and leaves the how to the plan.

## The job to be done

A curious person walks through a city they don't know. They pass a strange building, an odd intersection, a statue nobody explains. To find out what it is, they stop, take out their phone, search, and read Wikipedia on the pavement. By the time they look up, the moment is gone, and they've spent the walk looking at a screen instead of the place they came to see.

Often they don't even know what to ask. They only know that the place has stories, and that a good local friend walking beside them would tell those stories at the right time.

The job is: **tell me about the world around me while I'm in it, without making me look away from it.**

The first user is a curious traveler on foot. The same job applies to a local who has walked past the same buildings for years and never learned why they look the way they do.

## Where the idea comes from

Oscar travels a lot and is curious about everything he sees. Most of the time that curiosity ends with him looking down at his phone, reading Wikipedia, when he wants to be looking at the real world. Footnotes is the travel companion he wants: an AI agent with eyes and ears, worn on the face, that does the reading for him and talks to him about it.

Other people have wanted the same thing:

- **Patrick Collison (May 30, 2025)** [asked for](https://x.com/patrickc/status/1928509708190757294) an AI that lives in his AirPods and keeps telling him interesting facts about nearby places, such as the history of the San Mateo Bridge as he drives over it.
- **Marta Jamrozik (May 15, 2025)** [described an app she built](https://x.com/marta_jamrozik/status/1923033247392596333): photograph something and get a two-minute audio tour of its art or history.
- **Patrick O'Shaughnessy (August 2, 2024)** [used GPT-4o](https://x.com/patrick_oshag/status/1819383519442882845) to narrate the history of landmarks while driving, and imagined a personal audio guide to the whole world, connected to GPS and vision.
- **Detour (2014)**, from Andrew Mason, was the pre-AI version: [location-aware audio walks](https://techcrunch.com/2014/07/30/detour/) that played the right story as you reached each spot. The experience was loved, but every tour was written and recorded by hand for one route, so it could only cover a few places.

**Why now.** All of these point to the same gap: a guide made on the spot for the exact thing in front of you, anywhere. Two things close that gap in 2026. Models now understand what a camera sees well enough to talk about a specific building, sign or street corner, not only a famous landmark. And Meta's Wearables Device Access Toolkit reached 1.0 in September 2026, so an app can use the glasses' camera, microphone and speakers. Google added Gemini walking tours to Maps in January 2026, which shows the demand. Footnotes is different because it works from what you're looking at and keeps you off the phone.

## The core idea

**Footnotes is ambient.** It's a mix of a podcast and a live conversation. It talks when there's something worth saying and stays quiet when there isn't, like a good human guide. You can let it tell the story or cut in at any moment with a question.

**It knows what you're looking at.** The guide gets the camera view from the glasses and your location. "Tell me about this building", "why does this intersection look like that?" and "what's that up there?" mean the thing in front of you, now. When it can't tell which thing you mean, it asks, the way a guide would ("the one with the green dome?").

**It works anywhere.** No city is prepared in advance. The guide works from what the camera sees, where you are and what the model knows, so it can give a personal audio tour on any street in the world. Some streets have more to say than others, and it says less there.

**It learns you as you talk.** There's no onboarding and no interest picker. The guide notices what you ask about and what you react to, and it shifts what it notices and how deep it goes. If you keep asking about architecture, you hear more about architecture. This lives in the guide's instructions; nothing about interests is hard-coded.

## Product principles

- **Head up.** Every design choice keeps the person's eyes on the world. The phone is a companion for settings and the recap, not a screen to walk with.
- **Just in time.** A fact is worth most at the moment its subject is in view. Commentary about something the person has already walked past is late, and the guide treats it that way.
- **Let the model figure it out.** We don't list the kinds of places, topics or interests the guide handles. The model reasons about what's interesting here, for this person, right now. When a choice comes up between a hand-built rule and better context for the model, choose the context.
- **No setup.** The first walk starts the moment you put the glasses on. Everything the guide knows about you, it learns by talking with you.
- **The person sets the volume.** How much the guide talks is the person's choice, from near-silence to a full podcast.
- **One voice.** The guide has one well-made default voice and personality: a warm, witty local friend. If you want a different tone, you ask for it in conversation.

## The experience

### Walking

You put on the glasses and start walking. The guide listens to where you are and watches what's in front of you. On an ordinary stretch of street, it says nothing. Then something interesting comes into view, and it speaks up briefly, just as you'd want to know.

### Asking

At any time, you ask about what you see: "what's that?", "why is this building a different colour?", "who's the statue?" The guide answers about the exact thing in view and takes follow-up questions as a normal conversation.

### Interrupting

You can talk over the guide at any time. It stops at once and follows you, whether you want it to be quiet, go deeper, or talk about something else.

### Learning what you like

As you talk, the guide learns what you care about. Later commentary on the same walk reflects it: the person who asked about three façades hears about the fourth one, and the person who asked about food hears about the bakery instead.

### How chatty it is

A slider in the companion app sets how much the guide talks. At one end it's mostly silent, with an occasional comment. At the other end it's like listening to a podcast about the city, made live for your route, with you free to chime in. The default is near the quiet end.

### The recap

When the walk ends, you get a map of the route you walked with a pin at each place the guide spoke. Each pin holds the view from that moment, a line or two of what was said, and a link to read more. These are the walk's footnotes.

The recap is also a shareable image, in the spirit of the Strava activity graphic: your route, the places you learned about and a few highlights, designed to post on social media. Every shared walk shows someone else what Footnotes is.

## The demo

The prototype builds only what the demo video shows. The demo is a real walk outside on the Meta glasses, and it shows these moments in one continuous walk:

1. The guide chimes in unprompted as something interesting comes into view.
2. The walker asks "what's that?" and gets an answer about that exact thing.
3. The walker talks over the guide to stop it or change the subject.
4. The guide picks up the walker's interests, and later commentary changes because of it.
5. The chattiness slider moves from near-silent to full podcast.
6. The map recap and its shareable graphic appear at the end.
7. A side-by-side shows the same moment for someone who stops to read Wikipedia on their phone. They miss the street, and the Footnotes walker keeps walking and learns more.

The demo also shows that Footnotes works with any first-person walking video, using a pin on a map as the location. During development, this is how we test: we replay a long walking video, such as a multi-hour walk through Rome, so we don't have to walk outside for every change. When the guide works well on video, we move it to the glasses and the real street.

## Success

Success is **the number of walks where the person kept their phone in their pocket and came away with something they'd tell a friend.** The signal we can see is what happens after the walk: the person opens the recap, or shares it.

Everything else we could measure, such as questions asked, minutes listened or footnotes per walk, matters only when it moves that number.

## Out of scope

These are out of scope for the prototype:

- Historical reconstruction or other AR overlays.
- Route planning, itineraries and recommendations of where to go.
- Bookings, tickets and commerce.
- Group tours and multiplayer.
- Driving, and any use other than walking.
- Curated or prepared content for specific cities.
- A phone-first experience.
- Anything the demo video doesn't show.
