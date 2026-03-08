/**
 * gpx.js – GPX import / export
 *
 * Exports:
 *   GPX.generateGPX(name, waypointLatLngs, trackCoords) -> string
 *   GPX.exportRoute()
 *   GPX.parseGPX(xmlString) -> { waypoints, trackPoints }
 *   GPX.importFile(file)
 */
const GPX = (() => {
  /* ── Helpers ── */

  /** Haversine distance in metres between two {lat,lon} objects */
  function haversine(p1, p2) {
    const R = 6_371_000;
    const dLat = (p2.lat - p1.lat) * Math.PI / 180;
    const dLon = (p2.lon - p1.lon) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(p1.lat * Math.PI / 180) *
        Math.cos(p2.lat * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function totalDistance(points) {
    let d = 0;
    for (let i = 1; i < points.length; i++) d += haversine(points[i - 1], points[i]);
    return d;
  }

  function escapeXML(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ── Generate GPX ── */
  function generateGPX(name, waypointLatLngs, trackCoords) {
    const safeName = escapeXML(name || 'Bike Route');

    const rtePoints = waypointLatLngs
      .map(
        (w, i) =>
          `    <rtept lat="${w.lat.toFixed(7)}" lon="${w.lng.toFixed(7)}">\n` +
          `      <name>${escapeXML(w.name || `Waypoint ${i + 1}`)}</name>\n` +
          `    </rtept>`
      )
      .join('\n');

    const trkPoints = trackCoords
      .map(c => `      <trkpt lat="${c[1].toFixed(7)}" lon="${c[0].toFixed(7)}" />`)
      .join('\n');

    return (
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<gpx version="1.1" creator="Bikeways"\n` +
      `  xmlns="http://www.topografix.com/GPX/1/1"\n` +
      `  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n` +
      `  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">\n` +
      `  <metadata>\n` +
      `    <name>${safeName}</name>\n` +
      `    <time>${new Date().toISOString()}</time>\n` +
      `  </metadata>\n` +
      `  <rte>\n` +
      `    <name>${safeName}</name>\n` +
      `${rtePoints}\n` +
      `  </rte>\n` +
      `  <trk>\n` +
      `    <name>${safeName}</name>\n` +
      `    <trkseg>\n` +
      `${trkPoints}\n` +
      `    </trkseg>\n` +
      `  </trk>\n` +
      `</gpx>`
    );
  }

  /* ── Export ── */
  function exportRoute() {
    if (!window.APP || APP.waypoints.length === 0) {
      alert('Add at least one waypoint before exporting.');
      return;
    }

    const trackCoords = APP.routeData
      ? APP.routeData.geometry.coordinates
      : APP.waypoints.map(w => [w.lng, w.lat]);

    const xml = generateGPX('My Bike Route', APP.waypoints, trackCoords);
    const blob = new Blob([xml], { type: 'application/gpx+xml' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), {
      href: url, download: 'bikeways-route.gpx'
    });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /* ── Parse GPX ── */
  function parseGPX(xmlString) {
    const parser = new DOMParser();
    const doc    = parser.parseFromString(xmlString, 'application/xml');

    if (doc.querySelector('parsererror')) {
      throw new Error('Invalid GPX / XML file.');
    }

    const waypoints    = [];
    const trackPoints  = [];

    // Route points  (<rte><rtept>)
    doc.querySelectorAll('rte rtept').forEach(pt => {
      const lat = parseFloat(pt.getAttribute('lat'));
      const lon = parseFloat(pt.getAttribute('lon'));
      if (!isNaN(lat) && !isNaN(lon)) {
        waypoints.push({ lat, lon, name: pt.querySelector('name')?.textContent.trim() || '' });
      }
    });

    // Standalone waypoints (<wpt>)
    doc.querySelectorAll('wpt').forEach(pt => {
      const lat = parseFloat(pt.getAttribute('lat'));
      const lon = parseFloat(pt.getAttribute('lon'));
      if (!isNaN(lat) && !isNaN(lon)) {
        waypoints.push({ lat, lon, name: pt.querySelector('name')?.textContent.trim() || '' });
      }
    });

    // Track points (<trk><trkseg><trkpt>)
    doc.querySelectorAll('trk trkseg trkpt').forEach(pt => {
      const lat = parseFloat(pt.getAttribute('lat'));
      const lon = parseFloat(pt.getAttribute('lon'));
      if (!isNaN(lat) && !isNaN(lon)) {
        const ele = pt.querySelector('ele');
        trackPoints.push({
          lat, lon,
          ele: ele ? parseFloat(ele.textContent) : null
        });
      }
    });

    return { waypoints, trackPoints };
  }

  /* ── Import file ── */
  function importFile(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = e => {
      try {
        const { waypoints, trackPoints } = parseGPX(e.target.result);

        APP.clearAll();

        if (waypoints.length > 0) {
          waypoints.forEach(wp =>
            APP.addWaypoint(L.latLng(wp.lat, wp.lon), wp.name)
          );
        } else if (trackPoints.length >= 2) {
          // Use first and last track point as A → B
          APP.addWaypoint(
            L.latLng(trackPoints[0].lat, trackPoints[0].lon), 'Start'
          );
          APP.addWaypoint(
            L.latLng(trackPoints[trackPoints.length - 1].lat,
                      trackPoints[trackPoints.length - 1].lon), 'End'
          );
        }

        // If the GPX contains a full track, display it directly
        if (trackPoints.length > 1) {
          const latlngs = trackPoints.map(p => [p.lat, p.lon]);
          APP.drawTrackDirectly(latlngs, totalDistance(trackPoints));
        }

        // Fit map to content
        APP.fitMapToRoute();
      } catch (err) {
        alert('Failed to import GPX: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  return { generateGPX, exportRoute, parseGPX, importFile };
})();
