#!/usr/bin/env bash
set -euo pipefail

source_dir="${1:?Uso: build-pmtiles.sh DIRECTORIO_GEOJSON DIRECTORIO_SALIDA}"
output_dir="${2:?Uso: build-pmtiles.sh DIRECTORIO_GEOJSON DIRECTORIO_SALIDA}"

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
)

tippecanoe \
  --output="$output_dir/vegetacion-moxos-z5-z13.pmtiles" \
  --layer=vegetacion \
  --include=CLASE1 \
  --name=Vegetacion_Moxos \
  "${common[@]}" \
  "$source_dir/vegetacion_moxos.geojson"

tippecanoe \
  --output="$output_dir/segmentos-z5-z13.pmtiles" \
  --layer=segmentos \
  --use-attribute-for-id=OBJECTID_1 \
  --include=OBJECTID_1 \
  --include=zone \
  --include=CLASE1 \
  --include=NOM_DEP \
  --include=DESCRIP \
  --include=PromDias \
  --include=Frec \
  --include=Area \
  --name=Segmentos_Inundacion \
  "${common[@]}" \
  "$source_dir/segmentos.geojson"
