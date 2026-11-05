import { toCsv } from '/csv.js?v=7';

const app = document.getElementById('app');
const adminView = location.pathname.replace(/\/$/, '') === '/admin';
const store = {
  get: (key) => localStorage.getItem(`hunt-${key}`),
  set: (key, value) => localStorage.setItem(`hunt-${key}`, value),
  del: (key) => localStorage.removeItem(`hunt-${key}`),
};
let pollTimer = null;
const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let adminCode = '';
let config = {
  title: 'Orange Ribbon Hunt',
  tagline: '',
  signupsOpen: true,
  layout: { name: 'towers', group: 'Tower', unit: 'Apartment number', home: 'apartment', floors: true, columns: ['tower', 'floor', 'apartment', 'nut-free', 'hint'] },
};
// Labels for towers or townhouses. The server sends the layout in /api/config.
const L = () => config.layout;
const unitWord = () => L().unit.toLowerCase();
const place = (door) => (L().floors ? `${L().group} ${door.tower}, floor ${door.floor}` : `${L().group} ${door.tower}`);
const whereWords = () => (L().floors ? `${L().group.toLowerCase()} and floor` : L().group.toLowerCase());
const visitorId = store.get('visitor') || crypto.randomUUID();
store.set('visitor', visitorId);
const usageHeaders = { 'x-visitor': visitorId, 'x-mode': installed ? 'app' : 'browser' };
const EGG_WORDS = { TREAT: 'treat', TRICK: 'trick' };

// Anonymous counts only. See /how-it-works for what is and is not collected.
function track(name) {
  if (!adminView) fetch('/api/event', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json', ...usageHeaders }, body: JSON.stringify({ name }) }).catch(() => {});
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([key, value]) => {
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'class') node.className = value;
    else if (value !== false && value !== undefined) node.setAttribute(key, value === true ? '' : value);
  });
  children.flat(Infinity).forEach((child) => child !== null && child !== undefined && node.append(child));
  return node;
}

