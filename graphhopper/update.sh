#!/bin/sh
# Datenupdate: neuen Berlin-Extrakt laden, Sperrgebiete taggen und den Graphen
# in graph-cache-new bauen. Der laufende Dienst bleibt dabei unberührt;
# activate-graph.sh tauscht den neuen Graphen anschließend ein.
set -e
cd "$(dirname "$0")"

curl -fsSL -o data/berlin-latest.osm.pbf.new https://download.geofabrik.de/europe/germany/berlin-latest.osm.pbf
mv data/berlin-latest.osm.pbf.new data/berlin-latest.osm.pbf

./tag_landuse.py data/berlin-latest.osm.pbf data/deine_region_modifiziert.osm.pbf --landuse military

rm -rf graph-cache-new
java -Xmx3g -Ddw.graphhopper.graph.location=graph-cache-new -jar graphhopper-web-11.1.jar import config.yml
