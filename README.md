# 🚴 Bikeways – Bike Route Planner

A fully **static** bike-ride planning web-app designed for **GitHub Pages**.  
No server, no sign-up. Just plan, share, and ride.

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🗺 **Bike-friendly map** | CyclOSM layer highlights cycle paths, bike lanes, and dedicated bikeways |
| 📍 **Multi-waypoint routing** | Click the map to add as many stops as you like |
| 🔍 **Location search** | Geocoding via OpenStreetMap Nominatim |
| 🚲 **Cycle routing** | Routes prefer cycle tracks and bike lanes via the [OSRM](https://project-osrm.org/) cycling profile |
| 📤 **Share via link** | Waypoints are encoded in the URL so you can share the exact route with a link |
| 💾 **GPX export** | Download your route (waypoints + full track) as a `.gpx` file |
| 📂 **GPX import** | Open any `.gpx` file to display and re-route from it |
| 🎬 **Flyover video** | Animated canvas flyover of the route, recorded as a WebM video |

## 🚀 Live Demo

Hosted via **GitHub Pages** – open `index.html` directly in any modern browser or visit:  
`https://<your-username>.github.io/bikeways/`

## 🛠 Usage

1. **Search** for a location or pan the map to your area  
2. **Click the map** to add waypoints (start → stops → end)  
3. The app automatically calculates a **cycling-optimised route** between them  
4. **Drag** any marker to adjust the route  
5. **Share** → copy the link – anyone can open the same route  
6. **Export GPX** to use the route in Garmin, Wahoo, Komoot, etc.  
7. **Import GPX** to display and work with an existing route  
8. **Create flyover video** → preview or record a 20-second animated flyover as `.webm`

## 🏗 Technical stack

- [Leaflet.js](https://leafletjs.com/) – interactive map  
- [CyclOSM](https://www.cyclosm.org/) – bike-friendly tile layer  
- [OSRM](https://project-osrm.org/) cycling profile – free, no API key needed  
- [OpenStreetMap Nominatim](https://nominatim.openstreetmap.org/) – geocoding  
- Canvas API + MediaRecorder API – flyover video generation  
- Pure static HTML / CSS / JS – works on GitHub Pages with zero build step

## 📂 Project layout

```
bikeways/
├── index.html          # Main page
├── css/
│   └── style.css       # Dark sidebar + responsive layout
└── js/
    ├── app.js          # Core: map, waypoints, routing, search
    ├── gpx.js          # GPX import & export
    ├── share.js        # URL-based sharing
    └── flyover.js      # Canvas animation + video recording
```

## 📝 Notes

- Routing uses the OSRM public demo server – suitable for light use. For heavy traffic, run your own OSRM instance or swap in GraphHopper / OpenRouteService.  
- Flyover videos are saved as **WebM** (supported in Chrome, Firefox, Edge). Convert to MP4 with [FFmpeg](https://ffmpeg.org/) if needed.
