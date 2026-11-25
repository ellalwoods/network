# Rolo: a personal network app

Rolo is a personal app for remembering the people you meet at work. It is a website you can add to your phone's home screen, and it also works properly on a laptop.

**Mockup:** `mockup/index.html`. Open it in a browser and click through it. Screenshots are in `mockup/screens/`.

## Design direction: "Index × Orbit" (minimal)
- **Palette:** monochrome only. Off-white paper (#F3F2EE), near-black ink, one grey for secondary text. No accent colour; emphasis comes from solid black fills.
- **Type:** Archivo Black for big uppercase titles and names, Archivo for body text, JetBrains Mono for small uppercase labels, numbers and metadata.
- **Structure:** visible 1px hairline grid and numbered entries (001, 002…), like a catalogue.
- **Home = Orbit:** a quiet diagram with you at the centre and people as small circles. Rings show closeness (inner, middle, outer) and the sectors are your groups. A small black dot means someone is due for practice. Tap a group to highlight it, or tap a person to open their page.
- **Navigation:** Orbit · Index · Drill · Groups, plus a black **+** button. Bottom bar on phone, sidebar on laptop.
- **Groups:** shown by name and position, not by colour.

## Core features (v1)
1. **People**: photo, name, role, team, where you met, a *memory hook*, and dated notes.
2. **Custom groups**: create them as you go (for example "Clerkship cohort", "Partners"). One person can be in many groups.
3. **Search**: covers everything, including notes ("who was the marathon person?").
4. **Flashcard practice (Drill)**: see the face, tap to flip, then rate yourself *Forgot / Almost / Got it*. You can practise everyone or one group. Ratings feed a simple spaced-repetition schedule, so the people you struggle with come up more often.
5. **Today screen**: today's practice count, follow-ups due, and people you met recently.
6. **Follow-ups**: lightweight reminders on a person ("thank-you note", "coffee in Dec").

## Suggested extras
- **Quick add at events**: just a photo and a name, then fill in the rest later from an "Incomplete" queue.
- **Reverse flashcards**: see the name, then recall the team and the detail.
- **"Last contacted"**: a gentle nudge for people you haven't spoken to in a while.
- **Org view**: people grouped by team or seniority, to learn who sits where.
- **Import from a photo**: snap a printed cohort sheet or a LinkedIn profile to pre-fill details (later).
- **Export/backup** to a file, and an optional passcode/Face ID lock (this is personal data).

## Tech (matches Duo Logo and DuoVino)
- **App:** a static web app in plain JavaScript with no build step, hosted on GitHub Pages and installable on the home screen (with an offline cache).
- **Storage:** everything is saved on the device first, so the app works offline and without an account.
- **Sync:** through the **same Supabase project** as Duo Logo and DuoVino, using Rolo's own tables and functions so the apps stay separate.

### Sign-in: name + planet + constellation
- **The login:** your name, one of 8 planets (Mercury to Neptune) and one of 8 constellations (Crux, Orion, Lyra, Cygnus, Carina, Centaurus, Scorpius, Pegasus). For example: *"Ella · Saturn · Crux"*.
- Names are trimmed and lowercased, so capitals and extra spaces don't matter.
- **First visit:** shows "Who's in orbit?". A combination that doesn't exist yet offers to start a new orbit, carrying over anything already on the device. "Not now" keeps everything on the device only.
- **The login is never stored.** The app sends only a SHA-256 hash of `rolo:` + the login.
- **Supabase:**
  - `rolo_load(key)` and `rolo_save(key, data)` handle people, groups, notes and settings.
  - `rolo_photo_get` and `rolo_photo_put` store compressed photos separately, so syncing stays fast.
  - The tables have row-level security turned on with no policies, so nothing can reach them except through those functions.
- **Settings** shows the signed-in combination, with "Change planet & constellation" and "Switch account". If the database isn't set up yet, sign-in shows a clear message and the app keeps working on the device.
- **Family member:** gets their own combination and their own separate orbit.

## Steps
1. ✅ Clickable mockup, design direction and plan.
2. ✅ v1 app:
   - Orbit, Index, person pages (photo, notes, follow-ups), Groups, Drill with spaced repetition and Settings
   - Black-and-white and colour modes
   - Device storage, sign-in and sync with Supabase, backup export and import
   - Installable on the home screen, with offline support
3. Connect Supabase: run `supabase/rolo.sql`, fill in `config.js` and turn on GitHub Pages.
4. Use it for a week, then refine.
   - Ideas: quick add at events, reverse flashcards, "haven't spoken in a while" nudges, a team or seniority view, Clayton Utz and MinterEllison colours.