async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`/api/${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(adminView ? {} : usageHeaders), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Try again.'), { status: res.status, closed: data.closed });
  return data;
}

function notice(message) {
  let node = document.querySelector('.notice');
  if (!node) {
    node = el('div', { class: 'notice', role: 'alert' });
    document.body.append(node);
  }
  node.textContent = message;
  setTimeout(() => node.remove(), 6000);
}

function show(...nodes) {
  clearInterval(pollTimer);
  app.replaceChildren(...nodes.flat(Infinity).filter((node) => node !== null && node !== undefined));
  window.scrollTo(0, 0);
}

const howToPlay = () => el('a', { class: 'howto', href: '/guide/' }, 'How to play');

const helpLinks = () => [howToPlay(), el('br'), el('button', { class: 'quiet', style: 'margin-top:4px', onclick: showFeedback }, 'Send feedback')];

const ribbon = () => {
  const wrap = el('div');
  wrap.innerHTML = '<svg class="ribbon-mark" viewBox="0 0 64 64" aria-hidden="true"><path fill="#e8833a" d="M32 28C22 14 8 12 8 22s14 12 24 6zm0 0c10-14 24-16 24-6s-14 12-24 6z"/><path fill="#c46a26" d="M27 30l-11 28 9-5 5 7 4-28zM37 30l11 28-9-5-5 7-4-28z"/><circle cx="32" cy="28" r="6" fill="#f2b27a"/></svg>';
  return wrap;
};

function submitting(form, work) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type=submit]');
    const error = form.querySelector('.error');
    if (error) error.textContent = '';
    button.disabled = true;
    try {
      await work(new FormData(form));
    } catch (err) {
      if (err.closed && !adminView) return showClosed();
      if (error) error.textContent = err.message;
    }
    button.disabled = false;
  });
  return form;
}

function showClosed() {
  show(ribbon(), el('h1', {}, 'The hunt is over'), el('p', { class: 'soft' }, 'Thank you for playing. See you next year.'));
}

function showGate(message) {
  const form = submitting(el('form', {},
    el('label', { for: 'code' }, 'Building code'),
    el('input', { id: 'code', name: 'code', autocomplete: 'off', autocapitalize: 'none', required: true }),
    el('p', { class: 'error', role: 'alert' }, message || ''),
    el('button', { type: 'submit', class: 'wide' }, 'Let me in'),
  ), async (data) => {
    await api('join', { method: 'POST', body: { code: data.get('code') } });
    showHome();
  });
  show(ribbon(), el('h1', {}, config.title), el('p', { class: 'soft' }, 'For residents only. The code is in your group chat and at reception.'), form, howToPlay());
}

function showHome() {
  if (store.get('door')) return showDoor();
  if (store.get('team')) return showHunt();
  track('view_home');
  show(
    ribbon(),
    el('h1', {}, config.title),
    el('p', {}, config.tagline),
    el('div', { class: 'choices' },
      el('button', { class: 'choice', onclick: startHunt }, el('strong', {}, 'Hunt for candy'), el('span', {}, 'We are trick or treating with our kids')),
      config.signupsOpen ? el('button', { class: 'choice strong', onclick: showSignup }, el('strong', {}, 'I have an orange ribbon'), el('span', {}, 'We are giving out candy')) : null,
    ),
    installed ? null : el('p', { class: 'small soft', style: 'margin-top:18px' }, 'Tip: add this to your home screen before you choose, so your progress stays in one place. iPhone: Share, then Add to Home Screen. Android: menu, then Install app.'),
    helpLinks(),
  );
}

async function startHunt() {
  try {
    const { token } = await api('team', { method: 'POST' });
    store.set('team', token);
    showHunt();
  } catch (err) {
    handleFatal(err);
  }
}

function handleFatal(err) {
  if (err.closed) return showClosed();
  if (err.status === 401) return showGate('Enter the building code again.');
  notice(err.status ? err.message : 'No connection. Try again in a moment.');
}

function showRetry() {
  track('view_retry');
  show(ribbon(), el('h1', { style: 'font-size:36px' }, 'Lost the signal'), el('p', { class: 'soft' }, 'Elevators and hallways can do that. Check your connection and try again.'), el('button', { class: 'wide', onclick: () => location.reload() }, 'Try again'));
}

async function showHunt() {
  clearInterval(pollTimer);
  let state;
  try {
    state = await api('state', { headers: { 'x-team': store.get('team') } });
  } catch (err) {
    if (err.status === 401 || err.closed) return handleFatal(err);
    return showRetry();
  }
  if (!state.team) {
    store.del('team');
    return showHome();
  }
  track('view_hunt');
  renderHunt(state);
  pollTimer = setInterval(refreshHunt, 30000);
}

async function refreshHunt() {
  // Never redraw while someone is typing a word, or their text would vanish.
  if (document.activeElement?.tagName === 'INPUT' || [...app.querySelectorAll('input')].some((input) => input.value)) return;
  try {
    const state = await api('state', { headers: { 'x-team': store.get('team') } });
    // Someone may have started typing while the request was on its way.
    if (document.activeElement?.tagName === 'INPUT' || [...app.querySelectorAll('input')].some((input) => input.value)) return;
    const top = window.scrollY;
    renderHunt(state);
    window.scrollTo(0, top);
  } catch { /* The next poll will try again. */ }
}

function starPicker(door, kind, label, current) {
  const rate = (stars) => async () => {
    try {
      await api('rate', { method: 'POST', headers: { 'x-team': store.get('team') }, body: { doorId: door.id, [kind]: stars } });
      refreshHuntNow();
    } catch (err) { handleFatal(err); }
  };
  return el('div', { class: 'stars', role: 'group', 'aria-label': label },
    el('span', { class: 'small soft' }, label),
    el('div', { class: 'stars-row' }, [1, 2, 3, 4, 5].map((stars) => el('button', {
      class: `star${current >= stars ? ' on' : ''}`,
      'aria-label': `${stars} of 5 stars`,
      'aria-pressed': String(current === stars),
      onclick: rate(stars),
    }, current >= stars ? '\u2605' : '\u2606'))),
  );
}

function doorCard(door, done, justStamped, rating) {
  const card = el('article', { class: `card${done ? ' done' : ''}${!door.active && !done ? ' out' : ''}${justStamped ? ' just' : ''}` },
    el('div', { class: 'alias' }, door.alias),
    door.nutFree ? el('p', { class: 'nut small' }, 'Nut-free option') : null,
    door.note ? el('p', { class: 'soft small', style: 'margin:4px 0 0' }, door.note) : null,
  );
  if (door.spotted) card.prepend(el('p', { class: 'soft small', style: 'margin:0 0 4px' }, 'Found by a neighbor'));
  if (done) card.append(
    el('p', { class: 'got', style: 'margin-bottom:0' }, door.spotted ? 'Visited' : 'Word collected'),
    starPicker(door, 'candy', 'Rate the candy', rating?.candy ?? 0),
    starPicker(door, 'costume', 'Rate the host costume', rating?.costume ?? 0),
  );
  else if (!door.active) card.append(el('p', { class: 'soft small', style: 'margin:4px 0 0' }, door.spotted ? 'No ribbon or out of candy' : 'Out of candy'));
  else if (door.spotted) {
    const act = (path, body) => async () => {
      try {
        await api(path, { method: 'POST', headers: { 'x-team': store.get('team') }, body });
        refreshHuntNow();
      } catch (err) { handleFatal(err); }
    };
    card.append(el('div', { class: 'row', style: 'margin-top:10px;padding-right:22px' },
      el('button', { onclick: act('stamp', { doorId: door.id, word: '' }) }, 'We visited'),
      el('button', { class: 'quiet', onclick: act('door/spot-gone', { id: door.id }) }, 'No ribbon here'),
    ));
  } else {
    const inputId = `word-${door.id}`;
    const error = el('p', { class: 'error small', role: 'alert', style: 'grid-column:1/-1;min-height:0' });
    card.append(submitting(el('form', {},
      el('input', { id: inputId, name: 'word', 'aria-label': `Secret word from ${door.alias}`, placeholder: 'Secret word', autocomplete: 'off', autocapitalize: 'characters', required: true }),
      el('button', { type: 'submit' }, 'Stamp'),
      error,
    ), async (data) => {
      const typed = String(data.get('word')).trim().toUpperCase();
      if (EGG_WORDS[typed]) {
        card.querySelector('input').value = '';
        return playEgg(EGG_WORDS[typed]);
      }
      try {
        await api('stamp', { method: 'POST', headers: { 'x-team': store.get('team') }, body: { doorId: door.id, word: data.get('word') } });
      } catch (err) {
        if (typed === 'BOO') playEgg('boo');
        throw err;
      }
      const state = await api('state', { headers: { 'x-team': store.get('team') } });
      const top = window.scrollY;
      renderHunt(state, door.id);
      window.scrollTo(0, top);
    }));
  }
  return card;
}

function renderHunt(state, justStamped) {
  const done = new Set(state.stamped);
  const collected = state.doors.filter((d) => done.has(d.id)).length;
  const percent = state.total ? Math.round((collected / state.total) * 100) : 0;
  const places = [];
  const nutFreeOnly = store.get('nutfree') === '1';
  state.doors.filter((door) => !nutFreeOnly || door.nutFree).forEach((door) => {
    const label = place(door);
    const last = places[places.length - 1];
    if (last?.label === label) last.doors.push(door);
    else places.push({ label, doors: [door] });
  });

  const rename = async () => {
    try {
      await api('team/rename', { method: 'POST', headers: { 'x-team': store.get('team') } });
      refreshHuntNow();
    } catch (err) { handleFatal(err); }
  };

  const nodes = [
    el('h1', { style: 'font-size:36px' }, config.title),
    el('p', { class: 'soft' }, `Go to the ${L().floors ? 'floor' : L().group.toLowerCase()}. Find the door with the orange ribbon. Ask for the secret word and type it in.`),
    el('section', { class: 'score' },
      el('div', { class: 'team' }, state.team.name),
      el('div', { class: 'count' }, `${collected} of ${state.total} doors`),
      el('div', { class: 'rank' }, state.team.rank),
      state.team.stars ? el('div', { class: 'team' }, `Costume stars from hosts: ${state.team.stars}`) : null,
      el('div', { class: 'bar' }, el('i', { style: `width:${percent}%` })),
    ),
    el('button', { class: 'link', onclick: rename }, 'Give us a new team name'),
    el('br'),
    helpLinks(),
    store.get('door')
      ? el('button', { class: 'strong wide', onclick: showDoor }, 'Back to my door')
      : (config.signupsOpen ? el('button', { class: 'strong wide', onclick: showSignup }, 'We are giving out candy') : null),
    el('h2', {}, 'Doors to find'),
    el('button', { class: 'strong wide', style: 'margin-bottom:10px', onclick: showSpot }, 'Found a ribbon? Add the door'),
    el('button', { class: `filter${nutFreeOnly ? ' on' : ''}`, 'aria-pressed': String(nutFreeOnly), onclick: () => {
      if (nutFreeOnly) store.del('nutfree');
      else {
        store.set('nutfree', '1');
        track('filter_nutfree');
      }
      refreshHuntNow();
    } }, nutFreeOnly ? 'Showing nut-free options only' : 'Show nut-free options only'),
  ];
  if (!places.length) nodes.push(el('p', { class: 'soft' }, nutFreeOnly ? 'No nut-free doors yet. Check back soon.' : 'No doors yet. If you find a ribbon, add the door so other families can go there.'));
  places.forEach((place) => {
    const left = place.doors.filter((door) => door.active && !done.has(door.id)).length;
    nodes.push(el('div', { class: 'place' }, `${place.label}: ${left ? `${left} left` : 'done'}`), place.doors.map((door) => doorCard(door, done.has(door.id), door.id === justStamped, state.ratings[door.id])));
  });
  if (state.leaderboard.length) {
    nodes.push(
      el('h2', {}, 'Top hunters'),
      el('ol', { class: 'board' }, state.leaderboard.map((row) => el('li', {}, el('span', {}, row.name), el('b', {}, String(row.stamps))))),
    );
  }
  const topList = (title, rows, value) => (rows.length ? [
    el('h2', {}, title),
    el('ol', { class: 'board' }, rows.map((row) => el('li', {}, el('span', {}, row.name), el('b', {}, value(row))))),
  ] : []);
  const average = (row) => `${row.stars.toFixed(1)} of 5`;
  nodes.push(
    topList('Best candy', state.topCandy, average),
    topList('Best host costumes', state.topHosts, average),
    topList('Best kid costumes', state.topKids, (row) => `${row.stars} ${row.stars === 1 ? 'star' : 'stars'}`),
  );
  nodes.push(
    el('p', { class: 'small soft', style: 'margin-top:26px' }, 'Hidden tricks: type TREAT or TRICK as a secret word, or tap the title five times.'),
    el('p', { class: 'safety' }, 'Stay with your children and knock only on doors with an orange ribbon. Nut-free is what the resident told us, so please check every label before your child eats a treat.'),
    el('p', { class: 'small soft' }, 'We count anonymous activity, such as visits and stamps. We do not collect names or IP addresses.'),
  );
  app.replaceChildren(...nodes.flat(Infinity).filter((node) => node !== null && node !== undefined));
}

function refreshHuntNow() {
  api('state', { headers: { 'x-team': store.get('team') } }).then((state) => {
    const top = window.scrollY;
    renderHunt(state);
    window.scrollTo(0, top);
  }).catch(handleFatal);
}

// Tower and floor side by side, or just the row for townhouses.
function placeFields(prefix = '') {
  const field = (name, label) => el('div', {}, el('label', { for: `${prefix}${name}` }, label), el('input', { id: `${prefix}${name}`, name, inputmode: 'numeric', required: true }));
  return L().floors
    ? el('div', { class: 'pair' }, field('tower', L().group), field('floor', 'Floor'))
    : field('tower', L().group);
}

function doorFields() {
  return [
    placeFields(),
    el('label', { for: 'apt' }, L().unit),
    el('input', { id: 'apt', name: 'apt', autocapitalize: 'characters', required: true }),
    el('label', { for: 'note' }, 'Hint for hunters (optional)'),
    el('input', { id: 'note', name: 'note', maxlength: '60', placeholder: L().floors ? 'Right off the elevator' : 'Blue door by the lamp post' }),
    el('label', { class: 'check' }, el('input', { type: 'checkbox', name: 'nutFree' }), 'We have a nut-free option'),
  ];
}

const doorBody = (data) => ({ tower: data.get('tower'), floor: data.get('floor'), apt: data.get('apt'), note: data.get('note'), nutFree: data.get('nutFree') === 'on' });

function showSignup() {
  track('view_signup');
  const form = submitting(el('form', {},
    doorFields(),
    el('p', { class: 'error', role: 'alert' }),
    el('button', { type: 'submit', class: 'wide' }, 'Give me a secret name'),
  ), async (data) => {
    const { token } = await api('door', { method: 'POST', body: doorBody(data) });
    store.set('door', token);
    await showDoor();
  });
  show(
    ribbon(),
    el('h1', { style: 'font-size:36px' }, 'Sign up your door'),
    el('p', {}, `Hunters see your secret name and ${whereWords()}. They never see your ${unitWord()}.`),
    form,
    el('button', { class: 'strong wide', style: 'margin-top:14px', onclick: () => (store.get('team') ? showHunt() : showHome()) }, 'Go back'),
  );
}

function showSpot() {
  track('view_spot');
  const form = submitting(el('form', {},
    placeFields('spot-'),
    el('label', { for: 'spot-apt' }, L().floors ? 'Door number' : L().unit),
    el('input', { id: 'spot-apt', name: 'apt', autocapitalize: 'characters', required: true }),
    el('p', { class: 'error', role: 'alert' }),
    el('button', { type: 'submit', class: 'wide' }, 'Add this door'),
  ), async (data) => {
    const { listed } = await api('door/spot', { method: 'POST', body: { tower: data.get('tower'), floor: data.get('floor'), apt: data.get('apt') } });
    notice(listed ? 'That door is on the list now. Thank you!' : 'Thank you!');
    await showHunt();
  });
  show(
    ribbon(),
    el('h1', { style: 'font-size:36px' }, 'Add a ribbon door'),
    el('p', {}, 'Add only doors with an orange ribbon. Other families will see this door number right away.'),
    form,
    el('button', { class: 'strong wide', style: 'margin-top:14px', onclick: () => showHunt() }, 'Go back'),
  );
}

function showFeedback() {
  track('view_feedback');
  const form = submitting(el('form', {},
    el('label', { for: 'feedback' }, 'What should we improve?'),
    el('textarea', { id: 'feedback', name: 'text', rows: '6', maxlength: '1000', required: true }),
    el('p', { class: 'small soft', style: 'margin-top:6px' }, 'Your message is anonymous. Please leave out names and apartment numbers.'),
    el('p', { class: 'error', role: 'alert' }),
    el('button', { type: 'submit', class: 'wide' }, 'Send'),
  ), async (data) => {
    await api('feedback', { method: 'POST', body: { text: data.get('text') } });
    notice('Thank you! The organizer will read this.');
    showHome();
  });
  show(
    ribbon(),
    el('h1', { style: 'font-size:36px' }, 'Send feedback'),
    form,
    el('button', { class: 'strong wide', style: 'margin-top:14px', onclick: showHome }, 'Go back'),
  );
}

const doorLink = (token) => `${location.origin}/?door=${token}`;

async function shareDoor() {
  track('share_door');
  const url = doorLink(store.get('door'));
  try {
    if (navigator.share) await navigator.share({ title: 'Our Orange Ribbon door', url });
    else {
      await navigator.clipboard.writeText(url);
      notice('Link copied. Send it to the other phone.');
    }
  } catch { /* Closing the share sheet is fine. */ }
}

async function removeDoor(headers) {
  if (!confirm('Remove your door from the hunt?')) return;
  try {
    await api('door/remove', { method: 'POST', headers });
    store.del('door');
    showHome();
  } catch (err) { handleFatal(err); }
}

async function goHunting() {
  if (store.get('team')) return showHunt();
  await startHunt();
}

async function showDoor() {
  clearInterval(pollTimer);
  const headers = { 'x-door': store.get('door') };
  let door;
  try {
    ({ door } = await api('door', { headers }));
  } catch (err) {
    if (err.status === 404) {
      store.del('door');
      return showHome();
    }
    if (err.status === 401 || err.closed) return handleFatal(err);
    return showRetry();
  }
  const setActive = async (active) => {
    try {
      await api('door/status', { method: 'POST', headers, body: { active } });
      showDoor();
    } catch (err) { handleFatal(err); }
  };
  const visitorList = (current) => el('div', { id: 'visitors' }, current.visitors.length
    ? el('ol', { class: 'board' }, current.visitors.map((team) => el('li', { class: 'visitor' },
      el('span', {}, team.name),
      el('button', {
        class: team.starred ? '' : 'quiet',
        'aria-pressed': String(team.starred),
        onclick: async () => {
          try {
            const { door: fresh } = await api('door/star', { method: 'POST', headers, body: { teamId: team.id, on: !team.starred } });
            app.querySelector('#visitors')?.replaceWith(visitorList(fresh));
          } catch (err) { handleFatal(err); }
        },
      }, team.starred ? 'Starred' : 'Give a star'),
    )))
    : el('p', { class: 'small soft' }, 'Teams appear here after they collect your word.'));
  track('view_door');
  show(
    ribbon(),
    el('p', { class: 'soft', style: 'margin:6px 0 0' }, 'You are now'),
    el('h1', { class: 'alias' }, door.alias),
    el('p', {}, 'Hang your orange ribbon where hunters can see it. When they knock, give them candy and this word:'),
    el('div', { class: 'word' }, door.word),
    el('section', { class: 'score' },
      el('div', { class: 'count' }, `${door.visits} ${door.visits === 1 ? 'visit' : 'visits'}`),
      el('div', { class: 'team' }, `${place(door)}, ${L().home} ${door.apt}. Only you and the organizer see the ${unitWord()}.`),
    ),
    door.active
      ? el('button', { class: 'quiet wide', onclick: () => setActive(false) }, 'We are out of candy')
      : el('button', { class: 'wide', onclick: () => setActive(true) }, 'We have candy again'),
    el('p', { class: 'small soft', style: 'margin-top:12px' }, door.active ? 'This keeps your door on the list. Tap it when the candy runs out.' : 'Hunters now see your door as out of candy.'),
    el('h2', {}, 'Costume stars'),
    el('p', { class: 'small soft' }, 'Give a star to any costume you loved. The newest teams are first. Ask a family for its team name if you are not sure. Stars are the only costume score for kids.'),
    visitorList(door),
    el('button', { class: 'link', style: 'margin-top:14px', onclick: shareDoor }, 'Open this door on another phone'),
    el('br'),
    el('button', { class: 'link', onclick: goHunting }, 'Take the kids hunting too'),
    el('br'),
    el('button', { class: 'link', onclick: () => removeDoor(headers) }, 'Remove my door'),
    el('br'),
    helpLinks(),
  );
  pollTimer = setInterval(async () => {
    try {
      const fresh = await api('door', { headers });
      const count = app.querySelector('.score .count');
      if (count) count.textContent = `${fresh.door.visits} ${fresh.door.visits === 1 ? 'visit' : 'visits'}`;
      app.querySelector('#visitors')?.replaceWith(visitorList(fresh.door));
    } catch { /* The next poll will try again. */ }
  }, 30000);
}

function showAdminLogin(message) {
  const form = submitting(el('form', {},
    el('label', { for: 'admin' }, 'Organizer code'),
    el('input', { id: 'admin', name: 'admin', type: 'password', required: true }),
    el('p', { class: 'error', role: 'alert' }, message || ''),
    el('button', { type: 'submit', class: 'wide' }, 'Open'),
  ), async (data) => {
    adminCode = data.get('admin');
    await showAdmin();
  });
  show(el('h1', { style: 'font-size:36px' }, 'Organizer'), form);
}

function download(name, text) {
  const link = el('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/csv' })), download: name });
  document.body.append(link);
  link.click();
  link.remove();
}

const panel = (title, open, ...children) => el('details', { class: 'panel', open }, el('summary', {}, title), children);
const stat = (label, value) => el('div', { class: 'stat' }, el('b', {}, String(value)), el('span', {}, label));

const shareLink = (settings) => `${location.origin}/?c=${settings.buildingCode}`;
const shareMessage = (settings) => `Hi neighbors, I made a small free app for tonight so nobody has to go ${L().floors ? 'floor by floor' : 'house by house'} looking for orange ribbons.\n\n${shareLink(settings)}\n\nIf you are giving out candy, tap "I have an orange ribbon" and add your door. You get a silly secret name and a word to give the kids. Families see the secret name and ${whereWords()}, and only I can see your ${unitWord()}.\n\nIf you are trick or treating, tap "Hunt for candy." If you find a ribbon that is not listed, add the door so other families can go there.\n\nIf a neighbor adds your door first, its number shows until you sign up. The app does not ask for names and keeps an anonymous count of things like visits. Please keep the link inside the building. Happy Halloween!`;

async function qrImage(text) {
  if (!window.qrcode) {
    await new Promise((resolve, reject) => {
      document.head.append(el('script', { src: '/vendor/qrcode.js', onload: resolve, onerror: reject }));
    });
  }
  const code = window.qrcode(0, 'M');
  code.addData(text);
  code.make();
  return code.createDataURL(10, 2);
}

async function openPoster(settings) {
  const image = await qrImage(shareLink(settings));
  const page = el('div', { class: 'poster' },
    el('h1', {}, settings.title),
    el('p', {}, 'Picked up a ribbon? Scan this and sign up your door.'),
    el('img', { src: image, alt: 'QR code that opens the hunt' }),
    el('p', {}, `Hunters scan it too. Your ${unitWord()} stays private.`),
    el('p', {}, `Building code: ${settings.buildingCode}`),
    el('button', { class: 'no-print wide', onclick: () => window.print() }, 'Print'),
    el('button', { class: 'no-print link', onclick: () => showAdmin() }, 'Back to the portal'),
  );
  show(page);
}

function statsPanel(stats, headers) {
  const busiest = Math.max(1, ...stats.hours.map((hour) => hour.actions));
  const hourLabel = (hour) => new Date(hour * 3600000).toLocaleString([], { weekday: 'short', hour: 'numeric' });
  const clear = async () => {
    if (!confirm('Clear all usage counts?')) return;
    await api('admin/stats/clear', { method: 'POST', headers });
    showAdmin();
  };
  return panel('Usage and stats', true,
    el('div', { class: 'stats' },
      stat('Phones', stats.people.visitors),
      stat('Installed', stats.people.installed),
      stat('Teams', stats.teams),
      stat('Teams with a stamp', stats.teamsWithStamps),
      stat('Stamps', stats.stamps),
      stat('Ratings', stats.ratings),
      stat('Costume stars', stats.costumeStars),
      stat('Doors', stats.doors.total),
      stat('Doors with candy', stats.doors.active),
      stat('Nut-free doors', stats.doors.nutFree),
    ),
    stats.hours.length ? el('h3', {}, 'Activity by hour') : null,
    stats.hours.map((hour) => el('div', { class: 'hour' },
      el('span', {}, hourLabel(hour.hour)),
      el('div', { class: 'bar' }, el('i', { style: `width:${Math.round((hour.actions / busiest) * 100)}%` })),
      el('span', {}, `${hour.visitors} phones`),
    )),
    stats.topDoors.length ? el('h3', {}, 'Most visited doors') : null,
    stats.topDoors.map((door) => el('p', { class: 'small', style: 'margin:0 0 4px' }, `${door.alias}: ${door.visits}`)),
    stats.floors.length ? el('h3', {}, L().floors ? 'Busiest floors' : `Busiest ${L().group.toLowerCase()}s`) : null,
    stats.floors.map((floor) => el('p', { class: 'small', style: 'margin:0 0 4px' }, `${place(floor)}: ${floor.visits}`)),
    stats.events.length ? el('h3', {}, 'Every action') : null,
    stats.events.map((event) => el('p', { class: 'small', style: 'margin:0 0 4px' }, `${event.name.replaceAll('_', ' ')}: ${event.n}`)),
    el('p', { class: 'small soft', style: 'margin-top:12px' }, 'Counts are anonymous. No names, IP addresses or apartment numbers are stored with them.'),
    el('button', { class: 'quiet', onclick: clear }, 'Clear usage counts'),
  );
}

function sharePanel(settings) {
  const copy = async () => {
    await navigator.clipboard.writeText(shareMessage(settings));
    notice('Message copied.');
  };
  return panel('Share', false,
    el('p', { class: 'small', style: 'overflow-wrap:anywhere' }, shareLink(settings)),
    el('div', { class: 'row' },
      el('a', { class: 'button', href: `https://wa.me/?text=${encodeURIComponent(shareMessage(settings))}`, target: '_blank', rel: 'noreferrer' }, 'Send on WhatsApp'),
      el('button', { class: 'quiet', onclick: copy }, 'Copy message'),
      el('button', { class: 'quiet', onclick: () => openPoster(settings) }, 'QR poster'),
    ),
  );
}

