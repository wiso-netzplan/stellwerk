import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  lies, pruefeHallo, pruefeAntwort, pruefeBefehl, zaehle, tafel, wechsel, neuerEimer, nimm, freierCode,
  raeumeAuf, fehlversuch, istGesperrt, vergiss, schluesselPasst, zufallsMarke, fingerabdruck,
  MINDESTENS, NACHRICHT_BYTES, FEHLVERSUCHE
} from '../src/regeln.js';

const MARKE = 'abcdefghijklmnop1234';

test('lies verwirft alles außer kleinen JSON-Objekten mit Art', () => {
  assert.equal(lies(null), null);
  assert.equal(lies('kein json'), null);
  assert.equal(lies('[1,2]'), null);
  assert.equal(lies('{"x":1}'), null);
  assert.equal(lies('{"t":"a","x":"' + 'y'.repeat(NACHRICHT_BYTES) + '"}'), null);
  assert.deepEqual(lies('{"t":"antwort","f":1,"w":0}'), {t: 'antwort', f: 1, w: 0});
});

test('hallo: Lehrkraft nur mit passender Marke, Schüler neu oder mit vom Raum vergebener Marke', () => {
  assert.deepEqual(pruefeHallo({t: 'hallo', lehrer: 'geheim'}, 'geheim'), {rolle: 'lehrer'});
  assert.deepEqual(pruefeHallo({t: 'hallo', lehrer: 'falsch'}, 'geheim'), {fehler: 'lehrer-falsch'});
  assert.deepEqual(pruefeHallo({t: 'hallo', lehrer: ''}, ''), {fehler: 'lehrer-falsch'});
  assert.deepEqual(pruefeHallo({t: 'hallo', lehrer: 'geheim', marke: MARKE}, 'geheim'), {fehler: 'felder'});
  assert.deepEqual(pruefeHallo({t: 'hallo'}, 'geheim'), {rolle: 'schueler', marke: null});
  assert.deepEqual(pruefeHallo({t: 'hallo', marke: MARKE}, 'geheim'), {rolle: 'schueler', marke: MARKE});
  assert.deepEqual(pruefeHallo({t: 'hallo', marke: 'kurz'}, 'geheim'), {fehler: 'marke-ungueltig'});
  assert.deepEqual(pruefeHallo({t: 'hallo', marke: 'Lena Müller aus IN25!'}, 'g'), {fehler: 'marke-ungueltig'});
  assert.deepEqual(pruefeHallo({t: 'hallo', name: 'Tim'}, 'g'), {fehler: 'felder'});
  assert.deepEqual(pruefeHallo({t: 'antwort'}, 'g'), {fehler: 'hallo-fehlt'});
});

test('Antworten: nur Zahlen aus der Liste der laufenden, offenen Frage', () => {
  const frage = {nr: 3, n: 4, offen: true};
  assert.deepEqual(pruefeAntwort({f: 3, w: 2}, frage), {wahl: 2});
  assert.deepEqual(pruefeAntwort({f: 3, w: 4}, frage), {fehler: 'wahl-ungueltig'});
  assert.deepEqual(pruefeAntwort({f: 3, w: -1}, frage), {fehler: 'wahl-ungueltig'});
  assert.deepEqual(pruefeAntwort({f: 3, w: 1.5}, frage), {fehler: 'wahl-ungueltig'});
  assert.deepEqual(pruefeAntwort({f: 3, w: 'Ja'}, frage), {fehler: 'wahl-ungueltig'});
  assert.deepEqual(pruefeAntwort({f: 2, w: 0}, frage), {fehler: 'alte-frage'});
  assert.deepEqual(pruefeAntwort({f: 3, w: 0}, {...frage, offen: false}), {fehler: 'geschlossen'});
  assert.deepEqual(pruefeAntwort({f: 3, w: 0}, null), {fehler: 'keine-frage'});
  assert.deepEqual(pruefeAntwort({t: 'antwort', f: 3, w: 1, richtig: true}, frage), {fehler: 'felder'});
  assert.deepEqual(pruefeAntwort({t: 'antwort', f: 3, w: 1}, frage), {wahl: 1});
});

test('Befehle vom Pult: Fragearten, Anzahl und Verweis werden geprüft, Text gibt es nicht', () => {
  assert.deepEqual(pruefeBefehl({t: 'frage', art: 'wahl', n: 3, ref: 'AW-08/urteil-1'}),
    {befehl: 'frage', art: 'wahl', n: 3, ref: 'AW-08/urteil-1'});
  assert.deepEqual(pruefeBefehl({t: 'frage', art: 'ampel', n: 99, ref: 'ampel'}),
    {befehl: 'frage', art: 'ampel', n: 3, ref: 'ampel'});
  assert.deepEqual(pruefeBefehl({t: 'frage', art: 'fertig', ref: 'fertig'}),
    {befehl: 'frage', art: 'fertig', n: 1, ref: 'fertig'});
  assert.deepEqual(pruefeBefehl({t: 'frage', art: 'wahl', n: 9, ref: 'x'}), {fehler: 'anzahl-ungueltig'});
  assert.deepEqual(pruefeBefehl({t: 'frage', art: 'wahl', n: 1, ref: 'x'}), {fehler: 'anzahl-ungueltig'});
  assert.deepEqual(pruefeBefehl({t: 'frage', art: 'chat', n: 2, ref: 'x'}), {fehler: 'art-ungueltig'});
  assert.deepEqual(pruefeBefehl({t: 'frage', art: 'wahl', n: 2, ref: 'Wer ist doof?'}), {fehler: 'verweis-ungueltig'});
  assert.deepEqual(pruefeBefehl({t: 'frage', art: 'wahl', n: 2, ref: '<script>'}), {fehler: 'verweis-ungueltig'});
  assert.deepEqual(pruefeBefehl({t: 'tueren', zu: true}), {befehl: 'tueren', zu: true});
  assert.deepEqual(pruefeBefehl({t: 'tueren', zu: 'ja'}), {fehler: 'tueren-ungueltig'});
  assert.deepEqual(pruefeBefehl({t: 'zeigen'}), {befehl: 'zeigen'});
  assert.deepEqual(pruefeBefehl({t: 'platz', n: 27}), {befehl: 'platz', n: 27});
  assert.deepEqual(pruefeBefehl({t: 'platz', n: 0}), {fehler: 'platz-ungueltig'});
  assert.deepEqual(pruefeBefehl({t: 'platz', n: 61}), {fehler: 'platz-ungueltig'});
  assert.deepEqual(pruefeBefehl({t: 'sag', text: 'hallo'}), {fehler: 'befehl-unbekannt'});
});

