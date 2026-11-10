# Einmalige Netzprobe (wird nach dem Bau wieder entfernt). Runde 2.
import re, urllib.request, xml.etree.ElementTree as ET
UA = {'User-Agent': 'wiso-netzplan-stellwerk/1.0 (+https://github.com/wiso-netzplan/stellwerk)'}
def get(u, extra=None):
    r = urllib.request.urlopen(urllib.request.Request(u, headers=dict(UA, **(extra or {}))), timeout=20)
    return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
s, h, b = get('https://www.tagesschau.de/index~rss2.xml')
for i, it in enumerate(ET.fromstring(b).iter('item')):
    print(f'{i:2}', it.findtext('pubDate')[5:22], '|', (it.findtext('title') or '')[:90], '|', (it.findtext('link') or '')[24:110], '| D:', (it.findtext('description') or '')[:60].replace('\n',' '))
for u in ['https://www.bpb.de/rss-feed/230153.rss']:
    s, h, b = get(u); r = ET.fromstring(b)
    print('BPB', u, r.findtext('.//channel/title'))
    for it in list(r.iter('item'))[:8]: print('   ', it.findtext('pubDate'), '|', it.findtext('title'), '|', it.findtext('link'))
for u in ['https://www.tagesschau.de/index~rss2.xml', 'https://www.tagesschau.de/api2u/homepage/']:
    try:
        s, h, b = get(u, {'Origin': 'https://example.org'})
        print('CORS', u, s, h.get('access-control-allow-origin'), h.get('cache-control'))
    except Exception as e: print('CORS FEHLER', u, e)
s, h, b = get('https://www.tagesschau.de/api2u/homepage/')
import json; j = json.loads(b)
print('API Startseite news:', [ (n.get('title') or '')[:70] for n in j.get('news', [])[:12] ])
for u in ['https://www.deutschlandfunk.de/bund-will-e-auto-kaufpraemie-fuer-2027-offenbar-verdoppeln-100.html', 'https://www.bpb.de/kurz-knapp/hintergrund-aktuell/', 'https://www.nachrichtenleicht.de/']:
    try:
        s, h, b = get(u); print('FRAME', u[:70], s, 'XFO=', h.get('x-frame-options'), 'CSP-fa=', re.findall(r'frame-ancestors[^;]*', h.get('content-security-policy', '')))
    except Exception as e: print('FRAME FEHLER', u, e)
