#!/usr/bin/env bash
set -euo pipefail

source_dir="${1:?Uso: build-vector-tiles.sh DIRECTORIO_GEOJSON DIRECTORIO_SALIDA}"
output_dir="${2:?Uso: build-vector-tiles.sh DIRECTORIO_GEOJSON DIRECTORIO_SALIDA}"

common=(
  --force
  --minimum-zoom=5
  --maximum-zoom=13
  --full-detail=16
  --no-line-simplification
  --no-tiny-polygon-reduction
  --no-simplification-of-shared-nodes
  --no-feature-limit
  --no-tile-size-limit
  --no-tile-compression
)

tippecanoe \
  --output-to-directory="$output_dir/vegetacion" \
  --layer=vegetacion \
  --include=CLASE1 \
  --name=Vegetacion_Moxos \
  "${common[@]}" \
  "$source_dir/vegetacion_moxos.geojson"

tippecanoe \
  --output-to-directory="$output_dir/segmentos" \
  --layer=segmentos \
  --include=CLASE1 \
  --include=PromDias \
  --include=Frec \
  --include=Area \
  --name=Segmentos_Inundacion \
  "${common[@]}" \
  "$source_dir/segmentos.geojson"
