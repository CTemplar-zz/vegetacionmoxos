#!/usr/bin/env python3
"""Calcula índices anuales de inundación por encima del régimen seco.

El umbral de cada clase y año es el percentil 90 de la superficie inundada
suavizada observada entre julio y octubre. El suavizado usa una mediana móvil
centrada de tres observaciones MODIS (aproximadamente 24 días).

La frecuencia es el porcentaje de observaciones anuales que superan el umbral.
La permanencia es la duración del episodio continuo con mayor excedencia
acumulada hasta la primera observación que vuelve a estar bajo el umbral.

Uso:
    python scripts/calculate-hydrological-indices.py \
        public/data/vegetation-timeseries.json \
        public/data/vegetation-hydrology.json
"""

from __future__ import annotations

import argparse
import json
from datetime import date, timedelta
from pathlib import Path
from statistics import median
from typing import Iterable


DRY_MONTHS = (7, 8, 9, 10)
THRESHOLD_PERCENTILE = 90
OBSERVATION_DAYS = 8


def percentile(values: Iterable[float], percentage: float) -> float:
    ordered = sorted(float(value) for value in values)
    if not ordered:
        return 0.0
    position = (len(ordered) - 1) * percentage / 100
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    fraction = position - lower
    return ordered[lower] * (1 - fraction) + ordered[upper] * fraction


def moving_median(values: list[float]) -> list[float]:
    return [
        float(median(values[max(0, index - 1) : min(len(values), index + 2)]))
        for index in range(len(values))
    ]


def dominant_event(
    values: list[float],
    threshold: float,
) -> tuple[int, int] | None:
    runs: list[tuple[int, int]] = []
    index = 0
    while index < len(values):
        if values[index] <= threshold:
            index += 1
            continue
        start = index
        while index + 1 < len(values) and values[index + 1] > threshold:
            index += 1
        runs.append((start, index))
        index += 1

    if not runs:
        return None

    def event_score(run: tuple[int, int]) -> tuple[float, int, float]:
        start, end = run
        accumulated_excess = sum(max(0.0, value - threshold) for value in values[start : end + 1])
        return accumulated_excess, end - start + 1, max(values[start : end + 1])

    return max(runs, key=event_score)


def calculate_year(
    observation_dates: list[date],
    observations: list[float],
    area_km2: float,
) -> dict[str, object]:
    smoothed = moving_median(observations)
    dry_values = [
        value
        for observation_date, value in zip(observation_dates, smoothed)
        if observation_date.month in DRY_MONTHS
    ]
    threshold_km2 = percentile(dry_values, THRESHOLD_PERCENTILE)
    above = [value > threshold_km2 for value in smoothed]
    event = dominant_event(smoothed, threshold_km2)

    start_date: str | None = None
    end_date: str | None = None
    duration_days = 0
    event_peak_km2 = 0.0
    event_excess_km2_days = 0.0

    if event:
        start, end = event
        first_below = observation_dates[end + 1] if end + 1 < len(observation_dates) else observation_dates[end] + timedelta(days=OBSERVATION_DAYS)
        calendar_end = date(observation_dates[start].year + 1, 1, 1)
        first_below = min(first_below, calendar_end)
        start_date = observation_dates[start].isoformat()
        end_date = first_below.isoformat()
        duration_days = max(0, (first_below - observation_dates[start]).days)
        event_peak_km2 = max(smoothed[start : end + 1])
        event_excess_km2_days = sum(
            max(0.0, value - threshold_km2) * OBSERVATION_DAYS
            for value in smoothed[start : end + 1]
        )

    return {
        "thresholdKm2": round(threshold_km2, 3),
        "thresholdPct": round(min(100.0, threshold_km2 / area_km2 * 100) if area_km2 > 0 else 0.0, 2),
        "exceedanceFrequencyPct": round(sum(above) / len(above) * 100 if above else 0.0, 2),
        "durationDays": duration_days,
        "startDate": start_date,
        "endDate": end_date,
        "eventPeakKm2": round(event_peak_km2, 3),
        "eventExcessKm2Days": round(event_excess_km2_days, 2),
    }


def calculate_indices(source: dict[str, object]) -> dict[str, object]:
    all_dates = [date.fromisoformat(value) for value in source["dates"]]
    full_years = [int(value) for value in source["years"]]
    classes: dict[str, object] = {}

    for class_id, vegetation_class in source["classes"].items():
        area_km2 = float(vegetation_class["areaKm2"])
        series = [float(value or 0) for value in vegetation_class["series"]]
        annual: list[dict[str, object]] = []

        for year in full_years:
            positions = [index for index, observation_date in enumerate(all_dates) if observation_date.year == year]
            year_dates = [all_dates[index] for index in positions]
            year_values = [series[index] for index in positions]
            result = calculate_year(year_dates, year_values, area_km2)
            annual.append({"year": year, **result})

        classes[class_id] = {
            "annual": annual,
            "longTerm": {
                "meanThresholdKm2": round(sum(item["thresholdKm2"] for item in annual) / len(annual), 3),
                "meanThresholdPct": round(sum(item["thresholdPct"] for item in annual) / len(annual), 2),
                "meanExceedanceFrequencyPct": round(sum(item["exceedanceFrequencyPct"] for item in annual) / len(annual), 2),
                "meanDurationDays": round(sum(item["durationDays"] for item in annual) / len(annual), 2),
            },
        }

    return {
        "version": 1,
        "source": "vegetation-timeseries.json",
        "observationIntervalDays": OBSERVATION_DAYS,
        "years": full_years,
        "method": {
            "drySeasonMonths": list(DRY_MONTHS),
            "threshold": f"Percentil {THRESHOLD_PERCENTILE} de la superficie suavizada de julio a octubre",
            "smoothing": "Mediana móvil centrada de 3 observaciones MODIS",
            "frequency": "Porcentaje de observaciones anuales suavizadas por encima del umbral seco",
            "duration": "Duración del episodio continuo con mayor excedencia acumulada hasta volver bajo el umbral",
        },
        "classes": classes,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    source = json.loads(args.input.read_text(encoding="utf-8"))
    result = calculate_indices(source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    print(json.dumps({
        "classes": len(result["classes"]),
        "years": len(result["years"]),
        "records": len(result["classes"]) * len(result["years"]),
        "output": str(args.output),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
