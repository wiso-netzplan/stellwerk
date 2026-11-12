#!/usr/bin/env python3
"""Nachrichten-Automat für das Stellwerk des WiSo-Netzplans.

Aufrufe (nur Standardbibliothek, schreibt nur aktuell.json):
  nachrichten.py holen [--immer]      Feeds abrufen und die automatischen Meldungen erneuern
                                       (ohne --immer nur, wenn seit dem letzten Abruf ein Termin aus ABRUFE vergangen ist)
  nachrichten.py stellwerk DATEI      Auftrag der Eingabeseite übernehmen (Hand-Einträge, Termine …);
                                       die automatischen Meldungen und die Automatik-Einstellungen bleiben erhalten
  nachrichten.py aktion DATEI         Notbremse aus dem Stellwerk: {"aktion": "aus"|"an"|"entfernen"|"zulassen", "link": …}
  nachrichten.py pruefen              aktuell.json prüfen

Grundsätze (Eike, 10.11.2026): mehrmals täglich, ohne Freigabe, ohne KI, kein Filter nach Themen.
Die Auswahl trifft die Redaktion: übernommen wird die Spitze des Startseiten-Feeds der tagesschau
in ihrer Reihenfolge, nur Titel, Quelle und Link, nie Anreißer oder Bilder.
Dazu kommt der eigene „Heute“-Kalender (werkzeug/kalender.json): höchstens ein Satz zum Tag und der
Countdown zur nächsten Wahl, beide mit der Quelle „Kalender · WiSo-Netzplan“.
Die Wahlen stehen seit dem 12.11.2026 als eine Liste im Stellwerk (Feld `wahlen` in aktuell.json). Dieselbe Liste
liest der Kalender im Wagen; Eike trägt jede Wahl nur einmal ein.
"""
import datetime as dt
import html
import json
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from zoneinfo import ZoneInfo

DATEI = 'aktuell.json'
BERLIN = ZoneInfo('Europe/Berlin')
UA = {'User-Agent': 'wiso-netzplan-stellwerk/1.0 (+https://github.com/wiso-netzplan/stellwerk)'}

# Feste Quellenliste. Links werden nur auf diese Hosts und nur mit https übernommen.
TAGESSCHAU = ['https://www.tagesschau.de/index~rss2.xml', 'https://www.tagesschau.de/xml/rss2/']
DLF = ['https://www.deutschlandfunk.de/nachrichten-100.rss']
BPB = ['https://www.bpb.de/rss-feed/230153.rss']  # „Hintergrund aktuell“, CC BY-NC-ND 4.0
HOSTS = {'www.tagesschau.de': 'tagesschau.de', 'www.deutschlandfunk.de': 'deutschlandfunk.de', 'www.bpb.de': 'bpb.de'}

# Der Startseiten-Feed enthält neben den Meldungen auch Sendungen, Videoausschnitte, Bildergalerien, Podcasts
# und das Wetter. Diese Formate (kein Thema!) überspringt der Automat, die Meldungen selbst filtert er nicht.
FORMATE = ('/tagesschau_20_uhr/', '/tagesthemen/', '/tagesschau_in_100_sekunden/', '/tagesschau/',
           '/tagesschau_in_einfacher_sprache/', '/tagesschau_mit_gebaerdensprache/', '/multimedia/', '/wetter/',
           '/video-', '/audio-', '/podcast')

SPITZE = 6          # oberste Meldungen der Startseite
RESERVE = 6         # rücken nach, wenn Eike eine Meldung entfernt
HOECHSTENS = 8      # mehr fasst die Laufschrift im Wagen nicht (das Paket schneidet nach acht ab)
# Abrufzeiten deutscher Zeit (Eike, 12.11.2026). Jeder Aufruf danach holt einen verpassten Termin nach;
# weitere Aufrufe bis zum nächsten Termin tun nichts. So schadet es nicht, wenn der Wecker öfter klingelt oder ausfällt.
ABRUFE = (6, 9, 12, 15, 18)
BPB_TAGE = 7        # ein bpb-Beitrag bleibt höchstens so lange stehen
PROTOKOLL = 60
GESPERRT = 300
KALENDER = 'werkzeug/kalender.json'
HALTE = 'werkzeug/halte.json'
HALT_FORM = re.compile(r'[A-Z]{2}-\d\d/[a-z0-9-]+')
DATUM_FORM = re.compile(r'\d{4}-\d\d-\d\d')
WAHLEN = 40         # mehr Wahlen fasst die Liste nicht
FERIENTAGE = 20     # einzelne schulfreie Tage (Brückentage), nur für den Kalender im Wagen
KALENDER_QUELLE = 'Kalender · WiSo-Netzplan'
MONATE = ('Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober',
          'November', 'Dezember')


