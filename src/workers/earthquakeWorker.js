import { DOMParser } from "@xmldom/xmldom";
import * as toGeoJSON from "@tmcw/togeojson";

self.onmessage = async (e) => {
    if (e.data.type === "LOAD_FAULTS") {
        try {
            // Determine base URL since workers might run from a different path
            const baseUrl = self.location.origin || "http://localhost:5173";
            const response = await fetch(`${baseUrl}/gem_active_faults.kml`);
            if (!response.ok) throw new Error("Failed to fetch KML");

            const kmlText = await response.text();
            
            // Parse XML in worker
            const parser = new DOMParser();
            const kmlDom = parser.parseFromString(kmlText, "text/xml");
            
            // Convert to GeoJSON
            const geoJson = toGeoJSON.kml(kmlDom);

            // Filter for Philippines only (Approximate Bounding Box)
            const MIN_LAT = 4, MAX_LAT = 22.5;
            const MIN_LON = 116, MAX_LON = 129;

            const filteredFeatures = geoJson.features.filter(feature => {
                if (!feature.geometry || !feature.geometry.coordinates) return false;

                const coords = feature.geometry.type === "MultiLineString"
                    ? feature.geometry.coordinates.flat()
                    : feature.geometry.coordinates;

                return coords.some(([lon, lat]) =>
                    lat >= MIN_LAT && lat <= MAX_LAT &&
                    lon >= MIN_LON && lon <= MAX_LON
                );
            });

            const finalData = { ...geoJson, features: filteredFeatures };

            self.postMessage({ type: "FAULTS_LOADED", payload: finalData });
        } catch (error) {
            self.postMessage({ type: "FAULTS_ERROR", error: error.message });
        }
    }
};