function importPanel(headers) {
  const result = el('div');
  const form = submitting(el('form', {},
    el('p', { class: 'small soft' }, `One door per line: ${L().columns.join(', ').replace('nut-free', 'nut-free (yes or no)')}. Paste from a spreadsheet or the chat. Each door gets a new secret name and word.`),
    el('textarea', { name: 'list', rows: '6', 'aria-label': 'Door list', placeholder: L().floors ? '1,8,8B,yes,Right off the elevator\n2,5,5C' : '1,14,yes,Blue door\n2,3A' }),
    el('p', { class: 'error', role: 'alert' }),
    el('button', { type: 'submit', class: 'wide' }, 'Load doors'),
  ), async (data) => {
    const { added, skipped, errors } = await api('admin/import', { method: 'POST', headers, body: { text: data.get('list') } });
    const rows = [['where', unitWord(), 'secret name', 'word', 'door link'], ...added.map((door) => [place(door), door.apt, door.alias, door.word, doorLink(door.token)])];
    result.replaceChildren(
      el('p', { class: 'score small' }, `Loaded ${added.length}. Already there: ${skipped.length}. Bad lines: ${errors.map((e) => e.line).join(', ') || 'none'}.`),
      added.length ? el('button', { type: 'button', class: 'quiet wide', onclick: () => download('door-links.csv', toCsv(rows)) }, 'Download names, words and door links') : null,
      el('button', { type: 'button', class: 'link', onclick: () => showAdmin() }, 'Refresh the door list'),
    );
    form.querySelector('textarea').value = '';
  });
  return panel('Load a list of doors', false, form, result);
}