def jetzt():
    return dt.datetime.now(BERLIN)


def lies():
    with open(DATEI, encoding='utf-8') as f:
        return json.load(f)


def schreib(d):
    pruef(d)
    with open(DATEI, 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write('\n')


def text(s, n=160):
    s = re.sub(r'<[^>]*>', ' ', html.unescape(s or ''))
    s = re.sub(r'\s+', ' ', s).strip()
    if len(s) > n:
        s = s[:n - 1].rsplit(' ', 1)[0].rstrip(' ,;:-') + '…'
    return s


def link(u):
    """Nur https auf die feste Quellenliste; Anhänge zur Zählung (?at_medium=…) fallen weg.
    Kalendereinträge tragen statt eines Links eine Kennung (kalender:2027-01-19, wahl:2027-05-30),
    damit die Notbremse auch sie entfernen kann."""
    if re.fullmatch(r'(kalender|wahl):\d{4}-\d\d-\d\d', (u or '').strip()):
        return u.strip()
    try:
        p = urllib.parse.urlsplit((u or '').strip())
    except ValueError:
        return None
    if p.scheme != 'https' or p.hostname not in HOSTS or p.username or p.port:
        return None
    return urllib.parse.urlunsplit(('https', p.hostname, p.path or '/', '', ''))


def hole(url):
    r = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=25)
    b = r.read(3_000_000)
    if b'<!DOCTYPE' in b[:2000] or b'<!ENTITY' in b[:20000]:
        raise ValueError('Feed mit DOCTYPE/ENTITY abgelehnt')
    return ET.fromstring(b)


def eintraege(urls, quelle):
    """Erster Feed der Liste, der antwortet; Einträge in Feed-Reihenfolge."""
    fehler = []
    for u in urls:
        try:
            root = hole(u)
        except Exception as e:  # noqa: BLE001 – jeder Abruffehler führt zum nächsten Feed
            fehler.append(f'{u}: {type(e).__name__}')
            continue
        aus, gesehen = [], set()
        for it in root.iter('item'):
            t, l = text(it.findtext('title')), link(it.findtext('link'))
            if not t or not l or l in gesehen or any(f in urllib.parse.urlsplit(l).path for f in FORMATE):
                continue
            gesehen.add(l)
            try:
                z = parsedate_to_datetime(it.findtext('pubDate')).astimezone(BERLIN)
            except Exception:  # noqa: BLE001
                z = None
            aus.append({'text': t, 'quelle': quelle, 'link': l, 'auto': True,
                        'datum': (z or jetzt()).strftime('%Y-%m-%d'), 'zeit': z.strftime('%H:%M') if z else None,
                        '_z': z})
        if aus:
            return aus, fehler
        fehler.append(f'{u}: keine Einträge')
    return [], fehler


_REGELN = None


def halt_fuer(titel):
    """„Mehr dazu im Netzplan“: erster Halt aus werkzeug/halte.json, dessen Wort in der Schlagzeile steht."""
    global _REGELN
    if _REGELN is None:
        with open(HALTE, encoding='utf-8') as f:
            _REGELN = [(h, re.compile(r'(?<![\w-])(?:' + '|'.join(ws) + r')(?![\w])', re.I))
                       for h, ws in json.load(f)['regeln'] if HALT_FORM.fullmatch(h)]
    return next((h for h, rx in _REGELN if rx.search(titel or '')), None)


def wahlen_ordnen(liste):
    """Wahlen aus dem Stellwerk in feste Form bringen: Datum, Name (Kalender im Wagen), Satz (Countdown in der
    Laufschrift), Vorlauf in Tagen, Halt und Hinweis nur, wenn gesetzt. Unvollständige Zeilen fallen weg."""
    aus = []
    for w in liste if isinstance(liste, list) else []:
        if not isinstance(w, dict) or not DATUM_FORM.fullmatch(str(w.get('datum') or '')):
            continue
        try:
            dt.date.fromisoformat(w['datum'])
            vorlauf = int(w.get('vorlauf', 7))
        except (ValueError, TypeError):
            continue
        name, wer = text(w.get('name'), 60), text(w.get('wer'), 140)
        if not name or not wer:
            continue
        e = {'datum': w['datum'], 'name': name, 'wer': wer.rstrip('.'), 'vorlauf': max(0, min(vorlauf, 60))}
        if isinstance(w.get('halt'), str) and HALT_FORM.fullmatch(w['halt']):
            e['halt'] = w['halt']
        if text(w.get('hinweis'), 80):
            e['hinweis'] = text(w.get('hinweis'), 80)
        aus.append(e)
    return sorted(aus, key=lambda w: w['datum'])[:WAHLEN]


