/* Wege zu den Durable Objects. Alle liegen im EU-Bereich (jurisdiction "eu"): Sie laufen und speichern
   nur in Rechenzentren der EU. Geht das nicht, schlägt der Aufruf fehl, statt still woanders zu laufen.

   Einzige Ausnahme ist der Probelauf auf dem eigenen Rechner (`wrangler dev`), denn dort kennt workerd keine
   Bereiche. Dafür setzt man beim Start `--var LOKAL_OHNE_EU:ja`. In wrangler.toml steht diese Variable nie,
   der Automat bricht ab, wenn sie dort auftaucht. */

const eu = (ns, env) => (env.LOKAL_OHNE_EU === 'ja' ? ns : ns.jurisdiction('eu'));

export function pforte(env) {
  const ns = eu(env.PFORTE, env);
  return ns.get(ns.idFromName('pforte'));
}

export function raum(env, code) {
  const ns = eu(env.RAUM, env);
  return ns.get(ns.idFromName('raum-' + code));
}

export function probe(env) {
  const ns = eu(env.PROBE, env);
  return ns.get(ns.newUniqueId());
}