function settingsPanel(settings, headers) {
  const form = submitting(el('form', {},
    el('label', { for: 's-title' }, 'Title'),
    el('input', { id: 's-title', name: 'title', maxlength: '40', value: settings.title, required: true }),
    el('label', { for: 's-tagline' }, 'Intro on the home screen'),
    el('textarea', { id: 's-tagline', name: 'tagline', rows: '3', maxlength: '200', required: true }, settings.tagline),
    el('label', { for: 's-code' }, 'Building code'),
    el('input', { id: 's-code', name: 'buildingCode', value: settings.buildingCode, required: true }),
    el('p', { class: 'small soft', style: 'margin-top:4px' }, 'Changing this signs everyone out and breaks old links and posters.'),
    el('label', { for: 's-layout' }, 'Homes are'),
    el('select', { id: 's-layout', name: 'layout' },
      el('option', { value: 'towers', selected: settings.layout === 'towers' }, 'Apartment towers (tower, floor, apartment)'),
      el('option', { value: 'townhouses', selected: settings.layout === 'townhouses' }, 'Townhouses (row, house number)'),
    ),
    el('p', { class: 'small soft', style: 'margin-top:4px' }, 'Pick this before doors sign up. Number your rows on the poster so families can find them.'),
    el('label', { class: 'check' }, el('input', { type: 'checkbox', name: 'signupsOpen', checked: settings.signupsOpen }), 'Residents can sign up their own doors'),
    el('p', { class: 'error', role: 'alert' }),
    el('button', { type: 'submit', class: 'wide' }, 'Save'),
  ), async (data) => {
    await api('admin/settings', { method: 'POST', headers, body: {
      title: data.get('title'),
      tagline: data.get('tagline'),
      buildingCode: data.get('buildingCode'),
      layout: data.get('layout'),
      signupsOpen: data.get('signupsOpen') === 'on',
    } });
    notice('Saved.');
    await showAdmin();
  });
  return panel('Customize', false, form);
}

