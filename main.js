import 'ol/ol.css';
import MVT from 'ol/format/MVT.js';
import Map from 'ol/Map';
import Feature from 'ol/Feature';
import View from 'ol/View';
import Point from 'ol/geom/Point';
import OSM from 'ol/source/OSM.js';
import TileLayer from 'ol/layer/Tile';
import {Vector as VectorLayer} from 'ol/layer';
import {transform, transformExtent, get as getProjection, fromLonLat} from 'ol/proj';
import {boundingExtent, buffer, containsCoordinate, containsExtent, createEmpty, extend, getCenter, scaleFromCenter} from 'ol/extent';
import XYZ from 'ol/source/XYZ';
import VectorSource from 'ol/source/Vector';
import {Icon, Style, Circle, Fill, Stroke} from 'ol/style';
import VectorTileLayer from 'ol/layer/VectorTile.js';
import VectorTileSource from 'ol/source/VectorTile.js';
import TileJSON from 'ol/source/TileJSON.js';
import {defaults as defaultControls, Attribution, ScaleLine, FullScreen, Control, Rotate} from 'ol/control';
import {circular} from 'ol/geom/Polygon';
import kompas from 'kompas';
import {addRouting} from './routing.js';

const allotment_number_field = document.createElement('input');
allotment_number_field.className = 'ol-control button';
allotment_number_field.type = "input";
allotment_number_field.id = "allotment_number_field";

class FindAllotmentPlots extends Control {
  /**
   * @param {Object} [opt_options] Control options.
   */
  constructor(opt_options) {
      const options = opt_options || {};
      
      const allotment_number_button = document.createElement('button');
      allotment_number_button.className = 'ol-control button';
      allotment_number_button.type = "button";
      allotment_number_button.id = "allotment_number_button";
      allotment_number_button.innerHTML = "finde Parzelle";

      const element = document.createElement('div');
      element.appendChild(allotment_number_field);
      element.appendChild(allotment_number_button);

      super({
	  element: element,
	  target: options.target,
      });

      allotment_number_button.addEventListener('click', this.handleFindAllotmentPlots.bind(this), false);
      allotment_number_field.addEventListener('keydown', (event) => {
	  if (event.key === 'Enter') this.handleFindAllotmentPlots();
      });
  }

  handleFindAllotmentPlots() {
      plot_nrs = normalizePlots(document.getElementById("allotment_number_field").value);
      refreshPlotHighlight(this.getMap());
      updatePermalink();
      centerOnSearchedPlots(this.getMap());
  };
}

var plot_nrs = [' '];
var route_plot_nrs = [];  // Parzelle als Routenziel

function refreshPlotHighlight(map) {
    map.getLayers().getArray()
	.filter(layer => ['parzellengrenzen', 'parzelleneingaenge'].includes(layer.get('name')))
	.forEach(layer => layer.setStyle(styleFunction));
}

// "III/23b + III/22" -> ['iii23b', 'iii22'], so normalisiert wie die refs in styleFunction
function normalizePlots(text) {
    return text.split('+')
	.map(nr => nr.replace(/[^0-9a-zA-ZäöüÄÖÜß]+/g, "").toLowerCase())
	.filter(nr => nr !== '');
}

function formatLatLon(lonLat) {
    return lonLat[1].toFixed(5) + ',' + lonLat[0].toFixed(5);
}

// "52.47412,13.31233" -> [13.31233, 52.47412]
function parseLatLon(text) {
    const m = (text || '').match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    return m ? [parseFloat(m[2]), parseFloat(m[1])] : null;
}

var mapMinZoom = 1;
var mapMaxZoom = 24;
var mapExtent = getProjection('EPSG:3857').getExtent();

var attribution = new Attribution({
    collapsible: false
});

var massstab = new ScaleLine({
      units: 'metric'
});

// default zoom, center and rotation
var zoom = 17;
var center = transform([13.31233, 52.47416], 'EPSG:4326', 'EPSG:3857')
var rotation = 0;
var marker = 0;
// Routenpunkte aus dem Permalink (&start=…&via=…&ziel=…&profil=…)
var routeParams = new URLSearchParams();

