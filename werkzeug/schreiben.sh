#!/usr/bin/env bash
# Wendet eine Änderung auf den neuesten Stand von main an und schiebt sie hoch.
# Laufen zwei Automaten gleichzeitig (stündliche Nachrichten und ein Speichern im Stellwerk),
# gewinnt keiner durch Überschreiben: Wer beim Hochschieben abgewiesen wird, holt den neuen Stand
# und wendet seine Änderung darauf noch einmal an.
# Aufruf: werkzeug/schreiben.sh "Commit-Text" <Argumente für nachrichten.py>
set -euo pipefail
nachricht="$1"; shift
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
for versuch in 1 2 3 4 5 6; do
  git fetch -q origin main
  git reset -q --hard origin/main
  python3 werkzeug/nachrichten.py "$@"
  git add aktuell.json
  if git diff --cached --quiet; then echo "Nichts zu schreiben."; exit 0; fi
  git commit -q -m "$nachricht"
  if git push -q origin HEAD:main; then echo "Geschrieben (Versuch $versuch)."; exit 0; fi
  sleep $((versuch * 3))
done
echo "Hochschieben fünfmal abgewiesen." >&2
exit 1
