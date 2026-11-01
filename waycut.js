// Werkzeug: Wegabschnitt wählen und die Parzellen finden, deren Eingänge nur über diesen
// Abschnitt erreichbar sind.
//
// Der Abschnitt wird nicht gesperrt, sondern extrem teuer gemacht: Eine gesperrte Kante kann
// GraphHopper nicht mehr als Start nutzen, ein Eingang am gewählten Weg würde dann an einem
// anderen Weg einrasten. So bleibt das Einrasten wie beim normalen Routing. Führt die Route
// dennoch über den Abschnitt, gibt es keinen anderen Weg, und ihr Gewicht verrät das.
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import LineString from 'ol/geom/LineString';
import VectorSource from 'ol/source/Vector';
import MVT from 'ol/format/MVT.js';
import {Vector as VectorLayer} from 'ol/layer';
import {Control} from 'ol/control';
import {Style, Stroke, Circle, Fill} from 'ol/style';
import {fromLonLat, toLonLat} from 'ol/proj';
import {boundingExtent, buffer, containsExtent, createEmpty, extend, getCenter} from 'ol/extent';
import {GRAPHHOPPER_URL, PROFILES, formatDistance} from './routing.js';
import {plotListCsv} from './plotlist.js';

const SECTION_PRIORITY = '0.0000001';  // macht den Abschnitt rund 10 Millionen Mal teurer
const VIA_SECTION_WEIGHT = 1000000;    // normale Routen im Umkreis bleiben weit darunter
const MAX_VISITED_NODES = 200000;
const CHECK_SPACING = 20;              // m; so dicht liegen die Prüfpunkte auf dem Abschnitt
const CHECK_BOX = 0.25;                // m; halbe Kantenlänge eines Prüfpunkts
const MAX_SECTION_LENGTH = 3000;       // m, alle Zweige zusammen
const BRANCH_SNAP_DISTANCE = 15;       // m; so nah am Abschnitt setzt ein Zweig an ihm an
const SEARCH_RADIUS = 1500;            // m um den Abschnitt
const REFERENCE_DISTANCE = 3000;       // m; dorthin muss ein Eingang gelangen können
const PARALLEL_REQUESTS = 6;
const STOP_AFTER_REACHABLE = 400;      // so viele erreichbare Eingänge in Folge beenden die Suche
const TILE_ZOOM = 16;

const markerStyle = (color) => new Style({
    image: new Circle({
	radius: 7,
	fill: new Fill({color: color}),
	stroke: new Stroke({color: 'white', width: 2}),
    }),
    zIndex: 2,
});
const beginStyle = markerStyle('#2a9d3a');
const waypointStyle = markerStyle('#f08c00');
const endStyle = markerStyle('#d62828');
const sectionStyle = [
    new Style({stroke: new Stroke({color: 'rgba(255,255,255,0.9)', width: 9}), zIndex: 1}),
    new Style({stroke: new Stroke({color: '#f08c00', width: 5}), zIndex: 1}),
];

const metersPerDegreeLat = 111320;
const metersPerDegreeLon = (lat) => metersPerDegreeLat * Math.cos(lat * Math.PI / 180);

function distanceMeters(a, b) {
    return Math.hypot((a[0] - b[0]) * metersPerDegreeLon(a[1]), (a[1] - b[1]) * metersPerDegreeLat);
}

// Prüfpunkte auf den Segmenten. Genau auf deren Enden kann ein anderer Weg abzweigen, der würde
// mit verteuert, deshalb halten sie 1 m Abstand.
// So führt jeder Weg von einem Eingang am Abschnitt über einen Prüfpunkt.
function checkPoints(coordinates) {
    const points = [];
    for (let i = 0; i + 1 < coordinates.length; i++) {
	const [a, b] = [coordinates[i], coordinates[i + 1]];
	const length = distanceMeters(a, b);
	if (length < 3) {
	    points.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
	    continue;
	}
	const count = Math.max(1, Math.ceil((length - 2) / CHECK_SPACING));
	for (let k = 0; k <= count; k++) {
	    const f = (1 + (length - 2) * k / count) / length;
	    points.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
	}
    }
    return points;
}

function checkBox(point) {
    const dx = CHECK_BOX / metersPerDegreeLon(point[1]);
    const dy = CHECK_BOX / metersPerDegreeLat;
    return [[
	[point[0] - dx, point[1] - dy], [point[0] + dx, point[1] - dy],
	[point[0] + dx, point[1] + dy], [point[0] - dx, point[1] + dy],
	[point[0] - dx, point[1] - dy],
    ]];
}

