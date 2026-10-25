#!/bin/sh
# Lädt GraphHopper und den OSM-Extrakt (Standard: Deutschland) von Geofabrik herunter.
# Anderes Gebiet: PBF_URL setzen, z. B.
#   PBF_URL=https://download.geofabrik.de/europe/germany/berlin-latest.osm.pbf ./setup.sh
set -e
cd "$(dirname "$0")"

GH_VERSION=11.1
JAR=graphhopper-web-$GH_VERSION.jar
PBF_URL=${PBF_URL:-https://download.geofabrik.de/europe/germany-latest.osm.pbf}
PBF=data/$(basename "$PBF_URL")

if [ ! -f "$JAR" ]; then
    curl -fL -o "$JAR" "https://repo1.maven.org/maven2/com/graphhopper/graphhopper-web/$GH_VERSION/$JAR"
fi

mkdir -p data
curl -fL -o "$PBF" "$PBF_URL"

./tag_landuse.py "$PBF" data/deine_region_modifiziert.osm.pbf --landuse military

# alter Graph passt nicht mehr zu den neuen Daten
rm -rf graph-cache
