"""Exporta la capa Segmentos de ArcGIS Pro a GeoJSON WGS84 sin simplificar."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def transform_coordinates(node, transformer):
    if isinstance(node, (list, tuple)) and len(node) >= 2 and isinstance(node[0], (int, float)):
        x, y = transformer.transform(node[0], node[1])
        return [x, y, *node[2:]]
    return [transform_coordinates(child, transformer) for child in node]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--deps", type=Path)
    args = parser.parse_args()
    if args.deps:
        sys.path.insert(0, str(args.deps))

    import shapefile
    from pyproj import Transformer

    reader = shapefile.Reader(str(args.source), encoding="utf-8")
    fields = [field[0] for field in reader.fields[1:]]
    transformer = Transformer.from_crs("EPSG:32720", "EPSG:4326", always_xy=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)

    with args.output.open("w", encoding="utf-8") as output:
        output.write('{"type":"FeatureCollection","features":[')
        first = True
        for shape_record in reader.iterShapeRecords():
            properties = dict(zip(fields, shape_record.record, strict=True))
            geometry = shape_record.shape.__geo_interface__
            geometry["coordinates"] = transform_coordinates(geometry["coordinates"], transformer)
            feature = {"type": "Feature", "properties": properties, "geometry": geometry}
            if not first:
                output.write(",")
            json.dump(feature, output, ensure_ascii=False, separators=(",", ":"))
            first = False
        output.write("]}")

    print(json.dumps({"features": len(reader), "fields": fields, "output": str(args.output)}))


if __name__ == "__main__":
    main()
