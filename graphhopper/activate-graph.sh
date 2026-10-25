#!/bin/sh
# Tauscht den von update.sh gebauten Graphen ein (läuft als root). Ein laufender
# GraphHopper wird neu gestartet; antwortet er danach nicht, kommt der alte Graph zurück.
# Ein gestoppter Dienst bleibt gestoppt.
set -e
cd "$(dirname "$0")"

[ -d graph-cache-new ] || { echo "Kein neuer Graph (graph-cache-new) vorhanden." >&2; exit 1; }

was_active=false
systemctl is-active --quiet graphhopper && was_active=true

$was_active && systemctl stop graphhopper
rm -rf graph-cache-old
[ -d graph-cache ] && mv graph-cache graph-cache-old
mv graph-cache-new graph-cache

$was_active || exit 0

systemctl start graphhopper
for i in $(seq 1 60); do
    curl -fs http://localhost:8989/health >/dev/null && exit 0
    sleep 2
done

echo "GraphHopper antwortet nicht mit dem neuen Graphen, nehme den alten zurück." >&2
systemctl stop graphhopper
rm -rf graph-cache
mv graph-cache-old graph-cache
systemctl start graphhopper
exit 1
