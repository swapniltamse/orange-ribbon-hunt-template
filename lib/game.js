// Pure game rules, shared by the API and the tests.

const TITLES = ['Baron', 'Countess', 'Sir', 'Madame', 'Professor', 'Duchess', 'Captain', 'Doctor', 'Lord', 'Auntie', 'Archmage', 'Little Miss'];
const TREATS = ['Gummy', 'Caramel', 'Nougat', 'Licorice', 'Marshmallow', 'Peanut Butter', 'Toffee', 'Sour Patch', 'Candy Corn', 'Fudge', 'Bubblegum', 'Jellybean'];
const SPOOKS = ['Fang', 'Phantom', 'Goblin', 'Cobweb', 'Bat', 'Mummy', 'Skeleton', 'Banshee', 'Werewolf', 'Pumpkin', 'Zombie', 'Gremlin'];

const TEAM_FIRST = ['Sneaky', 'Wobbly', 'Midnight', 'Giggling', 'Sticky', 'Tiny', 'Howling', 'Sugar', 'Creaky', 'Hungry', 'Glowing', 'Dizzy'];
const TEAM_LAST = ['Ghouls', 'Goblins', 'Bats', 'Mummies', 'Witches', 'Ghosts', 'Vampires', 'Skeletons', 'Pumpkins', 'Monsters', 'Zombies', 'Trolls'];

// Short and easy to say at a door. None of them look alike when typed by a child.
const WORDS = ['BOO', 'BATS', 'FANGS', 'WITCH', 'GHOUL', 'CANDY', 'SPOOK', 'BROOM', 'CAPE', 'MOON', 'OWL', 'CRYPT', 'SLIME', 'TOAD', 'WEB', 'HOWL', 'GOURD', 'CAT', 'MASK', 'BONES', 'POTION', 'RAVEN', 'SHADOW', 'FOG'];

const RANKS = [
  { at: 0, name: 'Fresh Ghost' },
  { at: 1, name: 'Hallway Creeper' },
  { at: 3, name: 'Elevator Phantom' },
  { at: 6, name: 'Ribbon Hunter' },
  { at: 10, name: 'Night Terror' },
];

export const MAX_TOWER = 99;
export const MAX_FLOOR = 200;

// How doors are found. Towers have floors. Townhouses are grouped by row, and floor is stored as 1.
export const LAYOUTS = {
  towers: { name: 'towers', group: 'Tower', unit: 'Apartment number', home: 'apartment', floors: true, example: '8B or 804' },
  townhouses: { name: 'townhouses', group: 'Row', unit: 'House number', home: 'house', floors: false, example: '14 or 14A' },
};
export const layoutOf = (name) => LAYOUTS[name] ?? LAYOUTS.towers;

// What hunters see for where a door is. Never includes the apartment or house number.
export const placeLabel = (layout, tower, floor) => (layout.floors ? `${layout.group} ${tower}, floor ${floor}` : `${layout.group} ${tower}`);

const pick = (list, rand) => list[Math.floor(rand() * list.length)];

export const makeAlias = (rand = Math.random) => `${pick(TITLES, rand)} ${pick(TREATS, rand)} ${pick(SPOOKS, rand)}`;
export const makeTeamName = (rand = Math.random) => `The ${pick(TEAM_FIRST, rand)} ${pick(TEAM_LAST, rand)}`;
export const makeWord = (rand = Math.random) => pick(WORDS, rand);

export const normalizeWord = (word) => String(word ?? '').trim().toUpperCase();

export function rankFor(stamped, total) {
  if (total > 0 && stamped >= total) return 'Ruler of the Ribbons';
  return RANKS.filter((rank) => stamped >= rank.at).pop().name;
}

