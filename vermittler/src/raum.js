/* Ein Raum = eine Live-Stunde. Läuft als Durable Object im EU-Bereich von Cloudflare.
   Alles liegt nur im Arbeitsspeicher: Wer verbunden ist, welche Frage läuft, welche Nummer ein Gerät
   gewählt hat. Es gibt keine Datenbank und keine Protokolle. Endet der Raum (Pult, 90 Minuten, Neustart
   bei Cloudflare), ist alles weg.

   Ablauf: Die Lehrkraft öffnet den Raum mit dem Pult-Schlüssel (index.js → einrichten). Danach verbinden sich
   Pult und Schülergeräte per WebSocket und schicken als Erstes „hallo“. Schülergeräte schicken danach nur
   noch Antwortnummern, das Pult Befehle. Der Raum zählt und verteilt: an das Pult laufend die Tafel
   (Summen erst ab fünf Antworten), an die Geräte nur die laufende Frage, ihre eigene Wahl und – wenn das Pult
   es zeigt – dieselbe Tafel. */
import {DurableObject} from 'cloudflare:workers';
import {
  lies, pruefeHallo, pruefeAntwort, pruefeBefehl, tafel, wechsel, neuerEimer, nimm, zufallsMarke,
  HOECHSTENS_GERAETE, HALLO_SEKUNDEN
} from './regeln.js';
import {pforte} from './wege.js';

const HOECHSTENS_VERBINDUNGEN = 150; // Geräte dürfen sich neu verbinden; mehr offene Leitungen braucht kein Raum

