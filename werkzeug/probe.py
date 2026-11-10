# Einmalige Netzprobe (wird nach dem Bau wieder entfernt): welche Feeds antworten, wie sehen sie aus,
# und lässt sich ein tagesschau-Artikel in ein Fenster einbetten?
import re, urllib.request, xml.etree.ElementTree as ET
UA = {'User-Agent': 'wiso-netzplan-stellwerk/1.0 (+https://github.com/wiso-netzplan/stellwerk)'}
def get(u):
    r = urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=20)
    return r.status, dict(r.headers), r.read()
def feed(u, n=10):
    try:
        s, h, b = get(u)
        root = ET.fromstring(b)
        items = root.findall('.//item')
        print(f'OK {s} {u} items={len(items)} type={h.get("Content-Type")}')
        for it in items[:n]:
            t = (it.findtext('title') or '').strip(); l = (it.findtext('link') or '').strip(); d = it.findtext('pubDate')
            print('   ', d, '|', t[:110], '|', l[:140])
    except Exception as e:
        print('FEHLER', u, repr(e)[:200])
for u in ['https://www.tagesschau.de/index~rss2.xml', 'https://www.tagesschau.de/xml/rss2/',
          'https://www.tagesschau.de/infoservices/alle-meldungen-100~rss2.xml',
          'https://www.deutschlandfunk.de/nachrichten-100.rss', 'https://www.deutschlandfunk.de/die-nachrichten.353.de.rss']:
    feed(u)
for page in ['https://www.tagesschau.de/', 'https://www.bpb.de/kurz-knapp/hintergrund-aktuell/', 'https://www.bpb.de/die-bpb/ueber-uns/service/rss/']:
    try:
        s, h, b = get(page); t = b.decode('utf-8', 'replace')
        print('SEITE', s, page)
        for m in re.findall(r'<link[^>]+(?:rss|atom)[^>]*>', t, re.I)[:10]: print('   ALT', m[:200])
        for m in sorted(set(re.findall(r'href="([^"]*(?:rss|feed)[^"]*)"', t, re.I)))[:30]: print('   HREF', m[:160])
    except Exception as e:
        print('FEHLER', page, repr(e)[:200])
# Einbettbarkeit eines Artikels: Kopfzeilen X-Frame-Options / Content-Security-Policy frame-ancestors
try:
    s, h, b = get('https://www.tagesschau.de/index~rss2.xml'); root = ET.fromstring(b)
    art = root.find('.//item/link').text.strip()
    s, h, b = get(art)
    print('ARTIKEL', s, art)
    for k, v in h.items():
        if k.lower() in ('x-frame-options', 'content-security-policy', 'content-security-policy-report-only', 'set-cookie'):
            print('   ', k, ':', v[:400])
    t = b.decode('utf-8', 'replace')
    hosts = sorted(set(re.findall(r'<script[^>]+src="(?:https?:)?//([^/"]+)', t)))
    print('   SKRIPT-HOSTS', hosts)
    print('   INLINE-SKRIPTE', len(re.findall(r'<script(?![^>]*src)', t)), 'Treffer Messung:', sorted(set(re.findall(r'(ati-host|xiti|agf|ioam|infonline|matomo|piano|google|facebook|etracker|chartbeat|webtrekk)', t, re.I))))
except Exception as e:
    print('FEHLER Artikel', repr(e)[:200])
