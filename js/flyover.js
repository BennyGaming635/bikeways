/**
 * flyover.js – Canvas-based route flyover animation + WebM recording
 *
 * The animation draws:
 *  • A top-down stylised "map" of the route (full path + travelled segment)
 *  • A bike emoji that glides along the route
 *  • Waypoint markers at each stop
 *  • A HUD bar at the bottom (name, distance, progress)
 *  • A mini elevation profile (if elevation data is available)
 *
 * Recording is done via HTMLCanvasElement.captureStream() + MediaRecorder.
 */
const Flyover = (() => {
  /* ── State ── */
  let canvas = null, ctx = null;
  let coords  = [];          // [{lat, lon, ele?}] – full route points
  let waypts  = [];          // [{lat, lng, name}]
  let bounds  = {};
  let totalDist = 0;
  let animId  = null;
  let frame   = 0;
  let running = false;
  const FPS          = 30;
  const DURATION_S   = 20;     // animation length in seconds
  const TOTAL_FRAMES = FPS * DURATION_S;

  let mediaRecorder = null;
  let chunks        = [];
  let recording     = false;

  /* ── Polyfill roundRect for older browsers ── */
  function roundRect(cx, x, y, w, h, r) {
    if (cx.roundRect) {
      cx.roundRect(x, y, w, h, r);
    } else {
      const rr = Math.min(r, w / 2, h / 2);
      cx.moveTo(x + rr, y);
      cx.lineTo(x + w - rr, y);
      cx.arcTo(x + w, y, x + w, y + rr, rr);
      cx.lineTo(x + w, y + h - rr);
      cx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
      cx.lineTo(x + rr, y + h);
      cx.arcTo(x, y + h, x, y + h - rr, rr);
      cx.lineTo(x, y + rr);
      cx.arcTo(x, y, x + rr, y, rr);
      cx.closePath();
    }
  }

  /* ── Helpers ── */
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

  function computeDistance(pts) {
    let d = 0;
    for (let i = 1; i < pts.length; i++) d += haversine(pts[i - 1], pts[i]);
    return d;
  }

  /** Convert a lat/lon to canvas pixel coordinates */
  function toXY(lat, lon) {
    const PAD = 70;
    const W   = canvas.width  - PAD * 2;
    const H   = canvas.height - PAD * 2 - 80; // leave 80px for HUD
    const latRange = bounds.maxLat - bounds.minLat || 0.001;
    const lonRange = bounds.maxLon - bounds.minLon || 0.001;
    // Aspect-correct
    const scaleX = W / lonRange;
    const scaleY = H / latRange;
    const scale  = Math.min(scaleX, scaleY);
    const offX   = PAD + (W - lonRange * scale) / 2;
    const offY   = PAD + (H - latRange * scale) / 2;
    return {
      x: offX + (lon - bounds.minLon) * scale,
      y: offY + (bounds.maxLat - lat) * scale
    };
  }

  /* ── Prepare ── */
  function prepare() {
    // Pull route coords from APP
    if (APP.routeData) {
      coords = APP.routeData.geometry.coordinates.map(c => ({ lon: c[0], lat: c[1] }));
    } else {
      coords = APP.waypoints.map(w => ({ lat: w.lat, lon: w.lng }));
    }

    // Attach elevation data if present (from GPX import)
    if (APP._elevationData && APP._elevationData.length === coords.length) {
      APP._elevationData.forEach((e, i) => { coords[i].ele = e; });
    }

    waypts = APP.waypoints.map(w => ({ lat: w.lat, lon: w.lng, name: w.name || '' }));

    const lats = coords.map(c => c.lat);
    const lons = coords.map(c => c.lon);
    bounds = {
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
      minLon: Math.min(...lons),
      maxLon: Math.max(...lons)
    };
    totalDist = computeDistance(coords);
  }

  /* ── Draw a single frame ── */
  function drawFrame(f) {
    if (!canvas || !ctx) return;
    const W = canvas.width, H = canvas.height;
    const progress = Math.min(f / TOTAL_FRAMES, 1);
    const travelledIdx = Math.floor(progress * (coords.length - 1));

    /* Background – dark map-style gradient */
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0a1628');
    bg.addColorStop(1, '#0f2040');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    /* Subtle grid */
    ctx.strokeStyle = 'rgba(79,195,247,0.06)';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 50) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H - 80); ctx.stroke();
    }
    for (let y = 0; y < H - 80; y += 50) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    /* Full route (dim) */
    if (coords.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(79,195,247,0.25)';
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.lineCap  = 'round';
      const s = toXY(coords[0].lat, coords[0].lon);
      ctx.moveTo(s.x, s.y);
      for (let i = 1; i < coords.length; i++) {
        const p = toXY(coords[i].lat, coords[i].lon);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }

    /* Travelled segment (bright) */
    if (travelledIdx > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 5;
      ctx.shadowColor = '#00e5ff';
      ctx.shadowBlur  = 12;
      ctx.lineJoin = 'round';
      ctx.lineCap  = 'round';
      const s = toXY(coords[0].lat, coords[0].lon);
      ctx.moveTo(s.x, s.y);
      for (let i = 1; i <= travelledIdx; i++) {
        const p = toXY(coords[i].lat, coords[i].lon);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      ctx.restore();
    }

    /* Waypoint markers */
    waypts.forEach((wp, i) => {
      const p = toXY(wp.lat, wp.lon);
      const isStart = i === 0;
      const isEnd   = i === waypts.length - 1;
      ctx.save();
      const colour = isStart ? '#4caf50' : isEnd ? '#ef5350' : '#2196f3';
      ctx.shadowColor = colour;
      ctx.shadowBlur  = 10;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.fillStyle   = colour;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth   = 2;
      ctx.stroke();
      ctx.restore();

      if (wp.name) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font      = 'bold 12px sans-serif';
        ctx.fillText(wp.name, p.x + 12, p.y + 4);
      }
    });

    /* Current position – bike emoji */
    const posIdx = Math.min(travelledIdx, coords.length - 1);
    const pos = toXY(coords[posIdx].lat, coords[posIdx].lon);
    ctx.font = '28px serif';
    ctx.fillText('🚴', pos.x - 14, pos.y + 8);

    /* Pulse ring around bike */
    const pulse = (Math.sin(f * 0.15) + 1) * 0.5; // 0..1
    ctx.save();
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 18 + pulse * 6, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(0,229,255,${0.5 - pulse * 0.4})`;
    ctx.lineWidth   = 2;
    ctx.stroke();
    ctx.restore();

    /* Elevation mini-profile */
    const eleCoords = coords.filter(c => c.ele != null);
    if (eleCoords.length > 5) {
      drawElevationProfile(travelledIdx, eleCoords);
    }

    /* HUD bottom bar */
    const distTravelled = totalDist * progress;
    drawHUD(progress, distTravelled);
  }

  function drawElevationProfile(travelledIdx, eleCoords) {
    const W = canvas.width, H = canvas.height;
    const PH = 60, PW = Math.floor(W * 0.35);
    const PX = W - PW - 20, PY = H - 80 - PH - 10;

    const eles = eleCoords.map(c => c.ele);
    const minE = Math.min(...eles), maxE = Math.max(...eles);
    const range = maxE - minE || 1;

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    roundRect(ctx, PX - 4, PY - 4, PW + 8, PH + 8, 6);
    ctx.fill();

    ctx.beginPath();
    eleCoords.forEach((c, i) => {
      const x = PX + (i / (eleCoords.length - 1)) * PW;
      const y = PY + PH - ((c.ele - minE) / range) * PH;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.lineTo(PX + PW, PY + PH);
    ctx.lineTo(PX,      PY + PH);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, PY, 0, PY + PH);
    grad.addColorStop(0, 'rgba(76,175,80,0.7)');
    grad.addColorStop(1, 'rgba(76,175,80,0.1)');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = '#4caf50';
    ctx.lineWidth = 2;
    ctx.beginPath();
    eleCoords.forEach((c, i) => {
      const x = PX + (i / (eleCoords.length - 1)) * PW;
      const y = PY + PH - ((c.ele - minE) / range) * PH;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '10px sans-serif';
    ctx.fillText('Elevation', PX, PY - 6);
  }

  function drawHUD(progress, distMetres) {
    const W = canvas.width, H = canvas.height;

    // Bar background
    ctx.fillStyle = 'rgba(10,22,40,0.9)';
    ctx.fillRect(0, H - 80, W, 80);
    ctx.strokeStyle = 'rgba(79,195,247,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, H - 80); ctx.lineTo(W, H - 80); ctx.stroke();

    // Logo / title
    ctx.fillStyle = '#4fc3f7';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText('🚴 Bikeways', 18, H - 47);

    // Distance
    const distKm  = (distMetres / 1000).toFixed(2);
    const totalKm = (totalDist  / 1000).toFixed(2);
    ctx.fillStyle = '#e0e6f0';
    ctx.font = '15px sans-serif';
    ctx.fillText(`${distKm} / ${totalKm} km`, 18, H - 22);

    // Progress bar
    const BW = Math.floor(W * 0.4);
    const BX = Math.floor((W - BW) / 2);
    const BY = H - 52;
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath(); roundRect(ctx, BX, BY, BW, 10, 5); ctx.fill();
    ctx.fillStyle = '#00e5ff';
    ctx.beginPath(); roundRect(ctx, BX, BY, Math.max(BW * progress, 0), 10, 5); ctx.fill();

    ctx.fillStyle = '#e0e6f0';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(progress * 100)}%`, W / 2, H - 22);
    ctx.textAlign = 'left';

    // Waypoint count
    ctx.fillStyle = '#8892a4';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${waypts.length} waypoints`, W - 18, H - 22);
    ctx.textAlign = 'left';
  }

  /* ── Animation loop ── */
  function animate() {
    if (!running) return;
    drawFrame(frame);
    frame++;
    if (frame > TOTAL_FRAMES) {
      if (recording) {
        _stopRecording();
        return;
      } else {
        frame = 0; // loop preview
      }
    }
    animId = requestAnimationFrame(animate);
  }

  /* ── Internal stop (called at end of recording) ── */
  function _stopRecording() {
    running = false;
    recording = false;
    animId = null;
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    _setRecordingUI(false);
    setStatus('⏳ Processing video…');
  }

  function _setRecordingUI(isRecording) {
    const recBtn     = document.getElementById('flyover-record-btn');
    const prevBtn    = document.getElementById('flyover-preview-btn');
    const stopBtn    = document.getElementById('flyover-stop-btn');
    if (recBtn)  recBtn.disabled  = isRecording;
    if (prevBtn) prevBtn.disabled = isRecording;
    if (stopBtn) stopBtn.disabled = !isRecording;
  }

  function setStatus(msg) {
    const el = document.getElementById('flyover-status');
    if (el) el.textContent = msg;
  }

  /* ── Preview (no recording) ── */
  function preview() {
    stop();
    prepare();
    frame   = 0;
    running = true;
    animId  = requestAnimationFrame(animate);
    setStatus('Previewing…');
  }

  /* ── Record ── */
  function startRecording() {
    stop();
    prepare();
    frame     = 0;
    chunks    = [];
    recording = true;
    running   = true;

    const stream   = canvas.captureStream(FPS);
    const mimeType = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm'
    ].find(t => {
      try { return MediaRecorder.isTypeSupported(t); } catch (_e) { return false; }
    }) || '';

    try {
      mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    } catch (e) {
      // mimeType not supported; fall back to browser default
      console.warn('MediaRecorder mimeType fallback:', e.message);
      mediaRecorder = new MediaRecorder(stream);
    }
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    mediaRecorder.onstop = downloadVideo;
    mediaRecorder.start(100);

    _setRecordingUI(true);
    setStatus('⏺ Recording…');

    animId = requestAnimationFrame(animate);
  }

  /* ── Stop (public – also handles preview stop) ── */
  function stop() {
    running   = false;
    recording = false;
    if (animId !== null) { cancelAnimationFrame(animId); animId = null; }
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    _setRecordingUI(false);
  }

  function downloadVideo() {
    const type = (chunks[0] && chunks[0].type) ? chunks[0].type : 'video/webm';
    const blob  = new Blob(chunks, { type });
    const url   = URL.createObjectURL(blob);
    const a     = Object.assign(document.createElement('a'), {
      href: url, download: 'bikeways-flyover.webm'
    });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus('✅ Video downloaded!');
  }

  /* ── Show modal ── */
  function show() {
    if (!window.APP || APP.waypoints.length < 2) {
      alert('Please add at least two waypoints and calculate a route first.');
      return;
    }

    // Initialise canvas reference now that DOM is ready
    canvas = document.getElementById('flyover-canvas');
    ctx    = canvas.getContext('2d');

    prepare();
    Share.openModal('flyover-modal');

    // Draw a static first frame as a preview still
    drawFrame(0);
    setStatus('Click ▶ Preview to animate, or ⏺ Record video to export.');
  }

  function close() {
    stop();
    Share.closeModal('flyover-modal');
  }

  return { show, close, preview, startRecording, stop };
})();
