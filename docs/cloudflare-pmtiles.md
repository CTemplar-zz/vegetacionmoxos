# Publicación de PMTiles en Cloudflare R2

Cada capa se publica como un único archivo PMTiles:

- `vegetacion-moxos-z5-z13.pmtiles`
- `segmentos-z5-z13.pmtiles`

Ambos archivos contienen teselas vectoriales para los zooms 5–13. Se generaron sin simplificación de líneas, sin reducción de polígonos pequeños y sin descarte de entidades.

## Carga en R2

1. Suba los dos archivos `.pmtiles` dentro de la carpeta `Tiles` del bucket.
2. Configure `Content-Type: application/vnd.pmtiles` si el panel permite definirlo.
3. En la configuración CORS del bucket permita solicitudes `GET` y `HEAD` desde `https://geoportal-beni-inundacion.ctemplar.chatgpt.site`.
4. Permita el encabezado de solicitud `Range` y exponga `ETag` en la respuesta.

Ejemplo de política CORS:

```json
[
  {
    "AllowedOrigins": ["https://geoportal-beni-inundacion.ctemplar.chatgpt.site"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["Range", "If-Match"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

Después de la carga, configure `public/data/tile-sources.json` con las URL públicas completas:

```json
{
  "vegetation": {
    "url": "https://tiles.ejemplo.com/Tiles/vegetacion-moxos-z5-z13.pmtiles",
    "format": "pmtiles",
    "layerName": "vegetacion",
    "minZoom": 5,
    "maxZoom": 13
  },
  "segments": {
    "url": "https://tiles.ejemplo.com/Tiles/segmentos-z5-z13.pmtiles",
    "format": "pmtiles",
    "layerName": "segmentos",
    "minZoom": 5,
    "maxZoom": 13
  }
}
```

Mientras las URL permanezcan vacías, el portal utiliza los TopoJSON actuales como respaldo.