def ferientage_ordnen(liste):
    """Einzelne Ferientage (z. B. Tag nach Himmelfahrt): nur Datum und Name. Sie stehen bewusst nicht in den Ferien,
    weil ältere Pakete jeden Ferien-Eintrag als Halt auf das Linienband legen. Gelesen werden sie nur vom Kalender."""
    aus = []
    for t in liste if isinstance(liste, list) else []:
        if not isinstance(t, dict) or not DATUM_FORM.fullmatch(str(t.get('datum') or '')):
            continue
        try:
            dt.date.fromisoformat(t['datum'])
        except ValueError:
            continue
        name = text(t.get('name'), 30)
        if name:
            aus.append({'datum': t['datum'], 'name': name})
    return sorted(aus, key=lambda t: t['datum'])[:FERIENTAGE]


def kalender(heute=None, wahlen=()):
    """Die Kalendereinträge für heute: der Satz zum Tag und der Countdown zur nächsten Wahl (Wahlen aus dem Stellwerk)."""
    heute = heute or jetzt().date()
    with open(KALENDER, encoding='utf-8') as f:
        k = json.load(f)
    aus = []
    for t in k.get('tage', []):
        if t['tag'] == heute.strftime('%m-%d'):
            s = t['text'].replace('{n}', str(heute.year - t['jahr'])) if t.get('jahr') else t['text']
            aus.append({'text': text(s), 'link': f'kalender:{heute.isoformat()}', 'halt': t.get('halt')})
            break
    for w in wahlen_ordnen(list(wahlen)):
        tag = dt.date.fromisoformat(w['datum'])
        n = (tag - heute).days
        if 0 <= n <= w.get('vorlauf', 7):
            vorn = ('Heute' if n == 0 else 'Morgen' if n == 1 else
                    f'Noch {n} Tage: Am {tag.day}. {MONATE[tag.month - 1]}')
            aus.append({'text': text(f"{vorn} {w['wer']}."), 'link': f"wahl:{w['datum']}", 'halt': w.get('halt')})
            break
    for m in aus:
        if not (m['halt'] and HALT_FORM.fullmatch(m['halt'])):
            m.pop('halt')
        m.update({'quelle': KALENDER_QUELLE, 'auto': True, 'datum': heute.isoformat(), 'zeit': None, 'art': 'kalender'})
    return aus


def automatik(d):
    a = d.get('automatik')
    if not isinstance(a, dict):
        a = {}
    a.setdefault('an', True)
    a.setdefault('meldungen', [])
    a.setdefault('gesperrt', [])
    a.setdefault('protokoll', [])
    a.setdefault('stand', None)
    d['automatik'] = a
    return a


def notiz(a, s):
    a['protokoll'] = ([{'zeit': jetzt().strftime('%Y-%m-%d %H:%M'), 'text': text(s, 300)}] + a['protokoll'])[:PROTOKOLL]


def zusammensetzen(d):
    """Laufschrift = Eikes Hand-Einträge zuerst, dann die automatischen (ohne entfernte), höchstens acht."""
    a = automatik(d)
    hand = [n for n in d.get('nachrichten', []) if isinstance(n, dict) and not n.get('auto')]
    auto = []
    if a['an']:
        frei = [m for m in a['meldungen'] if m['link'] not in a['gesperrt']]
        # Entfernt Eike eine Meldung, rückt die nächste der Startseite nach (der Automat hält einige in Reserve).
        auto = ([m for m in frei if m.get('art') == 'kalender'] + [m for m in frei if m.get('art') == 'spitze'][:SPITZE]
                + [m for m in frei if m.get('art') == 'bpb'])
    d['nachrichten'] = [{k: v for k, v in m.items() if k != 'art'} for m in hand + auto][:HOECHSTENS]


