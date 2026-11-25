# Rolo

Rolo is a personal app for remembering the people you meet at work. It's a static web app (plain JavaScript, no build step) that you can add to your phone's home screen and also use on a laptop.

- **Orbit:** your network as a map with you at the centre. People are grouped by context and sit closer the better you know them.
- **Index:** a numbered, searchable list of everyone. Search also covers notes and memory hooks.
- **Drill:** flashcards that use face → name, with spaced repetition so the people you forget come up more often.
- **Groups:** custom groups (a cohort, a team, an event), and a person can be in several.
- **Settings:**
  - Black-and-white or colour mode, using colours from the Big Six law firms.
  - Sync and sign-in.
  - Backup export and import.

## Sign-in and sync

Sign-in works the same way as Duo Logo and DuoVino: **name + planet + constellation** (for example *Ella · Saturn · Crux*).

- Capitals and extra spaces in the name don't matter.
- The login is never stored on the server. The app sends only a SHA-256 hash of `rolo:` + the login.
- Everything is saved on the device first, so the app works offline. Once you're signed in, changes sync to Supabase.
- If the database isn't set up yet, sign-in says so and the app keeps working on the device.

### One-time setup

1. **Database:** open the Supabase project that Duo Logo and DuoVino use, go to the **SQL editor**, and run [`supabase/rolo.sql`](supabase/rolo.sql). It creates Rolo's own tables (`rolo_accounts` and `rolo_photos`) and functions (`rolo_*`), separate from the other apps. The tables have row-level security turned on with no policies, so nothing can reach them except through those functions.
2. **Connect the app:** in [`config.js`](config.js), paste the project URL and the anon (publishable) key. These are the same values your other apps use, and you'll also find them under Supabase → Project Settings → API. The anon key is meant to be public.
3. **Host it:** turn on GitHub Pages for this repo (Settings → Pages → deploy from a branch → the branch with these files, root folder).
4. **Install it:**
   - **iPhone:** open the Pages URL in Safari and tap Share → **Add to Home Screen**.
   - **Laptop:** use the install icon in the address bar.

## Files

| File | What it is |
|---|---|
| `index.html`, `styles.css`, `app.js` | The app |
| `config.js` | Supabase URL and anon key |
| `sw.js`, `manifest.json`, `icons/` | Home-screen install and offline support |
| `supabase/rolo.sql` | Database tables and functions |
| `mockup/` | The design mockups and earlier directions |
| `docs/screenshots/` | Screenshots of the built app |