function naturalCompare(a, b) {
    return a.localeCompare(b, 'de', {numeric: true, sensitivity: 'base'});
}

class WayCutPanel extends Control {
    constructor(options) {
	const element = document.createElement('div');
	element.className = 'routing-panel waycut-panel ol-unselectable';
	element.hidden = true;
	element.innerHTML = `
	  <div class="routing-header">
	    <strong>Wegabschnitt prüfen</strong>
	    <button type="button" class="routing-close" title="Schließen">×</button>
	  </div>
	  <select class="waycut-profile">
	    ${PROFILES.map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}
	  </select>
	  <div class="waycut-hint"></div>
	  <div class="waycut-actions">
	    <button type="button" class="waycut-branch" disabled title="Der nächste Klick beginnt einen Zweig, zum Beispiel an einer Einmündung">Neuer Zweig</button>
	    <button type="button" class="waycut-undo" disabled title="Letzten Punkt entfernen">Zurück</button>
	    <button type="button" class="waycut-new" disabled title="Ganzen Abschnitt entfernen">Neu</button>
	  </div>
	  <button type="button" class="routing-go waycut-go" disabled>Parzellen suchen</button>
	  <div class="routing-status waycut-status"></div>
	  <button type="button" class="routing-go waycut-export" hidden>Liste für Excel speichern</button>
	  <ul class="routing-instructions waycut-results"></ul>`;
	super({element: element});

	this.onOpen = options.onOpen || (() => {});
	this.onHighlight = options.onHighlight || (() => {});
	this.profileSelect = element.querySelector('.waycut-profile');
	this.hint = element.querySelector('.waycut-hint');
	this.goButton = element.querySelector('.waycut-go');
	this.status = element.querySelector('.waycut-status');
	this.results = element.querySelector('.waycut-results');
	this.exportButton = element.querySelector('.waycut-export');
	this.exportRefs = [];

	this.branchButton = element.querySelector('.waycut-branch');
	this.undoButton = element.querySelector('.waycut-undo');
	this.newButton = element.querySelector('.waycut-new');

	// Zweige des Abschnitts: {points: [[lon, lat]…], legs: [{coordinates, distance}…]};
	// legs[i] ist die Route von points[i] nach points[i + 1]
	this.branches = [];
	this.startBranch = false;      // der nächste Klick beginnt einen Zweig
	this.picking = Promise.resolve();  // Klicks der Reihe nach abarbeiten
	this.generation = 0;           // ändert sich, wenn laufende Routen veraltet sind
	this.run = null;               // AbortController der laufenden Suche
	this.source = new VectorSource();
	this.layer = new VectorLayer({source: this.source, name: 'wegabschnitt', zIndex: 11});

	element.querySelector('.routing-close').addEventListener('click', () => this.close());
	this.goButton.addEventListener('click', () => this.run ? this.stop() : this.search());
	this.exportButton.addEventListener('click', () => this.exportList());
	this.branchButton.addEventListener('click', () => {
	    this.startBranch = true;
	    this.updateControls();
	});
	this.undoButton.addEventListener('click', () => this.enqueue(() => this.undo()));
	this.newButton.addEventListener('click', () => this.reset());
	this.profileSelect.addEventListener('change', () => this.enqueue(() => this.recalculate()));
	this.updateControls();
    }

    setMap(map) {
	super.setMap(map);
	if (!map) return;
	map.addLayer(this.layer);
	map.on('singleclick', (event) => {
	    if (!this.element.hidden) this.enqueue(() => this.addPoint(toLonLat(event.coordinate)));
	});
    }

    get isOpen() {
	return !this.element.hidden;
    }

    toggle() {
	if (this.isOpen) {
	    this.close();
	} else {
	    this.onOpen();
	    this.element.hidden = false;
	}
    }

    close() {
	this.element.hidden = true;
	this.reset();
    }

    reset() {
	this.stop();
	this.generation++;
	this.branches = [];
	this.startBranch = false;
	this.source.clear();
	this.clearResults();
	this.updateControls();
    }

    stop() {
	if (this.run) this.run.abort();
    }

    clearResults() {
	this.results.replaceChildren();
	this.status.textContent = '';
	this.exportRefs = [];
	this.exportButton.hidden = true;
	this.onHighlight(new Set(), new Set());
    }

