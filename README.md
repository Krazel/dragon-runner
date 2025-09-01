# Dragon Runner (radar + mapa)

Este paquete incluye dos páginas independientes:

- `index.html` → **Radar** (tu radar original, sin cambios en el comportamiento).  
  - Botones: Ir / Parar / Calibrar / Minimal / Solo Radar, y enlace a **Mapa**.
- `mapa.html` → **Mapa de territorio** para corredores (Leaflet + Turf).  
  - Iniciar/Pausar/Reset, cierre de bucle automático al volver cerca del inicio (≈20 m), y se **reclama territorio** (polígono).
  - El territorio se **guarda en localStorage** (persiste entre recargas).

## Cómo usar

1. **Abre `index.html`** para el radar, o **`mapa.html`** para el mapa. No se necesita ninguna instalación.
2. En el mapa:
   - Pulsa **Iniciar** para comenzar a grabar.
   - Corre y crea un **bucle**; al volver cerca del punto inicial (20 m) se cerrará y **añadirá el polígono** a tu territorio.
   - **Pausar** detiene la grabación sin borrar el tramo.
   - **Reset tramo** limpia solo el tramo en curso (no el territorio).
   - **Borrar todo** elimina el territorio guardado (localStorage).

## Créditos
Mapas © OpenStreetMap. Librerías: Leaflet y Turf (CDN).