if (window.location.hash !== '') {
    // try to restore center, zoom-level and rotation from the URL
    var hash = window.location.hash.replace('#map=', '');
    var amp = hash.indexOf('&');
    if (amp >= 0) {
	routeParams = new URLSearchParams(hash.slice(amp + 1));
	hash = hash.slice(0, amp);
    }
    // weitergeleitete Links enthalten oft %2B (+) oder %2F (/)
    try {
	hash = decodeURIComponent(hash);
    } catch (e) {}
    var parts = hash.split('/');
    if (parts.length >= 4) {
	zoom = parseInt(parts[0], 10);
	center = [
	    parseFloat(parts[1]),
	    parseFloat(parts[2])
	];
	rotation = parseFloat(parts[3]);
    }
    if (parts.length >= 5) {  // wenn 1 dann Marker im Zentrum der Karte
	marker = parseInt(parts[4]);
    }
    if (parts.length >= 6) {  // Link mit Parzellennummern; diese dürfen selbst '/' enthalten (III/23b)
	plot_nrs = normalizePlots(parts.slice(5).join('/'));
	allotment_number_field.value = plot_nrs.join("+");
    }
}

var iconFeature = new Feature({
  geometry: new Point(center)
});

var iconStyle = new Style({
  image: new Icon({
    color: '#4271AE',
    crossOrigin: 'anonymous',
    src: 'data/dot.png'
  })
});

const baum = new Style({
  image: new Circle({
      radius: 12,
      fill: new Fill({
          color: 'rgba(0,255,0,0.01)',
       }),
       stroke: new Stroke({
         color: 'rgba(0,255,0,0.02)',
         width: 1,
       }),
     }),
     zIndex: Infinity,
});

const strauch = new Style({
  image: new Circle({
      radius: 10,
      fill: new Fill({
          color: 'rgba(0,255,0,0.01)',
       }),
       stroke: new Stroke({
         color: 'rgba(0,255,0,0.02)',
         width: 1,
       }),
     }),
     zIndex: Infinity,
});

const hecke = new Style({
    stroke: new Stroke({
        color: 'rgba(0,255,0,0.02)',
	width: 8,
    }),
    zIndex: Infinity,
});

// iconFeature.setStyle(iconStyle);

const plothighlightStroke = new Stroke({
    color: 'rgba(197,27,138,0.7)',
    width: 2.1,
    padding: 3.0
});

// stroke zeichnet die Parzellengrenzen (Flächen), image die Parzelleneingänge (Punkte)
var plothighlightStyle = new Style({
    stroke: plothighlightStroke,
    image: new Circle({
	radius: 5,
	stroke: plothighlightStroke,
    }),
});

// beim Routenziel liegt der Zielmarker auf dem Eingang, der Ring muss ihn umschließen
var routePlotHighlightStyle = new Style({
    stroke: plothighlightStroke,
    image: new Circle({
	radius: 13,
	stroke: plothighlightStroke,
    }),
});

function plotRef(feature) {
    return (feature.get('ref') || '').replace(/[^0-9a-zA-ZZäöüÄÖÜß]+/g,"").toLowerCase();
}

function isPlotAmong(feature, nrs) {
    const ref = plotRef(feature);
    return ['table.public.allotment_plots.geom', 'table.public.allotment_plot_entrances.geom'].includes(feature.get('layer'))
	&& nrs.includes(ref)
	&& ref.length > 0;
}

var styleFunction = function(feature, resolution) {
    if (isPlotAmong(feature, route_plot_nrs)) {
	return(routePlotHighlightStyle);
    }
    if (isPlotAmong(feature, plot_nrs)) {
	return(plothighlightStyle);
    }
};

const plotMinZoom = 14;  // unterhalb sind die Parzellen nicht zu sehen
const plotWiderSearchMinZoom = 17;  // erst oberhalb wird über den Kartenausschnitt hinaus gesucht
const plotTileFormat = new MVT();
var plotSearchNumber = 0;

// Lädt die Parzellen mit den Nummern nrs aus einer Kartenebene im Suchbereich. Kacheln außerhalb
// des Kartenausschnitts sind noch nicht geladen, deshalb werden sie hier selbst angefragt.
function loadPlots(map, layerName, searchExtent, nrs) {
    const view = map.getView();
    const source = map.getLayers().getArray()
	.find(layer => layer.get('name') === layerName).getSource();
    const tileGrid = source.getTileGrid();
    // wenige Kacheln anfragen: zwei Stufen gröber als die Karte, nicht gröber als 12
    const tileZoom = Math.min(Math.max(Math.floor(view.getZoom()) - 2, 12), 16);
    const tileRange = tileGrid.getTileRangeForExtentAndZ(searchExtent, tileZoom);

    const requests = [];
    for (let x = tileRange.minX; x <= tileRange.maxX; x++) {
	for (let y = tileRange.minY; y <= tileRange.maxY; y++) {
	    const tileCoord = [tileZoom, x, y];
	    const url = source.getTileUrlFunction()(tileCoord, 1, view.getProjection());
	    requests.push(fetch(url)
		.then(response => response.ok ? response.arrayBuffer() : new ArrayBuffer(0))
		.then(data => data.byteLength === 0 ? [] : plotTileFormat.readFeatures(data, {
		    extent: tileGrid.getTileCoordExtent(tileCoord),
		    featureProjection: view.getProjection(),
		})));
	}
    }
    return Promise.all(requests).then(tiles => tiles.flat().filter(feature => isPlotAmong(feature, nrs)));
}

