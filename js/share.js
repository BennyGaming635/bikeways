/**
 * share.js – URL-based route sharing
 *
 * Waypoints are encoded as a query-string parameter so anyone with the
 * link can open exactly the same route.
 *
 * Format:  ?waypoints=lat,lng,name,sl|lat,lng,name,sl|…
 *   – commas separate the four fields per waypoint
 *   – pipes  separate waypoints
 *   – names are URI-encoded to handle spaces / special chars
 *   – sl (straight-line flag) is 1 if the segment FROM this waypoint uses a
 *     straight line instead of bike routing; 0 or omitted otherwise
 */
const Share = (() => {
  /* ── Encode current route into the URL ── */
  function updateURL() {
    if (!window.APP) return;

    if (APP.waypoints.length === 0) {
      history.replaceState(null, '', window.location.pathname);
      return;
    }

    const encoded = APP.waypoints
      .map(w => {
        const name = encodeURIComponent(w.name || '');
        const sl   = w.straightLine ? '1' : '0';
        return `${w.lat.toFixed(6)},${w.lng.toFixed(6)},${name},${sl}`;
      })
      .join('|');

    const params = new URLSearchParams();
    params.set('waypoints', encoded);
    history.replaceState(null, '', `${window.location.pathname}?${params}`);
  }

  /* ── Decode waypoints from the URL on page load ── */
  function loadFromURL() {
    const params      = new URLSearchParams(window.location.search);
    const waypointsRaw = params.get('waypoints');
    if (!waypointsRaw) return;

    const parts = waypointsRaw.split('|');
    parts.forEach(part => {
      const segments = part.split(',');
      if (segments.length < 2) return;
      const lat  = parseFloat(segments[0]);
      const lng  = parseFloat(segments[1]);
      let name = '';
      if (segments[2]) {
        try { name = decodeURIComponent(segments[2]); }
        catch { name = ''; }
      }
      const straightLine = segments[3] === '1';
      if (!isNaN(lat) && !isNaN(lng)) {
        APP.addWaypoint(L.latLng(lat, lng), name || undefined, straightLine);
      }
    });

    if (APP.waypoints.length > 0) {
      APP.map.setView(APP.waypoints[0], 13);
    }
  }

  /* ── Show share modal ── */
  function showModal() {
    updateURL();
    document.getElementById('share-url-input').value = window.location.href;
    openModal('share-modal');
  }

  /* ── Copy URL to clipboard ── */
  function copyURL() {
    const input = document.getElementById('share-url-input');
    input.select();
    const btn = document.getElementById('copy-url-btn');

    navigator.clipboard.writeText(input.value)
      .then(() => flashBtn(btn))
      .catch(() => {
        // Fallback for older / non-https
        document.execCommand('copy');
        flashBtn(btn);
      });
  }

  function flashBtn(btn) {
    const orig = btn.textContent;
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.textContent = orig; }, 2000);
  }

  /* ── Modal helpers (shared with flyover) ── */
  function openModal(id) {
    document.getElementById('modal-overlay').classList.remove('hidden');
    document.getElementById(id).classList.remove('hidden');
  }

  function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
    // Hide overlay if no modal is visible
    const anyOpen = [...document.querySelectorAll('.modal:not(.hidden)')].length > 0;
    if (!anyOpen) document.getElementById('modal-overlay').classList.add('hidden');
  }

  return { updateURL, loadFromURL, showModal, copyURL, openModal, closeModal };
})();