    exportList() {
	const blob = new Blob([plotListCsv(this.exportRefs)], {type: 'text/csv;charset=utf-8'});
	const link = document.createElement('a');
	link.href = URL.createObjectURL(blob);
	link.download = 'parzellen-wegabschnitt.csv';
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    }

    get legs() {
	return this.branches.flatMap((branch) => branch.legs);
    }

    get sectionCoordinates() {
	return this.legs.flatMap((leg) => leg.coordinates);
    }

    get sectionLength() {
	return this.legs.reduce((sum, leg) => sum + leg.distance, 0);
    }

    updateControls() {
	const hasPoints = this.branches.length > 0;
	const hasLegs = this.legs.length > 0;
	const last = this.branches[this.branches.length - 1];
	this.hint.textContent = this.startBranch ? 'Anfang des Zweigs anklicken, zum Beispiel die Einmündung.'
	    : !hasPoints ? 'Anfang des Abschnitts in der Karte anklicken.'
	    : last.points.length === 1 ? 'Nächsten Punkt in der Karte anklicken.'
	    : 'Weitere Klicks verlängern den Abschnitt. „Neuer Zweig“ beginnt eine Abzweigung.';
	this.goButton.textContent = this.run ? 'Suche abbrechen' : 'Parzellen suchen';
	this.goButton.disabled = !hasLegs;
	this.branchButton.disabled = !hasLegs;
	this.branchButton.classList.toggle('waycut-armed', this.startBranch);
	this.undoButton.disabled = !hasPoints;
	this.newButton.disabled = !hasPoints;
    }

    enqueue(task) {
	this.picking = this.picking.then(task).catch((error) => {
	    this.status.textContent = 'Fehler: ' + error.message;
	});
	return this.picking;
    }

    showSection() {
	this.source.clear();
	this.legs.forEach((leg) => {
	    const line = new Feature(new LineString(leg.coordinates.map((c) => fromLonLat(c))));
	    line.setStyle(sectionStyle);
	    this.source.addFeature(line);
	});
	this.branches.forEach((branch) => {
	    branch.points.forEach((lonLat, index) => {
		const marker = new Feature(new Point(fromLonLat(lonLat)));
		marker.setStyle(index === 0 ? beginStyle
				: index === branch.points.length - 1 ? endStyle : waypointStyle);
		this.source.addFeature(marker);
	    });
	});
	this.updateControls();
    }

    showLength() {
	this.status.textContent = this.legs.length ? 'Abschnitt: ' + formatDistance(this.sectionLength) : '';
    }

    // Die Route zwischen zwei Punkten im Routing-Graphen
    async fetchLeg(from, to) {
	const params = new URLSearchParams({
	    profile: this.profileSelect.value, points_encoded: 'false', instructions: 'false',
	});
	[from, to].forEach((p) => params.append('point', p[1] + ',' + p[0]));
	const response = await fetch(GRAPHHOPPER_URL + '/route?' + params);
	const data = await response.json();
	if (!response.ok) throw new Error(data.message || response.statusText);
	const path = data.paths[0];
	return {coordinates: path.points.coordinates, distance: path.distance};
    }

    // Ein Zweig setzt am Abschnitt an, wenn er nah genug daran beginnt; ein Klick trifft
    // die Einmündung sonst nie genau
    branchStart(lonLat) {
	let nearest = lonLat, nearestDistance = BRANCH_SNAP_DISTANCE;
	this.sectionCoordinates.forEach((coordinate) => {
	    const distance = distanceMeters(coordinate, lonLat);
	    if (distance < nearestDistance) {
		nearest = coordinate;
		nearestDistance = distance;
	    }
	});
	return nearest;
    }

    async addPoint(lonLat) {
	this.stop();
	const generation = this.generation;
	this.clearResults();
	if (this.startBranch || this.branches.length === 0) {
	    this.branches.push({points: [this.startBranch ? this.branchStart(lonLat) : lonLat], legs: []});
	    this.startBranch = false;
	    this.showSection();
	    this.showLength();
	    return;
	}
	const branch = this.branches[this.branches.length - 1];
	const previous = branch.points[branch.points.length - 1];
	this.status.textContent = 'Suche den Abschnitt …';
	let leg;
	try {
	    leg = await this.fetchLeg(previous, lonLat);
	} catch (error) {
	    if (generation === this.generation) this.status.textContent = 'Kein Weg dorthin gefunden: ' + error.message;
	    return;
	}
	if (generation !== this.generation) return;  // inzwischen neu begonnen
	if (this.sectionLength + leg.distance > MAX_SECTION_LENGTH) {
	    this.status.textContent = 'Der Abschnitt wäre mit ' + formatDistance(this.sectionLength + leg.distance)
		+ ' zu lang (höchstens ' + formatDistance(MAX_SECTION_LENGTH) + ').';
	    return;
	}
	branch.points.push(lonLat);
	branch.legs.push(leg);
	this.showSection();
	this.showLength();
    }

