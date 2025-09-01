document.addEventListener('DOMContentLoaded',()=>{
  let radarOnlyActive=false;
  let pos=null, heading=null, dest=null;
  let watchId=null;
  
  // Speed tracking
  let lastPosition = null;
  let lastPositionTime = null;
  let currentSpeed = 0;

  const $=(sel)=>document.querySelector(sel);
  const showToast=(msg)=>{ const t=$('#toast'); t.textContent=msg; t.style.display='block'; clearTimeout(showToast._t); showToast._t=setTimeout(()=>t.style.display='none',2000); };

  const getScreenAngle=()=>{
    let a=0;
    if(screen.orientation && typeof screen.orientation.angle==='number') a=screen.orientation.angle;
    else if(typeof window.orientation==='number') a=window.orientation;
    if(a<0) a=360+a;
    return a%360;
  };

  const smoothAngle=(prev,next,f=0.25)=>{
    if(prev==null) return next;
    let delta=((next-prev+540)%360)-180;
    return (prev+delta*f+360)%360;
  };

  const q=$('#q'), rs=$('#rs');
  const btnMinimal=$('#toggleMinimal');
  const btnRadarOnly=$('#toggleRadarOnly');
  const btnGo=$('#go');
  const btnStop=$('#stop');
  const btnCal=$('#cal');
  const demo=$('#demo');
  const gpsEl=$('#gps'), headEl=$('#head'), distEl=$('#dist'), bearingEl=$('#bearing'), speedEl=$('#speed');
  const dotWrap=$('#dotWrap');

  btnMinimal.addEventListener('click',()=>{
    document.body.classList.toggle('minimal');
    showToast(document.body.classList.contains('minimal')?'Minimal ON':'Minimal OFF');
  });

  btnRadarOnly.addEventListener('click',()=>{
    if(radarOnlyActive){ exitRadarOnly(); }
    else{ enterRadarOnly(); }
  });

  // ====== Buscador ======
  let debT=null;
  q.addEventListener('input',()=>{
    const text=q.value.trim();
    if(debT) clearTimeout(debT);
    if(!text){ rs.style.display='none'; rs.innerHTML=''; return; }
    debT=setTimeout(async()=>{
      const items=await geocodeMany(text);
      rs.innerHTML='';
      items.forEach(it=>{
        const d=document.createElement('div');
        d.className='item';
        d.textContent=it.name;
        d.addEventListener('click',()=>{ selectDest(it); });
        rs.appendChild(d);
      });
      rs.style.display=items.length?'block':'none';
    },250);
  });

  btnGo.addEventListener('click',async()=>{
    if(!q.value.trim()) { showToast('Escribe destino'); return; }
    const one=await geocodeOne(q.value.trim());
    if(one){ dest=one; showToast('Destino: '+one.name); updateRadar(); }
    else { showToast('No encontrado'); }
  });

  btnStop.addEventListener('click',()=>{
    dest=null; updateRadar();
    showToast('Ruta detenida');
  });

  btnCal.addEventListener('click',()=>{ requestMotionPerm(); });

  demo.addEventListener('click',e=>{
    e.preventDefault();
    pos={lat:40.4168,lng:-3.7038};
    dest={lat:40.4268,lng:-3.6838,name:"Destino simulado"};
    heading=0; headEl.textContent='0°';
    showToast('Simulación activa');
    updateRadar();
  });

  // ====== Geolocalización ======
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
  function onPos(p){
    const lat = p.coords.latitude;
    const lng = p.coords.longitude;
    const timestamp = p.timestamp;
    
    pos={lat, lng};
    
    // Calculate speed
    const speed = calculateSpeed(lat, lng, timestamp);
    updateSpeedDisplay(speed);
    
    gpsEl.textContent=`OK (${Math.round(p.coords.accuracy)}m)`;
    gpsEl.style.color='var(--good)';
    updateRadar();
  }

  function calculateSpeed(lat, lng, timestamp) {
    if (!lastPosition || !lastPositionTime) {
      lastPosition = { lat, lng };
      lastPositionTime = timestamp;
      return 0;
    }

    const timeDiff = (timestamp - lastPositionTime) / 1000; // seconds
    if (timeDiff < 1) return currentSpeed; // Don't update too frequently

    const distance = dist({ lat: lastPosition.lat, lng: lastPosition.lng }, { lat, lng });
    const speed = (distance / timeDiff) * 3.6; // Convert m/s to km/h

    // Smooth the speed to avoid jumpy readings
    currentSpeed = currentSpeed * 0.7 + speed * 0.3;

    lastPosition = { lat, lng };
    lastPositionTime = timestamp;

    return currentSpeed;
  }

  function updateSpeedDisplay(speed) {
    let displaySpeed = Math.round(speed * 10) / 10; // One decimal place
    speedEl.textContent = displaySpeed + ' km/h';
    
    // Color coding based on speed
    if (speed > 20) speedEl.style.color = 'var(--bad)';      // Fast (red)
    else if (speed > 5) speedEl.style.color = 'var(--warn)'; // Medium (yellow)
    else if (speed > 1) speedEl.style.color = 'var(--good)'; // Slow (green)
    else speedEl.style.color = 'var(--fg)';                  // Stopped (normal)
  }

  // ====== Brújula ======
  function initOrientation(){
    if(typeof DeviceOrientationEvent!=='undefined' && typeof DeviceOrientationEvent.requestPermission==='function'){
      btnCal.style.display='inline-block';
    }
    window.addEventListener('deviceorientationabsolute',onHeading,true);
    window.addEventListener('deviceorientation',onHeading,true);

    window.addEventListener('orientationchange',()=>{ updateRadar(); });
    if(screen.orientation && screen.orientation.addEventListener){
      screen.orientation.addEventListener('change',()=>{ updateRadar(); });
    }
  }
  initOrientation();

  async function requestMotionPerm(){
    try{
      const res=await DeviceOrientationEvent.requestPermission();
      if(res==='granted'){
        window.addEventListener('deviceorientation',onHeading,true);
        showToast('Permiso concedido');
      } else showToast('Permiso denegado');
    }catch(e){ showToast('Error: '+e); }
  }

  function onHeading(e){
    let newHeading=null;
    if(typeof e.webkitCompassHeading==='number'){
      newHeading=e.webkitCompassHeading;
    } else if(typeof e.alpha==='number'){
      const angle=getScreenAngle();
      newHeading=(360 - e.alpha + angle + 360)%360;
    }

    if(newHeading!=null){
      heading=smoothAngle(heading,newHeading,0.25);
      headEl.textContent=Math.round(heading)+'°';
      updateRadar();
    } else {
      headEl.textContent='No disponible';
    }
  }

  // ====== Distancia y rumbo ======
  function dist(a, b){
    const R = 6371000;
    const φ1 = a.lat * Math.PI/180;
    const φ2 = b.lat * Math.PI/180;
    const Δφ = (b.lat - a.lat) * Math.PI/180;
    const Δλ = (b.lng - a.lng) * Math.PI/180;
    const h = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1-h));
  }
  function bearing(a, b){
    const φ1 = a.lat * Math.PI/180;
    const φ2 = b.lat * Math.PI/180;
    const λ1 = a.lng * Math.PI/180;
    const λ2 = b.lng * Math.PI/180;
    const y = Math.sin(λ2-λ1) * Math.cos(φ2);
    const x = Math.cos(φ1)*Math.sin(φ2) - Math.sin(φ1)*Math.cos(φ2)*Math.cos(λ2-λ1);
    return (Math.atan2(y,x) * 180/Math.PI + 360) % 360;
  }
  function formatDist(m){
    if(m < 1000) return Math.round(m) + ' m';
    return (m/1000).toFixed(2) + ' km';
  }

  // ====== Radar Update ======
  function updateRadar(){
    if(!dest||!pos){ distEl.textContent='–'; bearingEl.textContent='–'; return; }
    const brg=bearing(pos,dest);
    const d=dist(pos,dest);
    distEl.textContent=formatDist(d);
    bearingEl.textContent=Math.round(brg)+'°';
    const h=(heading!=null)?heading:0;
    const rel=(brg-h+360)%360;
    // Rotamos el GRUPO; el círculo sigue pulsando por CSS
    dotWrap.setAttribute('transform',`rotate(${rel} 0 0)`);
  }

  // ====== Geocoding ======
  async function geocodeMany(query){
    const url=`https://nominatim.openstreetmap.org/search?format=json&limit=8&addressdetails=1&q=${encodeURIComponent(query)}`;
    try{
      const res=await fetch(url,{headers:{'Accept-Language':'es'}});
      if(!res.ok) return [];
      const arr=await res.json();
      return (arr||[]).map(x=>({lat:parseFloat(x.lat), lng:parseFloat(x.lon), name:x.display_name}));
    }catch(e){ return []; }
  }
  async function geocodeOne(query){
    const url=`https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&q=${encodeURIComponent(query)}`;
    try{
      const res=await fetch(url,{headers:{'Accept-Language':'es'}});
      if(!res.ok) return null;
      const arr=await res.json();
      if(!arr||!arr.length) return null;
      return {lat:parseFloat(arr[0].lat), lng:parseFloat(arr[0].lon), name:arr[0].display_name};
    }catch(e){ return null; }
  }

  function selectDest(it){
    dest=it; q.value=it.name; rs.style.display='none'; updateRadar();
    showToast('Destino: '+it.name);
  }

  // ====== RadarOnly ======
  function enterRadarOnly(){
    document.body.classList.add('radaronly');
    radarOnlyActive=true;
    const layer=document.createElement('div');
    layer.className='exit-layer';
    layer.id='exit-layer';
    layer.addEventListener('click',()=>{ exitRadarOnly(); });
    layer.addEventListener('touchstart',()=>{ exitRadarOnly(); },{passive:true});
    document.body.appendChild(layer);
  }
  function exitRadarOnly(){
    document.body.classList.remove('radaronly');
    radarOnlyActive=false;
    const layer=$('#exit-layer'); if(layer) layer.remove();
    showToast('Menú restaurado');
  }
});
