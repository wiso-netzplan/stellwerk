/* Die Pforte: ein einziges Durable Object im EU-Bereich, das weiß, welche Raumcodes gerade vergeben sind.
   Gespeichert wird nur die Liste „Code → Ablaufzeit“, ohne Klasse, ohne Lehrkraft, ohne Geräte.
   Dazu bremst sie falsches Raten: Je Netzanschluss (gekürzter, täglich wechselnder Fingerabdruck, nur im
   Arbeitsspeicher, nach einer Minute vergessen) sind 30 falsche Codes in der Minute erlaubt. */
import {DurableObject} from 'cloudflare:workers';
import {freierCode, raeumeAuf, fehlversuch, istGesperrt, vergiss, RAUM_MINUTEN} from './regeln.js';

const zufall = () => crypto.getRandomValues(new Uint32Array(1))[0];

export class Pforte extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.fehl = new Map();
    this.raeume = null;
  }

  async lade() {
    if (!this.raeume) this.raeume = new Map(Object.entries((await this.ctx.storage.get('raeume')) || {}));
    if (raeumeAuf(this.raeume, Date.now())) await this.sichere();
  }

  async sichere() {
    await this.ctx.storage.put('raeume', Object.fromEntries(this.raeume));
  }

  /** Vergibt einen freien Code. Ergebnis {code, ablauf} oder null, wenn alles belegt ist. */
  async oeffnen() {
    await this.lade();
    const code = freierCode(new Set(this.raeume.keys()), zufall);
    if (!code) return null;
    const ablauf = Date.now() + RAUM_MINUTEN * 60000;
    this.raeume.set(code, ablauf);
    await this.sichere();
    return {code, ablauf};
  }

  /** 'da', 'unbekannt' oder 'gesperrt'. */
  async pruefen(code, abdruck) {
    const jetzt = Date.now();
    vergiss(this.fehl, jetzt);
    if (istGesperrt(this.fehl, abdruck, jetzt)) return 'gesperrt';
    await this.lade();
    if (this.raeume.has(code)) return 'da';
    return fehlversuch(this.fehl, abdruck, jetzt) ? 'gesperrt' : 'unbekannt';
  }

  async schliessen(code) {
    await this.lade();
    if (this.raeume.delete(code)) await this.sichere();
  }

  /** Für die Probe: Wie viele Räume sind offen? */
  async zahl() {
    await this.lade();
    return this.raeume.size;
  }
}
