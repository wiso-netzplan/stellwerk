# Stellwerk

Eingabeseite und Datenablage für den Wagen im WiSo-Netzplan. Alles hier ist öffentlich: nur Klassen und Themen, nie Namen.

- `stellwerk.html` – Eingabeseite (https://wiso-netzplan.github.io/stellwerk/stellwerk.html)
- `aktuell.json` – die Datei, die das Paket liest (Termine, Prüfungen, Ferien, Ferientage, Wahlen, Nachrichten, Neu im Paket)
- `.github/workflows/stellwerk.yml` – schreibt Aufträge der Eingabeseite (Speichern, Notbremse)
- `.github/workflows/nachrichten.yml` – Nachrichten-Automat, geplant alle 15 Minuten von 6 bis 22 Uhr (GitHub startet die Läufe unzuverlässig, siehe „Wecker“)
- `werkzeug/nachrichten.py` – Logik beider Automaten (nur Python-Standardbibliothek)
- `werkzeug/kalender.json` – Sätze des „Heute“-Kalenders
- `werkzeug/halte.json` – Wörter, über die eine Meldung zu einem Halt im Netzplan führt

## Nachrichten-Automat (seit 10.11.2026)

Übernimmt alle 15 Minuten die obersten sechs Meldungen der tagesschau-Startseite (RSS, Reihenfolge der Redaktion),
nur Titel, Quelle und Link. Sendungen, Videoausschnitte, Bildergalerien, Podcasts und Wetter aus dem Feed
überspringt er; nach Themen filtert er nicht. Ersatz bei Ausfall: Deutschlandfunk-Nachrichten.
Dazu der neueste Beitrag der bpb-Reihe „Hintergrund aktuell“ (höchstens sieben Tage alt, CC BY-NC-ND 4.0).

„Heute“-Kalender (`werkzeug/kalender.json`): an 33 Tagen im Jahr ein Satz zu einem Ereignis („Heute vor 108 Jahren …“,
die Jahre rechnet der Automat aus) und vor Wahlen ein Countdown („Noch 5 Tage: Am 25. April wählt …“, Landtag ab
sieben, Bremen ab 21 Tagen vorher). Er steht vor den tagesschau-Meldungen, Quelle „Kalender · WiSo-Netzplan“.

Wahlen (seit 12.11.2026 eine Liste im Stellwerk, Feld `wahlen` in `aktuell.json`): Datum, Name und Hinweis für den
Kalender im Wagen, Satz und „Tage vorher“ für den Countdown in der Laufschrift, dazu wahlweise ein Halt. Neue Wahlen
trägt man auf der Eingabeseite im Abschnitt „Wahlen“ ein, sobald ihr Tag amtlich ist. Schickt eine ältere,
zwischengespeicherte Eingabeseite keine Wahlen mit, bleiben die bisherigen stehen.

Einzelne Ferientage (seit 12.11.2026, Feld `ferientage`: Datum und Name, zum Beispiel „Tag nach Himmelfahrt“) stehen
bewusst nicht unter `ferien`: Ältere Pakete legen jeden Ferien-Eintrag als Halt auf das Linienband, und einzelne Tage
lagen dort übereinander. Der Kalender im Wagen (ab v49) liest beide Listen. Auch hier gilt: Schickt eine ältere
Eingabeseite das Feld nicht mit, bleiben die bisherigen Ferientage stehen.

„Mehr dazu im Netzplan“ (`werkzeug/halte.json`): Steht ein Wort aus der Liste in der Schlagzeile, hängt der Automat
den passenden Halt an (Feld `halt`, zum Beispiel `AW-08/streik`). Das Paket zeigt ihn im Lesefenster als Sprung in
den Netzplan. Der erste Treffer zählt; ohne Treffer gibt es keinen Verweis. Kalendersätze tragen ihren Halt selbst.

Eigene Nachrichten aus dem Stellwerk stehen in der Laufschrift vorn, zusammen höchstens acht.
Notbremse im Stellwerk: „Entfernen“ (die Meldung kommt nicht wieder, die nächste rückt nach) und „Automatik aus“.
Beides wirkt ohne „Ins Stellwerk schreiben“ und steht im Protokoll (`automatik.protokoll` in `aktuell.json`).

Laufen zwei Automaten gleichzeitig, wendet `werkzeug/schreiben.sh` die Änderung auf den neuesten Stand an und
versucht es erneut, statt zu überschreiben.

## Wecker (seit 12.11.2026)

GitHub startet geplante Läufe (`schedule`) nur nach Kräften: Vom 10.11. abends bis 12.11. 2 Uhr kamen von 27
Terminen zwei (beide verspätet), ab dem 11.11. 12:47 Uhr gar keiner mehr. Die Workflows standen auf „active“, die Läufe fehlten
einfach. Der Plan in `nachrichten.yml` bleibt als Reserve, verlassen kann man sich darauf nicht.

Darum soll ein externer Wecker den Automaten alle 15 Minuten über die GitHub-Schnittstelle aufrufen.
Eike hat am 12.11.2026 entschieden: Das übernimmt später ein Cloudflare-Worker mit Zeitplan (Cron Trigger), sobald
der Vermittler für den Mehrspieler-Modus auf Cloudflare läuft. Bis dahin gibt es keinen Wecker.

Was der Wecker tun muss (gleich, wer ihn stellt):

- Zeitplan: Minuten 7, 22, 37, 52, Stunden 6 bis 22 deutscher Zeit (oder rund um die Uhr; der Automat prüft die Zeit selbst)
- Aufruf: `POST https://api.github.com/repos/wiso-netzplan/stellwerk/actions/workflows/nachrichten.yml/dispatches`
  mit den Kopfzeilen `Accept: application/vnd.github+json`, `Authorization: Bearer <Schlüssel>`,
  `X-GitHub-Api-Version: 2022-11-28`, `Content-Type: application/json`, `User-Agent: wiso-netzplan-wecker`
  und dem Inhalt `{"ref":"main","inputs":{"wecker":"true"}}`. Erfolg heißt Antwort **204**.
- Mit `wecker: true` hält sich der Automat an 6 bis 22 Uhr; ändert sich an der Spitze nichts, schreibt er nichts.
- Schlüssel: ein eigener fine-grained Token „Nachrichten-Wecker“ (GitHub: Einstellungen → Developer settings →
  Personal access tokens → Fine-grained tokens), Resource owner `wiso-netzplan`, Laufzeit ein Jahr, nur
  `stellwerk`, unter „Repository permissions“ nur **Actions: Read and write**. Damit kann man Läufe starten, aber
  keine Dateien ändern. Im Worker als Secret ablegen, nie im Code.

Ersatzweise ginge dasselbe ohne Programmieren über cron-job.org (kostenlos, Betreiber in Deutschland): Cronjob mit
obiger Adresse, Methode POST, denselben Kopfzeilen und demselben Inhalt.

Läuft der Schlüssel ab, antwortet GitHub dem Wecker mit 401. Dann einen neuen Schlüssel wie oben anlegen und im
Wecker ersetzen. Bis der Wecker steht und bei Ausfällen hilft im Stellwerk der Knopf **„Jetzt holen“** (startet den
Automaten sofort, auch nachts, mit dem Schlüssel der Eingabeseite). Das Stellwerk warnt, wenn tagsüber drei Stunden
lang nichts Neues kam.
