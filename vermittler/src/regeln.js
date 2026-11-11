/* Regeln des Vermittlers als reine Funktionen, ohne Cloudflare-Abhängigkeit.
   Alles, was entscheidet, ob eine Nachricht angenommen wird und was jemand zu sehen bekommt, steht hier
   und ist mit `node --test` prüfbar. Die Räume (raum.js) und die Pforte (pforte.js) rufen nur diese Regeln auf.

   Grundsätze (Analyse „Mehrspieler im Politikbuch“, 11.11.2026):
   - Schülergeräte schicken nur Zahlen aus einer festen Liste, nie Text.
   - Der Vermittler gibt nie eine einzelne Antwort weiter, nur Summen, und Summen erst ab fünf Antworten.
   - Ein Raum kennt keine Klasse und keine Namen, nur einen vierstelligen Code. */

export const VERSION = '1';
export const MINDESTENS = 5;          // Summen erst ab so vielen Antworten
export const HOECHSTENS_GERAETE = 60; // je Raum
export const RAUM_MINUTEN = 90;       // danach schließt sich jeder Raum von selbst
export const HALLO_SEKUNDEN = 10;     // so lange darf ein Gerät nach dem Verbinden schweigen
export const NACHRICHT_BYTES = 512;   // längere Nachrichten verwirft der Raum ungelesen
export const FEHLVERSUCHE = 30;       // falsche Codes je Netzanschluss und Minute, danach kurze Sperre

export const CODE_FORM = /^\d{4}$/;
export const MARKE_FORM = /^[A-Za-z0-9_-]{16,64}$/;
// Verweis auf eine Frage, deren Text im Paket steht, z. B. „AW-08/urteil-1“ oder „blitz“.
export const VERWEIS_FORM = /^[A-Za-z0-9][A-Za-z0-9_./-]{0,79}$/;

/* Fragearten. n = Zahl der Antwortmöglichkeiten. */
export const ARTEN = {
  wahl: {min: 2, max: 8},   // Abstimmung, Blitzfrage, Quiz
  skala: {min: 3, max: 7},  // Meinungslinie, Schätzfrage in Stufen
  ampel: {min: 3, max: 3},  // Grün, Gelb, Rot
  fertig: {min: 1, max: 1}  // Fertig-Zähler
};

const istGanz = (x) => Number.isInteger(x);

/** Liest eine Nachricht vorsichtig: zu lang, kein JSON, kein Objekt oder ohne Art → null. */
export function lies(roh) {
  if (typeof roh !== 'string' || roh.length > NACHRICHT_BYTES) return null;
  let n;
  try { n = JSON.parse(roh); } catch { return null; }
  if (!n || typeof n !== 'object' || Array.isArray(n) || typeof n.t !== 'string') return null;
  return n;
}

/** true, wenn die Nachricht nur die erlaubten Felder hat. Unbekannte Felder machen sie ungültig. */
export function nurFelder(n, erlaubt) {
  return Object.keys(n).every((k) => erlaubt.includes(k));
}

/** Erste Nachricht eines Geräts. Ergebnis: {rolle:'lehrer'} | {rolle:'schueler', marke|null} | {fehler}.
    Die Marke eines Schülergeräts vergibt der Raum. Ein Gerät schickt sie nur zurück, wenn es nach einer
    Unterbrechung wieder zusteigt; marke null heißt „neu im Raum“. */
export function pruefeHallo(n, lehrerMarke) {
  if (!n || n.t !== 'hallo') return {fehler: 'hallo-fehlt'};
  if ('lehrer' in n) {
    if (!nurFelder(n, ['t', 'lehrer'])) return {fehler: 'felder'};
    return typeof n.lehrer === 'string' && lehrerMarke && n.lehrer === lehrerMarke ? {rolle: 'lehrer'} : {fehler: 'lehrer-falsch'};
  }
  if (!nurFelder(n, ['t', 'marke'])) return {fehler: 'felder'};
  if (n.marke === undefined || n.marke === null) return {rolle: 'schueler', marke: null};
  if (typeof n.marke === 'string' && MARKE_FORM.test(n.marke)) return {rolle: 'schueler', marke: n.marke};
  return {fehler: 'marke-ungueltig'};
}

/** Antwort eines Schülergeräts gegen die laufende Frage. Ergebnis: {wahl} | {fehler}. */
export function pruefeAntwort(n, frage) {
  if (!nurFelder(n, ['t', 'f', 'w'])) return {fehler: 'felder'};
  if (!frage) return {fehler: 'keine-frage'};
  if (!frage.offen) return {fehler: 'geschlossen'};
  if (!istGanz(n.f) || n.f !== frage.nr) return {fehler: 'alte-frage'};
  if (!istGanz(n.w) || n.w < 0 || n.w >= frage.n) return {fehler: 'wahl-ungueltig'};
  return {wahl: n.w};
}

