# Publicación de las teselas en Cloudflare

Los paquetes generados contienen teselas PBF independientes para `vegetacion` y `segmentos`, con zooms 5–13. Deben extraerse y publicarse conservando la ruta `{z}/{x}/{y}.pbf`.

En Cloudflare R2 configure:

- acceso público mediante dominio propio o Worker;
- `Content-Type: application/x-protobuf` para los archivos `.pbf`;
- solicitudes `GET` y CORS para `https://geoportal-beni-inundacion.ctemplar.chatgpt.site`;
- caché pública de larga duración, ya que las rutas son datos estáticos.

Las teselas se generaron sin compresión interna, por lo que no necesitan `Content-Encoding: gzip`.

Después de la carga, actualice `public/data/tile-sources.json` con las plantillas públicas:

```json
{
  "vegetation": {
    "url": "https://tiles.ejemplo.com/vegetacion/{z}/{x}/{y}.pbf",
    "layerName": "vegetacion",
    "minZoom": 5,
    "maxZoom": 13
  },
  "segments": {
    "url": "https://tiles.ejemplo.com/segmentos/{z}/{x}/{y}.pbf",
    "layerName": "segmentos",
    "minZoom": 5,
    "maxZoom": 13
  }
}
```

Mientras las URL permanezcan vacías, el portal usa automáticamente los TopoJSON actuales como respaldo.
