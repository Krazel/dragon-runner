(function(){
  const CLOSE_THRESHOLD_M = 20; // distance to start point to close a loop
  const MIN_LOOP_POINTS = 15;

  let running = false;
  let path = []; // [lng, lat]
  let loops = 0;
  let points = 0; // Sistema de puntos
  let watchId = null;
  let accText = 'inactivo';
  
  // Speed tracking
  let lastPosition = null;
  let lastPositionTime = null;
  let currentSpeed = 0;
  
  // Navigation variables
  let currentPosition = null;
  let destination = null;
  let routeLayer = null;
  let destinationMarker = null;
  let routeType = 'road'; // 'straight' or 'road'
  let roadRouteData = null;

  //  // Try to start GPS for marker even if not running
  async function initializeGeolocation() {
    if(!('geolocation' in navigator)) {
      gpsEl.textContent = 'GPS: No disponible';
      showToast('Este dispositivo no soporta geolocalización');
      return;
    }
    
    // Check if we already have permission
    const hasPermission = localStorage.getItem('dragon_gps_permission') === 'granted';
    
    if(hasPermission) {
      startGPSWatch();
    } else {
      // Try to get permission with user interaction
      try {
        gpsEl.textContent = 'GPS: Solicitando permiso...';
        
        const position = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 60000
          });
        });
        
        // If we get here, permission was granted
        localStorage.setItem('dragon_gps_permission', 'granted');
        showToast('¡Ubicación activada!');
        startGPSWatch();
        
        // Process the initial position
        onPos(position);
        
      } catch(error) {
        handleGeoError(error);
      }
    }
  }
  
  function startGPSWatch() {
    if(watchId) return; // Already watching
    
    watchId = navigator.geolocation.watchPosition(onPos, handleGeoError, { 
      enableHighAccuracy: true, 
      maximumAge: 1000, 
      timeout: 15000 
    });
  }
  
  function handleGeoError(error) {
    console.warn('GPS error:', error);
    
    switch(error.code) {
      case 1: // PERMISSION_DENIED
        localStorage.setItem('dragon_gps_permission', 'denied');
        gpsEl.textContent = 'GPS: Permiso denegado';
        showToast('Activa la ubicación en la configuración del navegador y recarga la página');
        break;
      case 2: // POSITION_UNAVAILABLE
        gpsEl.textContent = 'GPS: No disponible';
        showToast('Señal GPS no disponible. Intenta en exteriores.');
        break;
      case 3: // TIMEOUT
        gpsEl.textContent = 'GPS: Sin señal';
        showToast('Timeout GPS. Verificando señal...');
        // Retry after a delay
        setTimeout(() => {
          if(navigator.geolocation) {
            startGPSWatch();
          }
        }, 5000);
        break;
      default:
        gpsEl.textContent = 'GPS: Error';
        showToast('Error GPS: ' + error.message);
    }
  }
  
  initializeGeolocation();

  // Restore stored territory
  const stored = localStorage.getItem('territory_fc');
  let territory = stored ? JSON.parse(stored) : { type: 'FeatureCollection', features: [] };

  // UI
  const $ = (s)=>document.querySelector(s);
  const statusEl = $('#status');
  const pointsEl = $('#points');
  const loopsEl = $('#loops');
  const gpsEl = $('#gps');
  const speedEl = $('#speed');
  
  // Navigation UI
  const searchInput = $('#searchInput');
  const searchResults = $('#searchResults');
  const routeInfo = $('#routeInfo');
  const routeDistance = $('#routeDistance');
  const routeBearing = $('#routeBearing');

  // Map
  const map = L.map('map', { zoomControl: true });
  const tileUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  L.tileLayer(tileUrl, { attribution: '&copy; OpenStreetMap' }).addTo(map);
  map.setView([40.4168, -3.7038], 15);

  const pathLayer = L.polyline([], { color:'#4dabf7', weight:4 }).addTo(map);
  const territoryLayer = L.geoJSON(territory, { style: { color:'#4dabf7', weight:2, fillOpacity:0.25 } }).addTo(map);
  const hereMarker = L.circleMarker([40.4168, -3.7038], { radius:6, color:'#51cf66', fillColor:'#51cf66', fillOpacity:1 }).addTo(map);

  function saveTerritory(){
    localStorage.setItem('territory_fc', JSON.stringify(territory));
    localStorage.setItem('dragon_points', points.toString());
    localStorage.setItem('dragon_loops', loops.toString());
  }

  function loadProgress(){
    const savedPoints = localStorage.getItem('dragon_points');
    const savedLoops = localStorage.getItem('dragon_loops');
    
    if(savedPoints) {
      points = parseInt(savedPoints) || 0;
      pointsEl.textContent = 'Puntos: ' + points;
    }
    if(savedLoops) {
      loops = parseInt(savedLoops) || 0;
      loopsEl.textContent = 'Bucles: ' + loops;
    }
  }

  function calculateTerritoryPoints(polygon) {
    // Calcular el área del polígono en metros cuadrados
    const area = turf.area(polygon);
    
    // Sistema de puntos basado en área:
    // - 10 puntos base por completar un bucle
    // - 1 punto por cada 100m² de territorio
    // - Bonificación por territorios grandes
    let territoryPoints = 10; // Base
    territoryPoints += Math.floor(area / 100); // Área
    
    // Bonificación por territorios grandes
    if(area > 5000) territoryPoints += 20; // Territorio medio
    if(area > 10000) territoryPoints += 50; // Territorio grande
    if(area > 25000) territoryPoints += 100; // Territorio épico
    
    return {
      points: territoryPoints,
      area: area
    };
  }

  function formatArea(area) {
    if(area < 10000) {
      return Math.round(area) + ' m²';
    }
    return (area / 10000).toFixed(2) + ' ha';
  }

  function setRunning(v){
    running = v;
    statusEl.textContent = running ? 'Grabando' : 'Parado';
  }

  function resetPath(){
    path = [];
    pathLayer.setLatLngs([]);
    pointsEl.textContent = 'Puntos: 0';
  }

  function updateGPSAcc(acc){
    accText = `OK (${Math.round(acc)}m)`;
    gpsEl.textContent = 'GPS: ' + accText;
  }

  function calculateSpeed(lat, lng, timestamp) {
    if (!lastPosition || !lastPositionTime) {
      lastPosition = { lat, lng };
      lastPositionTime = timestamp;
      return 0;
    }

    const timeDiff = (timestamp - lastPositionTime) / 1000; // seconds
    if (timeDiff < 1) return currentSpeed; // Don't update too frequently

    const distance = calculateDistance(lastPosition.lat, lastPosition.lng, lat, lng);
    const speed = (distance / timeDiff) * 3.6; // Convert m/s to km/h

    // Smooth the speed to avoid jumpy readings
    currentSpeed = currentSpeed * 0.7 + speed * 0.3;

    lastPosition = { lat, lng };
    lastPositionTime = timestamp;

    return currentSpeed;
  }

  function updateSpeedDisplay(speed) {
    let displaySpeed = Math.round(speed * 10) / 10; // One decimal place
    let color = 'var(--fg)';

    // Color coding based on speed
    if (speed > 20) color = 'var(--bad)';      // Fast (red)
    else if (speed > 5) color = 'var(--warn)'; // Medium (yellow)
    else if (speed > 1) color = 'var(--good)'; // Slow (green)

    speedEl.textContent = displaySpeed + ' km/h';
    speedEl.style.color = color;
  }

  // Navigation functions
  function showToast(msg) {
    // Simple toast notification
    const existingToast = document.querySelector('.toast-msg');
    if (existingToast) existingToast.remove();
    
    const toast = document.createElement('div');
    toast.className = 'toast-msg';
    toast.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:rgba(20,25,37,0.9);color:var(--fg);padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.08);z-index:2000;backdrop-filter:blur(10px);font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
  }

  async function geocodeSearch(query) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=8&addressdetails=1&q=${encodeURIComponent(query)}`;
    try {
      const res = await fetch(url, { headers: { 'Accept-Language': 'es' } });
      if (!res.ok) return [];
      const arr = await res.json();
      return (arr || []).map(x => ({
        lat: parseFloat(x.lat),
        lng: parseFloat(x.lon),
        name: x.display_name
      }));
    } catch (e) {
      console.error('Geocoding error:', e);
      return [];
    }
  }

  function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  function calculateBearing(lat1, lng1, lat2, lng2) {
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δλ = (lng2 - lng1) * Math.PI / 180;
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  function formatDistance(meters) {
    if (meters < 1000) return Math.round(meters) + ' m';
    return (meters / 1000).toFixed(2) + ' km';
  }

  function formatBearing(degrees) {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(degrees / 45) % 8;
    return `${Math.round(degrees)}° (${directions[index]})`;
  }

  async function getRoadRoute(fromLat, fromLng, toLat, toLng) {
    // Using OSRM (Open Source Routing Machine) for free routing
    const url = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson`;
    
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Route service unavailable');
      
      const data = await response.json();
      if (data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        return {
          coordinates: route.geometry.coordinates,
          distance: route.distance, // in meters
          duration: route.duration  // in seconds
        };
      }
      return null;
    } catch (error) {
      console.error('Road route error:', error);
      showToast('Error obteniendo ruta por carretera');
      return null;
    }
  }

  function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }

  function setDestination(lat, lng, name) {
    destination = { lat, lng, name };
    
    // Remove existing destination marker
    if (destinationMarker) {
      map.removeLayer(destinationMarker);
    }
    
    // Add new destination marker
    destinationMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: 'destination-icon',
        html: '🎯',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
      })
    }).addTo(map);
    
    updateRouteInfo();
    showToast(`Destino: ${name}`);
  }

  function updateRouteInfo() {
    if (!currentPosition || !destination) {
      routeInfo.style.display = 'none';
      return;
    }
    
    if (routeType === 'straight') {
      updateStraightRoute();
    } else {
      updateRoadRoute();
    }
  }

  function updateStraightRoute() {
    const distance = calculateDistance(
      currentPosition.lat, currentPosition.lng,
      destination.lat, destination.lng
    );
    const bearing = calculateBearing(
      currentPosition.lat, currentPosition.lng,
      destination.lat, destination.lng
    );
    
    routeDistance.textContent = `Distancia: ${formatDistance(distance)}`;
    routeBearing.textContent = `Dirección: ${formatBearing(bearing)}`;
    routeInfo.style.display = 'block';
    
    // Draw straight route line
    if (routeLayer) {
      map.removeLayer(routeLayer);
    }
    routeLayer = L.polyline([
      [currentPosition.lat, currentPosition.lng],
      [destination.lat, destination.lng]
    ], { color: '#fab005', weight: 3, dashArray: '10, 10' }).addTo(map);
  }

  async function updateRoadRoute() {
    routeDistance.textContent = 'Calculando ruta...';
    routeBearing.textContent = 'Obteniendo direcciones...';
    routeInfo.style.display = 'block';
    
    const roadRoute = await getRoadRoute(
      currentPosition.lat, currentPosition.lng,
      destination.lat, destination.lng
    );
    
    if (roadRoute) {
      roadRouteData = roadRoute;
      routeDistance.textContent = `Distancia: ${formatDistance(roadRoute.distance)} (${formatDuration(roadRoute.duration)})`;
      
      // Calculate bearing to first waypoint
      const firstPoint = roadRoute.coordinates[1]; // Skip current position
      if (firstPoint) {
        const bearing = calculateBearing(
          currentPosition.lat, currentPosition.lng,
          firstPoint[1], firstPoint[0] // OSRM returns [lng, lat]
        );
        routeBearing.textContent = `Siguiente: ${formatBearing(bearing)}`;
      }
      
      // Draw road route
      if (routeLayer) {
        map.removeLayer(routeLayer);
      }
      
      // Convert OSRM coordinates [lng, lat] to Leaflet format [lat, lng]
      const leafletCoords = roadRoute.coordinates.map(coord => [coord[1], coord[0]]);
      routeLayer = L.polyline(leafletCoords, { 
        color: '#51cf66', 
        weight: 4, 
        opacity: 0.8 
      }).addTo(map);
      
    } else {
      // Fallback to straight route
      routeType = 'straight';
      document.getElementById('routeStraight').classList.add('active');
      document.getElementById('routeRoad').classList.remove('active');
      updateStraightRoute();
      showToast('Ruta por carretera no disponible, usando ruta recta');
    }
  }

  function clearRoute() {
    destination = null;
    roadRouteData = null;
    if (destinationMarker) {
      map.removeLayer(destinationMarker);
      destinationMarker = null;
    }
    if (routeLayer) {
      map.removeLayer(routeLayer);
      routeLayer = null;
    }
    routeInfo.style.display = 'none';
    searchInput.value = '';
    searchResults.innerHTML = '';
    // Reset to road route as default
    routeType = 'road';
    document.getElementById('routeRoad').classList.add('active');
    document.getElementById('routeStraight').classList.remove('active');
    showToast('Ruta eliminada');
  }

  function onPos(p){
    const lat = p.coords.latitude;
    const lng = p.coords.longitude;
    const timestamp = p.timestamp;
    
    currentPosition = { lat, lng };
    hereMarker.setLatLng([lat, lng]);
    updateGPSAcc(p.coords.accuracy);
    
    // Calculate and display speed
    const speed = calculateSpeed(lat, lng, timestamp);
    updateSpeedDisplay(speed);
    
    updateRouteInfo(); // Update navigation info

    if(!running) return;

    // push point if moved a bit (avoid spamming identical points)
    const last = path[path.length-1];
    if(!last || last[0] !== lng || last[1] !== lat){
      path.push([lng, lat]);
      pointsEl.textContent = 'Puntos: ' + path.length;
      pathLayer.setLatLngs(path.map(([LNG,LAT])=>[LAT,LNG]));
      map.panTo([lat,lng], { animate: true });
    }

    // closure detection
    if(path.length >= MIN_LOOP_POINTS){
      const start = path[0];
      const lastp = path[path.length-1];
      const d = turf.distance(turf.point(start), turf.point(lastp), { units: 'meters' });
      if(d < CLOSE_THRESHOLD_M){
        // Close polygon
        const coords = [...path, start];
        const poly = turf.polygon([coords]);
        
        // Calcular puntos por este territorio
        const territoryResult = calculateTerritoryPoints(poly);
        points += territoryResult.points;
        
        // Actualizar territorio y UI
        territory.features.push(poly);
        territoryLayer.clearLayers();
        territoryLayer.addData(territory);
        loops += 1;
        
        // Actualizar interfaz
        loopsEl.textContent = 'Bucles: ' + loops;
        pointsEl.textContent = 'Puntos: ' + points;
        
        // Mostrar resultado
        showToast(
          `¡Territorio capturado! +${territoryResult.points} puntos\n` +
          `Área: ${formatArea(territoryResult.area)}`
        );
        
        saveTerritory();
        resetPath(); // new segment
      }
    }
  }



  // Controls
  $('#start').addEventListener('click', ()=>{
    if(!('geolocation' in navigator)) return alert('Este dispositivo no tiene geolocalización');
    if(watchId==null){
      watchId = navigator.geolocation.watchPosition(onPos, onErr, { enableHighAccuracy:true, maximumAge:1000, timeout:10000 });
    }
    setRunning(true);
  });
  $('#pause').addEventListener('click', ()=>{
    setRunning(false);
  });
  $('#reset').addEventListener('click', ()=>{
    resetPath();
  });
  $('#clear').addEventListener('click', ()=>{
    if(confirm('¿Borrar todo tu territorio guardado?')){
      territory = { type:'FeatureCollection', features: [] };
      territoryLayer.clearLayers();
      territoryLayer.addData(territory);
      loops = 0;
      points = 0;
      loopsEl.textContent = 'Bucles: 0';
      pointsEl.textContent = 'Puntos: 0';
      saveTerritory();
      resetPath();
      showToast('Todo borrado - empezando de cero');
    }
  });

  // Navigation controls
  let searchTimeout = null;
  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim();
    if (searchTimeout) clearTimeout(searchTimeout);
    
    if (!query) {
      searchResults.innerHTML = '';
      return;
    }
    
    searchTimeout = setTimeout(async () => {
      const results = await geocodeSearch(query);
      searchResults.innerHTML = '';
      
      results.forEach(result => {
        const item = document.createElement('div');
        item.className = 'search-item';
        item.textContent = result.name;
        item.addEventListener('click', () => {
          setDestination(result.lat, result.lng, result.name);
          searchInput.value = result.name;
          searchResults.innerHTML = '';
          map.setView([result.lat, result.lng], 16);
        });
        searchResults.appendChild(item);
      });
    }, 300);
  });

  $('#goTo').addEventListener('click', async () => {
    const query = searchInput.value.trim();
    if (!query) {
      showToast('Escribe un destino');
      return;
    }
    
    const results = await geocodeSearch(query);
    if (results.length > 0) {
      const result = results[0];
      setDestination(result.lat, result.lng, result.name);
      map.setView([result.lat, result.lng], 16);
    } else {
      showToast('Destino no encontrado');
    }
  });

  $('#centerMe').addEventListener('click', () => {
    if (currentPosition) {
      map.setView([currentPosition.lat, currentPosition.lng], 16);
      showToast('Centrado en tu ubicación');
    } else {
      showToast('Ubicación no disponible');
    }
  });

  $('#clearRoute').addEventListener('click', () => {
    clearRoute();
  });

  // Route type controls
  $('#routeStraight').addEventListener('click', () => {
    routeType = 'straight';
    document.getElementById('routeStraight').classList.add('active');
    document.getElementById('routeRoad').classList.remove('active');
    if (destination && currentPosition) {
      updateRouteInfo();
    }
  });

  $('#routeRoad').addEventListener('click', () => {
    routeType = 'road';
    document.getElementById('routeRoad').classList.add('active');
    document.getElementById('routeStraight').classList.remove('active');
    if (destination && currentPosition) {
      updateRouteInfo();
    }
  });

  // Try to start GPS for marker even if not running
  if('geolocation' in navigator){
    watchId = navigator.geolocation.watchPosition(onPos, onErr, { enableHighAccuracy:true, maximumAge:1000, timeout:10000 });
  }
  
  // Load saved progress
  loadProgress();
})();