# Stellwerk

Eingabeseite und Datenablage für den Wagen im WiSo-Netzplan. Alles hier ist öffentlich: nur Klassen und Themen, nie Namen.

- `stellwerk.html` – Eingabeseite (https://wiso-netzplan.github.io/stellwerk/stellwerk.html)
- `aktuell.json` – die Datei, die das Paket liest (Termine, Prüfungen, Ferien, Nachrichten, Neu im Paket)
- `.github/workflows/stellwerk.yml` – schreibt Aufträge der Eingabeseite (Speichern, Notbremse)
- `.github/workflows/nachrichten.yml` – Nachrichten-Automat, stündlich von 6 bis 22 Uhr
- `werkzeug/nachrichten.py` – Logik beider Automaten (nur Python-Standardbibliothek)

## Nachrichten-Automat (seit 10.11.2026)

Übernimmt jede Stunde die obersten sechs Meldungen der tagesschau-Startseite (RSS, Reihenfolge der Redaktion),
nur Titel, Quelle und Link. Sendungen, Videoausschnitte, Bildergalerien, Podcasts und Wetter aus dem Feed
überspringt er; nach Themen filtert er nicht. Ersatz bei Ausfall: Deutschlandfunk-Nachrichten.
Dazu der neueste Beitrag der bpb-Reihe „Hintergrund aktuell“ (höchstens sieben Tage alt, CC BY-NC-ND 4.0).

Eigene Nachrichten aus dem Stellwerk stehen in der Laufschrift vorn, zusammen höchstens acht.
Notbremse im Stellwerk: „Entfernen“ (die Meldung kommt nicht wieder, die nächste rückt nach) und „Automatik aus“.
Beides wirkt ohne „Ins Stellwerk schreiben“ und steht im Protokoll (`automatik.protokoll` in `aktuell.json`).

Laufen zwei Automaten gleichzeitig, wendet `werkzeug/schreiben.sh` die Änderung auf den neuesten Stand an und
versucht es erneut, statt zu überschreiben.