    undo() {
	this.stop();
	this.clearResults();
	if (this.startBranch) {
	    this.startBranch = false;
	} else {
	    const branch = this.branches[this.branches.length - 1];
	    if (branch) {
		branch.points.pop();
		branch.legs.pop();
		if (branch.points.length === 0) this.branches.pop();
	    }
	}
	this.showSection();
	this.showLength();
    }

    // Ein anderes Profil kann andere Wege nehmen
    async recalculate() {
	this.stop();
	this.clearResults();
	const generation = this.generation;
	try {
	    for (const branch of this.branches) {
		const legs = [];
		for (let i = 0; i + 1 < branch.points.length; i++) {
		    legs.push(await this.fetchLeg(branch.points[i], branch.points[i + 1]));
		    if (generation !== this.generation) return;
		}
		branch.legs = legs;
	    }
	} catch (error) {
	    if (generation !== this.generation) return;
	    this.reset();
	    this.status.textContent = 'Für dieses Profil gibt es keinen solchen Abschnitt: ' + error.message;
	    return;
	}
	this.showSection();
	this.showLength();
    }

    // 'via': nur über den Abschnitt, 'ok': auch ohne, 'none': gar nicht, 'unknown': keine Antwort
    async check(from, to, customModel, signal) {
	let response, data;
	try {
	    response = await fetch(GRAPHHOPPER_URL + '/route', {
		method: 'POST',
		headers: {'Content-Type': 'application/json'},
		signal: signal,
		body: JSON.stringify({
		    points: [from, to],
		    profile: this.profileSelect.value,
		    'ch.disable': true,
		    custom_model: customModel,
		    'routing.max_visited_nodes': MAX_VISITED_NODES,
		    instructions: false,
		    calc_points: false,
		}),
	    });
	    data = await response.json();
	} catch (error) {
	    if (error.name === 'AbortError') throw error;
	    return 'unknown';
	}
	if (response.ok) return data.paths[0].weight >= VIA_SECTION_WEIGHT ? 'via' : 'ok';
	return /not found|Cannot find point/i.test(data.message || '') ? 'none' : 'unknown';
    }

    // Ein Ziel außerhalb des abgeschnittenen Bereichs: Es muss andere Ziele oder die Punkte des
    // Abschnitts erreichen, ohne über ihn zu führen. Die Enden allein reichen nicht, sie können
    // Sackgassen sein, während der Ausgang in der Mitte des Abschnitts liegt.
    async findReference(customModel, signal) {
	const coordinates = this.sectionCoordinates;
	const center = coordinates[Math.floor(coordinates.length / 2)];
	const dLat = REFERENCE_DISTANCE / metersPerDegreeLat;
	const dLon = REFERENCE_DISTANCE / metersPerDegreeLon(center[1]);
	const candidates = [[dLon, 0], [-dLon, 0], [0, dLat], [0, -dLat]]
	    .map(([x, y]) => [center[0] + x, center[1] + y]);
	const counts = candidates.map(() => 0);
	const pairs = candidates.flatMap((_, i) => candidates.map((__, j) => [i, j]).slice(i + 1));
	await Promise.all(pairs.map(async ([i, j]) => {
	    if (await this.check(candidates[i], candidates[j], customModel, signal) === 'ok') {
		counts[i]++;
		counts[j]++;
	    }
	}));
	const best = counts.indexOf(Math.max(...counts));
	if (counts[best] > 0) return candidates[best];

	// keine zwei Ziele verbunden: wenigstens von einem Punkt des Abschnitts erreichbar
	const points = this.branches.flatMap((branch) => branch.points);
	for (const candidate of candidates) {
	    const answers = await Promise.all(points.map((point) => this.check(point, candidate, customModel, signal)));
	    if (answers.includes('ok')) return candidate;
	}
	return null;
    }

