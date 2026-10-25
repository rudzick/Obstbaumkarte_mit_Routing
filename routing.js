// Routing-Panel (ähnlich der Routenplanung auf openstreetmap.org) mit GraphHopper als Backend.
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import LineString from 'ol/geom/LineString';
import VectorSource from 'ol/source/Vector';
import {Vector as VectorLayer} from 'ol/layer';
import {Control} from 'ol/control';
import Translate from 'ol/interaction/Translate';
import {Style, Stroke, Circle, Fill} from 'ol/style';
import {fromLonLat, toLonLat, transformExtent} from 'ol/proj';
import {boundingExtent} from 'ol/extent';
import './routing.css';

// im Dev-Server per Proxy auf localhost:8989 umgeleitet, siehe vite.config.js
const GRAPHHOPPER_URL = import.meta.env.VITE_GRAPHHOPPER_URL || '/graphhopper';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

const PROFILES = [
    ['foot', 'Zu Fuß'],
    ['bike', 'Fahrrad'],
    ['wheelchair', 'Rollstuhl / Kinderwagen'],
    ['car', 'Auto'],
];

const routeStyle = [
    new Style({stroke: new Stroke({color: 'rgba(255,255,255,0.9)', width: 8})}),
    new Style({stroke: new Stroke({color: '#0b62d6', width: 5})}),
];

function markerStyle(color) {
    return new Style({
	image: new Circle({
	    radius: 8,
	    fill: new Fill({color: color}),
	    stroke: new Stroke({color: 'white', width: 2}),
	}),
	zIndex: 1,
    });
}
const markerStyles = {start: markerStyle('#2a9d3a'), end: markerStyle('#d62828')};

function formatDistance(m) {
    if (m < 1000) return Math.round(m) + ' m';
    return (m / 1000).toLocaleString('de-DE', {maximumFractionDigits: 1}) + ' km';
}

function formatTime(ms) {
    const min = Math.round(ms / 60000);
    if (min < 60) return min + ' min';
    return Math.floor(min / 60) + ' h ' + (min % 60) + ' min';
}

function formatLonLat(lonLat) {
    return lonLat[1].toFixed(5) + ', ' + lonLat[0].toFixed(5);
}

// "52.47, 13.31" -> [13.31, 52.47], sonst Ortssuche über Nominatim
// Sucht zuerst im aktuellen Kartenausschnitt, danach in ganz Deutschland
async function geocode(text, extent) {
    const m = text.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (m) return [parseFloat(m[2]), parseFloat(m[1])];
    const viewbox = transformExtent(extent, 'EPSG:3857', 'EPSG:4326').join(',');
    for (const area of [{viewbox: viewbox, bounded: '1'}, {}]) {
	const params = new URLSearchParams({
	    q: text, format: 'jsonv2', limit: '1', countrycodes: 'de', ...area,
	});
	const response = await fetch(NOMINATIM_URL + '?' + params, {headers: {'Accept-Language': 'de'}});
	const results = await response.json();
	if (results.length) return [parseFloat(results[0].lon), parseFloat(results[0].lat)];
    }
    throw new Error('„' + text + '“ wurde nicht gefunden.');
}