def letzter_termin(t):
    """Der letzte Abruftermin vor oder genau zu t (Berliner Zeit); vor 6 Uhr ist es 18 Uhr am Vortag."""
    frueher = [h for h in ABRUFE if h <= t.hour]
    if frueher:
        return t.replace(hour=frueher[-1], minute=0, second=0, microsecond=0)
    gestern = t - dt.timedelta(days=1)
    return gestern.replace(hour=ABRUFE[-1], minute=0, second=0, microsecond=0)


def faellig(a, t):
    try:
        geholt = dt.datetime.fromisoformat(a.get('geholt') or '')
    except (TypeError, ValueError):
        return True
    return geholt < letzter_termin(t)


def holen(immer=False):
    d = lies()
    a = automatik(d)
    t = jetzt()
    if not immer and not faellig(a, t):
        print(f'Kein Termin fällig (letzter {letzter_termin(t):%d.%m. %H:%M}, abgerufen {a.get("geholt")}).')
        return
    if not a['an']:
        print('Automatik ist aus.')
        return
    vorher = [m['link'] for m in a['meldungen']]
    ts, f1 = eintraege(TAGESSCHAU, 'tagesschau.de')
    neu = ts[:SPITZE + RESERVE]
    if not neu:
        dl, f2 = eintraege(DLF, 'deutschlandfunk.de')
        neu = dl[:SPITZE + RESERVE]
        if neu and not any('Ersatz' in p['text'] for p in a['protokoll'][:1]):
            notiz(a, 'tagesschau nicht erreichbar, Ersatz Deutschlandfunk (' + '; '.join(f1) + ')')
        if not neu:
            if not any('nicht erreichbar' in p['text'] for p in a['protokoll'][:1]):
                notiz(a, 'Keine Quelle erreichbar, alte Meldungen bleiben stehen (' + '; '.join(f1 + f2) + ')')
                zusammensetzen(d)
                schreib(d)
            print('Keine Quelle erreichbar.', f1, f2)
            return
    bp, f3 = eintraege(BPB, 'bpb.de')
    grenze = jetzt() - dt.timedelta(days=BPB_TAGE)
    bp = sorted((m for m in bp if m['_z'] and m['_z'] >= grenze), key=lambda m: m['_z'], reverse=True)[:1]
    if f3:
        print('bpb:', f3)
    for m in neu:
        m['art'] = 'spitze'
    for m in bp:
        m['art'] = 'bpb'
    try:
        kal = kalender(wahlen=d.get('wahlen') or [])
    except Exception as e:  # noqa: BLE001 – ein Fehler im Kalender darf die Nachrichten nicht aufhalten
        kal = []
        print('Kalender:', type(e).__name__, e)
    meldungen = kal + neu + bp
    for m in meldungen:
        m.pop('_z', None)
    for m in neu + bp:
        try:
            h = halt_fuer(m['text'])
        except Exception as e:  # noqa: BLE001 – ohne Haltkatalog gibt es eben keinen Verweis
            h = None
            print('Haltkatalog:', type(e).__name__, e)
        if h:
            m['halt'] = h
    sichtbar = {m['link'] for m in neu[:SPITZE]} | {m['link'] for m in bp + kal}
    hinzu = [m for m in meldungen if m['link'] not in vorher and m['link'] in sichtbar]
    a['geholt'] = t.isoformat(timespec='seconds')  # auch ohne Änderung: der Termin ist erledigt
    if [(m['link'], m['text'], m.get('halt')) for m in meldungen] == [(m['link'], m['text'], m.get('halt')) for m in a['meldungen']]:
        schreib(d)
        print('Unverändert, Abruf vermerkt.')
        return
    a['meldungen'] = meldungen
    a['stand'] = jetzt().isoformat(timespec='seconds')
    if hinzu:
        notiz(a, f'{len(hinzu)} neu: ' + ' · '.join(m['text'] for m in hinzu))
    zusammensetzen(d)
    schreib(d)
    print('Geschrieben:', *[m['text'] for m in meldungen], sep='\n  ')


