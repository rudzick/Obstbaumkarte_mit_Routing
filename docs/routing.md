# Routing und Blockadeanalyse

Diese Datei beschreibt die Routenplanung der Obstbaumkarte, die Aufbereitung der
Routing-Daten und das Werkzeug „Wegabschnitt prüfen“. Einrichtung und Betrieb des
GraphHopper-Servers stehen in der [README](../README.md).

## Überblick

| Teil | Datei | Aufgabe |
|---|---|---|
| Routing-Panel | `routing.js` | Routenpunkte, Ortssuche, Anzeige der Route |
| Parzellensuche, Hervorhebung, Permalink | `main.js` | „finde Parzelle“, Parzelle als Routenziel |
| Blockadeanalyse | `waycut.js` | Wegabschnitt wählen, abhängige Parzellen finden |
| Excel-Export | `plotlist.js` | Parzellenliste als CSV |
| Datenaufbereitung | `graphhopper/tag_landuse.py` | markiert Sperrgebiete und private Wege |
| Profile | `graphhopper/config.yml`, `graphhopper/custom_models/` | Fuß, Fahrrad, Rollstuhl, Auto |

Das Frontend fragt GraphHopper über `/graphhopper/route` ab. Parzellen und Eingänge kommen
als Vektorkacheln von `sbtiles.obstbaumkarte.de`:

- `table.public.allotment_plots.geom`: Parzellenflächen mit `ref` und `way_id`
- `table.public.allotment_plot_entrances.geom`: Eingänge als Punkte mit `ref` und `node_id`

Ein Eingang kann zu mehreren Parzellen gehören (gemeinsames Tor). Er steht dann mit derselben
`node_id` mehrfach in der Tabelle.

## Routenplanung

Der Button „⤳“ öffnet das Panel.

### Punkte setzen

- Es gibt Start, Über (optional) und Ziel. Jeder Punkt lässt sich einzeln mit „ד entfernen.
- Der nächste Klick in die Karte setzt den Punkt des zuletzt angeklickten Eingabefelds, sonst
  Start und danach Ziel. Marker lassen sich verschieben.
- Eingaben im Textfeld können Koordinaten sein (`52.47, 13.31`) oder Orte und Adressen
  (Ortssuche über Nominatim, zuerst im Kartenausschnitt, dann in ganz Deutschland).

### Ziel als Parzellennummer

Das Menü „☰“ im Zielfeld legt fest, wonach das Feld sucht:

- **Ort oder Adresse** (Standard): nur die Ortssuche.
- **Parzellennummer**: nur die Parzellen. Das Symbol wird magenta.

Die Route endet am Eingang der Parzelle, bei einer Parzelle ohne Eingang in ihrer Mitte.
Parzelle und Eingang werden hervorgehoben; ein größerer Ring umschließt den Zielmarker. Die
Hervorhebung verschwindet, sobald das Ziel entfernt oder geändert wird oder das Panel schließt.

Die Nummer muss vollständig sein: `133` findet nicht `II/133`. Groß- und Kleinschreibung sowie
Sonderzeichen zählen nicht, `II/133`, `II 133` und `ii133` sind gleichwertig. Kommt die Nummer
im Suchbereich mehrfach vor, gilt der Treffer, der der Kartenmitte am nächsten liegt; hervorgehoben
werden alle Parzellen mit dieser Nummer im Bild.

### Suchbereich für Parzellen

„finde Parzelle“ und das Parzellenziel nutzen denselben Bereich um die Kartenmitte:

| Zoomstufe | Suchbereich |
|---|---|
| unter 14 | keine Suche, Parzellen sind nicht sichtbar |
| 14 bis 17 | der sichtbare Kartenausschnitt |
| 18 | 2-mal so breit und hoch wie der Ausschnitt |
| 19 | 4-mal so breit und hoch |
| 20 und höher | 8-mal, 16-mal … |

Oberhalb von Zoom 17 bleibt der Bereich dadurch real gleich groß, nämlich so groß wie der
Ausschnitt bei Zoom 17. Wird nichts gefunden, meldet das Panel das; „finde Parzelle“ lässt die
Karte dann einfach stehen.