class RoutingPanel extends Control {
    constructor() {
	const element = document.createElement('div');
	element.className = 'routing-panel ol-unselectable';
	element.hidden = true;
	element.innerHTML = `
	  <div class="routing-header">
	    <strong>Route planen</strong>
	    <button type="button" class="routing-close" title="Schließen">×</button>
	  </div>
	  <select class="routing-profile">
	    ${PROFILES.map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}
	  </select>
	  <div class="routing-endpoints">
	    <div class="routing-inputs">
	      <input type="text" class="routing-start" placeholder="Start (Ort oder Klick in die Karte)">
	      <input type="text" class="routing-end" placeholder="Ziel (Ort oder Klick in die Karte)">
	    </div>
	    <button type="button" class="routing-swap" title="Start und Ziel tauschen">⇅</button>
	  </div>
	  <button type="button" class="routing-go">Route berechnen</button>
	  <div class="routing-status"></div>
	  <ol class="routing-instructions"></ol>`;
	super({element: element});

	this.profileSelect = element.querySelector('.routing-profile');
	this.inputs = {start: element.querySelector('.routing-start'), end: element.querySelector('.routing-end')};
	this.status = element.querySelector('.routing-status');
	this.instructionList = element.querySelector('.routing-instructions');

	this.markers = {start: null, end: null};
	this.routeSource = new VectorSource();
	this.layer = new VectorLayer({
	    source: this.routeSource,
	    name: 'routing',
	    zIndex: 10,
	});
	// über layers/filter statt features: verschoben wird nur der Marker unter dem Zeiger,
	// bei features würden alle Features der Collection gemeinsam verschoben
	this.translate = new Translate({
	    layers: [this.layer],
	    filter: (feature) => feature.get('role') !== undefined,
	});
	this.translate.on('translateend', (event) => {
	    event.features.forEach((feature) => this.updateInputFromMarker(feature.get('role')));
	    this.calculateRoute();
	});
	this.abortController = null;

	element.querySelector('.routing-close').addEventListener('click', () => this.close());
	element.querySelector('.routing-go').addEventListener('click', () => this.resolveAndRoute());
	element.querySelector('.routing-swap').addEventListener('click', () => this.swap());
	this.profileSelect.addEventListener('change', () => this.calculateRoute());
	Object.values(this.inputs).forEach((input) => input.addEventListener('keydown', (event) => {
	    if (event.key === 'Enter') this.resolveAndRoute();
	}));
    }

    setMap(map) {
	super.setMap(map);
	if (!map) return;
	map.addLayer(this.layer);
	map.addInteraction(this.translate);
	map.on('singleclick', (event) => {
	    if (this.element.hidden) return;
	    if (map.forEachFeatureAtPixel(event.pixel, () => true, {layerFilter: (l) => l === this.layer})) return;
	    this.setMarker(this.markers.start ? 'end' : 'start', event.coordinate);
	    this.calculateRoute();
	});
    }

    toggle() {
	if (this.element.hidden) {
	    this.element.hidden = false;
	    this.inputs.start.focus();
	} else {
	    this.close();
	}
    }

    close() {
	this.element.hidden = true;
	if (this.abortController) this.abortController.abort();
	this.clearRoute();
	['start', 'end'].forEach((role) => {
	    this.removeMarker(role);
	    this.inputs[role].value = '';
	});
	this.status.textContent = '';
    }

    setMarker(role, coordinate) {
	if (this.markers[role]) {
	    this.markers[role].getGeometry().setCoordinates(coordinate);
	} else {
	    const feature = new Feature({geometry: new Point(coordinate), role: role});
	    feature.setStyle(markerStyles[role]);
	    this.markers[role] = feature;
	    this.routeSource.addFeature(feature);
	}
	this.updateInputFromMarker(role);
    }

    removeMarker(role) {
	const feature = this.markers[role];
	if (!feature) return;
	this.routeSource.removeFeature(feature);
	this.markers[role] = null;
    }

    updateInputFromMarker(role) {
	const lonLat = toLonLat(this.markers[role].getGeometry().getCoordinates());
	this.inputs[role].value = formatLonLat(lonLat);
	// merken, damit der Text beim Berechnen nicht erneut gesucht wird
	this.inputs[role].dataset.resolved = this.inputs[role].value;
    }

    swap() {
	const start = this.markers.start ? this.markers.start.getGeometry().getCoordinates() : null;
	const end = this.markers.end ? this.markers.end.getGeometry().getCoordinates() : null;
	const startText = this.inputs.start.value;
	['start', 'end'].forEach((role) => this.removeMarker(role));
	this.inputs.start.value = this.inputs.end.value;
	this.inputs.end.value = startText;
	if (end) this.setMarker('start', end);
	if (start) this.setMarker('end', start);
	this.calculateRoute();
    }

