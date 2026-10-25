#!/usr/bin/python3
"""Markiert Wege in Sperrgebieten für GraphHopper.

Wege (highway=*), die im Inneren einer Fläche mit landuse=<Wert> verlaufen, bekommen
access=yes und ein Markierungs-Tag (Standard: hazmat=no). GraphHopper kann diese
Wege so zwar nutzen, gibt ihnen über das Markierungs-Tag aber eine niedrige
Priorität: Ziele im Sperrgebiet sind erreichbar, Routen führen aber nicht hindurch.
Die landuse-Tags der Sperrgebiete werden entfernt.

Beispiel:
    tag_landuse.py data/berlin-latest.osm.pbf data/deine_region_modifiziert.osm.pbf --landuse military
"""
import argparse
import os
import sys

import osmium
from shapely import wkb
from shapely.prepared import prep
from shapely.strtree import STRtree


class RestrictedAreaCollector(osmium.SimpleHandler):
    """Sammelt die Flächen mit den gewünschten landuse-Werten als Shapely-Polygone."""

    def __init__(self, landuse_values):
        super().__init__()
        self.landuse_values = landuse_values
        self.polygons = []
        self.broken = 0
        self.factory = osmium.geom.WKBFactory()

    def area(self, a):
        if a.tags.get('landuse') not in self.landuse_values:
            return
        try:
            self.polygons.append(wkb.loads(self.factory.create_multipolygon(a), hex=True))
        except RuntimeError:
            # unvollständige oder fehlerhafte Fläche
            self.broken += 1


class RestrictedWayTagger(osmium.SimpleHandler):
    """Schreibt die Datei neu und passt dabei die Tags von Wegen und Relationen an."""

    def __init__(self, polygons, landuse_values, marker, writer):
        super().__init__()
        self.tree = STRtree(polygons)
        self.prepared = [prep(p) for p in polygons]
        self.landuse_values = landuse_values
        self.marker_key, self.marker_value = marker
        self.writer = writer
        self.factory = osmium.geom.WKBFactory()
        self.tagged = 0
        self.landuse_removed = 0
        self.marker_removed = 0

    def is_inside(self, way):
        try:
            line = wkb.loads(self.factory.create_linestring(way), hex=True)
        except RuntimeError:
            # z. B. Weg mit fehlenden Knoten
            return False
        for i in self.tree.query(line):
            area = self.prepared[i]
            # nur Berührung am Rand (etwa die Straße am Zaun entlang) zählt nicht
            if area.intersects(line) and not area.touches(line):
                return True
        return False

    def strip_landuse(self, tags):
        if tags.get('landuse') in self.landuse_values:
            del tags['landuse']
            self.landuse_removed += 1
            return True
        return False

    def node(self, n):
        self.writer.add_node(n)

    def way(self, w):
        tags = dict(w.tags)
        changed = self.strip_landuse(tags)
        # vorhandene Werte des Markierungs-Tags entfernen, sonst wären auch
        # Wege außerhalb der Sperrgebiete markiert
        if self.marker_key in tags:
            del tags[self.marker_key]
            self.marker_removed += 1
            changed = True
        if 'highway' in tags and self.is_inside(w):
            tags['access'] = 'yes'
            tags[self.marker_key] = self.marker_value
            self.tagged += 1
            changed = True
        self.writer.add_way(w.replace(tags=tags) if changed else w)

    def relation(self, r):
        tags = dict(r.tags)
        if self.strip_landuse(tags):
            r = r.replace(tags=tags)
        self.writer.add_relation(r)


def parse_marker(text):
    key, sep, value = text.partition('=')
    if not sep or not key or not value:
        raise argparse.ArgumentTypeError('Format KEY=VALUE erwartet, z. B. hazmat=no')
    return key, value


def main():
    parser = argparse.ArgumentParser(
        description='Markiert Wege in Sperrgebieten (landuse=...) für GraphHopper.')
    parser.add_argument('input', help='Eingabedatei (.osm.pbf)')
    parser.add_argument('output', help='Ausgabedatei (.osm.pbf), wird überschrieben')
    parser.add_argument('-l', '--landuse', nargs='+', required=True, metavar='WERT',
                        help='landuse-Werte, die als Sperrgebiet gelten, z. B. military')
    parser.add_argument('-m', '--marker', type=parse_marker, default=('hazmat', 'no'),
                        metavar='KEY=VALUE',
                        help='Markierungs-Tag für Wege in Sperrgebieten (Standard: hazmat=no)')
    args = parser.parse_args()

    if os.path.abspath(args.input) == os.path.abspath(args.output):
        parser.error('Ein- und Ausgabedatei müssen verschieden sein.')
    landuse_values = set(args.landuse)

    print('Sammle Flächen mit landuse=' + ','.join(sorted(landuse_values)) + ' ...')
    collector = RestrictedAreaCollector(landuse_values)
    collector.apply_file(args.input, locations=True)
    print(f'{len(collector.polygons)} Flächen gefunden, {collector.broken} fehlerhafte übersprungen.')

    print('Markiere Wege und schreibe ' + args.output + ' ...')
    if os.path.exists(args.output):
        os.remove(args.output)
    writer = osmium.SimpleWriter(args.output)
    try:
        tagger = RestrictedWayTagger(collector.polygons, landuse_values, args.marker, writer)
        tagger.apply_file(args.input, locations=True)
    finally:
        writer.close()

    marker = '='.join(args.marker)
    print(f'{tagger.tagged} Wege mit access=yes und {marker} markiert, '
          f'{tagger.landuse_removed} landuse-Tags entfernt, '
          f'{tagger.marker_removed} vorhandene {args.marker[0]}-Tags entfernt.')


if __name__ == '__main__':
    sys.exit(main())