export class Raum extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.raum = null;
    this.leitungen = new Map(); // WebSocket → {rolle, marke, eimer}
  }

  /** Vom Worker aufgerufen, nachdem die Pforte den Code vergeben hat. */
  async einrichten(code, lehrerMarke, ablauf) {
    if (this.raum) return false;
    this.raum = {
      code, lehrerMarke, ablauf, tuerenZu: false, platz: HOECHSTENS_GERAETE, nr: 0, frage: null, gezeigt: false,
      bekannt: new Map() // Marke → Eimer. Die Bremse gilt je Gerät, auch wenn es mehrere Tabs offen hat.
    };
    this.uhr = setTimeout(() => this.beenden('zeit'), Math.max(0, ablauf - Date.now()));
    return true;
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Nur WebSocket.', {status: 426});
    const [aussen, innen] = Object.values(new WebSocketPair());
    innen.accept();
    if (!this.raum) {
      sende(innen, {t: 'fehler', grund: 'code'});
      innen.close(4404, 'code');
    } else if (this.leitungen.size >= HOECHSTENS_VERBINDUNGEN) {
      sende(innen, {t: 'fehler', grund: 'voll'});
      innen.close(4429, 'voll');
    } else {
      this.verbinde(innen);
    }
    return new Response(null, {status: 101, webSocket: aussen});
  }

  verbinde(ws) {
    const l = {rolle: null, marke: null, eimer: neuerEimer(Date.now())};
    this.leitungen.set(ws, l);
    const stumm = setTimeout(() => { if (!l.rolle) this.trenne(ws, 4408, 'hallo-fehlt'); }, HALLO_SEKUNDEN * 1000);
    ws.addEventListener('message', (e) => {
      if (!this.raum) return;
      const eimer = l.rolle === 'schueler' ? this.raum.bekannt.get(l.marke) : l.eimer;
      if (!eimer || !nimm(eimer, Date.now(), l.rolle === 'lehrer' ? 5 : 1)) return; // Flut: still verwerfen
      const n = lies(typeof e.data === 'string' ? e.data : null);
      if (!n) return;
      if (n.t === 'ping') { sende(ws, {t: 'pong'}); return; }
      if (!l.rolle) { clearTimeout(stumm); this.begruesse(ws, l, n); return; }
      if (l.rolle === 'lehrer') this.befehl(ws, n); else this.antwort(ws, l, n);
    });
    const weg = () => { clearTimeout(stumm); if (this.leitungen.delete(ws)) this.meldePult(); };
    ws.addEventListener('close', weg);
    ws.addEventListener('error', weg);
  }

  begruesse(ws, l, n) {
    const r = this.raum;
    const h = pruefeHallo(n, r.lehrerMarke);
    if (h.fehler) return this.trenne(ws, 4401, h.fehler);
    l.rolle = h.rolle;
    if (h.rolle === 'lehrer') {
      l.eimer = neuerEimer(Date.now(), 10);
      sende(ws, this.pult());
    } else {
      let marke = h.marke;
      if (!marke || !r.bekannt.has(marke)) { // neu im Raum: Der Raum vergibt die Marke, nicht das Gerät
        if (r.tuerenZu) return this.trenne(ws, 4403, 'tueren-zu');
        if (r.bekannt.size >= r.platz) return this.trenne(ws, 4429, 'voll');
        marke = zufallsMarke();
        r.bekannt.set(marke, neuerEimer(Date.now()));
        sende(ws, {t: 'willkommen', marke});
      }
      l.marke = marke;
      sende(ws, this.stand(marke));
    }
    this.meldePult();
  }

  antwort(ws, l, n) {
    if (n.t !== 'antwort') return;
    const f = this.raum.frage;
    const a = pruefeAntwort(n, f);
    if (a.fehler) { sende(ws, {t: 'fehler', grund: a.fehler}); sende(ws, this.stand(l.marke)); return; }
    (f.runde === 2 ? f.nachher : f.vorher).set(l.marke, a.wahl);
    this.anMarke(l.marke);
    this.meldePult();
  }

  befehl(ws, n) {
    const r = this.raum;
    const b = pruefeBefehl(n);
    if (b.fehler) { sende(ws, {t: 'fehler', grund: b.fehler}); return; }
    const f = r.frage;
    switch (b.befehl) {
      case 'ping': return;
      case 'frage':
        r.nr++;
        r.frage = {nr: r.nr, ref: b.ref, art: b.art, n: b.n, runde: 1, offen: true, vorher: new Map(), nachher: null};
        r.gezeigt = false;
        break;
      case 'nachher':
        if (!f || f.runde === 2 || (f.art !== 'wahl' && f.art !== 'skala')) { sende(ws, {t: 'fehler', grund: 'kein-nachher'}); return; }
        f.runde = 2; f.offen = true; f.nachher = new Map(); r.gezeigt = false;
        break;
      case 'schliessen': if (f) f.offen = false; break;
      case 'oeffnen': if (f) { f.offen = true; r.gezeigt = false; } break;
      case 'zeigen': if (f) { f.offen = false; r.gezeigt = true; } break;
      case 'verbergen': r.gezeigt = false; break;
      case 'tueren': r.tuerenZu = b.zu; break;
      case 'platz': r.platz = b.n; break;
      case 'ende': this.beenden('pult'); return;
    }
    this.anAlle();
  }

  /* --- Was wer zu sehen bekommt --- */

  frageFuerAlle() {
    const f = this.raum.frage;
    return f ? {nr: f.nr, ref: f.ref, art: f.art, n: f.n, runde: f.runde, offen: f.offen} : null;
  }

  ergebnis() {
    const f = this.raum.frage;
    if (!f) return null;
    return {
      vorher: tafel(f.vorher, f.n),
      nachher: f.nachher ? tafel(f.nachher, f.n) : null,
      wechsel: f.nachher ? wechsel(f.vorher, f.nachher) : null
    };
  }

  stand(marke) {
    const f = this.raum.frage;
    let meine = null;
    if (f) { const m = f.runde === 2 ? f.nachher : f.vorher; meine = m.has(marke) ? m.get(marke) : null; }
    return {t: 'stand', frage: this.frageFuerAlle(), meine, ergebnis: this.raum.gezeigt ? this.ergebnis() : null};
  }

  pult() {
    const r = this.raum;
    const da = new Set();
    for (const l of this.leitungen.values()) if (l.rolle === 'schueler') da.add(l.marke);
    return {
      t: 'pult', code: r.code, ablauf: r.ablauf, geraete: da.size, bekannt: r.bekannt.size,
      platz: r.platz, tuerenZu: r.tuerenZu, frage: this.frageFuerAlle(), tafel: this.ergebnis(), gezeigt: r.gezeigt
    };
  }

  meldePult() {
    if (!this.raum) return;
    const p = this.pult();
    for (const [ws, l] of this.leitungen) if (l.rolle === 'lehrer') sende(ws, p);
  }

  anMarke(marke) {
    const s = this.stand(marke);
    for (const [ws, l] of this.leitungen) if (l.marke === marke) sende(ws, s);
  }

  anAlle() {
    const p = this.pult();
    for (const [ws, l] of this.leitungen) {
      if (l.rolle === 'lehrer') sende(ws, p);
      else if (l.rolle === 'schueler') sende(ws, this.stand(l.marke));
    }
  }

  trenne(ws, code, grund) {
    sende(ws, {t: 'fehler', grund});
    try { ws.close(code, grund); } catch { /* schon zu */ }
    this.leitungen.delete(ws);
  }

  async beenden(grund) {
    const r = this.raum;
    if (!r) return;
    clearTimeout(this.uhr);
    this.raum = null;
    for (const ws of this.leitungen.keys()) {
      sende(ws, {t: 'ende', grund});
      try { ws.close(4000, 'ende'); } catch { /* schon zu */ }
    }
    this.leitungen.clear();
    try { await pforte(this.env).schliessen(r.code); } catch { /* die Pforte räumt nach 90 Minuten selbst auf */ }
  }
}

function sende(ws, nachricht) {
  try { ws.send(JSON.stringify(nachricht)); } catch { /* Leitung schon zu */ }
}