    async resolveAndRoute() {
	try {
	    for (const role of ['start', 'end']) {
		const input = this.inputs[role];
		const text = input.value.trim();
		if (!text) continue;
		if (this.markers[role] && input.dataset.resolved === input.value) continue;
		this.status.textContent = 'Suche „' + text + '“ …';
		const lonLat = await geocode(text, this.getMap().getView().calculateExtent());
		this.setMarker(role, fromLonLat(lonLat));
		input.value = text;
		input.dataset.resolved = text;
	    }
	} catch (error) {
	    this.status.textContent = error.message;
	    return;
	}
	this.calculateRoute(true);
    }

    clearRoute() {
	this.routeSource.getFeatures()
	    .filter((feature) => !feature.get('role'))
	    .forEach((feature) => this.routeSource.removeFeature(feature));
	this.instructionList.replaceChildren();
    }

    async calculateRoute(fit = false) {
	if (!this.markers.start || !this.markers.end) {
	    this.status.textContent = this.markers.start ? 'Jetzt das Ziel in der Karte anklicken.' : '';
	    return;
	}
	if (this.abortController) this.abortController.abort();
	this.abortController = new AbortController();

	const params = new URLSearchParams({
	    profile: this.profileSelect.value,
	    points_encoded: 'false',
	    locale: 'de',
	    instructions: 'true',
	});
	['start', 'end'].forEach((role) => {
	    const lonLat = toLonLat(this.markers[role].getGeometry().getCoordinates());
	    params.append('point', lonLat[1] + ',' + lonLat[0]);
	});

	this.status.textContent = 'Berechne Route …';
	let data;
	try {
	    const response = await fetch(GRAPHHOPPER_URL + '/route?' + params, {signal: this.abortController.signal});
	    data = await response.json();
	    if (!response.ok) throw new Error(data.message || response.statusText);
	} catch (error) {
	    if (error.name === 'AbortError') return;
	    this.clearRoute();
	    this.status.textContent = 'Keine Route gefunden: ' + error.message;
	    return;
	}
	this.showRoute(data.paths[0], fit);
    }

    showRoute(path, fit) {
	this.clearRoute();
	const coordinates = path.points.coordinates.map((c) => fromLonLat(c));
	const route = new Feature(new LineString(coordinates));
	route.setStyle(routeStyle);
	this.routeSource.addFeature(route);
	this.status.textContent = formatDistance(path.distance) + ' · ' + formatTime(path.time);

	path.instructions.forEach((instruction) => {
	    const item = document.createElement('li');
	    item.textContent = instruction.text;
	    if (instruction.distance > 0) {
		const distance = document.createElement('span');
		distance.className = 'routing-distance';
		distance.textContent = formatDistance(instruction.distance);
		item.appendChild(distance);
	    }
	    item.addEventListener('click', () => {
		const [from, to] = instruction.interval;
		this.getMap().getView().fit(boundingExtent(coordinates.slice(from, to + 1)), {
		    maxZoom: 19, duration: 300, padding: [40, 40, 40, 40],
		});
	    });
	    this.instructionList.appendChild(item);
	});

	if (fit) {
	    this.getMap().getView().fit(route.getGeometry(), {duration: 300, padding: [40, 40, 40, 40]});
	}
    }
}

export function addRouting(map) {
    const panel = new RoutingPanel();

    const button = document.createElement('button');
    button.type = 'button';
    button.title = 'Route planen';
    button.textContent = '⤳';
    button.addEventListener('click', () => panel.toggle());
    const buttonElement = document.createElement('div');
    buttonElement.className = 'ol-control ol-unselectable routing-button';
    buttonElement.appendChild(button);

    map.addControl(new Control({element: buttonElement}));
    map.addControl(panel);
}