### Filter vor der Ortssuche

Nominatim findet zu kurzen Nummern irgendetwas in Deutschland, oft Hunderte Kilometer entfernt.
Deshalb gehen diese Eingaben in allen drei Feldern nicht an die Ortssuche, sondern ergeben eine
Meldung:

- Zahlen, auch mit Buchstabe: `20`, `23b`
- Mit Schrägstrich und bis zu 4 Zeichen davor: `II/133`, `12/3`, `A/12`
- Mit den römischen Zeichen I, V, X davor: `II 133`, `ii133`, `II-133`

Fünfstellige Zahlen (Postleitzahlen), Straßen wie `A 100` oder `B 96` und Adressen bleiben möglich.
Auch sie können weit entfernte Treffer liefern; die Länge der Route zeigt das.

### Anzeige der Route

Abschnitte über Wege mit `hazmat=no` sind gestrichelt, alle anderen durchgezogen. Das sind private
Wege in Kleingärten **und** Wege in Sperrgebieten; der Graph unterscheidet beide nicht.

### Permalink

    #map=<zoom>/<x>/<y>/<drehung>[/<marker>/<parzellen>]&start=<lat,lon>&via=<lat,lon>&ziel=<lat,lon>&profil=<profil>&zielparzelle=<nummer>

Es stehen nur die gesetzten Punkte im Link. Mehrere Parzellen sind mit `+` verbunden
(`.../0/0/ii133+ii125`). `zielparzelle` stellt das Parzellenziel samt Hervorhebung wieder her.

## Aufbereitung der Routing-Daten

`tag_landuse.py` bearbeitet den OSM-Extrakt vor dem Graph-Import:

    ./tag_landuse.py <eingabe.pbf> <ausgabe.pbf> --landuse military --private-landuse allotments

### Sperrgebiete (`--landuse`)

- Wege, die die Grenze überqueren, werden dort geteilt. Alle Teile bekommen `access=yes`, damit
  das Wegenetz im Inneren verbunden bleibt.
- Wege und Wegteile im Inneren bekommen `hazmat=no`.
- Tore in oder auf der Grenze verlieren ihre Zugangs-Tags.
- Die Flächen verlieren `landuse` und ihre Zugangs-Tags.

### Private Wege in Kleingärten (`--private-landuse`)

Gilt nicht für Wege, die zu einem Sperrgebiet gehören.

- Tore in oder auf der Grenze der Fläche bekommen `access=yes`, wenn sie auf einem Weg mit
  `access=private` liegen oder selbst `access=private` haben.
- Wege mit `access=private`, die zum Teil in der Fläche liegen oder über ein so geöffnetes Tor
  führen, verlieren `access=private` und bekommen als Ganzes `hazmat=no`.
- Andere Wege über ein zuvor privates Tor bekommen ebenfalls `hazmat=no`.

Nur der Schlüssel `access=private` wird entfernt; `foot=private`, `bicycle=no` und Ähnliches bleiben.

### Die Strafe

In allen Custom Models steht:

    "turn_penalty": [ { "if": "prev_hazmat != hazmat", "add": "600" } ]

Jeder Wechsel zwischen markierten und unmarkierten Wegen kostet 600 s, unabhängig von der Weglänge.
Dafür brauchen alle Profile `turn_costs`. Die Folgen:

- Ziele auf markierten Wegen bleiben erreichbar, einmal hinein kostet 600 s.
- Innerhalb eines markierten Bereichs fällt keine Strafe an.
- Eine Durchquerung kostet 1200 s, also rund 20 Minuten. Ist der Umweg teurer, führt die Route
  trotzdem hindurch. Das kommt vor allem bei großen Truppenübungsplätzen vor.

### Bekannte Grenzen

Ziele bleiben unerreichbar oder rasten an einem anderen Weg ein bei:

- privaten Wegen, die nur außerhalb der Kleingartenfläche ans Netz anschließen
- anderen Toren als `barrier=gate` mit `access=private`, etwa `lift_gate`
- kleinen isolierten Netzen (`prepare.min_network_size: 200` entfernt sie aus dem Graphen)

## Blockadeanalyse: „Wegabschnitt prüfen“