// Punkte der Parzellen mit den Nummern nrs: die Eingänge, bei Parzellen ohne Eingang die
// Parzellenmitte. Gesucht wird im Kartenausschnitt, oberhalb von Zoom 17 in einem
// größeren Bereich: 2-mal so breit und hoch bei Zoom 18, 4-mal bei Zoom 19, 8-mal bei Zoom 20 ...
async function findPlotPoints(map, nrs) {
    const view = map.getView();
    const zoom = view.getZoom();
    if (zoom < plotMinZoom || nrs.length === 0) {
	return [];
    }
    const searchExtent = view.calculateExtent(map.getSize());
    if (zoom > plotWiderSearchMinZoom) {
	scaleFromCenter(searchExtent, Math.pow(2, zoom - plotWiderSearchMinZoom));
    }

    const [entrances, plotParts] = await Promise.all([
	loadPlots(map, 'parzelleneingaenge', searchExtent, nrs),
	loadPlots(map, 'parzellengrenzen', searchExtent, nrs),
    ]);

    const points = entrances
	.filter(entrance => containsExtent(searchExtent, entrance.getExtent()))
	.map(entrance => getCenter(entrance.getExtent()));

    // eine Parzelle kann über mehrere Kacheln verteilt sein
    const plots = {};
    plotParts.forEach(part => {
	const id = part.get('way_id');
	if (!plots[id]) {
	    plots[id] = {ref: plotRef(part), extent: createEmpty()};
	}
	extend(plots[id].extent, part.getExtent());
    });
    Object.values(plots).forEach(plot => {
	const center = getCenter(plot.extent);
	// Eingänge liegen auf der Parzellengrenze; 5 m Spielraum wegen der Kachelauflösung
	const tolerance = buffer(plot.extent, 5);
	const hasEntrance = entrances.some(entrance =>
	    plotRef(entrance) === plot.ref && containsExtent(tolerance, entrance.getExtent()));
	if (!hasEntrance && containsCoordinate(searchExtent, center)) {
	    points.push(center);
	}
    });
    return points;
}

// Zentriert die Karte auf die gesuchten Parzellen
async function centerOnSearchedPlots(map) {
    const search = ++plotSearchNumber;
    let points;
    try {
	points = await findPlotPoints(map, plot_nrs);
    } catch (error) {
	console.error('Parzellen konnten nicht geladen werden', error);
	return;
    }
    if (search === plotSearchNumber && points.length > 0) {  // sonst inzwischen neu gesucht
	map.getView().animate({center: getCenter(boundingExtent(points)), duration: 500});
    }
}

// Routenziel zu einer Parzellennummer: der Punkt, der der Kartenmitte am nächsten liegt
// (Nummern wiederholen sich in anderen Kolonien); null, wenn nichts gefunden wurde
async function findPlotDestination(map, text) {
    let points;
    try {
	points = await findPlotPoints(map, normalizePlots(text));
    } catch (error) {
	console.error('Parzellen konnten nicht geladen werden', error);
	return null;
    }
    const center = map.getView().getCenter();
    const distance = point => Math.hypot(point[0] - center[0], point[1] - center[1]);
    return points.reduce((nearest, point) =>
	nearest === null || distance(point) < distance(nearest) ? point : nearest, null);
}

var vectorSource = new VectorSource({
  features: [iconFeature]
});

var vectorLayer = new VectorLayer({
  source: vectorSource
});

