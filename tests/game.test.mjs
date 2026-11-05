import test from 'node:test';
import assert from 'node:assert/strict';
import { toCsv } from '../public/csv.js';
import { makeAlias, makeTeamName, makeWord, normalizeWord, rankFor, validateDoor, publicDoor, parseDoorList, validateSettings, parseRating, topRated, LAYOUTS, layoutOf, placeLabel, listColumns, spottedName } from '../lib/game.js';

const townhouses = LAYOUTS.townhouses;

test('townhouses sign up with a row and house number, and floor is always 1', () => {
  assert.deepEqual(validateDoor({ tower: '3', apt: '14a' }, townhouses).value, { tower: 3, floor: 1, apt: '14A', note: '', nutFree: false });
  assert.equal(validateDoor({ tower: 3, floor: 999, apt: '14' }, townhouses).value.floor, 1);
  assert.match(validateDoor({ tower: 0, apt: '14' }, townhouses).error, /row/);
  assert.match(validateDoor({ tower: 3, apt: '' }, townhouses).error, /house number/);
});

test('hunters see the row for townhouses and tower and floor for towers', () => {
  assert.equal(placeLabel(townhouses, 3, 1), 'Row 3');
  assert.equal(placeLabel(LAYOUTS.towers, 1, 8), 'Tower 1, floor 8');
  assert.equal(spottedName(3, '14', townhouses), 'Row 3, door 14');
});

test('a townhouse list has no floor column and loads its own export', () => {
  const csv = toCsv([listColumns(townhouses), [1, '14', 'yes', 'blue door, by the lamp'], [2, '3A', 'no', '']]);
  const { rows, errors } = parseDoorList(csv, townhouses);
  assert.deepEqual(errors, []);
  assert.deepEqual(rows, [
    { tower: 1, floor: 1, apt: '14', note: 'blue door, by the lamp', nutFree: true },
    { tower: 2, floor: 1, apt: '3A', note: '', nutFree: false },
  ]);
});

test('layout defaults to towers and rejects anything else', () => {
  assert.equal(layoutOf(undefined).name, 'towers');
  assert.equal(layoutOf('igloos').name, 'towers');
  const good = { title: 'Hunt', tagline: 'Find doors', buildingCode: 'ribbon-2027' };
  assert.equal(validateSettings(good).value.layout, 'towers');
  assert.equal(validateSettings({ ...good, layout: 'townhouses' }).value.layout, 'townhouses');
  assert.ok(validateSettings({ ...good, layout: 'igloos' }).error);
});

test('aliases and team names never contain digits', () => {
  for (let i = 0; i < 500; i++) {
    assert.doesNotMatch(makeAlias(), /\d/);
    assert.doesNotMatch(makeTeamName(), /\d/);
  }
});

test('hints and apartments cannot carry spreadsheet formulas', () => {
  assert.equal(validateDoor({ tower: 1, floor: 8, apt: '8B', note: '=HYPERLINK(1)' }).value.note, 'HYPERLINK(1)');
  assert.equal(validateDoor({ tower: 1, floor: 8, apt: '8B', note: '@ +-=sum' }).value.note, 'sum');
  assert.ok(validateDoor({ tower: 1, floor: 8, apt: '-1' }).error);
});

test('export keeps a comma from starting a formula cell', () => {
  assert.equal(toCsv([['x,=cmd()', '=sum', 'say "hi"']]), '"x,=cmd()","\'=sum","say ""hi"""');
});

test('a saved list loads again with the same doors', () => {
  const csv = toCsv([['tower', 'floor', 'apartment', 'nut-free', 'hint'], [1, 8, '8B', 'yes', 'left, past "the" plant'], [2, 5, '5C', 'no', '']]);
  const { rows, errors } = parseDoorList(csv);
  assert.deepEqual(errors, []);
  assert.deepEqual(rows, [
    { tower: 1, floor: 8, apt: '8B', note: 'left, past "the" plant', nutFree: true },
    { tower: 2, floor: 5, apt: '5C', note: '', nutFree: false },
  ]);
});

test('generated names never use a hateful title', () => {
  for (let i = 0; i < 3000; i++) assert.doesNotMatch(makeAlias(), /wizard|dragon|klan/i);
});

test('door words match however a child types them', () => {
  assert.equal(normalizeWord('  boo '), 'BOO');
  assert.equal(normalizeWord(undefined), '');
  const word = makeWord();
  assert.equal(normalizeWord(word.toLowerCase()), word);
});

