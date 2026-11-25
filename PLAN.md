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

## Proposed tech
- **Front end:** React + Vite, set up as an installable web app (a PWA: home-screen icon, works offline).
- **Storage:** start with on-device storage (IndexedDB) so it's private and fast, with export/import for backups. Optional cloud sync later (e.g. Supabase) to share between phone and laptop.
- **Photos:** compressed on the device before saving.

## Steps
1. ✅ Clickable mockup and this plan. *Review the look and flows.*
2. Set up the project and the installable-app shell, with the navigation and theme.
3. People and Groups: create, edit and delete, plus photos and search.
4. Flashcards with spaced repetition.
5. Today dashboard and follow-ups.
6. Backup/export, app lock, polish, and deployment (e.g. Vercel or Netlify).
7. Optional: sync between devices.
