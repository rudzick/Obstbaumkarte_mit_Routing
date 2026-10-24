#!/bin/sh
# Lädt GraphHopper und den Berlin-Extrakt von Geofabrik herunter.
set -e
cd "$(dirname "$0")"

GH_VERSION=11.1
JAR=graphhopper-web-$GH_VERSION.jar

if [ ! -f "$JAR" ]; then
    curl -fL -o "$JAR" "https://repo1.maven.org/maven2/com/graphhopper/graphhopper-web/$GH_VERSION/$JAR"
fi

mkdir -p data
curl -fL -o data/berlin-latest.osm.pbf https://download.geofabrik.de/europe/germany/berlin-latest.osm.pbf

# alter Graph passt nicht mehr zu den neuen Daten
rm -rf graph-cache