async function showAdmin(added) {
  const headers = { 'x-admin': adminCode };
  const [{ doors }, settings, stats, { feedback }, fresh] = await Promise.all([
    api('admin/doors', { headers }),
    api('admin/settings', { headers }),
    api('admin/stats', { headers }),
    api('admin/feedback', { headers }),
    api('config'),
  ]);
  // A saved layout change shows up in every label right away.
  config = fresh;
  const clearFeedback = async () => {
    if (!confirm('Delete all feedback?')) return;
    await api('admin/feedback/clear', { method: 'POST', headers });
    showAdmin();
  };
  const remove = async (door) => {
    if (!confirm(`Remove ${door.alias}?`)) return;
    await api('admin/remove', { method: 'POST', headers, body: { id: door.id } });
    showAdmin();
  };
  const setActive = async (door, active) => {
    await api('admin/status', { method: 'POST', headers, body: { id: door.id, active } });
    showAdmin();
  };
  // Columns match the import format, so this file loads straight back in next year.
  const exportList = () => download('door-list.csv', toCsv([
    L().columns,
    ...doors.map((door) => [door.tower, ...(L().floors ? [door.floor] : []), door.apt, door.nut_free ? 'yes' : 'no', door.note]),
  ]));
  const wipe = async () => {
    if (prompt('This deletes every door, team and stamp. Save the list first if you want it next year. Type WIPE to confirm.') !== 'WIPE') return;
    await api('admin/wipe', { method: 'POST', headers, body: { confirm: 'WIPE' } });
    showAdmin();
  };
  const form = submitting(el('form', {},
    doorFields(),
    el('p', { class: 'error', role: 'alert' }),
    el('button', { type: 'submit', class: 'wide' }, 'Add door'),
  ), async (data) => {
    const { token, door } = await api('door', { method: 'POST', headers, body: doorBody(data) });
    await showAdmin(`Added ${door.alias}. Word: ${door.word}. Send this door link to the resident: ${doorLink(token)}`);
  });
  show(
    el('h1', { style: 'font-size:36px' }, 'Organizer'),
    el('p', { class: 'soft' }, `${settings.title}: ${doors.length} doors. Keep this page private because it shows ${unitWord()}s.`),
    added ? el('p', { class: 'score', style: 'overflow-wrap:anywhere' }, added) : null,
    sharePanel(settings),
    statsPanel(stats, headers),
    panel('Doors', true,
      el('table', {},
        el('thead', {}, el('tr', {}, ['Door', 'Name', 'Word', 'Visits', ''].map((title) => el('th', {}, title)))),
        el('tbody', {}, doors.map((door) => el('tr', {},
          el('td', {}, L().floors ? `T${door.tower} F${door.floor} ${door.apt}` : `${L().group} ${door.tower}, ${door.apt}`),
          el('td', {}, door.alias, door.spotted ? ' (found by a neighbor)' : null, door.active ? null : ' (out)'),
          el('td', {}, door.word),
          el('td', {}, String(door.visits)),
          el('td', {},
            el('button', { class: 'quiet', onclick: () => setActive(door, door.active !== 1) }, door.active === 1 ? 'Out' : 'Back'),
            ' ',
            el('button', { class: 'quiet', onclick: () => remove(door) }, 'Remove'),
          ),
        ))),
      ),
      el('button', { class: 'quiet', style: 'margin-top:12px', onclick: exportList }, 'Save door list for next year'),
    ),
    panel(`Feedback (${feedback.length})`, feedback.length > 0,
      feedback.length ? feedback.map((item) => el('div', { class: 'score small', style: 'overflow-wrap:anywhere' },
        el('div', { class: 'soft small' }, new Date(item.at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })),
        el('div', {}, item.text),
      )) : el('p', { class: 'small soft' }, 'No feedback yet.'),
      feedback.length ? el('button', { class: 'quiet', onclick: clearFeedback }, 'Delete all feedback') : null,
    ),
    panel('Add one door', false, form),
    importPanel(headers),
    settingsPanel(settings, headers),
    panel('New year or after the hunt', false,
      el('p', { class: 'small soft' }, 'After the night: save the door list, then delete all data. Next year, load the list again.'),
      el('button', { class: 'quiet wide', onclick: wipe }, 'Delete all data'),
    ),
  );
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  store.set('theme', theme);
  document.querySelector('meta[name=theme-color]').content = theme === 'light' ? '#eef2f7' : '#141c2b';
  const toggle = document.querySelector('.theme');
  if (toggle) {
    toggle.textContent = theme === 'light' ? 'Dark mode' : 'Light mode';
    toggle.setAttribute('aria-pressed', String(theme === 'dark'));
  }
}

