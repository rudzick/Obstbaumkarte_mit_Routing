#!/usr/bin/python3
"""Bereitet Sperrgebiete für GraphHopper vor.

Sperrgebiete sind Flächen mit landuse=<Wert>. Das Skript

- teilt Wege (highway=*) dort, wo sie die Grenze eines Sperrgebiets überqueren. Alle Teile
  bekommen access=yes, damit das Wegenetz im Inneren mit dem außerhalb verbunden
  bleibt; nur die Teile im Inneren bekommen zusätzlich ein Markierungs-Tag
  (Standard: hazmat=no). Wege ganz im Inneren werden ebenso markiert. In den Custom Models kostet jeder Wechsel
  zwischen markierten und unmarkierten Kanten eine feste Abbiegestrafe
  (turn_penalty), unabhängig von der Länge der Wege: Ziele im Sperrgebiet bleiben
  erreichbar, Routen führen aber nicht hindurch;
- entfernt die Zugangs-Tags von Toren (barrier=gate) in oder auf der Grenze der
  Sperrgebiete, damit das Innere mit dem Wegenetz außerhalb verbunden bleibt;
- entfernt das landuse-Tag und die Zugangs-Tags der Sperrgebietsflächen selbst.

Beispiel:
    tag_landuse.py data/berlin-latest.osm.pbf data/deine_region_modifiziert.osm.pbf --landuse military
"""
import argparse
import os
import sys
from collections import Counter

import osmium
from shapely import wkb
from shapely.geometry import Point
from shapely.prepared import prep
from shapely.strtree import STRtree

# Schlüssel der OSM-Zugangshierarchie; Varianten wie access:conditional oder
# foot:forward werden über den Teil vor dem ':' erkannt. emergency und wheelchair
# fehlen absichtlich: an Flächen beschreiben sie Einrichtungen (Notaufnahme,
# Barrierefreiheit), keinen Zugang.
ACCESS_KEYS = {
    'access', 'vehicle', 'motor_vehicle', 'motorcar', 'motorcycle', 'moped', 'mofa',
    'hgv', 'goods', 'bus', 'psv', 'taxi', 'agricultural', 'forestry',
    'bicycle', 'foot', 'horse',
}

# IDs für die beim Teilen entstehenden Wege, weit oberhalb der OSM-Way-IDs
FIRST_NEW_WAY_ID = 10_000_000_000


def is_access_key(key):
    return key.split(':', 1)[0] in ACCESS_KEYS


def strip_access(tags):
    """Entfernt alle Zugangs-Tags und gibt deren Anzahl zurück."""
    keys = [k for k in tags if is_access_key(k)]
    for k in keys:
        del tags[k]
    return len(keys)


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


