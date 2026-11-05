import { makeAlias, makeTeamName, makeWord, normalizeWord, rankFor, validateDoor, validateSettings, parseDoorList, publicDoor, spottedName, parseRating, topRated, layoutOf, placeLabel, listColumns } from '../../lib/game.js';

const DEFAULT_TITLE = 'Orange Ribbon Hunt';
const DEFAULT_TAGLINE = 'Every candy door has a funny secret name and an orange ribbon. Find them. Collect their words. Rule the night.';
// The app draws every label from this, so towers and townhouses share one code path.
const layoutConfig = (layout) => ({ ...layout, columns: listColumns(layout) });
const CLIENT_EVENTS = new Set(['app_open', 'view_home', 'view_hunt', 'view_door', 'view_signup', 'view_spot', 'view_feedback', 'view_retry', 'filter_nutfree', 'share_door', 'egg_treat', 'egg_trick', 'egg_boo', 'egg_bats', 'theme_light', 'theme_dark', 'installed']);
const COOKIE = 'hunt';
const MISS_WINDOW_MS = 10 * 60 * 1000;
// One report is enough to list a door. Families can hide a wrong one with "No ribbon here".
const REPORTS_TO_SHOW = 1;
const MAX_REPORTS_PER_PHONE = 8;

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });

const sha256 = async (text) => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

const gateCookie = (env) => sha256(`${env.COOKIE_SECRET}:${env.BUILDING_CODE}`);

const hasGate = async (request, env) => {
  const cookies = request.headers.get('cookie') ?? '';
  const value = cookies.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return Boolean(value) && value === (await gateCookie(env));
};

const isAdmin = async (request, env) => {
  const given = request.headers.get('x-admin');
  return Boolean(given && env.ADMIN_CODE) && (await sha256(given)) === (await sha256(env.ADMIN_CODE));
};

// Usage counting must never get in the way of the game.
const track = async (request, env, name) => {
  const visitor = request.headers.get('x-visitor');
  const mode = request.headers.get('x-mode');
  try {
    await env.DB.prepare('INSERT INTO events (name, visitor, mode, at) VALUES (?, ?, ?, ?)')
      .bind(name, /^[a-f0-9-]{8,40}$/.test(visitor ?? '') ? visitor : null, mode === 'app' ? 'app' : 'browser', Date.now()).run();
  } catch { /* Counting is best effort. */ }
};

const loadSettings = async (env) => {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(results.map((row) => [row.key, row.value]));
};


const usageStats = async (env) => {
  const one = (sql) => env.DB.prepare(sql).first();
  const all = async (sql) => (await env.DB.prepare(sql).all()).results;
  const [people, events, hours, doors, teams, stamps, topDoors, floors, ratings, stars] = await Promise.all([
    one("SELECT COUNT(DISTINCT visitor) AS visitors, COUNT(DISTINCT CASE WHEN mode = 'app' THEN visitor END) AS installed FROM events"),
    all('SELECT name, COUNT(*) AS n FROM events GROUP BY name ORDER BY n DESC'),
    all('SELECT CAST(at / 3600000 AS INTEGER) AS hour, COUNT(DISTINCT visitor) AS visitors, COUNT(*) AS actions FROM events GROUP BY hour ORDER BY hour'),
    one('SELECT COUNT(*) AS total, COALESCE(SUM(active), 0) AS active, COALESCE(SUM(nut_free), 0) AS nutFree FROM doors'),
    one('SELECT COUNT(*) AS total FROM teams'),
    one('SELECT COUNT(*) AS total, COUNT(DISTINCT team_id) AS teams FROM stamps'),
    all('SELECT d.alias, COUNT(*) AS visits FROM stamps s JOIN doors d ON d.id = s.door_id GROUP BY d.id ORDER BY visits DESC LIMIT 5'),
    all('SELECT d.tower, d.floor, COUNT(*) AS visits FROM stamps s JOIN doors d ON d.id = s.door_id GROUP BY d.tower, d.floor ORDER BY visits DESC LIMIT 5'),
    one('SELECT COUNT(*) AS total FROM ratings'),
    one('SELECT COUNT(*) AS total FROM costume_stars'),
  ]);
  return { people, events, hours, doors, teams: teams.total, stamps: stamps.total, teamsWithStamps: stamps.teams, topDoors, floors, ratings: ratings.total, costumeStars: stars.total };
};