function addThemeToggle() {
  document.body.append(el('button', { class: 'theme quiet', onclick: () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    track(next === 'light' ? 'theme_light' : 'theme_dark');
  } }));
  setTheme(store.get('theme') === 'light' ? 'light' : 'dark');
}

// Easter eggs. All of them skip the motion when the phone asks for reduced motion.
function floatMany(kind, count) {
  const layer = el('div', { class: 'eggs', 'aria-hidden': 'true' });
  for (let i = 0; i < count; i++) {
    layer.append(el('i', { class: kind, style: `left:${Math.random() * 96}%;animation-delay:${Math.random() * 1.2}s;animation-duration:${2 + Math.random() * 1.5}s` }));
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 5000);
}

function playEgg(name) {
  track(`egg_${name}`);
  const lines = { treat: 'Candy for everyone!', trick: 'Trick! The building turned upside down.', boo: 'BOO! But that is not this door\u2019s word.', bats: 'You woke the bats!' };
  notice(lines[name]);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (name === 'treat') floatMany('candy', 28);
  if (name === 'bats') floatMany('bat', 16);
  if (name === 'boo') floatMany('ghost', 6);
  if (name === 'trick') {
    document.body.classList.add('flipped');
    setTimeout(() => document.body.classList.remove('flipped'), 2500);
  }
}