class RestrictedAreaTagger(osmium.SimpleHandler):
    """Schreibt die Datei neu und passt dabei Tore, Wege und Relationen an."""

    def __init__(self, polygons, landuse_values, marker, writer):
        super().__init__()
        self.tree = STRtree(polygons)
        self.prepared = [prep(p) for p in polygons]
        self.landuse_values = landuse_values
        self.marker_key, self.marker_value = marker
        self.writer = writer
        self.factory = osmium.geom.WKBFactory()
        # Barrieren in der Nähe der Sperrgebiete; an ihnen wird nicht geteilt, weil
        # GraphHopper Barrieren an Kreuzungen ignoriert. Freigegebene Tore fehlen hier:
        # sie sperren nichts mehr und dürfen Teilungspunkt sein.
        self.barriers = set()
        # ursprüngliche Way-ID -> IDs der zusätzlichen Teile (für Routen-Relationen)
        self.pieces = {}
        self.next_way_id = FIRST_NEW_WAY_ID
        self.stats = Counter()

    def candidates(self, geom):
        return [self.prepared[i] for i in self.tree.query(geom)]

    def strip_landuse(self, tags):
        """Entfernt landuse- und Zugangs-Tags einer Sperrgebietsfläche."""
        if tags.get('landuse') not in self.landuse_values:
            return False
        del tags['landuse']
        self.stats['landuse'] += 1
        self.stats['area_access'] += strip_access(tags)
        return True

    def node(self, n):
        barrier = n.tags.get('barrier')
        if barrier is None or not n.location.valid():
            self.writer.add_node(n)
            return
        point = Point(n.location.lon, n.location.lat)
        areas = self.candidates(point)
        if barrier == 'gate' and any(a.covers(point) for a in areas):
            tags = dict(n.tags)
            removed = strip_access(tags)
            if removed:
                self.stats['gates'] += 1
                self.stats['gate_access'] += removed
                n = n.replace(tags=tags)
        elif areas:
            self.barriers.add(n.id)
        self.writer.add_node(n)

    def inside_segments(self, way):
        """Gibt für jedes Segment des Wegs an, ob es im Inneren eines Sperrgebiets liegt,
        oder None, wenn der Weg kein Sperrgebiet berührt."""
        try:
            line = wkb.loads(self.factory.create_linestring(way), hex=True)
        except RuntimeError:
            # z. B. Weg mit fehlenden Knoten
            return None
        areas = [a for a in self.candidates(line) if a.intersects(line)]
        if not areas:
            return None
        nodes = way.nodes
        result = []
        for i in range(len(nodes) - 1):
            a, b = nodes[i].location, nodes[i + 1].location
            mid = Point((a.lon + b.lon) / 2, (a.lat + b.lat) / 2)
            # Segmente auf der Grenze (etwa die Straße am Zaun entlang) zählen als außen
            result.append(any(area.contains(mid) for area in areas))
        return result

    def split_points(self, way, inside):
        """Knotenindizes, an denen der Weg geteilt wird: dort, wo er die Grenze
        überquert, aber nicht an Barrieren."""
        last = len(inside)
        splits = []
        for i in range(1, last):
            if inside[i - 1] == inside[i]:
                continue
            if way.nodes[i].ref in self.barriers:
                # auf einen Nachbarknoten ausweichen, der weder Barriere noch
                # Endknoten noch schon Teilungspunkt ist
                for j in (i + 1, i - 1):
                    if (0 < j < last and way.nodes[j].ref not in self.barriers
                            and j not in splits and (not splits or j > splits[-1])):
                        i = j
                        break
                else:
                    self.stats['barrier_splits'] += 1
            if not splits or i > splits[-1]:
                splits.append(i)
        return splits

    def mark_inside(self, tags):
        tags['access'] = 'yes'
        tags[self.marker_key] = self.marker_value

    def way(self, w):
        tags = dict(w.tags)
        changed = self.strip_landuse(tags)
        # vorhandene Werte des Markierungs-Tags entfernen, sonst wären auch
        # Wege außerhalb der Sperrgebiete markiert
        if self.marker_key in tags:
            del tags[self.marker_key]
            self.stats['marker'] += 1
            changed = True

        inside = self.inside_segments(w) if 'highway' in tags else None
        if not inside or not any(inside):
            self.writer.add_way(w.replace(tags=tags) if changed else w)
            return
        if all(inside):
            self.mark_inside(tags)
            self.stats['inside'] += 1
            self.writer.add_way(w.replace(tags=tags))
            return

        # Weg überquert die Grenze: ganz freigeben, dann in Teile innen/außen zerlegen
        tags['access'] = 'yes'
        refs = [n.ref for n in w.nodes]
        bounds = [0] + self.split_points(w, inside) + [len(refs) - 1]
        new_ids = []
        for k in range(len(bounds) - 1):
            start, end = bounds[k], bounds[k + 1]
            piece_tags = dict(tags)
            # nach dem Ausweichen an Barrieren kann ein Teil ein fremdes Segment enthalten
            if sum(inside[start:end]) * 2 > end - start:
                self.mark_inside(piece_tags)
            way_id = w.id
            if k > 0:
                way_id = self.next_way_id
                self.next_way_id += 1
                new_ids.append(way_id)
            self.writer.add_way(w.replace(id=way_id, nodes=refs[start:end + 1], tags=piece_tags))
        self.pieces[w.id] = new_ids
        self.stats['split'] += 1
        self.stats['pieces'] += len(new_ids) + 1

    def relation(self, r):
        tags = dict(r.tags)
        changed = self.strip_landuse(tags)
        members = None
        # Routen (Rad-/Wandernetz) sollen auch die neuen Teile enthalten;
        # Abbiegeverbote bleiben unverändert
        if tags.get('type') == 'route' and any(
                m.type == 'w' and m.ref in self.pieces for m in r.members):
            members = []
            for m in r.members:
                members.append((m.type, m.ref, m.role))
                if m.type == 'w':
                    members.extend(('w', ref, m.role) for ref in self.pieces.get(m.ref, ()))
            changed = True
        if changed:
            r = r.replace(tags=tags) if members is None else r.replace(tags=tags, members=members)
        self.writer.add_relation(r)


def parse_marker(text):
    key, sep, value = text.partition('=')
    if not sep or not key or not value:
        raise argparse.ArgumentTypeError('Format KEY=VALUE erwartet, z. B. hazmat=no')
    return key, value


def main():
    parser = argparse.ArgumentParser(
        description='Bereitet Sperrgebiete (landuse=...) für GraphHopper vor.')
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

    print('Bearbeite Tore und Wege und schreibe ' + args.output + ' ...')
    if os.path.exists(args.output):
        os.remove(args.output)
    writer = osmium.SimpleWriter(args.output)
    try:
        tagger = RestrictedAreaTagger(collector.polygons, landuse_values, args.marker, writer)
        tagger.apply_file(args.input, locations=True)
    finally:
        writer.close()

    s = tagger.stats
    marker = '='.join(args.marker)
    print(f'{s["inside"]} Wege ganz im Inneren und {s["split"]} Grenzwege (geteilt in '
          f'{s["pieces"]} Teile, alle mit access=yes) mit {marker} markiert, '
          f'{s["barrier_splits"]} Teilungen an Barrieren nicht vermeidbar.')
    print(f'{s["gates"]} Tore mit {s["gate_access"]} Zugangs-Tags freigegeben.')
    print(f'{s["landuse"]} landuse-Tags und {s["area_access"]} Zugangs-Tags der Sperrgebiete '
          f'entfernt, {s["marker"]} vorhandene {args.marker[0]}-Tags entfernt.')


if __name__ == '__main__':
    sys.exit(main())
