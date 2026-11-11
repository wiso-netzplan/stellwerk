/* Die Probe für das Testpaket „Live-Probe“. Sie zeigt, ob eine Live-Verbindung von einem Gerät aus
   zustande kommt: WebSocket auf, Nachrichten hin und zurück, und ob das Gegenüber wirklich im EU-Bereich läuft.
   Die Probe speichert nichts und kennt keinen Raum. */
import {DurableObject} from 'cloudflare:workers';
import {lies} from './regeln.js';

export class Probe extends DurableObject {
  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Nur WebSocket.', {status: 426});
    const [aussen, innen] = Object.values(new WebSocketPair());
    innen.accept();
    let zahl = 0;
    innen.addEventListener('message', (e) => {
      const n = lies(typeof e.data === 'string' ? e.data : null);
      if (!n || n.t !== 'echo' || ++zahl > 20) return;
      try { innen.send(JSON.stringify({t: 'echo', n: Number.isInteger(n.n) ? n.n : null})); } catch { /* zu */ }
    });
    const auskunft = {t: 'probe', bereich: this.ctx.id.jurisdiction || null, ort: await rechenzentrum()};
    try { innen.send(JSON.stringify(auskunft)); } catch { /* zu */ }
    setTimeout(() => { try { innen.close(1000, 'fertig'); } catch { /* zu */ } }, 30000);
    return new Response(null, {status: 101, webSocket: aussen});
  }
}

/** Kürzel des Rechenzentrums, in dem dieses Objekt läuft (z. B. FRA, AMS). Fragt Cloudflares eigene Auskunftsseite. */
async function rechenzentrum() {
  try {
    const r = await fetch('https://www.cloudflare.com/cdn-cgi/trace');
    const m = /^colo=([A-Z]{3})$/m.exec(await r.text());
    return m ? m[1] : null;
  } catch {
    return null;
  }
}
