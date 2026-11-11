"""Trägt die Adresse des Vermittlers in live.json ein. Das Feld „an“ bleibt, wie es ist.

Aufruf: python3 vermittler/werkzeug/live_json.py <adresse>
live.json liest das Paket nur, wenn jemand „Zusteigen“ oder „Mit der Klasse“ tippt, und das Testpaket
„Live-Probe“. Sie enthält keine Namen, keine Klassen und keine Schlüssel.
"""
import datetime
import json
import re
import sys

PFAD = 'live.json'
FORM = re.compile(r'^https://[a-z0-9.-]+\.workers\.dev$|^https://[a-z0-9.-]+\.[a-z]{2,}$')


def main(adresse):
    if not FORM.fullmatch(adresse or ''):
        raise SystemExit(f'Adresse sieht nicht richtig aus: {adresse!r}')
    try:
        with open(PFAD, encoding='utf-8') as f:
            d = json.load(f)
    except FileNotFoundError:
        d = {}
    neu = {
        'werk': 'wiso-netzplan-live',
        'version': 1,
        'an': bool(d.get('an', False)),
        'adresse': adresse,
        'stand': d.get('stand'),
    }
    if neu['adresse'] != d.get('adresse') or neu['an'] != d.get('an') or d.get('werk') != neu['werk']:
        neu['stand'] = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')
    with open(PFAD, 'w', encoding='utf-8') as f:
        json.dump(neu, f, ensure_ascii=False, indent=2)
        f.write('\n')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else '')
