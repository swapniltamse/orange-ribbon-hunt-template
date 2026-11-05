# Orange Ribbon Hunt

A Halloween door hunt for one apartment building. Residents giving out candy hang an orange ribbon and sign up their door. Families hunt for the doors, collect a secret word at each one, and climb a leaderboard.

The app never shows apartment numbers to hunters. Each door appears under a silly name, like "Baron Gummy Bat, tower 1, floor 4". Only the resident and the organizer see the real number. Nobody signs in, and no names, emails or phone numbers are collected.

The story behind it: [A Halloween door hunt that never shows the apartment number](https://www.swapniltamse.com/article/orange-ribbon-hunt).

## What it does

- **Residents** sign up with tower, floor and apartment. They get a secret name and a secret word, then give the word to kids who knock. They can mark "out of candy" or remove their door.
- **Hunters** enter the building code, get a made-up team name, and see the doors grouped by tower and floor. Typing a door's word stamps it. Teams can rate candy and costumes at doors they visited.
- **The organizer** opens `/admin` to see usage counts, add or remove doors, load or save a door list, change the title and building code, read feedback, and delete all data.

A how-to-play guide with screenshots is at `/guide`.

## Run it for your building

You need a free [Cloudflare](https://dash.cloudflare.com/sign-up) account and [Node.js](https://nodejs.org/) 20 or newer.

1. Clone this repo and open the folder.
2. Run `npm install`.
3. Run `npx wrangler login` and approve access in the browser.
4. Run `npx wrangler d1 create orange-ribbon-hunt`.
5. Copy the `database_id` it prints into `wrangler.toml`.
6. Run `npm run db:remote` to create the tables.
7. Run `npx wrangler pages project create orange-ribbon-hunt --production-branch main`.
8. Run `npm run deploy`.
9. Set the three secrets below in the Cloudflare dashboard, under your Pages project, Settings, Variables and Secrets.
10. Run `npm run deploy` again so the secrets take effect.
11. Open `your-project.pages.dev/admin`, enter the admin code, and set your title and building code.

| Secret | What it is |
|---|---|
| `ADMIN_CODE` | The organizer password for `/admin`. Use a long random one. |
| `BUILDING_CODE` | The code families type to see the list. You can change it later at `/admin`. |
| `COOKIE_SECRET` | Any long random string. It signs the building-code cookie and salts rate limits. |

To try it on your own computer first, copy `.dev.vars.example` to `.dev.vars`, run `npm run db:local`, then run `npm run dev`.

Towers go from 1 to 99 and floors from 1 to 200. A building with one tower uses tower 1.

## After the night

The door table maps real apartments to secret names. Open `/admin`, save the door list if you want it next year, then use **Delete all data**. Nothing deletes itself.

## Known risks

This version was built for one night in one building, with a building code shared in the group chat. Before you run it, know what it does not stop:

1. **Anyone with the building code can sign up any door number.** Nothing proves the door belongs to the person claiming it.
2. **Fake teams can game the ratings.** Teams are free to create. A door needs 3 ratings averaging 3 stars to appear on the top lists, which slows a determined parent but does not stop one.
3. **The building code will leak.** A code shared in a group chat does not stay inside the building forever, and it is the only thing between the internet and the door list.
4. **A neighbor can add a door they spotted, and it shows its real door number** until the resident signs up. Families can hide a wrong one with "No ribbon here".
5. **A false claim on a spotted door shows that door's earlier visiting team names** to the person who claimed it.

Help with any of these is welcome. Open an issue or a pull request.

## How it is built

- Cloudflare Pages for the static app, Pages Functions for the API, and D1 (SQLite) for storage.
- Plain JavaScript with no framework and no build step. It installs to the home screen.
- Usage is counted as events with no names. Rate limits use a salted hash, so no IP address is stored.
- `npm test` runs the game rule tests in `tests/`.

## License

MIT. See [LICENSE](LICENSE).
