#!/usr/bin/env bash
set -euo pipefail

source_dir="${1:?Uso: build-pmtiles.sh DIRECTORIO_GEOJSON DIRECTORIO_SALIDA}"
output_dir="${2:?Uso: build-pmtiles.sh DIRECTORIO_GEOJSON DIRECTORIO_SALIDA}"
vegetation_source="${VEGETATION_SOURCE:-$source_dir/vegetacion_moxos.geojson}"
segments_source="${SEGMENTS_SOURCE:-$source_dir/segmentos.geojson}"
overview_max_zoom=7
detail_min_zoom=8

mkdir -p "$output_dir"
temporary_dir="$(mktemp -d)"
trap 'rm -rf "$temporary_dir"' EXIT

overview=(
  --force
  --minimum-zoom=5
  --maximum-zoom="$overview_max_zoom"
  --simplification=10
  --no-feature-limit
  --no-tile-size-limit
)

detail=(
  --force
  --minimum-zoom="$detail_min_zoom"
  --maximum-zoom=13
  --full-detail=16
  --no-line-simplification
  --no-tiny-polygon-reduction
  --no-simplification-of-shared-nodes
  --no-feature-limit
  --no-tile-size-limit
)

tippecanoe \
  --output="$temporary_dir/vegetacion-overview.pmtiles" \
  --layer=vegetacion \
  --include=CLASE1 \
  --name=Vegetacion_Moxos \
  "${overview[@]}" \
  "$vegetation_source"

tippecanoe \
  --output="$temporary_dir/vegetacion-detail.pmtiles" \
  --layer=vegetacion \
  --include=CLASE1 \
  --name=Vegetacion_Moxos \
  "${detail[@]}" \
  "$vegetation_source"

tile-join \
  --force \
  --no-tile-size-limit \
  --output="$output_dir/vegetacion-moxos-z5-z13.pmtiles" \
  "$temporary_dir/vegetacion-overview.pmtiles" \
  "$temporary_dir/vegetacion-detail.pmtiles"

tippecanoe \
  --output="$temporary_dir/segmentos-overview.pmtiles" \
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
  "${overview[@]}" \
  "$segments_source"

tippecanoe \
  --output="$temporary_dir/segmentos-detail.pmtiles" \
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
  "${detail[@]}" \
  "$segments_source"

tile-join \
  --force \
  --no-tile-size-limit \
  --output="$output_dir/segmentos-z5-z13.pmtiles" \
  "$temporary_dir/segmentos-overview.pmtiles" \
  "$temporary_dir/segmentos-detail.pmtiles"