test('Tafel: unter fünf Antworten keine Verteilung, ab fünf die Summen', () => {
  const vier = new Map([['a', 0], ['b', 0], ['c', 1], ['d', 2]]);
  assert.deepEqual(tafel(vier, 3), {gesamt: 4, summen: null});
  const fuenf = new Map([...vier, ['e', 2]]);
  assert.equal(fuenf.size, MINDESTENS);
  assert.deepEqual(tafel(fuenf, 3), {gesamt: 5, summen: [2, 1, 2]});
  assert.deepEqual(zaehle(new Map([['a', 7]]), 3), [0, 0, 0]);
});

test('Wechsel zwischen Vorher und Nachher erst ab fünf Geräten in beiden Runden', () => {
  const vorher = new Map([['a', 0], ['b', 0], ['c', 1], ['d', 1], ['e', 2], ['f', 2]]);
  const wenige = new Map([['a', 1], ['b', 0], ['c', 1], ['d', 1]]);
  assert.equal(wechsel(vorher, wenige), null);
  const genug = new Map([['a', 1], ['b', 0], ['c', 1], ['d', 0], ['e', 2], ['neu', 0]]);
  assert.deepEqual(wechsel(vorher, genug), {beide: 5, anders: 2});
});

test('Eimer: kurze Stöße erlaubt, danach eine Nachricht pro Sekunde', () => {
  const e = neuerEimer(0);
  assert.equal(nimm(e, 0), true);
  assert.equal(nimm(e, 0), true);
  assert.equal(nimm(e, 0), true);
  assert.equal(nimm(e, 0), false);
  assert.equal(nimm(e, 500), false);
  assert.equal(nimm(e, 1000), true);
  assert.equal(nimm(e, 60000), true); // nach langer Pause wieder voll, aber nie mehr als der Stoß
  assert.ok(e.inhalt <= 3);
});

test('freierCode: vierstellig, nie doppelt', () => {
  let i = 0;
  const folge = [42, 42, 1234, 9999];
  const zufall = () => folge[i++ % folge.length];
  assert.equal(freierCode(new Set(), zufall), '0042');
  assert.equal(freierCode(new Set(['0042']), zufall), '1234');
  const voll = new Set(Array.from({length: 9000}, (_, k) => String(k).padStart(4, '0')));
  assert.equal(freierCode(voll, () => 1), null);
});

test('raeumeAuf entfernt nur abgelaufene Räume', () => {
  const r = new Map([['0001', 100], ['0002', 300]]);
  assert.equal(raeumeAuf(r, 200), 1);
  assert.deepEqual([...r.keys()], ['0002']);
});

test('Fehlversuche: Sperre nach der Grenze, nach einer Minute vergessen', () => {
  const z = new Map();
  for (let i = 0; i < FEHLVERSUCHE; i++) assert.equal(fehlversuch(z, 'x', 1000), false);
  assert.equal(fehlversuch(z, 'x', 1000), true);
  assert.equal(istGesperrt(z, 'x', 30000), true);
  assert.equal(istGesperrt(z, 'y', 30000), false);
  assert.equal(istGesperrt(z, 'x', 61000), false);
  vergiss(z, 61000);
  assert.equal(z.size, 0);
});

test('Pult-Schlüssel: nur exakt gleich und mindestens 16 Zeichen lang', async () => {
  const s = 'Kastanie Hafenkran Regenschirm 7';
  assert.equal(await schluesselPasst(s, s), true);
  assert.equal(await schluesselPasst(s + ' ', s), false);
  assert.equal(await schluesselPasst('', s), false);
  assert.equal(await schluesselPasst('kurz', 'kurz'), false);
  assert.equal(await schluesselPasst(s, undefined), false);
});

test('Marken und Fingerabdrücke', async () => {
  const a = zufallsMarke(), b = zufallsMarke();
  assert.match(a, /^[A-Za-z0-9_-]{24}$/);
  assert.notEqual(a, b);
  const f1 = await fingerabdruck('203.0.113.7', 'salz', '2026-11-12');
  const f2 = await fingerabdruck('203.0.113.7', 'salz', '2026-11-13');
  assert.match(f1, /^[0-9a-f]{16}$/);
  assert.notEqual(f1, f2);
  assert.ok(!f1.includes('203'));
});