const tooManyMisses = async (env, key, limit) => {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM misses WHERE key = ? AND created_at > ?').bind(key, Date.now() - MISS_WINDOW_MS).first();
  return row.n >= limit;
};
const recordMiss = (env, key) => env.DB.prepare('INSERT INTO misses (key, created_at) VALUES (?, ?)').bind(key, Date.now()).run();

const teamFrom = async (request, env) => {
  const token = request.headers.get('x-team');
  if (!token) return null;
  return env.DB.prepare('SELECT id, name FROM teams WHERE token_hash = ?').bind(await sha256(token)).first();
};

const doorFrom = async (request, env) => {
  const token = request.headers.get('x-door');
  if (!token) return null;
  return env.DB.prepare('SELECT * FROM doors WHERE owner_hash = ?').bind(await sha256(token)).first();
};

const ownDoor = async (env, door) => {
  const visits = await env.DB.prepare('SELECT COUNT(*) AS n FROM stamps WHERE door_id = ?').bind(door.id).first();
  // Only this door's owner receives the list of teams that visited it.
  const { results: visitors } = await env.DB.prepare(
    `SELECT t.id, t.name, EXISTS (SELECT 1 FROM costume_stars c WHERE c.door_id = s.door_id AND c.team_id = t.id) AS starred
     FROM stamps s JOIN teams t ON t.id = s.team_id WHERE s.door_id = ? ORDER BY s.created_at DESC LIMIT 50`
  ).bind(door.id).all();
  return { id: door.id, alias: door.alias, word: door.word, tower: door.tower, floor: door.floor, apt: door.apt, note: door.note, active: door.active === 1, visits: visits.n, visitors: visitors.map((v) => ({ id: v.id, name: v.name, starred: v.starred === 1 })) };
};

