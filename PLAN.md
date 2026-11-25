# Rolo: a personal network app

Rolo is a personal app for remembering the people you meet at work. It is a website you can add to your phone's home screen, and it also works properly on a laptop.

**Mockup:** `mockup/index.html`. Open it in a browser and click through it. Screenshots are in `mockup/screens/`.

## Design direction
- **Feel:** like a calm paper notebook. Warm paper background, deep green ink, a clay-orange accent, a serif font for headings and a clean sans-serif font for everything else.
- **Navigation:** four places only: **Today · People · Practice · Groups**.
  - On a phone, a floating tab bar at the bottom with a big **+** in the middle.
  - On a laptop, the same items in a sidebar, with your groups listed underneath.
- **Groups are colours.** Each group gets a soft colour that follows it everywhere: chips, tags, flashcard filters.
- Pop-up panels (on phones they slide up from the bottom) for adding things, so you never lose your place.

## Core features (v1)
1. **People**: photo, name, role, team, where you met, a *memory hook*, and dated notes.
2. **Custom groups**: create them as you go (for example "Clerkship cohort", "Partners"). One person can be in many groups.
3. **Search**: covers everything, including notes ("who was the marathon person?").
4. **Flashcard practice**: see the face, tap to flip, then rate yourself *Forgot / Almost / Got it*. You can practise everyone or one group. Ratings feed a simple spaced-repetition schedule, so the people you struggle with come up more often.
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