const map = new Map({
  target: 'map',
    layers: [
	new TileLayer({
	    source: new OSM({
		attributions: '<p style="text-align:left;font-family:verdana;"> © ' +
		    '<a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors<br />' +
		    '<a href="https://obstbaumkarte.de/about/">Über diese Karte</a></p>'}),
	    minZoom: mapMinZoom,
	    maxZoom: 16
	}),
	new TileLayer({
	    extent: mapExtent,
	    source: new XYZ({
		attributions: '<p style="text-align:left;font-family:verdana;"> © ' +
		    '<a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors<br />' +
		    '<a href="https://obstbaumkarte.de/about/">Über diese Karte</a></p>',
		url: 'https://mymapnik.rudzick.it/MeinMapnikWMS/tiles/osm_hq/webmercator_hq/{z}/{x}/{y}.png?origin=nw',
		tilePixelRatio: 2, // THIS IS IMPORTANT
		tileSize: 256,
		retina: true
	    }),
	    minZoom: 16,
	    maxZoom: mapMaxZoom
	}),
	new VectorTileLayer({
	    name: 'parzellengrenzen',
	    source: new VectorTileSource({
		format: new MVT(),
		url: 'https://sbtiles.obstbaumkarte.de/table.public.allotment_plots.geom/{z}/{x}/{y}',
		crossOrigin: 'anonymous',
	    }),
	    minZoom: 14,
	    maxZoom: 21,
	    style: styleFunction,
	}),
	new VectorTileLayer({
	    name: 'parzelleneingaenge',
	    source: new VectorTileSource({
		format: new MVT(),
		url: 'https://sbtiles.obstbaumkarte.de/table.public.allotment_plot_entrances.geom/{z}/{x}/{y}',
		crossOrigin: 'anonymous',
	    }),
	    minZoom: 14,
	    maxZoom: 21,
	    style: styleFunction,
	}),
	new VectorTileLayer({
	    name: 'baeume',
	    source: new VectorTileSource({
		format: new MVT(),
		url: 'https://sbtiles.obstbaumkarte.de/trees/{z}/{x}/{y}',
	    }),
	    minZoom: 18,
	    style: baum,
	}),
	new VectorTileLayer({
	    name: 'straeucher',
	    source: new VectorTileSource({
		format: new MVT(),
		url: 'https://sbtiles.obstbaumkarte.de/shrubs/{z}/{x}/{y}',
	    }),
	    minZoom: 20,
	    style: strauch,
	}),
	new VectorTileLayer({
	    name: 'hecken',
	    source: new VectorTileSource({
		format: new MVT(),
		url: 'https://sbtiles.obstbaumkarte.de/hedges/{z}/{x}/{y}',
	    }),
	    minZoom: 18,
	    style: hecke,
	}),
	// Vektortiles für Geldautomaten
	new VectorTileLayer({
	    name: 'geldautomaten',
	    source: new VectorTileSource({
		format: new MVT(),
		url: 'https://sbtiles.obstbaumkarte.de/table.public.atm.geom/{z}/{x}/{y}',
	    }),
	    minZoom: 18,
	    style: baum,
	}),

    ],
    view: new View({
	projection: 'EPSG:3857',
	center: center,
	zoom: zoom,
	rotation: rotation
    }),
    controls: defaultControls({attribution: false}).extend([attribution,massstab,new FullScreen(), new Rotate(), new FindAllotmentPlots()]),
    //   controls: defaultControls({attribution: true}).extend([attribution,massstab,new FullScreen()]),
});

const routing = addRouting(map, {
    onChange: () => updatePermalink(),
    findPlot: (text) => findPlotDestination(map, text),
    onEndPlotChange: (text) => {
	route_plot_nrs = text ? normalizePlots(text) : [];
	refreshPlotHighlight(map);
    },
});

map.on('pointermove', showInfo);

const info = document.getElementById('info');
function layerFilter(layerCandidate) {
    if (layerCandidate.get('name') == 'baeume' ||  layerCandidate.get('name') == 'straeucher'  ||  layerCandidate.get('name') == 'hecken'  ||  layerCandidate.get('name') == 'geldautomaten'   ) {
	return(true);
    }
    return(false);
}
function showInfo(event) {
  const features = map.getFeaturesAtPixel(event.pixel,{layerFilter});
    if (features.length == 0){
    info.innerText = '';
    info.style.opacity = 0;
    return;
  }
  const properties = features[0].getProperties();
  info.innerText = JSON.stringify(properties, null, 2);
  info.style.opacity = 1;
}

if(marker > 0) map.addLayer(vectorLayer);  // setze Marker im Kartenzentrum

function onChangeScaleText() {
  scaleBarText = scaleTextCheckbox.checked;
  map.removeControl(massstab);
  map.addControl(scaleControl());
}

function checkSize() {
  var small = map.getSize()[0] < 6000;
  attribution.setCollapsible(small);
  attribution.setCollapsed(small);
}