let titleTaps = 0;
let titleTimer = null;
document.addEventListener('click', (event) => {
  if (adminView || !event.target.closest('h1, .ribbon-mark')) return;
  titleTaps += 1;
  clearTimeout(titleTimer);
  titleTimer = setTimeout(() => { titleTaps = 0; }, 2500);
  if (titleTaps >= 5) {
    titleTaps = 0;
    playEgg('bats');
  }
});
window.addEventListener('appinstalled', () => track('installed'));

async function start() {
  addThemeToggle();
  try {
    config = await api('config');
    document.title = config.title;
    if (config.closed && !adminView) return showClosed();
  } catch { /* Offline: the defaults still draw the page. */ }
  if (adminView) return showAdminLogin();
  track('app_open');
  const params = new URLSearchParams(location.search);
  const code = params.get('c');
  const wantsFeedback = params.has('feedback');
  const doorToken = params.get('door');
  if (doorToken) {
    store.set('door', doorToken);
    history.replaceState(null, '', location.pathname);
  }
  if (code) {
    history.replaceState(null, '', location.pathname);
    try {
      await api('join', { method: 'POST', body: { code } });
    } catch (err) {
      if (err.closed) return showClosed();
      return showGate(err.message);
    }
    return showHome();
  }
  try {
    await api('state');
    if (wantsFeedback) {
      history.replaceState(null, '', location.pathname);
      return showFeedback();
    }
    showHome();
  } catch (err) {
    if (err.closed) return showClosed();
    if (err.status === 401) return showGate();
    showRetry();
  }
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
start();
