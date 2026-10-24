#!/bin/sh
# Startet GraphHopper auf http://localhost:8989 (baut beim ersten Start den Graphen).
set -e
cd "$(dirname "$0")"
exec java -Xmx3g -jar graphhopper-web-11.1.jar server config.yml
