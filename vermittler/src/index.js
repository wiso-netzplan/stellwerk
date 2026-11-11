/* Vermittler für Live-Stunden im WiSo-Netzplan.

   Wege:
     GET  /              kurze Auskunft
     GET  /probe         Probe für das Testpaket (erreichbar? EU-Bereich? Pforte?)
     GET  /probe/ws      WebSocket-Probe: Nachrichten hin und zurück, Rechenzentrum, EU-Bereich
     POST /raum          Raum öffnen; nur mit Pult-Schlüssel (Kopfzeile „Authorization: Pult <Schlüssel>“)
     GET  /raum/<code>   WebSocket in einen Raum (Pult und Schülergeräte)

   Datenschutz: Der Vermittler legt nichts über Personen ab, schreibt keine Protokolle (observability aus)
   und setzt keine Cookies. Die IP-Adresse eines Geräts sieht Cloudflare technisch bei jeder Verbindung;
   dieser Code liest sie nur, um falsches Raten von Codes zu bremsen, und auch dann nur als gekürzten,
   täglich wechselnden Fingerabdruck im Arbeitsspeicher der Pforte. */
import {pforte, raum, probe} from './wege.js';
import {CODE_FORM, VERSION, schluesselPasst, zufallsMarke, fingerabdruck} from './regeln.js';

export {Raum} from './raum.js';
export {Pforte} from './pforte.js';
export {Probe} from './probe.js';

const KOPF = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff'
};

const json = (daten, status = 200) =>
  new Response(JSON.stringify(daten), {status, headers: {...KOPF, 'Content-Type': 'application/json; charset=utf-8'}});

const liveAn = (env) => env.LIVE_AN !== 'nein';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const weg = url.pathname.replace(/\/+$/, '') || '/';
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: KOPF});

    if (weg === '/' && request.method === 'GET') {
      return new Response(
        'Vermittler für Live-Stunden im WiSo-Netzplan. Quelltext: https://github.com/wiso-netzplan/stellwerk/tree/main/vermittler\n',
        {headers: {...KOPF, 'Content-Type': 'text/plain; charset=utf-8'}});
    }

    if (weg === '/probe' && request.method === 'GET') return probeAuskunft(request, env);
    if (weg === '/probe/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return json({fehler: 'nur-websocket'}, 426);
      try { return await probe(env).fetch(request); } catch { return json({fehler: 'eu-bereich'}, 503); }
    }

    if (weg === '/raum' && request.method === 'POST') return raumOeffnen(request, env);

    const m = /^\/raum\/(\d{4})$/.exec(weg);
    if (m) return zusteigen(request, env, m[1]);

    return json({fehler: 'unbekannt'}, 404);
  }
};

async function probeAuskunft(request, env) {
  const antwort = {
    ok: true, dienst: 'wiso-netzplan-vermittler', version: VERSION,
    ort: request.cf?.colo || null, live: liveAn(env),
    pult: typeof env.PULT_SCHLUESSEL === 'string' && env.PULT_SCHLUESSEL.length >= 16
  };
  try {
    antwort.raeume = await pforte(env).zahl();
    antwort.pforte = true;
  } catch (e) {
    antwort.pforte = false;
    antwort.grund = String(e && e.message || e).slice(0, 200); // z. B. wenn der EU-Bereich im Tarif fehlt
  }
  return json(antwort);
}

async function raumOeffnen(request, env) {
  if (!liveAn(env)) return json({fehler: 'aus'}, 503);
  const kopf = request.headers.get('Authorization') || '';
  const gegeben = kopf.startsWith('Pult ') ? kopf.slice(5).trim() : '';
  if (!(await schluesselPasst(gegeben, env.PULT_SCHLUESSEL))) return json({fehler: 'schluessel'}, 401);
  const p = pforte(env);
  const vergabe = await p.oeffnen();
  if (!vergabe) return json({fehler: 'voll'}, 503);
  const lehrer = zufallsMarke();
  const ok = await raum(env, vergabe.code).einrichten(vergabe.code, lehrer, vergabe.ablauf);
  if (!ok) { await p.schliessen(vergabe.code); return json({fehler: 'noch-belegt'}, 409); }
  return json({code: vergabe.code, lehrer, ablauf: vergabe.ablauf});
}

async function zusteigen(request, env, code) {
  if (request.headers.get('Upgrade') !== 'websocket') return json({fehler: 'nur-websocket'}, 426);
  if (!CODE_FORM.test(code)) return absage('code');
  if (!liveAn(env)) return absage('aus');
  const tag = new Date().toISOString().slice(0, 10);
  const abdruck = await fingerabdruck(request.headers.get('CF-Connecting-IP'), env.SALZ || 'wiso-netzplan', tag);
  const stand = await pforte(env).pruefen(code, abdruck);
  if (stand !== 'da') return absage(stand === 'gesperrt' ? 'gesperrt' : 'code');
  return raum(env, code).fetch(request);
}

/** Antwortet auf einen WebSocket-Wunsch mit einer klaren Absage, die der Browser auch lesen kann. */
function absage(grund) {
  const [aussen, innen] = Object.values(new WebSocketPair());
  innen.accept();
  innen.send(JSON.stringify({t: 'fehler', grund}));
  innen.close(4404, grund);
  return new Response(null, {status: 101, webSocket: aussen});
}