/** Befehl vom Pult. Ergebnis: {befehl, ...} | {fehler}. */
export function pruefeBefehl(n) {
  switch (n && n.t) {
    case 'frage': {
      const art = ARTEN[n.art];
      if (!art) return {fehler: 'art-ungueltig'};
      const anzahl = art.min === art.max ? art.min : n.n;
      if (!istGanz(anzahl) || anzahl < art.min || anzahl > art.max) return {fehler: 'anzahl-ungueltig'};
      if (typeof n.ref !== 'string' || !VERWEIS_FORM.test(n.ref)) return {fehler: 'verweis-ungueltig'};
      return {befehl: 'frage', art: n.art, n: anzahl, ref: n.ref};
    }
    case 'nachher': case 'schliessen': case 'oeffnen': case 'zeigen': case 'verbergen': case 'ende': case 'ping':
      return {befehl: n.t};
    case 'tueren':
      return typeof n.zu === 'boolean' ? {befehl: 'tueren', zu: n.zu} : {fehler: 'tueren-ungueltig'};
    case 'platz': // höchstens so viele Geräte dürfen zusteigen, z. B. die Klassengröße
      return istGanz(n.n) && n.n >= 1 && n.n <= HOECHSTENS_GERAETE ? {befehl: 'platz', n: n.n} : {fehler: 'platz-ungueltig'};
    default:
      return {fehler: 'befehl-unbekannt'};
  }
}

/** Zählt Antworten (Map marke → wahl) zu Summen je Möglichkeit. */
export function zaehle(antworten, n) {
  const summen = new Array(n).fill(0);
  for (const w of antworten.values()) if (istGanz(w) && w >= 0 && w < n) summen[w]++;
  return summen;
}

/** Was eine Tafel zeigen darf: unter MINDESTENS Antworten nur die Gesamtzahl, keine Verteilung. */
export function tafel(antworten, n) {
  const gesamt = antworten.size;
  return gesamt < MINDESTENS ? {gesamt, summen: null} : {gesamt, summen: zaehle(antworten, n)};
}

/** Wie viele Geräte ihre Antwort zwischen Vorher und Nachher geändert haben.
    Nur wenn in beiden Runden mindestens MINDESTENS Geräte geantwortet haben, sonst null. */
export function wechsel(vorher, nachher) {
  let beide = 0, anders = 0;
  for (const [marke, w] of nachher) {
    if (!vorher.has(marke)) continue;
    beide++;
    if (vorher.get(marke) !== w) anders++;
  }
  return beide < MINDESTENS ? null : {beide, anders};
}

/** Eimer gegen Fluten: höchstens `rate` Nachrichten je Sekunde, kurze Stöße bis `stoss`. */
export function neuerEimer(jetzt, stoss = 3) { return {inhalt: stoss, zeit: jetzt, stoss}; }
export function nimm(eimer, jetzt, rate = 1) {
  eimer.inhalt = Math.min(eimer.stoss, eimer.inhalt + ((jetzt - eimer.zeit) / 1000) * rate);
  eimer.zeit = jetzt;
  if (eimer.inhalt < 1) return false;
  eimer.inhalt -= 1;
  return true;
}

/** Freier vierstelliger Code, der nicht belegt ist. `zufall` liefert ganze Zahlen 0 … 9999. */
export function freierCode(belegt, zufall) {
  if (belegt.size >= 9000) return null;
  for (let i = 0; i < 200; i++) {
    const code = String(zufall() % 10000).padStart(4, '0');
    if (!belegt.has(code)) return code;
  }
  return null;
}

/** Abgelaufene Räume entfernen (Map code → Ablaufzeit in ms). Gibt die Zahl der entfernten zurück. */
export function raeumeAuf(raeume, jetzt) {
  let weg = 0;
  for (const [code, ablauf] of raeume) if (ablauf <= jetzt) { raeume.delete(code); weg++; }
  return weg;
}

/** Fehlversuche je Netzanschluss: Map schluessel → {zahl, seit}. true = gesperrt. */
export function fehlversuch(zaehler, schluessel, jetzt, grenze = FEHLVERSUCHE) {
  let z = zaehler.get(schluessel);
  if (!z || jetzt - z.seit >= 60000) { z = {zahl: 0, seit: jetzt}; zaehler.set(schluessel, z); }
  z.zahl++;
  return z.zahl > grenze;
}
export function istGesperrt(zaehler, schluessel, jetzt, grenze = FEHLVERSUCHE) {
  const z = zaehler.get(schluessel);
  return !!z && jetzt - z.seit < 60000 && z.zahl > grenze;
}
export function vergiss(zaehler, jetzt) {
  for (const [k, z] of zaehler) if (jetzt - z.seit >= 60000) zaehler.delete(k);
}

/** Pult-Schlüssel prüfen. Der Schlüssel muss mindestens 16 Zeichen haben, sonst bleibt das Pult zu. */
export async function schluesselPasst(gegeben, erwartet) {
  if (typeof gegeben !== 'string' || typeof erwartet !== 'string' || erwartet.length < 16) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(gegeben)),
    crypto.subtle.digest('SHA-256', enc.encode(erwartet))
  ]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/** Zufällige Marke (für die Lehrkraft eines Raums). */
export function zufallsMarke(bytes = 18) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Gekürzter, täglich wechselnder Fingerabdruck eines Netzanschlusses. Nur im Arbeitsspeicher der Pforte,
    nur zum Bremsen falscher Codes; die Adresse selbst wird nirgends abgelegt. */
export async function fingerabdruck(ip, salz, tag) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salz}|${tag}|${ip || ''}`));
  return [...new Uint8Array(d).slice(0, 8)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