window.addEventListener('resize', checkSize);
checkSize();

var shouldUpdate = true;
var view = map.getView();
var updatePermalink = function() {
  if (!shouldUpdate) {
    // do not update the URL when the view was changed in the 'popstate' handler
    shouldUpdate = true;
    return;
  }

  var center = view.getCenter();
  var hash = '#map=' +
      view.getZoom() + '/' +
      Math.round(center[0] * 100) / 100 + '/' +
      Math.round(center[1] * 100) / 100 + '/' +
      view.getRotation();
   if (plot_nrs.some(nr => nr.trim() !== '')) {
       hash = hash + '/0/' +  plot_nrs.join("+");
   }
  // nur die gesetzten Routenpunkte
  var route = routing.getPermalinkState();
  var routeParts = [['start', route.start], ['via', route.via], ['ziel', route.end]]
      .filter(([, lonLat]) => lonLat)
      .map(([key, lonLat]) => key + '=' + formatLatLon(lonLat));
  if (routeParts.length) {
      hash = hash + '&' + routeParts.join('&') + '&profil=' + route.profile;
      if (route.endPlot) {
	  hash = hash + '&zielparzelle=' + encodeURIComponent(route.endPlot);
      }
  }
  var state = {
    zoom: view.getZoom(),
    center: view.getCenter(),
    rotation: view.getRotation()
  };
  window.history.pushState(state, 'map', hash);
};

map.on('moveend', updatePermalink);

if (['start', 'via', 'ziel'].some(key => routeParams.has(key))) {
    routing.setPermalinkState({
	profile: routeParams.get('profil'),
	start: parseLatLon(routeParams.get('start')),
	via: parseLatLon(routeParams.get('via')),
	end: parseLatLon(routeParams.get('ziel')),
	endPlot: routeParams.get('zielparzelle'),
    });
}

// restore the view state when navigating through the history, see
// https://developer.mozilla.org/en-US/docs/Web/API/WindowEventHandlers/onpopstate
window.addEventListener('popstate', function(event) {
  if (event.state === null) {
    return;
  }
  map.getView().setCenter(event.state.center);
  map.getView().setZoom(event.state.zoom);
  map.getView().setRotation(event.state.rotation);
  shouldUpdate = false;
});

// Locator-Button
const locatorSource = new VectorSource();
const locatorLayer = new VectorLayer({
    source: locatorSource,
    name: 'locatorLayer',
});

const locate = document.createElement('div');
locate.className = 'ol-control ol-unselectable locate';
locate.innerHTML = '<button title="Locate me">◎</button>';
locate.addEventListener('click', function () {
    if (!map.getLayers().getArray().some(layer => layer.get('name') == 'locatorLayer')) {
    	navigator.geolocation.watchPosition(
	    function (pos) {
		const coords = [pos.coords.longitude, pos.coords.latitude];
		const accuracy = circular(coords, pos.coords.accuracy);
		locatorSource.clear(true);
		locatorSource.addFeatures([
		    new Feature(
			accuracy.transform('EPSG:4326', map.getView().getProjection())
		    ),
		    new Feature(new Point(fromLonLat(coords))),
		]);
	    },
	    function (error) {
		alert(`ERROR: ${error.message}`);
	    },
	    {
		enableHighAccuracy: true,
	    }
	);
	map.addLayer(locatorLayer);
    }
    if (!locatorSource.isEmpty()) {
	map.getView().fit(locatorSource.getExtent(), {
	    maxZoom: 20,
	    duration: 500,
	});
    }
});

map.addControl(
  new Control({
    element: locate,
  })
);

const style = new Style({
  fill: new Fill({
    color: 'rgba(0, 0, 255, 0.2)',
  }),
  image: new Icon({
    src: './data/location-heading.svg',
    imgSize: [27, 55],
    rotateWithView: true,
  }),
});
locatorLayer.setStyle(style);

function startCompass() {
  kompas()
    .watch()
    .on('heading', function (heading) {
      style.getImage().setRotation((Math.PI / 180) * heading);
    });
}

if (
  window.DeviceOrientationEvent &&
  typeof DeviceOrientationEvent.requestPermission === 'function'
) {
  locate.addEventListener('click', function () {
    DeviceOrientationEvent.requestPermission()
      .then(startCompass)
      .catch(function (error) {
        alert(`ERROR: ${error.message}`);
      });
  });
} else if ('ondeviceorientationabsolute' in window) {
  startCompass();
}
