/**
 * app.js – Core application
 *
 * Features
 *  • Leaflet map with CyclOSM (bike-friendly) as default layer
 *  • Click-to-add waypoints + drag to reposition
 *  • Bike routing via OSRM cycling endpoint
 *  • Geocoding search via Nominatim
 *  • Integration with GPX, Share, and Flyover modules
 */

/* ── Module ── */
const APP = (() => {
  /* ── State ── */
  let map        = null;
  let markers    = [];   // L.Marker[] matching waypoints[]
  let routeLayer = null;
  let trackLayer = null; // for GPX-imported raw tracks

  /* Public state consumed by other modules */
  const waypoints = [];   // { lat, lng, name } (extended L.LatLng)
  let   routeData = null; // OSRM route object
  let   _elevationData = null; // array of elevations matching routeData coords

  /* ── Map init ── */
  function initMap() {
    map = L.map('map', { zoomControl: true }).setView([51.505, -0.09], 13);

    /* ─ Tile layers ─ */
    const cyclosm = L.tileLayer(
      'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
      {
        attribution:
          '© <a href="https://www.cyclosm.org/" target="_blank">CyclOSM</a> ' +
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 20
      }
    );

    const osm = L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
      }
    );

    cyclosm.addTo(map);

    L.control.layers(
      { '🚲 CyclOSM (recommended)': cyclosm, '🗺 Standard OSM': osm },
      {},
      { position: 'topright', collapsed: true }
    ).addTo(map);

    /* Routing spinner overlay inside map */
    const spinnerEl = document.createElement('div');
    spinnerEl.id = 'routing-spinner';
    spinnerEl.textContent = '⏳ Calculating bike route…';
    map.getContainer().appendChild(spinnerEl);

    /* Click to add waypoint */
    map.on('click', e => addWaypoint(e.latlng));
  }

  /* ── Waypoints ── */
  function addWaypoint(latlng, name, straightLine = false) {
    const index = waypoints.length;
    const wp    = L.latLng(latlng.lat, latlng.lng);
    wp.name        = name || (index === 0 ? 'Start' : `Stop ${index}`);
    wp.straightLine = !!straightLine; // per-segment straight-line flag
    waypoints.push(wp);

    const marker = L.marker(latlng, {
      draggable: true,
      title:     wp.name
    });

    marker.bindTooltip(wp.name, { permanent: false, direction: 'top' });

    marker.on('dragend', () => {
      const newLatLng  = marker.getLatLng();
      waypoints[index].lat = newLatLng.lat;
      waypoints[index].lng = newLatLng.lng;
      updateWaypointName(index, waypoints[index].name);
      renderWaypointsList();
      if (waypoints.length >= 2) calculateRoute();
    });

    marker.addTo(map);
    markers.push(marker);

    // Keep Start/Stop/End labels consistent after every add
    refreshWaypointLabels();

    renderWaypointsList();
    Share.updateURL();

    if (waypoints.length >= 2) calculateRoute();
  }

  function removeWaypoint(index) {
    map.removeLayer(markers[index]);
    waypoints.splice(index, 1);
    markers.splice(index, 1);
    refreshWaypointLabels();
    renderWaypointsList();
    Share.updateURL();

    if (waypoints.length >= 2) {
      calculateRoute();
    } else {
      clearRouteLayer();
      hideRouteInfo();
    }
  }

  /** Toggle straight-line (no routing) for the segment starting at this waypoint */
  function toggleStraightLine(index) {
    if (waypoints[index]) {
      waypoints[index].straightLine = !waypoints[index].straightLine;
      renderWaypointsList();
      if (waypoints.length >= 2) calculateRoute();
    }
  }

  function updateWaypointName(index, name) {
    if (waypoints[index]) {
      waypoints[index].name = name;
      markers[index]?.setTooltipContent(name);
    }
  }

  /** Rename waypoints Start / Stop N / End after any add/remove */
  function refreshWaypointLabels() {
    waypoints.forEach((wp, i) => {
      const label =
        i === 0                     ? 'Start' :
        i === waypoints.length - 1  ? 'End'   :
                                      `Stop ${i}`;  // Stop 1, Stop 2, …
      // Only auto-rename if it still has an auto-generated name (not user-provided via GPX)
      const auto = /^(Start|End|Stop \d+)$/.test(wp.name);
      if (auto || !wp.name) {
        wp.name = label;
        markers[i]?.setTooltipContent(label);
      }
    });
  }

  function renderWaypointsList() {
    const ul = document.getElementById('waypoints-list');
    ul.innerHTML = '';

    if (waypoints.length === 0) {
      const li = document.createElement('li');
      li.style.cssText = 'font-size:.8em;color:var(--text-muted);padding:6px 0';
      li.textContent = 'Click the map to add waypoints.';
      ul.appendChild(li);
      return;
    }

    waypoints.forEach((wp, i) => {
      const icon = i === 0 ? '🟢' : i === waypoints.length - 1 ? '🔴' : '🔵';
      const li = document.createElement('li');
      li.className = 'waypoint-item';

      // Straight-line toggle for every waypoint except the last (which has no outgoing segment)
      const isLast = i === waypoints.length - 1;
      const straightBtn = isLast ? '' : `
        <button class="wp-straight${wp.straightLine ? ' active' : ''}" data-idx="${i}"
          title="${wp.straightLine ? 'Segment: straight line (click to use bike route)' : 'Segment: bike route (click to use straight line)'}">
          ${wp.straightLine ? '📐' : '🚲'}
        </button>`;

      li.innerHTML = `
        <span class="wp-icon">${icon}</span>
        <div style="flex:1;min-width:0">
          <div class="wp-name">${sanitize(wp.name)}</div>
          <div class="wp-coords">${wp.lat.toFixed(5)}, ${wp.lng.toFixed(5)}</div>
        </div>
        ${straightBtn}
        <button class="wp-remove" data-idx="${i}" title="Remove">✕</button>
      `;
      ul.appendChild(li);
    });

    ul.querySelectorAll('.wp-straight').forEach(btn => {
      btn.addEventListener('click', () => toggleStraightLine(+btn.dataset.idx));
    });

    ul.querySelectorAll('.wp-remove').forEach(btn => {
      btn.addEventListener('click', () => removeWaypoint(+btn.dataset.idx));
    });
  }

  /* ── Routing ── */

  /** Estimate cycling duration (seconds) from a straight-line distance (metres). */
  const AVG_CYCLING_MS = 15000 / 3600; // 15 km/h in m/s

  async function calculateRoute() {
    if (waypoints.length < 2) return;
    clearRouteLayer();
    showSpinner(true);

    let totalDistance = 0;
    let totalDuration = 0;
    const allGeoCoords = []; // [lng, lat] pairs for synthesised routeData
    const segmentGroup = L.featureGroup();
    let hasAutoFallback = false;

    /** Append straight-line coordinates, deduplicating the shared endpoint */
    function pushStraightCoords(fromWp, toWp) {
      if (allGeoCoords.length === 0) allGeoCoords.push([fromWp.lng, fromWp.lat]);
      allGeoCoords.push([toWp.lng, toWp.lat]);
    }

    try {
      for (let i = 0; i < waypoints.length - 1; i++) {
        const from      = waypoints[i];
        const to        = waypoints[i + 1];
        const fromLatLng = L.latLng(from.lat, from.lng);
        const toLatLng   = L.latLng(to.lat,   to.lng);
        const dist       = fromLatLng.distanceTo(toLatLng);

        if (from.straightLine) {
          /* ── User-requested straight line for this segment ── */
          totalDistance += dist;
          totalDuration += dist / AVG_CYCLING_MS;
          L.polyline([[from.lat, from.lng], [to.lat, to.lng]], {
            color: '#ff9800', weight: 4, dashArray: '8,6', opacity: 0.75
          }).addTo(segmentGroup);
          pushStraightCoords(from, to);
        } else {
          /* ── Try OSRM cycling routing for this segment ── */
          try {
            const coords = `${from.lng.toFixed(6)},${from.lat.toFixed(6)};` +
                           `${to.lng.toFixed(6)},${to.lat.toFixed(6)}`;
            const url = `https://router.project-osrm.org/route/v1/cycling/${coords}` +
                        `?geometries=geojson&overview=full&steps=false`;

            const res  = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (!data.routes?.length) throw new Error('No route found');

            const route = data.routes[0];
            totalDistance += route.distance;
            totalDuration += route.duration;

            L.geoJSON(route.geometry, {
              style: { color: '#00bcd4', weight: 6, opacity: 0.85 }
            }).addTo(segmentGroup);

            // Append coordinates (skip first point on subsequent segments to avoid duplicates)
            const segCoords = route.geometry.coordinates;
            const start     = allGeoCoords.length === 0 ? 0 : 1;
            segCoords.slice(start).forEach(c => allGeoCoords.push(c));
          } catch (err) {
            /* Auto-fallback: route unavailable – draw straight line */
            console.warn(`Routing error for segment ${i}→${i + 1}:`, err);
            hasAutoFallback = true;
            totalDistance += dist;
            totalDuration += dist / AVG_CYCLING_MS;
            L.polyline([[from.lat, from.lng], [to.lat, to.lng]], {
              color: '#ff9800', weight: 4, dashArray: '8,6', opacity: 0.75
            }).addTo(segmentGroup);
            pushStraightCoords(from, to);
          }
        }
      }

      routeLayer = segmentGroup;
      segmentGroup.addTo(map);

      routeData = {
        geometry: { coordinates: allGeoCoords },
        distance: totalDistance,
        duration: totalDuration
      };
      _elevationData = null;

      showRouteInfo(totalDistance, totalDuration);

      if (hasAutoFallback) {
        showStatus('⚠ Some segments unavailable – showing straight lines.');
      }

      Share.updateURL();
    } finally {
      showSpinner(false);
    }
  }

  function clearRouteLayer() {
    if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
    routeData = null;
  }

  /* ── GPX track direct draw (imported tracks) ── */
  function drawTrackDirectly(latlngs, distMetres) {
    if (trackLayer) { map.removeLayer(trackLayer); trackLayer = null; }
    trackLayer = L.polyline(latlngs, {
      color: '#00bcd4', weight: 6, opacity: 0.85
    }).addTo(map);

    // Synthesise routeData so flyover / export can use the full geometry
    routeData = {
      geometry: { coordinates: latlngs.map(ll => [ll[1], ll[0]]) },
      distance: distMetres,
      duration: 0
    };
    showRouteInfo(distMetres, 0);
  }

  function fitMapToRoute() {
    const layers = [];
    if (routeLayer)  layers.push(routeLayer);
    if (trackLayer)  layers.push(trackLayer);
    markers.forEach(m => layers.push(m));
    if (layers.length === 0) return;
    const group = L.featureGroup(layers);
    map.fitBounds(group.getBounds().pad(0.15));
  }

  /* ── Clear all ── */
  function clearAll() {
    markers.forEach(m => map.removeLayer(m));
    markers.length    = 0;
    waypoints.length  = 0;
    routeData         = null;
    _elevationData    = null;
    clearRouteLayer();
    if (trackLayer) { map.removeLayer(trackLayer); trackLayer = null; }
    renderWaypointsList();
    hideRouteInfo();
    Share.updateURL();
  }

  /* ── UI helpers ── */
  function showRouteInfo(distMetres, durationSecs) {
    const distKm = (distMetres / 1000).toFixed(1);
    document.getElementById('info-distance').textContent = `${distKm} km`;

    if (durationSecs > 0) {
      const mins = Math.round(durationSecs / 60);
      document.getElementById('info-duration').textContent =
        mins >= 60
          ? `${Math.floor(mins / 60)}h ${mins % 60}m`
          : `${mins} min`;
    } else {
      document.getElementById('info-duration').textContent = '—';
    }

    document.getElementById('route-info').style.display = 'block';
  }

  function hideRouteInfo() {
    document.getElementById('route-info').style.display = 'none';
  }

  function showSpinner(on) {
    document.getElementById('routing-spinner').style.display = on ? 'block' : 'none';
  }

  function showStatus(msg) {
    const el = document.getElementById('routing-spinner');
    el.textContent = msg;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; el.textContent = '⏳ Calculating bike route…'; }, 3500);
  }

  function sanitize(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  /* ── Geocoding / Search ── */
  async function search(query) {
    if (!query.trim()) return;
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5`;
    try {
      const res  = await fetch(url, { headers: { 'Accept-Language': 'en' } });
      const data = await res.json();
      renderSearchResults(data);
    } catch (err) {
      console.warn('Geocoding error:', err);
    }
  }

  function renderSearchResults(results) {
    const ul = document.getElementById('search-results');
    ul.innerHTML = '';
    if (!results.length) {
      const li = document.createElement('li');
      li.textContent = 'No results found.';
      li.style.color = 'var(--text-muted)';
      ul.appendChild(li);
      return;
    }
    results.forEach(r => {
      const li = document.createElement('li');
      li.textContent = r.display_name;
      li.addEventListener('click', () => {
        const latlng = L.latLng(parseFloat(r.lat), parseFloat(r.lon));
        map.setView(latlng, 15);
        ul.innerHTML = '';
        document.getElementById('search-input').value = r.display_name.split(',')[0];
      });
      ul.appendChild(li);
    });
  }

  /* ── Event wiring ── */
  function initEvents() {
    /* Search */
    const searchInput = document.getElementById('search-input');
    const searchBtn   = document.getElementById('search-btn');
    searchBtn.addEventListener('click', () => search(searchInput.value));
    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') search(searchInput.value);
    });

    /* Clear */
    document.getElementById('clear-btn').addEventListener('click', clearAll);

    /* Share */
    document.getElementById('share-btn').addEventListener('click', Share.showModal);
    document.getElementById('copy-url-btn').addEventListener('click', Share.copyURL);

    /* GPX */
    document.getElementById('export-gpx-btn').addEventListener('click', GPX.exportRoute);
    document.getElementById('import-gpx-btn').addEventListener('click', () =>
      document.getElementById('gpx-file-input').click()
    );
    document.getElementById('gpx-file-input').addEventListener('change', e => {
      GPX.importFile(e.target.files[0]);
      e.target.value = ''; // allow re-importing same file
    });

    /* Flyover */
    document.getElementById('flyover-btn').addEventListener('click', Flyover.show);
    document.getElementById('flyover-preview-btn').addEventListener('click', Flyover.preview);
    document.getElementById('flyover-record-btn').addEventListener('click', Flyover.startRecording);
    document.getElementById('flyover-stop-btn').addEventListener('click', Flyover.stop);

    /* Modal close buttons */
    document.querySelectorAll('.modal-close').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.modal;
        if (target === 'flyover-modal') { Flyover.close(); }
        else                            { Share.closeModal(target); }
      });
    });

    /* Close modal on overlay click */
    document.getElementById('modal-overlay').addEventListener('click', e => {
      if (e.target === e.currentTarget) {
        Flyover.close();
        Share.closeModal('share-modal');
      }
    });
  }

  /* ── Boot ── */
  function init() {
    initMap();
    initEvents();
    renderWaypointsList();

    // Size the flyover canvas to 16:9
    const flyCanvas = document.getElementById('flyover-canvas');
    flyCanvas.width  = 1280;
    flyCanvas.height = 720;
    flyCanvas.style.aspectRatio = '16/9';

    // Load any shared route from the URL
    Share.loadFromURL();
  }

  document.addEventListener('DOMContentLoaded', init);

  /* ── Public API (used by other modules) ── */
  return {
    get map()           { return map; },
    get waypoints()     { return waypoints; },
    get routeData()     { return routeData; },
    get _elevationData(){ return _elevationData; },
    addWaypoint,
    removeWaypoint,
    toggleStraightLine,
    clearAll,
    drawTrackDirectly,
    fitMapToRoute
  };
})();
