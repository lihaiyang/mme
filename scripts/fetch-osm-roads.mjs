// 拉取上海人民广场附近一小块路网,转为 GeoJSON 写到 public/sample-roads.geojson
// 重新生成:`node scripts/fetch-osm-roads.mjs`
// 数据来源:OpenStreetMap (ODbL),归属:© OpenStreetMap contributors
import { mkdir, writeFile } from 'node:fs/promises'

const SOUTH = 31.225
const WEST = 121.465
const NORTH = 31.245
const EAST = 121.485

const query = `[out:json][timeout:30];
(
  way["highway"~"motorway|trunk|primary|secondary|tertiary|residential|unclassified|service"]
    (${SOUTH},${WEST},${NORTH},${EAST});
);
out body geom;`

console.log('querying overpass…')
const res = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
    'User-Agent': 'mme-fetch-osm-roads/0.1 (https://github.com/local/mme)',
  },
  body: 'data=' + encodeURIComponent(query),
})

if (!res.ok) {
  console.error('overpass error:', res.status, await res.text())
  process.exit(1)
}

const data = await res.json()

const features = data.elements
  .filter(
    (el) =>
      el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 2,
  )
  .map((el) => ({
    type: 'Feature',
    id: el.id,
    properties: {
      osmId: el.id,
      ...(el.tags || {}),
    },
    geometry: {
      type: 'LineString',
      coordinates: el.geometry.map((p) => [p.lon, p.lat]),
    },
  }))

const fc = {
  type: 'FeatureCollection',
  generator: 'mme scripts/fetch-osm-roads.mjs',
  copyright: '© OpenStreetMap contributors (ODbL)',
  bbox: [WEST, SOUTH, EAST, NORTH],
  features,
}

await mkdir('public', { recursive: true })
await writeFile('public/sample-roads.geojson', JSON.stringify(fc))

console.log(`saved ${features.length} ways to public/sample-roads.geojson`)