test('rank climbs with stamps and the top rank needs every door', () => {
  assert.equal(rankFor(0, 12), 'Fresh Ghost');
  assert.equal(rankFor(1, 12), 'Hallway Creeper');
  assert.equal(rankFor(3, 12), 'Elevator Phantom');
  assert.equal(rankFor(6, 12), 'Ribbon Hunter');
  assert.equal(rankFor(10, 12), 'Night Terror');
  assert.equal(rankFor(12, 12), 'Ruler of the Ribbons');
  assert.equal(rankFor(0, 0), 'Fresh Ghost');
});

test('door validation accepts real apartments and rejects junk', () => {
  assert.deepEqual(validateDoor({ tower: '1', floor: '8', apt: ' 8b ', note: ' right off  the elevator ' }).value, { tower: 1, floor: 8, apt: '8B', note: 'right off the elevator', nutFree: false });
  assert.equal(validateDoor({ tower: 1, floor: 8, apt: '8B', nutFree: true }).value.nutFree, true);
  assert.ok(validateDoor({ tower: 0, floor: 8, apt: '8B' }).error);
  assert.ok(validateDoor({ tower: 1, floor: 201, apt: '8B' }).error);
  assert.ok(validateDoor({ tower: 100, floor: 8, apt: '8B' }).error);
  assert.equal(validateDoor({ tower: 12, floor: 150, apt: '150A' }).value.floor, 150);
  assert.ok(validateDoor({ tower: 1, floor: 8, apt: '<script>' }).error);
  assert.ok(validateDoor({ tower: 1, floor: 8, apt: '8B', note: 'x'.repeat(61) }).error);
});

test('a pasted door list skips the header and reports bad lines', () => {
  const { rows, errors } = parseDoorList('Tower,Floor,Apartment,Nut free,Hint\n1,8,8b,yes,Off the elevator, on the left\n\n2,5,5C\nx,1,1A');
  assert.deepEqual(rows, [
    { tower: 1, floor: 8, apt: '8B', note: 'Off the elevator, on the left', nutFree: true },
    { tower: 2, floor: 5, apt: '5C', note: '', nutFree: false },
  ]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].line, 5);
});

test('settings reject bad values', () => {
  const good = { title: 'Hunt', tagline: 'Find doors', buildingCode: 'ribbon-2027', signupsOpen: true };
  assert.equal(validateSettings(good).value.signups_open, '1');
  assert.ok(validateSettings({ ...good, title: '' }).error);
  assert.ok(validateSettings({ ...good, buildingCode: 'a b' }).error);
  assert.equal(validateSettings(good).value.closes_at, undefined);
});

test('hunters never receive the apartment number or the door word', () => {
  const door = publicDoor({ id: 'a', alias: 'Baron Gummy Fang', tower: 1, floor: 8, apt: '8B', word: 'BOO', note: '', active: 1, owner_hash: 'secret' });
  assert.deepEqual(Object.keys(door).sort(), ['active', 'alias', 'floor', 'id', 'note', 'nutFree', 'spotted', 'tower']);
  assert.equal(door.active, true);
});

test('a rating needs whole stars from 1 to 5', () => {
  assert.deepEqual(parseRating({ candy: 5 }).value, { candy: 5, costume: null });
  assert.deepEqual(parseRating({ costume: '1' }).value, { candy: null, costume: 1 });
  for (const bad of [{}, { candy: 0 }, { candy: 6 }, { candy: 2.5 }, { costume: 'lots' }, { candy: null }, { candy: 3, costume: 9 }]) assert.ok(parseRating(bad).error);
});

test('top lists hide low scores, keep the best first and stop at five', () => {
  const rows = [
    { name: 'Low', avg: 2.96, votes: 9 },
    { name: 'Edge', avg: 3, votes: 3 },
    { name: 'Best', avg: 5, votes: 3 },
    { name: 'Too few votes', avg: 5, votes: 2 },
    { name: 'Busy best', avg: 5, votes: 4 },
    { name: 'Good', avg: 4.25, votes: 4 },
    { name: 'Fine', avg: 3.5, votes: 4 },
    { name: 'Sixth', avg: 3.1, votes: 4 },
  ];
  assert.deepEqual(topRated(rows).map((row) => row.name), ['Busy best', 'Best', 'Good', 'Fine', 'Sixth']);
  assert.equal(topRated([{ name: 'Round', avg: 4.25, votes: 4 }])[0].stars, 4.3);
  assert.deepEqual(topRated([{ name: 'Low', avg: 2.96, votes: 9 }]), []);
});
