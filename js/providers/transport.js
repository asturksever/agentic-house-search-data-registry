// Getting about — rail/tube/tram and bus stops from OpenStreetMap, plus the
// lines that actually serve the nearest London stop from the TfL Unified API.

import { getJSON } from '../fetchx.js';
import { fact, result, finish, fmt } from '../facts.js';
import { nearby, pick } from './_overpass.js';
import { noteFailure } from './_util.js';

const OSM = 'osm-overpass';
const TFL = 'tfl-api';

export default {
  id: 'transport',
  label: 'Transport',
  registryIds: [OSM, TFL],

  async run(place) {
    const inLondon = place.region === 'London';
    const res = result(this.id, this.label, {
      sources: inLondon ? [OSM, TFL] : [OSM], mode: 'live',
    });
    const geography = { level: 'Area', code: null, name: 'around the postcode' };

    let items = null;
    try {
      items = await nearby(place);
    } catch (err) {
      noteFailure(res, OSM, 'Overpass (OpenStreetMap)', err);
    }

    if (items) {
      const stations = pick(items, 'station');
      const trams = pick(items, 'tram');
      const rail = [...stations, ...trams].sort((a, b) => a.distance - b.distance);
      if (rail.length) {
        const nearest = rail[0];
        res.facts.push(fact({
          key: 'transport.nearest_station_m', label: 'Nearest station',
          value: Math.round(nearest.distance), display: fmt.metres(nearest.distance),
          kind: 'distance_m', unit: 'm', geography, period: 'current OSM data', sourceId: OSM,
          note: nearest.name ? `${nearest.name} — straight-line distance.` : 'Straight-line distance.',
        }));
        res.facts.push(fact({
          key: 'transport.stations_2km', label: 'Stations within 2 km',
          value: rail.length, display: fmt.num(rail.length), kind: 'count',
          geography, period: 'current OSM data', sourceId: OSM,
        }));
      }
      const buses = pick(items, 'bus_stop');
      res.facts.push(fact({
        key: 'transport.bus_stops_800m', label: 'Bus stops within 800 m',
        value: buses.length, display: fmt.num(buses.length), kind: 'count',
        geography, period: 'current OSM data', sourceId: OSM,
      }));
    }

    if (inLondon) {
      try {
        const data = await getJSON(
          `https://api.tfl.gov.uk/StopPoint?lat=${place.lat}&lon=${place.lng}` +
          '&stopTypes=NaptanMetroStation,NaptanRailStation&radius=1500&useStopPointHierarchy=true',
          { timeout: 10000 });
        const stops = (data.stopPoints || []).sort((a, b) => (a.distance || 0) - (b.distance || 0));
        if (stops.length) {
          const lines = [...new Set(stops.flatMap(s => (s.lines || []).map(l => l.name)))];
          res.facts.push(fact({
            key: 'transport.tfl_nearest', label: 'Nearest TfL/National Rail station',
            value: Math.round(stops[0].distance || 0),
            display: `${stops[0].commonName} (${fmt.metres(stops[0].distance || 0)})`,
            kind: 'category', geography, period: 'live', sourceId: TFL,
          }));
          if (lines.length) {
            res.facts.push(fact({
              key: 'transport.tfl_lines', label: 'Lines and services within 1.5 km',
              value: lines.length, display: lines.slice(0, 8).join(', '),
              kind: 'category', geography, period: 'live', sourceId: TFL,
            }));
          }
        }
      } catch (err) {
        noteFailure(res, TFL, 'TfL Unified API', err);
      }
    }

    if (!res.facts.length && !res.errors.length) {
      res.notes.push('No stations or stops were found near this postcode in OpenStreetMap.');
    }
    return finish(res);
  },
};