    async loadTiles(layerName, extent, signal) {
	const map = this.getMap();
	const source = map.getLayers().getArray().find((layer) => layer.get('name') === layerName).getSource();
	const tileGrid = source.getTileGrid();
	const projection = map.getView().getProjection();
	const format = new MVT();
	const range = tileGrid.getTileRangeForExtentAndZ(extent, TILE_ZOOM);
	const requests = [];
	for (let x = range.minX; x <= range.maxX; x++) {
	    for (let y = range.minY; y <= range.maxY; y++) {
		const tileCoord = [TILE_ZOOM, x, y];
		requests.push(fetch(source.getTileUrlFunction()(tileCoord, 1, projection), {signal: signal})
		    .then((response) => response.ok ? response.arrayBuffer() : new ArrayBuffer(0))
		    .then((data) => data.byteLength === 0 ? [] : format.readFeatures(data, {
			extent: tileGrid.getTileCoordExtent(tileCoord),
			featureProjection: projection,
		    })));
	    }
	}
	return (await Promise.all(requests)).flat();
    }

    async search() {
	const run = new AbortController();
	this.run = run;
	this.clearResults();
	this.updateControls();
	try {
	    await this.searchPlots(run.signal);
	} catch (error) {
	    if (error.name !== 'AbortError') {
		this.status.textContent = 'Fehler: ' + error.message;
	    } else if (this.legs.length) {
		this.status.textContent = 'Suche abgebrochen.';
	    }
	}
	if (this.run === run) this.run = null;
	this.updateControls();
    }

    async searchPlots(signal) {
	const customModel = {
	    priority: [{if: 'in_wegabschnitt', multiply_by: SECTION_PRIORITY}],
	    areas: {type: 'FeatureCollection', features: [{
		type: 'Feature', id: 'wegabschnitt', properties: {},
		geometry: {
		    type: 'MultiPolygon',
		    coordinates: this.legs.flatMap((leg) => checkPoints(leg.coordinates)).map(checkBox),
		},
	    }]},
	};

	this.status.textContent = 'Lade Parzellen …';
	const coordinates = this.sectionCoordinates;
	const sectionExtent = boundingExtent(coordinates.map((c) => fromLonLat(c)));
	const lat = coordinates[0][1];
	const extent = buffer(sectionExtent, SEARCH_RADIUS / Math.cos(lat * Math.PI / 180));
	const [entranceFeatures, plotFeatures] = await Promise.all([
	    this.loadTiles('parzelleneingaenge', extent, signal),
	    this.loadTiles('parzellengrenzen', extent, signal),
	]);

	// Kacheln überlappen: jeden Eingang einmal, auch wenn sich Parzellen ein Tor teilen
	const entrancesById = {};
	entranceFeatures.forEach((feature) => {
	    const id = feature.get('node_id');
	    const ref = feature.get('ref') || '';
	    if (entrancesById[id]) {
		if (!entrancesById[id].refs.includes(ref)) entrancesById[id].refs.push(ref);
		return;
	    }
	    const coordinate = getCenter(feature.getExtent());
	    const lonLat = toLonLat(coordinate);
	    entrancesById[id] = {
		id: id, refs: [ref], coordinate: coordinate, lonLat: lonLat,
		distance: Math.min(...coordinates.map((c) => distanceMeters(c, lonLat))),
		answer: null,
	    };
	});
	const entrances = Object.values(entrancesById)
	    .filter((entrance) => entrance.distance <= SEARCH_RADIUS)
	    .sort((a, b) => a.distance - b.distance);
	if (entrances.length === 0) {
	    this.status.textContent = 'Im Umkreis von ' + formatDistance(SEARCH_RADIUS) + ' gibt es keine Parzelleneingänge.';
	    return;
	}

	this.status.textContent = 'Suche Bezugspunkt …';
	const reference = await this.findReference(customModel, signal);
	if (!reference) {
	    this.status.textContent = 'Vom Abschnitt aus ist kein Bezugspunkt erreichbar, die Prüfung ist hier nicht möglich.';
	    return;
	}

	let tested = 0, reachableInARow = 0, stoppedEarly = false;
	while (tested < entrances.length) {
	    const batch = entrances.slice(tested, tested + PARALLEL_REQUESTS);
	    await Promise.all(batch.map(async (entrance) => {
		entrance.answer = await this.check(entrance.lonLat, reference, customModel, signal);
	    }));
	    tested += batch.length;
	    reachableInARow = batch.some((entrance) => entrance.answer === 'via') ? 0 : reachableInARow + batch.length;
	    this.status.textContent = 'Prüfe Eingänge: ' + tested + ' von ' + entrances.length + ' …';
	    if (reachableInARow >= STOP_AFTER_REACHABLE) {
		stoppedEarly = tested < entrances.length;
		break;
	    }
	}

	this.showResults(entrances, plotFeatures, tested, stoppedEarly);
    }

