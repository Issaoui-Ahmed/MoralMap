"use client";

import React, { useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, Polyline, TileLayer, ZoomControl } from "react-leaflet";
import L from "leaflet";
import { startIcon, endIcon } from "../markerIcons";
import { fetchRoute } from "../utils/fetchRoute";

import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x.src || markerIcon2x,
  iconUrl: markerIcon.src || markerIcon,
  shadowUrl: markerShadow.src || markerShadow,
});

function isValidCoord(point) {
  return (
    Array.isArray(point) &&
    point.length === 2 &&
    point.every((value) => typeof value === "number" && Number.isFinite(value))
  );
}

const clampIndex = (idx, length) => {
  if (!length) return null;
  const value = typeof idx === "number" && idx >= 0 ? idx : 0;
  return Math.min(value, length - 1);
};

const DEFAULT_ROUTE_COLOR = "#1452EE";
const ALTERNATIVE_ROUTE_COLORS = ["#4B78F2", "#7897F6", "#A5B6FA", "#CFD9FD"];

const makePolyline = (points, color, weight) => ({
  points: points.filter(isValidCoord),
  color,
  weight,
});

export default function ScenarioMapPreview({
  scenario,
  selection = {},
  onChange = () => {},
  className = "h-64 w-full",
}) {
  const startOptions = Array.isArray(scenario?.start)
    ? scenario.start.filter(isValidCoord)
    : [];
  const endOptions = Array.isArray(scenario?.end) ? scenario.end.filter(isValidCoord) : [];

  const startIndex = clampIndex(selection?.start, startOptions.length);
  const endIndex = clampIndex(selection?.end, endOptions.length);

  const activeStart = startIndex !== null ? startOptions[startIndex] : startOptions[0];
  const activeEnd = endIndex !== null ? endOptions[endIndex] : endOptions[0];

  const alternatives = Array.isArray(scenario?.choice_list) ? scenario.choice_list : [];
  const routeSelections = Array.isArray(selection?.choice_list) ? selection.choice_list : [];

  const alternativeSelections = useMemo(
    () =>
      alternatives.map((route, routeIndex) => {
        const middleOptions = Array.isArray(route?.middle_point)
          ? route.middle_point.filter(isValidCoord)
          : [];
        const middleIndex = clampIndex(
          routeSelections?.[routeIndex]?.middle_point,
          middleOptions.length
        );
        const middlePoint = middleIndex !== null ? middleOptions[middleIndex] : middleOptions[0];

        return { route, routeIndex, middlePoint, middleOptions };
      }),
    [alternatives, routeSelections]
  );

  const [previewRoutes, setPreviewRoutes] = useState([]);

  useEffect(() => {
    if (!isValidCoord(activeStart) || !isValidCoord(activeEnd)) {
      setPreviewRoutes([]);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    const defaultPoints = [activeStart, activeEnd].filter(isValidCoord);
    if (defaultPoints.length < 2) {
      setPreviewRoutes([]);
      return;
    }

    const buildFallbackRoute = (points, color, weight) => ({
      points: points.filter(isValidCoord),
      color,
      weight,
    });

    const loadRoutes = async () => {
      const fallbackRoutes = [
        buildFallbackRoute(defaultPoints, DEFAULT_ROUTE_COLOR, 6),
        ...alternativeSelections.map((selection, index) => {
          const points = [activeStart, selection.middlePoint, activeEnd].filter(isValidCoord);
          if (points.length < 2) return null;
          return buildFallbackRoute(
            points,
            ALTERNATIVE_ROUTE_COLORS[index % ALTERNATIVE_ROUTE_COLORS.length],
            4
          );
        }),
      ];

      const fetches = fallbackRoutes.map((route) =>
        route ? fetchRoute(route.points, controller.signal).catch(() => null) : Promise.resolve(null)
      );

      const results = await Promise.all(fetches);
      if (cancelled) return;

      const builtRoutes = fallbackRoutes
        .map((route, idx) => {
          if (!route) return null;
          const fetched = results[idx];
          const points = Array.isArray(fetched) && fetched.length >= 2 ? fetched : route.points;
          return makePolyline(points, route.color, route.weight);
        })
        .filter(Boolean);

      setPreviewRoutes(builtRoutes);
    };

    loadRoutes();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activeStart, activeEnd, alternativeSelections]);

  const bounds = useMemo(() => {
    const coords = previewRoutes.flatMap((route) => route.points);
    if (coords.length >= 2) {
      return L.latLngBounds(coords);
    }
    if (coords.length === 1) {
      const [[lat, lng]] = coords;
      const delta = 0.01;
      return L.latLngBounds(
        [lat - delta, lng - delta],
        [lat + delta, lng + delta]
      );
    }
    return null;
  }, [previewRoutes]);

  const handleDrag = (type, routeIndex) => (event) => {
    const { lat, lng } = event.target.getLatLng();
    const coords = [lat, lng];

    if (type === "start") {
      const next = Array.isArray(scenario.start) ? scenario.start.slice() : [];
      const targetIndex = startIndex ?? 0;
      if (typeof targetIndex === "number") {
        next[targetIndex] = coords;
        onChange({ start: next });
      }
      return;
    }

    if (type === "end") {
      const next = Array.isArray(scenario.end) ? scenario.end.slice() : [];
      const targetIndex = endIndex ?? 0;
      if (typeof targetIndex === "number") {
        next[targetIndex] = coords;
        onChange({ end: next });
      }
      return;
    }

    if (type === "middle" && typeof routeIndex === "number") {
      const choiceList = Array.isArray(scenario.choice_list) ? scenario.choice_list.slice() : [];
      const route = choiceList[routeIndex];
      if (!route) return;
      const middleOptions = Array.isArray(route.middle_point) ? route.middle_point.slice() : [];
      const currentSelection = clampIndex(routeSelections?.[routeIndex]?.middle_point, middleOptions.length);
      const targetIndex = currentSelection ?? 0;
      if (typeof targetIndex === "number") {
        middleOptions[targetIndex] = coords;
        choiceList[routeIndex] = { ...route, middle_point: middleOptions };
        onChange({ choice_list: choiceList });
      }
    }
  };

  if (!activeStart || !activeEnd) {
    return (
      <div
        className={`flex items-center justify-center bg-gray-100 text-sm text-gray-600 ${className}`}
      >
        Select valid start and end coordinates to preview the scenario.
      </div>
    );
  }

  const middleMarkers = alternativeSelections
    .map(({ middlePoint, routeIndex }) => {
      if (!middlePoint) return null;
      return { position: middlePoint, routeIndex };
    })
    .filter(Boolean);

  return (
    <div className={className}>
      <div className="relative h-full w-full">
        <MapContainer
          bounds={bounds ?? undefined}
          center={bounds ? undefined : activeStart}
          zoom={13}
          style={{ height: "100%", width: "100%" }}
          scrollWheelZoom
          doubleClickZoom
          touchZoom
          boxZoom
          keyboard
          zoomControl={false}
        >
          <ZoomControl position="topright" />
          <TileLayer
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          />
          <Marker
            position={activeStart}
            draggable
            icon={startIcon}
            eventHandlers={{ dragend: handleDrag("start") }}
          />
          <Marker
            position={activeEnd}
            draggable
            icon={endIcon}
            eventHandlers={{ dragend: handleDrag("end") }}
          />
          {middleMarkers.map(({ position, routeIndex }) => (
            <Marker
              key={`middle-${routeIndex}`}
              position={position}
              draggable
              eventHandlers={{ dragend: handleDrag("middle", routeIndex) }}
            />
          ))}
          {previewRoutes.map((route, index) => (
            <Polyline
              // eslint-disable-next-line react/no-array-index-key
              key={index}
              positions={route.points}
              pathOptions={{ color: route.color, weight: route.weight, opacity: 0.9 }}
            />
          ))}
        </MapContainer>
      </div>
    </div>
  );
}

