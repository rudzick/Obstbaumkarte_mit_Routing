# Obstbaumkarte_mit_Routing

## Routing (GraphHopper)

Der Button „⤳“ links in der Karte öffnet ein Panel zur Routenplanung. Start und Ziel
werden per Klick in die Karte gesetzt (Marker lassen sich verschieben) oder als Ort bzw.
„Breite, Länge“ eingegeben (Ortssuche über Nominatim). Profile: Zu Fuß, Fahrrad,
Rollstuhl / Kinderwagen, Auto.

GraphHopper lokal einrichten und starten (Java 17+, ca. 3 GB RAM):

    ./graphhopper/setup.sh    # lädt GraphHopper 11.1 und den Berlin-Extrakt
    ./graphhopper/start.sh    # baut beim ersten Start den Graphen (~2 min), dann http://localhost:8989

Der Vite-Dev-Server (`npm start`) leitet `/graphhopper/*` an `localhost:8989` weiter.

Die Profile stehen in `graphhopper/config.yml`, eigene Anpassungen in
`graphhopper/custom_models/`. Nach Änderungen daran `graphhopper/graph-cache` löschen
und neu starten.

Für den Produktivbetrieb muss GraphHopper auf dem Server laufen und unter `/graphhopper/`
erreichbar sein, z. B. mit nginx:

    location /graphhopper/ {
        proxy_pass http://localhost:8989/;
    }

Alternativ lässt sich die URL beim Bauen setzen: `VITE_GRAPHHOPPER_URL=https://… npm run build`.
