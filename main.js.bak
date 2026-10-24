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
import XYZ from 'ol/source/XYZ';
import VectorSource from 'ol/source/Vector';
import {Icon, Style, Circle, Fill, Stroke} from 'ol/style';
import VectorTileLayer from 'ol/layer/VectorTile.js';
import VectorTileSource from 'ol/source/VectorTile.js';
import {defaults as defaultControls, Attribution, ScaleLine, FullScreen, Control, Rotate} from 'ol/control';
import {circular} from 'ol/geom/Polygon';
import kompas from 'kompas';

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
  }

  handleFindAllotmentPlots() {
//      plot_nr = (document.getElementById("allotment_number_field").value).replace(/\s+/g,"").toLowerCase();
      plot_nr = (document.getElementById("allotment_number_field").value).replace(/[^0-9a-zA-ZZäöüÄÖÜß]+/g,"").toLowerCase();
//      console.log(plot_nr);
      this.getMap().getLayers().getArray().find(layer => layer.get('name') == 'parzellengrenzen').setStyle(styleFunction);
      updatePermalink();
  };
}

var plot_nr = ' ';

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

if (window.location.hash !== '') {
    // try to restore center, zoom-level and rotation from the URL
    var hash = window.location.hash.replace('#map=', '');
    var parts = hash.split('/');
    if (parts.length === 4) {
	zoom = parseInt(parts[0], 10);
	center = [
	    parseFloat(parts[1]),
	    parseFloat(parts[2])
	];
	rotation = parseFloat(parts[3]);
    } else if (parts.length === 5) {  // wenn 1 dann Marker im Zentrum der Karte
	zoom = parseInt(parts[0], 10);
	center = [
	    parseFloat(parts[1]),
	    parseFloat(parts[2])
	];
	rotation = parseFloat(parts[3]);
	marker = parseInt(parts[4]);     
    } else if (parts.length === 6) {  // Link mit Parzellennummer
	zoom = parseInt(parts[0], 10);
	center = [
	    parseFloat(parts[1]),
	    parseFloat(parts[2])
	];
	rotation = parseFloat(parts[3]);
	marker = parseInt(parts[4]);
	plot_nr = parts[5];
	allotment_number_field.value = plot_nr;	
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

// iconFeature.setStyle(iconStyle);

var plothighlightStyle = new Style({
    stroke: new Stroke({
        color: 'rgba(197,27,138,0.7)',
        width: 2.1,
	padding: 3.0
    }),
});

var styleFunction = function(feature, resolution) {
    if (feature.get('layer') == 'parzellengrenzen'
	&&  feature.get('ref') == plot_nr){
    return(plothighlightStyle);
  }
};


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
	    source: new OSM(),
	    minZoom: mapMinZoom,
	    maxZoom: 17
	}),
	new TileLayer({
	    extent: mapExtent,
	    source: new XYZ({
		attributions: '<p style="text-align:left;font-family:verdana;"> © ' +
		    '<a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors<br />' +
		    '<a href="https://obstbaumkarte.de/about/">Über diese Karte</a></p>',
		url: 'https://mymapnik.rudzick.it/MeinMapnikWMS/tiles/osm_hq/webmercator_hq/{z}/{x}/{y}.png?origin=nw',
		tilePixelRatio: 2 // THIS IS IMPORTANT
	    }),
	    minZoom: 17,
	    maxZoom: mapMaxZoom
	}),
	new VectorTileLayer({
	    name: 'parzellengrenzen',
	    source: new VectorTileSource({
		format: new MVT({layerName: 'layer', layers: ['parzellengrenzen']}),
		url: 'https://vectortiles.obstbaumkarte.de/trees/{z}/{x}/{y}.pbf',
	    }),
	    minZoom: 14,
	    maxZoom: 21,
	    style: styleFunction,
	}),
	new VectorTileLayer({
	    name: 'baeume',
	    source: new VectorTileSource({
		format: new MVT({layerName: 'layer', layers: ['tree']}),
		url: 'https://vectortiles.obstbaumkarte.de/trees/{z}/{x}/{y}.pbf',
	    }),
	    minZoom: 18,
	    style: baum,
	}),
	new VectorTileLayer({
	    name: 'straeucher',
	    source: new VectorTileSource({
		format: new MVT({layerName: 'layer', layers: ['shrub']}),
		url: 'https://vectortiles.obstbaumkarte.de/trees/{z}/{x}/{y}.pbf',
	    }),
	    minZoom: 20,
	    style: strauch,
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

map.on('pointermove', showInfo);

const info = document.getElementById('info');
function layerFilter(layerCandidate) {
    if (layerCandidate.get('name') == 'baeume' ||  layerCandidate.get('name') == 'straeucher'  ) {
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
   if ( plot_nr != ' ') {
	hash = hash + '/0/' +  plot_nr;
   } 
  var state = {
    zoom: view.getZoom(),
    center: view.getCenter(),
    rotation: view.getRotation()
  };
  window.history.pushState(state, 'map', hash);
};

map.on('moveend', updatePermalink);

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