Das Werkzeug beantwortet die Frage: Welche Parzellen wären nicht mehr erreichbar, wenn dieser
Wegabschnitt gesperrt ist? Es öffnet sich über den Button „✂“; das Routing-Panel schließt dabei und
umgekehrt.

### Bedienung

1. Profil wählen.
2. Anfang des Abschnitts in die Karte klicken, dann weitere Punkte. Jeder Klick verlängert den
   Abschnitt vom letzten Punkt aus entlang des Routing-Graphen. Die orange Linie zeigt, was gewählt
   ist, und sollte vor der Suche geprüft werden.
3. Für eine Abzweigung „Neuer Zweig“ drücken und den Anfang des Zweigs anklicken. Liegt der Klick
   höchstens 15 m neben dem Abschnitt, setzt der Zweig am nächsten Punkt des Abschnitts an, sonst
   beginnt ein getrenntes Stück.
4. Optional: Mit „Gebiet zeichnen“ die Prüfung auf ein Gebiet beschränken (siehe unten).
5. „Parzellen suchen“ drücken. Die Suche lässt sich abbrechen.

„Zurück“ entfernt den letzten Punkt oder bricht einen begonnenen Zweig ab, beim Zeichnen die letzte
Ecke des Gebiets. „Neu“ löscht den Abschnitt; das Gebiet bleibt, bis es gelöscht oder das Panel
geschlossen wird.

Die Treffer stehen als Liste im Panel; ein Klick darauf zentriert die Karte. Parzellen und betroffene
Eingänge werden hervorgehoben, und zwar genau diese Objekte, nicht alle mit derselben Nummer.
„Liste für Excel speichern“ erzeugt `parzellen-wegabschnitt.csv`.

### Gebiet (optional)

Ohne Gebiet prüft das Werkzeug den Umkreis um den Abschnitt, wie unter „Einstellungen“ beschrieben.
Mit Gebiet gilt stattdessen:

- Geprüft werden nur Parzellen, die **vollständig** im Gebiet liegen. Parzellen außerhalb und solche,
  die die Gebietsgrenze schneiden oder berühren, entfallen. Das gilt auch, wenn nur eine Ecke des
  Gebiets in eine Parzelle hineinragt.
- Der Umkreis von 1,5 km und das vorzeitige Ende gelten nicht. Das Gebiet darf weiter entfernt liegen,
  und alle Eingänge seiner Parzellen werden geprüft.
- Das Gebiet darf höchstens 6 km breit und hoch sein und auch konkav sein.
- Der Abschnitt selbst und die Wege gehören nicht zur Auswahl: Ob ein Eingang abgeschnitten ist, hängt
  weiter vom ganzen Wegenetz ab, auch außerhalb des Gebiets.
- Eingänge, die keiner Parzelle zugeordnet werden können, entfallen.

Zum Zeichnen die Ecken anklicken; ein Doppelklick oder ein Klick auf den ersten Punkt schließt das Gebiet
ab. Ein neues Gebiet ersetzt das alte, „Gebiet löschen“ stellt den Umkreis wieder her.

### Was als Treffer zählt

- Eine Parzelle wird aufgeführt, sobald **mindestens ein** Eingang nur über den Abschnitt erreichbar
  ist. Hervorgehoben werden nur solche Eingänge; ein zweiter, frei erreichbarer Eingang bleibt unmarkiert.
- Parzellen ohne Eingang kommen nicht vor.
- Eine Sackgasse, die innerhalb des Abschnitts abzweigt, hängt von ihm ab: Man muss einen Teil des
  Abschnitts benutzen, um sie zu erreichen.
- Es gelten die Regeln des gewählten Profils und das Einrasten des normalen Routings. Das Ergebnis
  kann deshalb vom Augenschein abweichen, wenn ein Eingang an einem anderen Weg einrastet, als der
  Plan vermuten lässt.

### Verfahren

Für jeden Eingang im Umkreis fragt das Frontend eine Route zu einem Bezugspunkt ab, bei der der
Abschnitt extrem teuer gemacht wird:

1. **Prüfpunkte:** Auf dem Abschnitt liegen kleine Quadrate (0,5 m Kantenlänge) höchstens rund 20 m
   auseinander, je Segment auch 1 m vor beiden Enden. Genau auf den Stützpunkten liegen sie nicht,
   denn dort kann ein anderer Weg abzweigen, der sonst mit verteuert würde.
2. **Anfrage:** `POST /route` mit `ch.disable: true` und einem Custom Model, das die Priorität in
   diesen Quadraten mit `0.0000001` multipliziert.
3. **Bezugspunkt:** Von vier Punkten rund 3 km um den Abschnitt gilt der, der die meisten anderen
   erreicht, ohne über den Abschnitt zu führen. Hilfsweise reicht es, dass ein Punkt des Abschnitts ihn
   erreicht. So darf der Ausgang auch in der Mitte des Abschnitts liegen.
4. **Auswertung** des Gewichts in der Antwort:

| Antwort | Bedeutung |
|---|---|
| Gewicht ab 1 000 000 | führt über den Abschnitt, es gibt also keinen anderen Weg |
| kleineres Gewicht | auch ohne den Abschnitt erreichbar |
| „not found“ | auch sonst keine Verbindung, zählt nicht als Treffer |
| anderer Fehler | nicht geprüft, wird im Ergebnis gezählt |

Normale Routen im Umkreis haben ein Gewicht von einigen Tausend, Routen über den Abschnitt von
Hunderten Millionen.

**Warum nicht einfach sperren?** Mit `multiply_by: 0` kann GraphHopper die Kante auch nicht mehr als
Start nutzen. Ein Eingang am gewählten Weg rastet dann an einem anderen Weg ein und wirkt erreichbar,
obwohl er es nicht ist. Der hohe Preis lässt das Einrasten unverändert. Außerdem wirkt der Preis auf
Teile einer Kante: Eingänge am selben Weg vor und hinter dem Abschnitt werden richtig getrennt.

Beispiel für eine Anfrage:

    curl -s https://obstbaumkarte.de/graphhopper/route -H 'Content-Type: application/json' -d '{
      "points": [[13.313088, 52.473962], [13.3574, 52.4740]],
      "profile": "foot", "ch.disable": true, "calc_points": false, "instructions": false,
      "custom_model": {
        "priority": [{"if": "in_abschnitt", "multiply_by": "0.0000001"}],
        "areas": {"type": "FeatureCollection", "features": [{
          "type": "Feature", "id": "abschnitt", "properties": {},
          "geometry": {"type": "Polygon", "coordinates": [[
            [13.313092, 52.474108], [13.313099, 52.474108],
            [13.313099, 52.474113], [13.313092, 52.474113],
            [13.313092, 52.474108]
          ]]}
        }]}
      }
    }'

### Einstellungen

Die Werte stehen am Anfang von `waycut.js`:

| Konstante | Wert | Bedeutung |
|---|---|---|
| `SEARCH_RADIUS` | 1500 m | Umkreis der geprüften Eingänge (ohne Gebiet) |
| `STOP_AFTER_REACHABLE` | 400 | so viele erreichbare Eingänge in Folge beenden die Suche (ohne Gebiet) |
| `MAX_AREA_SIZE` | 6000 m | größte Breite und Höhe eines Gebiets |
| `MAX_SECTION_LENGTH` | 3000 m | Höchstlänge aller Zweige zusammen |
| `BRANCH_SNAP_DISTANCE` | 15 m | so nah am Abschnitt setzt ein Zweig an ihm an |
| `REFERENCE_DISTANCE` | 3000 m | Entfernung der möglichen Bezugspunkte |
| `CHECK_SPACING` | 20 m | Abstand der Prüfpunkte |
| `PARALLEL_REQUESTS` | 6 | gleichzeitige Anfragen |
| `VIA_SECTION_WEIGHT` | 1 000 000 | Schwelle für „führt über den Abschnitt“ |
| `MAX_VISITED_NODES` | 200 000 | Grenze je Anfrage |

Eine Suche sendet etwa eine Anfrage je Eingang plus wenige für den Bezugspunkt, in Berlin rund 120 bis
250 Anfragen in 4 bis 8 Sekunden.

### Grenzen