export function validateDoor(input, layout = LAYOUTS.towers) {
  const tower = Number(input?.tower);
  const floor = layout.floors ? Number(input?.floor) : 1;
  const apt = String(input?.apt ?? '').trim().toUpperCase();
  // Leading formula characters are dropped so a hint cannot run when the list opens in a spreadsheet.
  const note = String(input?.note ?? '').trim().replace(/\s+/g, ' ').replace(/^['=+\-@\s]+/, '');
  // Wide enough for one house or a row of high-rises. A single building uses tower 1.
  if (!Number.isInteger(tower) || tower < 1 || tower > MAX_TOWER) return { error: `Enter your ${layout.group.toLowerCase()} number.` };
  if (!Number.isInteger(floor) || floor < 1 || floor > MAX_FLOOR) return { error: 'Enter your floor number.' };
  if (!/^[A-Z0-9][A-Z0-9-]{0,7}$/.test(apt)) return { error: `Enter your ${layout.unit.toLowerCase()}, like ${layout.example}.` };
  if (note.length > 60) return { error: 'Keep the hint under 60 characters.' };
  return { value: { tower, floor, apt, note, nutFree: input?.nutFree === true } };
}

// Reads pasted text and the app's own quoted export. Commas inside quotes stay in the cell.
function splitDoorLine(line) {
  const fields = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted && char === '"' && line[i + 1] === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && (char === ',' || char === '\t')) {
      fields.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current.trim());
  return fields;
}

// Towers: tower, floor, apartment, nut-free (yes or no), hint.
// Townhouses: row, house number, nut-free (yes or no), hint.
export const listColumns = (layout) => (layout.floors
  ? ['tower', 'floor', 'apartment', 'nut-free', 'hint']
  : ['row', 'house number', 'nut-free', 'hint']);

export function parseDoorList(text, layout = LAYOUTS.towers) {
  const skip = layout.floors ? 0 : 1;
  const rows = [];
  const errors = [];
  let seenLine = false;
  String(text ?? '').split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    const fields = splitDoorLine(line);
    const isHeader = !seenLine && Number.isNaN(Number(fields[0]));
    seenLine = true;
    if (isHeader) return;
    const { error, value } = validateDoor({
      tower: fields[0],
      floor: fields[1],
      apt: fields[2 - skip],
      nutFree: /^(y|yes|true|1)$/i.test(fields[3 - skip] ?? ''),
      note: fields.slice(4 - skip).join(', '),
    }, layout);
    if (error) errors.push({ line: index + 1, error });
    else rows.push(value);
  });
  return { rows, errors };
}

export function validateSettings(input) {
  const title = String(input?.title ?? '').trim();
  const tagline = String(input?.tagline ?? '').trim();
  const code = String(input?.buildingCode ?? '').trim();
  if (!title || title.length > 40) return { error: 'Use a title of 1 to 40 characters.' };
  if (!tagline || tagline.length > 200) return { error: 'Use an intro of 1 to 200 characters.' };
  if (!/^[A-Za-z0-9-]{4,40}$/.test(code)) return { error: 'Use a building code of 4 to 40 letters, numbers or dashes.' };
  const layout = input?.layout ?? 'towers';
  if (!LAYOUTS[layout]) return { error: 'Choose towers or townhouses.' };
  return { value: { title, tagline, building_code: code, layout, signups_open: input?.signupsOpen ? '1' : '0' } };
}

// A door a neighbor reported shows its number, because the ribbon is already visible in the hallway.
export const spottedName = (tower, apt, layout = LAYOUTS.towers) => `${layout.group} ${tower}, door ${apt}`;

// The only door fields hunters may ever receive. Apartment number and word stay out.
export const publicDoor = (row) => ({
  id: row.id,
  alias: row.alias,
  tower: row.tower,
  floor: row.floor,
  note: row.note,
  nutFree: row.nut_free === 1,
  spotted: row.spotted === 1,
  active: row.active === 1,
});

// A rating sends candy, costume or both, each a whole number of stars from 1 to 5.
export function parseRating(input) {
  const read = (value) => (value === undefined ? null : Number(value));
  const candy = read(input?.candy);
  const costume = read(input?.costume);
  const valid = (stars) => stars === null || (Number.isInteger(stars) && stars >= 1 && stars <= 5);
  if (!valid(candy) || !valid(costume) || (candy === null && costume === null)) return { error: 'Choose 1 to 5 stars.' };
  return { value: { candy, costume } };
}

// A neighbor's low score is never shown. Doors below this average stay off the public lists.
export const MIN_PUBLIC_STARS = 3;
// A host who had one visitor could work out who rated them, so one or two votes stay private.
export const MIN_PUBLIC_VOTES = 3;
const TOP_LIST_SIZE = 5;

export const topRated = (rows) => rows
  .filter((row) => row.avg >= MIN_PUBLIC_STARS && row.votes >= MIN_PUBLIC_VOTES)
  .sort((a, b) => b.avg - a.avg || b.votes - a.votes)
  .slice(0, TOP_LIST_SIZE)
  .map((row) => ({ name: row.name, stars: Math.round(row.avg * 10) / 10 }));