async function createDoor(env, value) {
  const token = crypto.randomUUID();
  const ownerHash = await sha256(token);
  for (let attempt = 0; attempt < 12; attempt++) {
    const id = crypto.randomUUID();
    try {
      await env.DB.prepare('INSERT INTO doors (id, tower, floor, apt, alias, word, note, nut_free, owner_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, value.tower, value.floor, value.apt, makeAlias(), makeWord(), value.note, value.nutFree ? 1 : 0, ownerHash, Date.now()).run();
      return { token, door: await env.DB.prepare('SELECT * FROM doors WHERE id = ?').bind(id).first() };
    } catch (err) {
      if (String(err).includes('doors.tower')) {
        const existing = await env.DB.prepare('SELECT id, spotted FROM doors WHERE tower = ? AND apt = ?').bind(value.tower, value.apt).first();
        if (existing?.spotted !== 1) return { taken: true };
        // The resident is claiming a door a neighbor reported, so the number goes back to private.
        try {
          // Only one person can claim a door, even if two tap at the same moment.
          const claim = await env.DB.prepare('UPDATE doors SET alias = ?, word = ?, note = ?, nut_free = ?, floor = ?, owner_hash = ?, spotted = 0, active = 1 WHERE id = ? AND spotted = 1')
            .bind(makeAlias(), makeWord(), value.note, value.nutFree ? 1 : 0, value.floor, ownerHash, existing.id).run();
          if (!claim.meta.changes) return { taken: true };
          return { token, door: await env.DB.prepare('SELECT * FROM doors WHERE id = ?').bind(existing.id).first() };
        } catch (claimErr) {
          if (!String(claimErr).includes('doors.alias')) throw claimErr;
          continue;
        }
      }
      if (!String(err).includes('doors.alias')) throw err;
    }
  }
  throw new Error('No free alias');
}

const ratingBoard = async (env, column) => {
  const { results } = await env.DB.prepare(
    `SELECT d.alias AS name, AVG(r.${column}) AS avg, COUNT(r.${column}) AS votes FROM ratings r JOIN doors d ON d.id = r.door_id
     WHERE r.${column} IS NOT NULL AND (d.spotted = 0 OR d.active = 1) GROUP BY d.id`
  ).all();
  return topRated(results);
};

const gameState = async (request, env) => {
  const { results: rows } = await env.DB.prepare(`SELECT id, alias, tower, floor, note, nut_free, spotted, active FROM doors d WHERE spotted = 0 OR (active = 1 AND (SELECT COUNT(*) FROM door_reports r WHERE r.door_id = d.id) >= ${REPORTS_TO_SHOW}) ORDER BY tower, floor, alias`).all();
  const { results: board } = await env.DB.prepare(
    `SELECT t.name, COUNT(*) AS stamps, MAX(s.created_at) AS last FROM stamps s JOIN teams t ON t.id = s.team_id
     GROUP BY t.id ORDER BY stamps DESC, last ASC LIMIT 10`
  ).all();
  const doors = rows.map(publicDoor);
  const total = doors.filter((d) => d.active).length;
  const team = await teamFrom(request, env);
  let stamped = [];
  let ratings = {};
  let stars = 0;
  if (team) {
    const { results } = await env.DB.prepare('SELECT door_id FROM stamps WHERE team_id = ?').bind(team.id).all();
    stamped = results.map((r) => r.door_id);
    const { results: mine } = await env.DB.prepare('SELECT door_id, candy, costume FROM ratings WHERE team_id = ?').bind(team.id).all();
    ratings = Object.fromEntries(mine.map((r) => [r.door_id, { candy: r.candy, costume: r.costume }]));
    stars = (await env.DB.prepare('SELECT COUNT(*) AS n FROM costume_stars WHERE team_id = ?').bind(team.id).first()).n;
  }
  const [topCandy, topHosts, { results: topKids }] = await Promise.all([
    ratingBoard(env, 'candy'),
    ratingBoard(env, 'costume'),
    env.DB.prepare('SELECT t.name, COUNT(*) AS stars FROM costume_stars c JOIN teams t ON t.id = c.team_id GROUP BY t.id ORDER BY stars DESC, MIN(c.at) ASC LIMIT 5').all(),
  ]);
  // A door that runs out of candy leaves the goal, but a word already collected still counts.
  const goal = doors.filter((d) => d.active || stamped.includes(d.id)).length;
  return {
    doors,
    stamped,
    ratings,
    topCandy,
    topHosts,
    topKids,
    total: goal,
    team: team ? { name: team.name, rank: rankFor(stamped.length, goal), stars } : null,
    leaderboard: board.map((b) => ({ name: b.name, stamps: b.stamps, rank: rankFor(b.stamps, total) })),
  };
};

async function adminRoute(request, env, path, body) {
  if (path === 'admin/stats' && request.method === 'GET') return json(await usageStats(env));
  if (path === 'admin/feedback' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT id, text, at FROM feedback ORDER BY at DESC').all();
    return json({ feedback: results });
  }
  if (path === 'admin/feedback/clear' && request.method === 'POST') {
    await env.DB.prepare('DELETE FROM feedback').run();
    return json({ ok: true });
  }
  if (path === 'admin/stats/clear' && request.method === 'POST') {
    await env.DB.prepare('DELETE FROM events').run();
    return json({ ok: true });
  }
  if (path === 'admin/settings' && request.method === 'GET') {
    const s = env.settings;
    return json({
      title: s.title || DEFAULT_TITLE,
      tagline: s.tagline || DEFAULT_TAGLINE,
      buildingCode: env.BUILDING_CODE,
      layout: env.layout.name,
      signupsOpen: s.signups_open !== '0',
    });
  }
  if (path === 'admin/settings' && request.method === 'POST') {
    const { error, value } = validateSettings(body);
    if (error) return json({ error }, 400);
    await env.DB.batch(Object.entries(value).map(([key, val]) => env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(key, val)));
    return json({ ok: true });
  }
  if (path === 'admin/import' && request.method === 'POST') {
    const { rows, errors } = parseDoorList(body.text, env.layout);
    if (rows.length > 200) return json({ error: 'Load up to 200 doors at a time.' }, 400);
    const added = [];
    const skipped = [];
    for (const row of rows) {
      const created = await createDoor(env, row);
      if (created.taken) skipped.push(`${placeLabel(env.layout, row.tower, row.floor)}, ${row.apt}`);
      else added.push({ tower: row.tower, floor: row.floor, apt: row.apt, alias: created.door.alias, word: created.door.word, token: created.token });
    }
    return json({ added, skipped, errors });
  }
  if (path === 'admin/doors' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT d.id, d.tower, d.floor, d.apt, d.alias, d.word, d.note, d.nut_free, d.spotted, d.active, (SELECT COUNT(*) FROM door_reports r WHERE r.door_id = d.id) AS reports, COUNT(s.team_id) AS visits
       FROM doors d LEFT JOIN stamps s ON s.door_id = d.id GROUP BY d.id ORDER BY d.tower, d.floor, d.apt`
    ).all();
    return json({ doors: results });
  }
  if (path === 'admin/remove' && request.method === 'POST') {
    const removing = await env.DB.prepare('SELECT tower, apt, spotted FROM doors WHERE id = ?').bind(String(body.id)).first();
    if (removing) await env.DB.prepare('INSERT OR IGNORE INTO door_blocks (tower, apt) VALUES (?, ?)').bind(removing.tower, removing.apt).run();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM stamps WHERE door_id = ?').bind(String(body.id)),
      env.DB.prepare('DELETE FROM ratings WHERE door_id = ?').bind(String(body.id)),
      env.DB.prepare('DELETE FROM costume_stars WHERE door_id = ?').bind(String(body.id)),
      env.DB.prepare('DELETE FROM door_reports WHERE door_id = ?').bind(String(body.id)),
      env.DB.prepare('DELETE FROM doors WHERE id = ?').bind(String(body.id)),
    ]);
    return json({ ok: true });
  }
  if (path === 'admin/status' && request.method === 'POST') {
    await env.DB.prepare('UPDATE doors SET active = ? WHERE id = ?').bind(body.active ? 1 : 0, String(body.id)).run();
    return json({ ok: true });
  }
  if (path === 'admin/wipe' && request.method === 'POST') {
    if (body.confirm !== 'WIPE') return json({ error: 'Type WIPE to confirm.' }, 400);
    await env.DB.batch(['ratings', 'costume_stars', 'stamps', 'door_reports', 'door_blocks', 'doors', 'teams', 'misses'].map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
    return json({ ok: true });
  }
  return json({ error: 'Not found' }, 404);
}

async function route(request, env, path) {
  const method = request.method;
  const body = method === 'POST' ? await request.json().catch(() => ({})) : {};
  // Rate limits use a salted hash, so no IP address is ever stored.
  const ip = (await sha256(`${env.COOKIE_SECRET}:${request.headers.get('cf-connecting-ip') ?? 'unknown'}`)).slice(0, 24);

  if (path === 'join' && method === 'POST') {
    const key = `join:${ip}`;
    if (await tooManyMisses(env, key, 30)) return json({ error: 'Too many tries. Wait ten minutes.' }, 429);
    if (String(body.code ?? '').trim().toLowerCase() !== env.BUILDING_CODE.toLowerCase()) {
      await recordMiss(env, key);
      await track(request, env, 'join_failed');
      return json({ error: 'That is not the building code.' }, 401);
    }
    await track(request, env, 'join_ok');
    return json({ ok: true }, 200, { 'set-cookie': `${COOKIE}=${await gateCookie(env)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=172800` });
  }

  // Admin routes use their own password and do not need the building cookie.
  const adminAddingDoor = path === 'door' && method === 'POST' && request.headers.get('x-admin');
  if (path.startsWith('admin/') || adminAddingDoor) {
    const key = `admin:${ip}`;
    if (await tooManyMisses(env, key, 10)) return json({ error: 'Too many tries. Wait ten minutes.' }, 429);
    if (!(await isAdmin(request, env))) {
      await recordMiss(env, key);
      return json({ error: 'Wrong admin code.' }, 401);
    }
    if (!adminAddingDoor) return adminRoute(request, env, path, body);
  } else if (!(await hasGate(request, env))) {
    return json({ error: 'Building code needed.' }, 401);
  }

  if (path === 'state' && method === 'GET') return json(await gameState(request, env));

  if (path === 'feedback' && method === 'POST') {
    const text = String(body.text ?? '').trim();
    if (text.length < 3 || text.length > 1000) return json({ error: 'Write between 3 and 1000 characters.' }, 400);
    const key = `feedback:${ip}`;
    if (await tooManyMisses(env, key, 10)) return json({ error: 'Too many messages right now. Try again soon.' }, 429);
    await env.DB.prepare('INSERT INTO feedback (text, at) VALUES (?, ?)').bind(text, Date.now()).run();
    await recordMiss(env, key);
    await track(request, env, 'feedback_sent');
    return json({ ok: true });
  }

  if (path === 'event' && method === 'POST') {
    if (CLIENT_EVENTS.has(body.name)) await track(request, env, body.name);
    return json({ ok: true });
  }

  if (path === 'team' && method === 'POST') {
    const token = crypto.randomUUID();
    const name = makeTeamName();
    await env.DB.prepare('INSERT INTO teams (id, name, token_hash, created_at) VALUES (?, ?, ?, ?)').bind(crypto.randomUUID(), name, await sha256(token), Date.now()).run();
    await track(request, env, 'team_created');
    return json({ token, name });
  }

  if (path === 'team/rename' && method === 'POST') {
    const team = await teamFrom(request, env);
    if (!team) return json({ error: 'Start a team first.' }, 401);
    const name = makeTeamName();
    await env.DB.prepare('UPDATE teams SET name = ? WHERE id = ?').bind(name, team.id).run();
    return json({ name });
  }

  if (path === 'stamp' && method === 'POST') {
    const team = await teamFrom(request, env);
    if (!team) return json({ error: 'Start a team first.' }, 401);
    const key = `stamp:${team.id}`;
    if (await tooManyMisses(env, key, 20)) return json({ error: 'Too many wrong words. Wait ten minutes.' }, 429);
    const door = await env.DB.prepare('SELECT id, word, spotted FROM doors WHERE id = ?').bind(String(body.doorId)).first();
    if (!door) return json({ error: 'That door is gone.' }, 404);
    // A child given the last candy can still enter the word after the door runs out.
    if (door.spotted !== 1 && normalizeWord(body.word) !== door.word) {
      await recordMiss(env, key);
      await track(request, env, 'wrong_word');
      return json({ error: 'That is not the secret word. Ask at the door.' }, 400);
    }
    await env.DB.prepare('INSERT OR IGNORE INTO stamps (team_id, door_id, created_at) VALUES (?, ?, ?)').bind(team.id, door.id, Date.now()).run();
    await track(request, env, 'stamp');
    return json({ ok: true });
  }

  if (path === 'rate' && method === 'POST') {
    const team = await teamFrom(request, env);
    if (!team) return json({ error: 'Start a team first.' }, 401);
    const { error, value } = parseRating(body);
    if (error) return json({ error }, 400);
    const visited = await env.DB.prepare('SELECT 1 FROM stamps WHERE team_id = ? AND door_id = ?').bind(team.id, String(body.doorId)).first();
    if (!visited) return json({ error: 'Visit this door before you rate it.' }, 403);
    await env.DB.prepare(
      `INSERT INTO ratings (team_id, door_id, candy, costume, at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (team_id, door_id) DO UPDATE SET candy = COALESCE(excluded.candy, candy), costume = COALESCE(excluded.costume, costume), at = excluded.at`
    ).bind(team.id, String(body.doorId), value.candy, value.costume, Date.now()).run();
    await track(request, env, value.candy ? 'rate_candy' : 'rate_costume');
    return json({ ok: true });
  }

  if (path === 'door/star' && method === 'POST') {
    const door = await doorFrom(request, env);
    if (!door) return json({ error: 'Door not found.' }, 404);
    const visited = await env.DB.prepare('SELECT 1 FROM stamps WHERE team_id = ? AND door_id = ?').bind(String(body.teamId), door.id).first();
    if (!visited) return json({ error: 'That team has not visited your door.' }, 403);
    if (body.on === false) {
      await env.DB.prepare('DELETE FROM costume_stars WHERE door_id = ? AND team_id = ?').bind(door.id, String(body.teamId)).run();
    } else {
      await env.DB.prepare('INSERT OR IGNORE INTO costume_stars (door_id, team_id, at) VALUES (?, ?, ?)').bind(door.id, String(body.teamId), Date.now()).run();
      await track(request, env, 'costume_star');
    }
    return json({ door: await ownDoor(env, door) });
  }

  if (path === 'door' && method === 'POST') {
    const { error, value } = validateDoor(body, env.layout);
    if (error) return json({ error }, 400);
    // Stops one phone flooding the list. The organizer is exempt when adding doors from the chat.
    if (!adminAddingDoor && env.settings.signups_open === '0') return json({ error: 'Sign-ups are closed. Ask the organizer to add your door.' }, 403);
    const key = `door:${ip}`;
    if (!adminAddingDoor) {
      if (await tooManyMisses(env, key, 20)) return json({ error: 'Too many sign-ups right now. Ask the organizer to add your door.' }, 429);
    }
    const created = await createDoor(env, value);
    if (created.taken) return json({ error: 'That door is already signed up. Use the door link from the first phone, or ask the organizer.' }, 409);
    if (!adminAddingDoor) await recordMiss(env, key);
    await track(request, env, adminAddingDoor ? 'door_added_by_organizer' : 'door_signup');
    return json({ token: created.token, door: await ownDoor(env, created.door) });
  }

  if (path === 'door' && method === 'GET') {
    const door = await doorFrom(request, env);
    if (!door) return json({ error: 'Door not found.' }, 404);
    return json({ door: await ownDoor(env, door) });
  }

  if (path === 'door/spot' && method === 'POST') {
    if (env.settings.signups_open === '0') return json({ error: 'Adding doors is closed. Ask the organizer.' }, 403);
    const { error, value } = validateDoor({ tower: body.tower, floor: body.floor, apt: body.apt }, env.layout);
    if (error) return json({ error }, 400);
    const visitor = request.headers.get('x-visitor') ?? '';
    if (!/^[a-f0-9-]{8,40}$/.test(visitor)) return json({ error: 'Reload the page and try again.' }, 400);
    const key = `door:${ip}`;
    const phoneKey = `spot:${visitor}`;
    if (await tooManyMisses(env, phoneKey, MAX_REPORTS_PER_PHONE) || await tooManyMisses(env, key, 20)) return json({ error: 'Too many doors added right now. Try again soon.' }, 429);
    const blocked = await env.DB.prepare('SELECT 1 FROM door_blocks WHERE tower = ? AND apt = ?').bind(value.tower, value.apt).first();
    if (blocked) return json({ ok: true, listed: true });
    let door = await env.DB.prepare('SELECT id, spotted, active FROM doors WHERE tower = ? AND apt = ?').bind(value.tower, value.apt).first();
    if (door && door.spotted !== 1) return json({ ok: true, listed: true });
    if (!door) {
      door = { id: crypto.randomUUID(), spotted: 1, active: 1 };
      await env.DB.prepare("INSERT INTO doors (id, tower, floor, apt, alias, word, note, nut_free, spotted, owner_hash, created_at) VALUES (?, ?, ?, ?, ?, '', '', 0, 1, ?, ?)")
        .bind(door.id, value.tower, value.floor, value.apt, spottedName(value.tower, value.apt, env.layout), await sha256(crypto.randomUUID()), Date.now()).run();
    } else if (door.active !== 1) {
      await env.DB.prepare('UPDATE doors SET active = 1 WHERE id = ?').bind(door.id).run();
    }
    await env.DB.prepare('INSERT OR IGNORE INTO door_reports (door_id, visitor, at) VALUES (?, ?, ?)').bind(door.id, visitor, Date.now()).run();
    await recordMiss(env, phoneKey);
    await recordMiss(env, key);
    await track(request, env, 'door_spotted');
    const reports = await env.DB.prepare('SELECT COUNT(*) AS n FROM door_reports WHERE door_id = ?').bind(door.id).first();
    return json({ ok: true, listed: reports.n >= REPORTS_TO_SHOW });
  }

  if (path === 'door/spot-gone' && method === 'POST') {
    await env.DB.prepare('UPDATE doors SET active = 0 WHERE id = ? AND spotted = 1').bind(String(body.id)).run();
    await track(request, env, 'spotted_door_gone');
    return json({ ok: true });
  }

  if (path === 'door/remove' && method === 'POST') {
    const door = await doorFrom(request, env);
    if (!door) return json({ error: 'Door not found.' }, 404);
    // A resident who leaves the hunt stays off it, unless they sign up again themselves.
    await env.DB.batch([
      env.DB.prepare('INSERT OR IGNORE INTO door_blocks (tower, apt) VALUES (?, ?)').bind(door.tower, door.apt),
      env.DB.prepare('DELETE FROM stamps WHERE door_id = ?').bind(door.id),
      env.DB.prepare('DELETE FROM ratings WHERE door_id = ?').bind(door.id),
      env.DB.prepare('DELETE FROM costume_stars WHERE door_id = ?').bind(door.id),
      env.DB.prepare('DELETE FROM door_reports WHERE door_id = ?').bind(door.id),
      env.DB.prepare('DELETE FROM doors WHERE id = ?').bind(door.id),
    ]);
    await track(request, env, 'door_removed');
    return json({ ok: true });
  }

  if (path === 'door/status' && method === 'POST') {
    const door = await doorFrom(request, env);
    if (!door) return json({ error: 'Door not found.' }, 404);
    const active = body.active ? 1 : 0;
    await env.DB.prepare('UPDATE doors SET active = ? WHERE id = ?').bind(active, door.id).run();
    await track(request, env, active ? 'candy_back' : 'out_of_candy');
    return json({ door: await ownDoor(env, { ...door, active }) });
  }

  return json({ error: 'Not found' }, 404);
}

export async function onRequest({ request, env, params }) {
  const path = (params.path ?? []).join('/');
  const settings = await loadSettings(env);
  const layout = layoutOf(settings.layout);
  const live = { ...env, BUILDING_CODE: settings.building_code || env.BUILDING_CODE, settings, layout };
  if (path === 'config') {
    return json({ title: settings.title || DEFAULT_TITLE, tagline: settings.tagline || DEFAULT_TAGLINE, signupsOpen: settings.signups_open !== '0', layout: layoutConfig(layout) });
  }
  return route(request, live, path);
}