def stellwerk(pfad):
    with open(pfad, encoding='utf-8') as f:
        neu = json.load(f)
    if not isinstance(neu, dict) or neu.get('werk') != 'wiso-netzplan-stellwerk':
        raise SystemExit('Auftrag hat das falsche Format.')
    alt = lies()
    neu = {k: neu[k] for k in ('werk', 'version', 'stand', 'termine', 'nachrichten', 'ferien', 'pruefungen', 'neu', 'wahlen', 'ferientage') if k in neu}
    # Eine ältere, noch zwischengespeicherte Eingabeseite kennt die Wahlen nicht. Dann bleiben die bisherigen stehen.
    neu['wahlen'] = wahlen_ordnen(neu['wahlen'] if 'wahlen' in neu else alt.get('wahlen', []))
    neu['ferientage'] = ferientage_ordnen(neu['ferientage'] if 'ferientage' in neu else alt.get('ferientage', []))
    neu['automatik'] = automatik(alt)  # Einstellungen ändert nur die Notbremse, nie ein Speichern
    # Eine ältere, noch zwischengespeicherte Eingabeseite kennt das Feld auto nicht und schickt die automatischen
    # Meldungen als eigene zurück. Was wörtlich einer automatischen Meldung gleicht, gilt deshalb nicht als eigene.
    autotexte = {m['text'] for m in neu['automatik']['meldungen']}
    hand = [n for n in neu.get('nachrichten', []) if isinstance(n, dict) and not n.get('auto') and text(n.get('text')) not in autotexte]
    neu['nachrichten'] = [{'text': text(n.get('text')), 'quelle': text(n.get('quelle'), 40),
                           'datum': n.get('datum') or None} for n in hand if text(n.get('text'))][:HOECHSTENS]
    zusammensetzen(neu)
    schreib(neu)


def aktion(pfad):
    with open(pfad, encoding='utf-8') as f:
        p = json.load(f)
    d = lies()
    a = automatik(d)
    was = p.get('aktion')
    if was in ('aus', 'an'):
        a['an'] = was == 'an'
        notiz(a, 'Automatik ' + ('eingeschaltet' if a['an'] else 'ausgeschaltet'))
    elif was in ('entfernen', 'zulassen'):
        l = link(p.get('link'))
        if not l:
            raise SystemExit('Link fehlt oder gehört nicht zur Quellenliste.')
        titel = next((m['text'] for m in a['meldungen'] if m['link'] == l), l)
        if was == 'entfernen' and l not in a['gesperrt']:
            a['gesperrt'] = ([l] + a['gesperrt'])[:GESPERRT]
            notiz(a, 'Entfernt: ' + titel)
        elif was == 'zulassen' and l in a['gesperrt']:
            a['gesperrt'].remove(l)
            notiz(a, 'Wieder zugelassen: ' + titel)
    else:
        raise SystemExit('Unbekannte Aktion.')
    zusammensetzen(d)
    schreib(d)


def pruef(d):
    """Strenge Prüfung vor jedem Schreiben: feste Felder, Längen, Links nur auf die Quellenliste."""
    assert d.get('werk') == 'wiso-netzplan-stellwerk'
    for k in ('termine', 'nachrichten', 'ferien', 'pruefungen'):
        assert isinstance(d.get(k), list), k
    assert isinstance(d.get('wahlen', []), list) and len(d.get('wahlen', [])) <= WAHLEN
    for w in d.get('wahlen', []):
        assert wahlen_ordnen([w]) == [w], w
    assert isinstance(d.get('ferientage', []), list) and len(d.get('ferientage', [])) <= FERIENTAGE
    for t in d.get('ferientage', []):
        assert ferientage_ordnen([t]) == [t], t
    assert len(d['nachrichten']) <= HOECHSTENS
    for n in d['nachrichten']:
        assert isinstance(n.get('text'), str) and 0 < len(n['text']) <= 160
        assert isinstance(n.get('quelle', ''), str) and len(n.get('quelle') or '') <= 40
        if n.get('auto'):
            assert link(n.get('link')) == n['link']
        assert n.get('halt') is None or HALT_FORM.fullmatch(n['halt'])
    a = d.get('automatik', {})
    for m in a.get('meldungen', []):
        assert link(m.get('link')) == m['link'] and 0 < len(m['text']) <= 160
    assert all(link(l) == l for l in a.get('gesperrt', []))


if __name__ == '__main__':
    arg = sys.argv[1:]
    if not arg:
        raise SystemExit(__doc__)
    if arg[0] == 'holen':
        holen('--immer' in arg)
    elif arg[0] == 'stellwerk':
        stellwerk(arg[1])
    elif arg[0] == 'aktion':
        aktion(arg[1])
    elif arg[0] == 'pruefen':
        pruef(lies())
        print('aktuell.json in Ordnung.')
    else:
        raise SystemExit(__doc__)
