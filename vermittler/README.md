# Vermittler für Live-Stunden

Ein kleiner Dienst bei Cloudflare (Workers mit Durable Objects, Gratistarif), über den die Geräte einer Klasse
in einer Live-Stunde Antwortnummern an das Pult der Lehrkraft schicken. Grundlage ist die Analyse
„Mehrspieler im Politikbuch“ vom 11.11.2026; entschieden am 12.11.2026: Cloudflare mit EU-Bindung,
gleich bauen, Test im Schulnetz und Ja der Schule parallel. Mit Schülern läuft Live erst nach diesem Ja.

## Was er tut

- **Raum öffnen.** Das Pult schickt den Pult-Schlüssel, die Pforte vergibt einen freien vierstelligen Code,
  der Raum bekommt eine zufällige Lehrer-Marke. Ein Raum schließt sich nach 90 Minuten von selbst.
- **Zusteigen.** Ein Gerät verbindet sich mit dem Code und schickt „hallo“. Die Marke des Geräts vergibt der
  Raum; nur beim Wiederzusteigen schickt das Gerät sie zurück.
- **Fragen.** Das Pult stellt eine Frage als Verweis auf einen Text im Paket (`AW-08/urteil-1`), mit Art und
  Zahl der Möglichkeiten. Der Vermittler reicht keinen Text durch, von niemandem.
- **Zählen.** Geräte schicken nur eine Nummer aus der Liste der laufenden, offenen Frage. Das Pult sieht
  Summen, die Geräte erst, wenn das Pult sie zeigt, und Summen gibt es erst ab fünf Antworten.
  Vorher/Nachher und „wie viele haben gewechselt“ (ebenfalls erst ab fünf).
- **Bremsen.** Eine Nachricht pro Sekunde je Gerät, höchstens 512 Byte, nur bekannte Felder; Türen zu und
  Platzzahl am Pult (höchstens 60); wer zehn Sekunden schweigt, fliegt; 30 falsche Codes je Netzanschluss und
  Minute, danach kurze Sperre.
- **Probe.** `/probe` und `/probe/ws` für das Testpaket `live-probe.html`: erreichbar, WebSocket, Gegenüber im
  EU-Bereich, zehn Nachrichten hin und zurück.

## Datenschutz im Code

- Alle Durable Objects laufen mit `jurisdiction("eu")` (`src/wege.js`). Geht das nicht, schlägt der Aufruf fehl.
- Räume halten alles im Arbeitsspeicher. Gespeichert wird nur die Liste „Code → Ablaufzeit“ in der Pforte.
- Keine Protokolle (`observability` aus), keine Cookies, keine Analyse.
- Die IP-Adresse liest der Code nur für die Bremse gegen Raten, als gekürzten, täglich wechselnden
  Fingerabdruck im Arbeitsspeicher, nach einer Minute vergessen.
- Cloudflare selbst protokolliert die Kennung eines Durable Objects auch außerhalb der EU (Abrechnung,
  Fehlersuche). Sie ist zufällig bzw. aus dem Code abgeleitet und verrät keine Klasse und keine Antworten.

## Nachrichten

Gerät → Raum: `{"t":"hallo"}` oder `{"t":"hallo","marke":"…"}`, `{"t":"antwort","f":1,"w":2}`, `{"t":"ping"}`
Pult → Raum: `{"t":"hallo","lehrer":"…"}`, `{"t":"frage","art":"wahl|skala|ampel|fertig","n":3,"ref":"AW-08/urteil-1"}`,
`nachher`, `schliessen`, `oeffnen`, `zeigen`, `verbergen`, `{"t":"tueren","zu":true}`, `{"t":"platz","n":27}`, `ende`
Raum → Gerät: `willkommen` (Marke), `stand` (Frage, eigene Wahl, Ergebnis wenn gezeigt), `ende`, `fehler`
Raum → Pult: `pult` (Code, Geräte, Platz, Türen, Frage, Tafel)

## Prüfen

```
node --test test/*.test.js                                   # Regeln, ohne Cloudflare
npx --yes wrangler@4.152.0 dev --var "PULT_SCHLUESSEL:…mindestens 16 Zeichen…" --var LOKAL_OHNE_EU:ja
node werkzeug/ende-zu-ende.mjs http://127.0.0.1:8787 "…derselbe Schlüssel…" --lokal --bremsen
```

`LOKAL_OHNE_EU` gibt es nur für den Probelauf auf dem eigenen Rechner, weil workerd dort keine Bereiche kennt.
In `wrangler.toml` darf sie nie stehen; der Automat bricht dann ab.

## Einspielen

Der Automat `.github/workflows/vermittler.yml` prüft bei jeder Änderung unter `vermittler/` und spielt ein,
sobald die Geheimnisse `CLOUDFLARE_API_TOKEN` und `CLOUDFLARE_ACCOUNT_ID` hinterlegt sind (dazu
`PULT_SCHLUESSEL`). Danach prüft er den echten Vermittler mit `werkzeug/ende-zu-ende.mjs` und trägt die Adresse
in `live.json` ein. Das Feld `an` in `live.json` stellt nur die Lehrkraft um.

Notbremsen: `an: false` in `live.json` (das Paket bietet Live nicht mehr an), `LIVE_AN = "nein"` in
`wrangler.toml` (der Vermittler öffnet keine Räume mehr), oder den Worker im Cloudflare-Dashboard abschalten.

## Gratistarif

100.000 Anfragen am Tag; eine Stunde mit 30 Geräten braucht grob 100. Ein Raum hält offene Leitungen ohne
Ruhezustand, das zählt als Laufzeit: Bei 13.000 GB-s am Tag reicht das für etwa 20 (90 Minuten) bis 35 (45 Minuten) Live-Stunden täglich.
Wird eine Grenze überschritten, gibt es bis 1 Uhr nachts (00:00 UTC) Fehler, keine Rechnung.
