/* Ende-zu-Ende-Probe gegen einen laufenden Vermittler (lokal mit `wrangler dev` oder eingespielt).
   Aufruf: node werkzeug/ende-zu-ende.mjs <adresse> [pult-schlüssel] [--lokal] [--bremsen]
   --lokal    für `wrangler dev`: dort gibt es keinen EU-Bereich, die Prüfung darauf entfällt
   --bremsen  zusätzlich Platz, Schweigen und Raten prüfen (dauert gut zehn Sekunden länger)
   Ohne Schlüssel prüft sie nur die Probe. Mit Schlüssel spielt sie eine kleine Stunde durch:
   Pult und sechs Geräte, Abstimmung mit Vorher und Nachher, Türen zu, Ende. Braucht Node 22 (WebSocket eingebaut). */
import assert from 'node:assert/strict';

const basis = (process.argv[2] || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const schluessel = (process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : '') || process.env.PULT_SCHLUESSEL || '';
const wsBasis = basis.replace(/^http/, 'ws');
const warte = (ms) => new Promise((r) => setTimeout(r, ms));

class Leitung {
  constructor(pfad) {
    this.post = [];
    this.wartende = [];
    this.ws = new WebSocket(wsBasis + pfad);
    this.zu = new Promise((r) => this.ws.addEventListener('close', (e) => r(e)));
    this.ws.addEventListener('message', (e) => {
      const n = JSON.parse(e.data);
      const i = this.wartende.findIndex((w) => w.pruef(n));
      if (i >= 0) this.wartende.splice(i, 1)[0].fertig(n); else this.post.push(n);
    });
    this.offen = new Promise((r, f) => { this.ws.addEventListener('open', r); this.ws.addEventListener('error', f); });
  }
  sende(n) { this.ws.send(typeof n === 'string' ? n : JSON.stringify(n)); }
  /** Wartet auf die erste Nachricht, die `pruef` erfüllt (auch schon eingegangene). */
  hole(pruef, ms = 3000) {
    const i = this.post.findIndex(pruef);
    if (i >= 0) return Promise.resolve(this.post.splice(i, 1)[0]);
    return new Promise((fertig, fehl) => {
      const w = {pruef, fertig};
      this.wartende.push(w);
      setTimeout(() => { const k = this.wartende.indexOf(w); if (k >= 0) { this.wartende.splice(k, 1); fehl(new Error('Zeit um: ' + pruef)); } }, ms);
    });
  }
  leere() { this.post = []; }
}

const art = (t) => (n) => n.t === t;

async function probe() {
  const r = await fetch(basis + '/probe');
  assert.equal(r.status, 200);
  const p = await r.json();
  assert.equal(p.ok, true);
  assert.equal(p.pforte, true, 'Pforte nicht erreichbar');
  console.log('Probe:', JSON.stringify(p));
  const l = new Leitung('/probe/ws');
  await l.offen;
  const a = await l.hole(art('probe'), 8000);
  console.log('Probe-WebSocket:', JSON.stringify(a));
  if (!process.argv.includes('--lokal')) assert.equal(a.bereich, 'eu', 'Die Probe läuft nicht im EU-Bereich');
  for (let n = 1; n <= 3; n++) {
    const t0 = Date.now();
    l.sende({t: 'echo', n});
    const e = await l.hole((x) => x.t === 'echo' && x.n === n);
    assert.equal(e.n, n);
    console.log(`  Echo ${n}: ${Date.now() - t0} ms`);
  }
  l.ws.close();
  return a;
}

async function stunde() {
  // Falscher Schlüssel
  let r = await fetch(basis + '/raum', {method: 'POST', headers: {Authorization: 'Pult falsch-falsch-falsch-falsch'}});
  assert.equal(r.status, 401);

  r = await fetch(basis + '/raum', {method: 'POST', headers: {Authorization: 'Pult ' + schluessel}});
  assert.equal(r.status, 200, r.status === 401 ? 'Pult-Schlüssel nicht angenommen (mindestens 16 Zeichen, genau wie hinterlegt?)' : 'Raum öffnen');
  const {code, lehrer} = await r.json();
  assert.match(code, /^\d{4}$/);
  console.log('Raum offen:', code);

  // Falscher Code
  const falsch = new Leitung('/raum/' + (code === '0000' ? '0001' : '0000'));
  assert.equal((await falsch.hole(art('fehler'))).grund, 'code');
  await falsch.zu;

  const pult = new Leitung('/raum/' + code);
  await pult.offen;
  pult.sende({t: 'hallo', lehrer});
  let p = await pult.hole(art('pult'));
  assert.equal(p.code, code);
  assert.equal(p.geraete, 0);

  // Falsche Lehrer-Marke wird abgewiesen
  const falschesPult = new Leitung('/raum/' + code);
  await falschesPult.offen;
  falschesPult.sende({t: 'hallo', lehrer: 'geraten'});
  assert.equal((await falschesPult.hole(art('fehler'))).grund, 'lehrer-falsch');

  const geraete = [];
  for (let i = 0; i < 6; i++) {
    const g = new Leitung('/raum/' + code);
    await g.offen;
    g.sende({t: 'hallo'});
    g.marke = (await g.hole(art('willkommen'))).marke;
    const s = await g.hole(art('stand'));
    assert.equal(s.frage, null);
    geraete.push(g);
  }
  await warte(200);
  pult.leere();

  // Text statt Nummer wird nicht angenommen
  geraete[0].sende({t: 'antwort', f: 1, w: 0, text: 'Hallo Klasse'});
  assert.equal((await geraete[0].hole(art('fehler'))).grund, 'felder');
  await warte(1100);
  geraete[0].sende({t: 'antwort', f: 1, w: 0});
  assert.equal((await geraete[0].hole(art('fehler'))).grund, 'keine-frage');
  geraete[0].sende('freier Text');

  pult.sende({t: 'frage', art: 'wahl', n: 3, ref: 'AW-08/urteil-1'});
  for (const g of geraete) {
    const s = await g.hole((n) => n.t === 'stand' && n.frage);
    assert.deepEqual(s.frage, {nr: 1, ref: 'AW-08/urteil-1', art: 'wahl', n: 3, runde: 1, offen: true});
    assert.equal(s.ergebnis, null);
  }
  geraete[1].sende({t: 'antwort', f: 1, w: 0, richtig: true});
  assert.equal((await geraete[1].hole(art('fehler'))).grund, 'felder');

  const vorher = [0, 0, 1, 2, 2, 2];
  for (let i = 0; i < 4; i++) geraete[i].sende({t: 'antwort', f: 1, w: vorher[i]});
  await warte(300);
  p = (await pult.hole((n) => n.t === 'pult' && n.tafel && n.tafel.vorher.gesamt === 4));
  assert.equal(p.tafel.vorher.summen, null, 'unter fünf keine Summen');
  for (let i = 4; i < 6; i++) geraete[i].sende({t: 'antwort', f: 1, w: vorher[i]});
  p = await pult.hole((n) => n.t === 'pult' && n.tafel && n.tafel.vorher.gesamt === 6);
  assert.deepEqual(p.tafel.vorher.summen, [2, 1, 3]);
  console.log('Vorher:', p.tafel.vorher.summen.join(' / '));

  // Wahl außerhalb der Liste
  await warte(1100);
  geraete[0].sende({t: 'antwort', f: 1, w: 7});
  assert.equal((await geraete[0].hole(art('fehler'))).grund, 'wahl-ungueltig');

  pult.sende({t: 'nachher'});
  for (const g of geraete) await g.hole((n) => n.t === 'stand' && n.frage && n.frage.runde === 2);
  await warte(1100);
  const nachher = [1, 0, 1, 2, 0, 2];
  geraete.forEach((g, i) => g.sende({t: 'antwort', f: 1, w: nachher[i]}));
  p = await pult.hole((n) => n.t === 'pult' && n.tafel?.nachher?.gesamt === 6);
  assert.deepEqual(p.tafel.nachher.summen, [2, 2, 2]);
  assert.deepEqual(p.tafel.wechsel, {beide: 6, anders: 2});

  // Wiederzusteigen mit Marke: die eigene Wahl ist noch da, es entsteht kein neues Gerät
  geraete[3].ws.close();
  await warte(200);
  const zurueck = new Leitung('/raum/' + code);
  await zurueck.offen;
  zurueck.sende({t: 'hallo', marke: geraete[3].marke});
  const s = await zurueck.hole(art('stand'));
  assert.equal(s.meine, 2);
  geraete[3] = zurueck;

  pult.sende({t: 'zeigen'});
  for (const g of geraete) {
    const e = await g.hole((n) => n.t === 'stand' && n.ergebnis);
    assert.deepEqual(e.ergebnis.vorher.summen, [2, 1, 3]);
    assert.deepEqual(e.ergebnis.nachher.summen, [2, 2, 2]);
    assert.equal(e.frage.offen, false);
  }
  p = await pult.hole((n) => n.t === 'pult' && n.gezeigt);
  assert.equal(p.bekannt, 6, 'Wiederzusteigen zählt nicht doppelt');
  console.log('Nachher:', p.tafel.nachher.summen.join(' / '), '· gewechselt:', p.tafel.wechsel.anders);

  // Türen zu: ein neues Gerät kommt nicht mehr hinein
  pult.sende({t: 'tueren', zu: true});
  await pult.hole((n) => n.t === 'pult' && n.tuerenZu);
  const spaet = new Leitung('/raum/' + code);
  await spaet.offen;
  spaet.sende({t: 'hallo'});
  assert.equal((await spaet.hole(art('fehler'))).grund, 'tueren-zu');

  pult.sende({t: 'ende'});
  for (const g of geraete) assert.equal((await g.hole(art('ende'))).grund, 'pult');
  await warte(300);
  const danach = new Leitung('/raum/' + code);
  assert.equal((await danach.hole(art('fehler'))).grund, 'code');
  console.log('Stunde beendet, Raum weg.');
}

async function bremsen() {
  // Platz: Das Pult deckelt auf zwei Geräte, das dritte bleibt draußen.
  const r = await fetch(basis + '/raum', {method: 'POST', headers: {Authorization: 'Pult ' + schluessel}});
  const {code, lehrer} = await r.json();
  const pult = new Leitung('/raum/' + code);
  await pult.offen;
  pult.sende({t: 'hallo', lehrer});
  await pult.hole(art('pult'));
  pult.sende({t: 'platz', n: 2});
  await pult.hole((n) => n.t === 'pult' && n.platz === 2);
  for (let i = 0; i < 2; i++) {
    const g = new Leitung('/raum/' + code);
    await g.offen;
    g.sende({t: 'hallo'});
    await g.hole(art('willkommen'));
  }
  const dritter = new Leitung('/raum/' + code);
  await dritter.offen;
  dritter.sende({t: 'hallo'});
  assert.equal((await dritter.hole(art('fehler'))).grund, 'voll');

  // Eine ausgedachte Marke gilt als neues Gerät und braucht einen freien Platz
  const flut = new Leitung('/raum/' + code);
  await flut.offen;
  flut.sende({t: 'hallo', marke: 'unbekannt-unbekannt'});
  assert.equal((await flut.hole(art('fehler'))).grund, 'voll', 'fremde Marke gilt als neues Gerät');

  // Schweigen: Wer kein hallo schickt, fliegt nach zehn Sekunden
  const stumm = new Leitung('/raum/' + code);
  await stumm.offen;
  assert.equal((await stumm.hole(art('fehler'), 12000)).grund, 'hallo-fehlt');
  pult.sende({t: 'ende'});
  console.log('Platz, fremde Marke und Schweigen: gebremst.');

  // Raten: nach 30 falschen Codes in der Minute ist dieser Anschluss kurz gesperrt
  let gesperrt = false;
  for (let i = 0; i < 32 && !gesperrt; i++) {
    const l = new Leitung('/raum/' + String(9000 + i));
    const f = await l.hole(art('fehler'));
    gesperrt = f.grund === 'gesperrt';
  }
  assert.ok(gesperrt, 'Sperre nach falschen Codes');
  console.log('Raten: nach 30 falschen Codes gesperrt.');
}

try {
  await probe();
  if (schluessel) { await stunde(); if (process.argv.includes('--bremsen')) await bremsen(); }
  else console.log('Ohne Pult-Schlüssel: nur die Probe.');
  console.log('ALLES GRÜN');
  process.exit(0);
} catch (e) {
  console.error('ROT:', e.message);
  process.exit(1);
}
