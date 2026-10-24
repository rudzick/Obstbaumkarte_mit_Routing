import osmium
from shapely.geometry import shape
from shapely.strtree import STRtree

class LanduseIntersectionHandler(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.polygons = []
        # Nutzt Osmium, um Flächen (Polygone) korrekt zusammenzubauen
        self.area_factory = osmium.geom.WKBFactory()

    def area(self, a):
        # Hier den gewünschten Filter setzen, z.B. landuse=military
        if 'landuse' in a.tags and a.tags['landuse'] == 'military':
            try:
                # WKB-Geometrie erzeugen und in Shapely-Objekt umwandeln
                wkb = self.area_factory.create_area_geometry(a)
                shapely_poly = shape(wkb)
                self.polygons.append(shapely_poly)
            except Exception:
                pass # Fehlerhafte Geometrien ignorieren

class WayTaggerWriter(osmium.SimpleHandler):
    def __init__(self, spatial_index, writer):
        super().__init__()
        self.spatial_index = spatial_index
        self.writer = writer
        self.wkbfab = osmium.geom.WKBFactory()

    def node(self, n):
        self.writer.add_node(n)

    def way(self, w):
        # Nur für routingrelevante Straßen prüfen
        if 'highway' in w.tags:
            try:
                wkb = self.wkbfab.create_way_geometry(w)
                way_geom = shape(wkb)
                
                # Schnelle Abfrage über den Spatial Index (STRtree)
                intersecting = self.spatial_index.query(way_geom)
                
                # Prüfen, ob eine echte Überschneidung vorliegt
                is_inside = any(way_geom.intersects(poly) for poly in intersecting)
                
                if is_inside:
                    # Tags modifizieren: Neues Custom-Tag hinzufügen
                    modified_tags = dict(w.tags)
                    modified_tags['mein_sperrgebiet'] = 'yes'
                    
                    # Kopie des Ways mit den neuen Tags schreiben
                    w = w.replace(tags=modified_tags)
            except Exception:
                pass
                
        self.writer.add_way(w)

    def relation(self, r):
        self.writer.add_relation(r)

# 1. Schritt: Sammle alle Polygone (benötigt node locations im ersten Durchlauf)
print("Analysiere Landuse-Flächen...")
handler = LanduseIntersectionHandler()
# 'with_locations=True' stellt sicher, dass Flächen Geometrie besitzen
handler.apply_file("deine_region.osm.pbf", locations=True)

# Erstelle einen schnellen räumlichen Suchbaum (R-Tree)
tree = STRtree(handler.polygons)
print(f"{len(handler.polygons)} Flächen indexiert.")

# 2. Schritt: Straßen filtern, taggen und neue Datei schreiben
print("Verschneide Straßen und schreibe neue PBF...")
writer = osmium.SimpleWriter("data/deine_region_modifiziert.osm.pbf")
tagger = WayTaggerWriter(tree, writer)
tagger.apply_file("data/berlin-latest.osm.pbf", locations=True)
writer.close()
print("Fertig!")