- **Umkreis (ohne Gebiet):** Eingänge über 1,5 km vom Abschnitt entfernt werden nicht geprüft. Reichen
  Treffer nahe an diese Grenze, weist das Ergebnis darauf hin.
- **Vorzeitiges Ende (ohne Gebiet):** Die Eingänge werden von nah nach fern geprüft. Nach 400 erreichbaren
  in Folge endet die Suche mit einem Hinweis. Ein weit entfernter abgeschnittener Bereich kann dabei fehlen.
- **Enden des Abschnitts:** Ein Eingang, der höchstens etwa 1 m vor einem Segmentende einrastet, kann
  als frei gelten. Ein Eingang genau am Ende oder dahinter ist frei, wenn er in die andere Richtung
  hinausführt.
- **Überführungen:** Kreuzt ein anderer Weg den Abschnitt ohne gemeinsamen Knoten genau an einem
  Prüfpunkt, wird er mit verteuert. Das ist selten, aber nicht ausgeschlossen.
- **Abgelegene Gegenden:** Ist kein Bezugspunkt erreichbar, meldet das Werkzeug, dass die Prüfung dort
  nicht möglich ist.
- **Daten:** Das Ergebnis ist nur so vollständig wie die Eingangstabelle, und der Graph ist bis zu einer
  Woche alt.

### Permalink

Auch die Prüfung steht im Link der Adresszeile:

    #map=<zoom>/<x>/<y>/<drehung>&abschnitt=<lat,lon;lat,lon;…>&abschnitt=<…>&gebiet=<lat,lon;lat,lon;…>&profil=<profil>&suche=1

- Jeder Zweig hat ein eigenes `abschnitt`, mit seinen Punkten in der Reihenfolge der Klicks.
- `gebiet` enthält die Ecken des Gebiets und fehlt, wenn keines gezeichnet ist.
- `suche=1` steht im Link, sobald eine Suche abgeschlossen ist. Der Link startet sie dann beim Öffnen neu
  und zeigt die Trefferliste. Ohne `suche=1` zeigt er nur Abschnitt und Gebiet.

Der Link enthält die Punkte, nicht das Ergebnis. Abschnitt und Treffer werden neu berechnet und können sich
nach einem Update des Graphen oder der Parzellendaten ändern; jedes Öffnen sendet die Anfragen der Suche erneut.
Ein Link gibt eine Route oder eine Prüfung wieder, nicht beides, weil immer nur ein Panel offen ist.

### Excel-Export

Die CSV-Datei hat eine Spalte „Parzelle“ und ist UTF-8 mit BOM kodiert. Werte, die Excel umdeuten würde
(`12/3`, `3-4`, `1.5`, `012`) oder die wie Formeln beginnen (`=`, `+`, `-`, `@`), stehen als `="…"` in der
Datei und bleiben so Text.

### Geprüfter Stand

Geprüft im November 2026 in Berlin mit dem Profil „Zu Fuß“ gegen eine unabhängige
Berechnung aus den OSM-Daten: 13 einzelne Abschnitte, 6 T-Formen, 4 Abschnitte mit mehreren Punkten und
4 Kontrollen mit Wegen drumherum. Drei Abweichungen betrafen Eingänge am Ende eines Abschnitts; dort
bestätigten direkte Anfragen das Werkzeug.

Das Gebiet wurde mit gezeichneten Polygonen gegen eine unabhängige Geometrieberechnung mit shapely geprüft:
Rechteck, L-Form, Kerbe bis in eine Parzelle, zu kleines Gebiet, Gebiet ohne Parzellen und L-Form um eine T-Form.
Alle stimmten überein. Ein großes Gebiet (rund 5,8 km breit und hoch, 358 Eingänge) prüfte auch Eingänge jenseits
des Umkreises.

Nicht geprüft: die anderen drei Profile, ländliche Gegenden, das vorzeitige Ende der Suche, ein Gebiet mit mehr als
400 Eingängen, das Zeichnen mit dem Finger, der Klick auf einen Listeneintrag, das Öffnen der
CSV-Datei in Excel selbst (nur LibreOffice) und ein echtes Handy (nur Emulation).
