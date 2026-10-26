#!/bin/sh
# Datenupdate: neuen OSM-Extrakt laden, Sperrgebiete taggen und den Graphen
# in graph-cache-new bauen. Der laufende Dienst bleibt dabei unberührt;
# activate-graph.sh tauscht den neuen Graphen anschließend ein.
# Anderes Gebiet: PBF_URL setzen, z. B.
#   PBF_URL=https://download.geofabrik.de/europe/germany/berlin-latest.osm.pbf ./update.sh
set -e
cd "$(dirname "$0")"

PBF_URL=${PBF_URL:-https://download.geofabrik.de/europe/germany-latest.osm.pbf}
PBF=data/$(basename "$PBF_URL")

curl -fsSL -o "$PBF.new" "$PBF_URL"
mv "$PBF.new" "$PBF"

./tag_landuse.py "$PBF" data/deine_region_modifiziert.osm.pbf --landuse military

rm -rf graph-cache-new
java -Xmx18g -Ddw.graphhopper.graph.location=graph-cache-new -jar graphhopper-web-11.1.jar import config.yml
