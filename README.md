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

Auf dem Server (mymapnik.rudzick.it) liegt GraphHopper unter `/opt/graphhopper`
(Dateien aus `graphhopper/`, Benutzer `graphhopper`) und läuft als systemd-Dienst
`graphhopper` (`graphhopper/graphhopper.service`). Apache gibt im vhost
`obstbaumkarte.de` nur den Route-Endpunkt frei:

    ProxyPass /graphhopper/route http://127.0.0.1:8989/route
    ProxyPassReverse /graphhopper/route http://127.0.0.1:8989/route

Profile auf dem Server aktualisieren:

    rsync -a -e "ssh -p 39125" graphhopper/config.yml graphhopper/custom_models root@mymapnik.rudzick.it:/opt/graphhopper/
    ssh -p 39125 root@mymapnik.rudzick.it 'rm -rf /opt/graphhopper/graph-cache && chown -R graphhopper: /opt/graphhopper && systemctl restart graphhopper'

Wöchentliches Datenupdate (installiert, aber noch nicht aktiviert): `graphhopper-update.timer`
startet sonntags gegen 4:30 `graphhopper-update.service`. Der lädt den Berlin-Extrakt neu,
taggt mit `tag_landuse.py` die Sperrgebiete und baut den Graphen in `graph-cache-new`
(niedrigste CPU-/IO-Priorität, max. 5 GB RAM). Erst danach tauscht `activate-graph.sh`
den Graphen ein und startet GraphHopper neu (nur wenn der Dienst läuft); antwortet er
nicht, kommt der alte Graph zurück.

    systemctl start graphhopper-update.service        # einmalig von Hand
    systemctl enable --now graphhopper-update.timer   # wöchentlich aktivieren

Alternativ lässt sich die URL beim Bauen setzen: `VITE_GRAPHHOPPER_URL=https://… npm run build`.