    showResults(entrances, plotFeatures, tested, stoppedEarly) {
	const plotsById = {};
	plotFeatures.forEach((feature) => {
	    const id = feature.get('way_id');
	    if (!plotsById[id]) {
		plotsById[id] = {id: id, ref: feature.get('ref') || '', extent: createEmpty(), entrances: []};
	    }
	    extend(plotsById[id].extent, feature.getExtent());
	});
	// Eingänge liegen auf der Parzellengrenze; Spielraum wegen der Kachelauflösung
	const plots = Object.values(plotsById);
	const withoutPlot = [];
	entrances.forEach((entrance) => {
	    const point = [...entrance.coordinate, ...entrance.coordinate];
	    entrance.refs.forEach((ref) => {
		const plot = plots.find((candidate) => candidate.ref === ref
		    && containsExtent(buffer(candidate.extent, 5), point));
		if (plot) plot.entrances.push(entrance); else withoutPlot.push({ref: ref, entrance: entrance});
	    });
	});

	// Eine Parzelle zählt, sobald einer ihrer Eingänge nur über den Abschnitt erreichbar ist;
	// hervorgehoben werden nur diese Eingänge
	const found = plots
	    .filter((plot) => plot.entrances.some((entrance) => entrance.answer === 'via'))
	    .map((plot) => ({ref: plot.ref, plotId: plot.id, entrances: plot.entrances.filter((e) => e.answer === 'via')}));
	withoutPlot.filter(({entrance}) => entrance.answer === 'via')
	    .forEach(({ref, entrance}) => found.push({ref: ref, plotId: null, entrances: [entrance]}));
	found.sort((a, b) => naturalCompare(a.ref, b.ref));

	this.onHighlight(
	    new Set(found.map((plot) => plot.plotId).filter((id) => id !== null)),
	    new Set(found.flatMap((plot) => plot.entrances.map((entrance) => entrance.id))),
	);

	this.exportRefs = found.map((plot) => plot.ref || '(ohne Nummer)');
	this.exportButton.hidden = found.length === 0;
	this.results.replaceChildren(...found.map((plot) => {
	    const item = document.createElement('li');
	    item.textContent = plot.ref || '(ohne Nummer)';
	    item.addEventListener('click', () => {
		this.getMap().getView().animate({center: plot.entrances[0].coordinate, duration: 300});
	    });
	    return item;
	}));

	const count = (answer) => entrances.filter((entrance) => entrance.answer === answer).length;
	const parts = [
	    found.length === 1 ? '1 Parzelle hat Eingänge, die nur über diesen Abschnitt erreichbar sind.'
		: found.length + ' Parzellen haben Eingänge, die nur über diesen Abschnitt erreichbar sind.',
	    tested + ' Eingänge geprüft.',
	];
	if (count('none')) parts.push(count('none') + ' Eingänge haben auch sonst keine Verbindung.');
	if (count('unknown')) parts.push(count('unknown') + ' Eingänge konnten nicht geprüft werden.');
	if (stoppedEarly) {
	    parts.push('Die entfernteren ' + (entrances.length - tested) + ' Eingänge wurden nicht mehr geprüft, weil die letzten '
		       + STOP_AFTER_REACHABLE + ' alle anders erreichbar waren.');
	}
	if (entrances.some((entrance) => entrance.answer === 'via' && entrance.distance > SEARCH_RADIUS * 0.8)) {
	    parts.push('Treffer reichen fast bis an den Suchradius von ' + formatDistance(SEARCH_RADIUS) + '; weiter draußen kann es weitere geben.');
	}
	this.status.textContent = parts.join(' ');
    }
}

export function addWayCut(map, options = {}) {
    const panel = new WayCutPanel(options);

    const button = document.createElement('button');
    button.type = 'button';
    button.title = 'Wegabschnitt prüfen: Welche Parzellen sind nur darüber erreichbar?';
    button.textContent = '✂';
    button.addEventListener('click', () => panel.toggle());
    const buttonElement = document.createElement('div');
    buttonElement.className = 'ol-control ol-unselectable waycut-button';
    buttonElement.appendChild(button);

    map.addControl(new Control({element: buttonElement}));
    map.addControl(panel);
    return panel;
}
