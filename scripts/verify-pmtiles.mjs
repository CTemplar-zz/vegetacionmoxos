import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { PMTiles } from "pmtiles";

class LocalSource {
  constructor(path) {
    this.path = resolve(path);
    this.handlePromise = open(this.path, "r");
  }

  getKey() {
    return this.path;
  }

  async getBytes(offset, length) {
    const handle = await this.handlePromise;
    const data = new Uint8Array(length);
    const { bytesRead } = await handle.read(data, 0, length, offset);
    return { data: data.buffer.slice(0, bytesRead) };
  }

  async close() {
    const handle = await this.handlePromise;
    await handle.close();
  }
}

function lonLatToTile(lon, lat, zoom) {
  const scale = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * scale);
  const latitude = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const radians = latitude * Math.PI / 180;
  const y = Math.floor((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * scale);
  return { x, y };
}

for (const path of process.argv.slice(2)) {
  const remote = /^https?:\/\//i.test(path);
  const source = remote ? path : new LocalSource(path);
  const archive = new PMTiles(source);
  const header = await archive.getHeader();
  const metadata = await archive.getMetadata();
  const { x, y } = lonLatToTile(header.centerLon, header.centerLat, header.maxZoom);
  const tile = await archive.getZxy(header.maxZoom, x, y);
  console.log(JSON.stringify({
    file: path,
    specVersion: header.specVersion,
    minZoom: header.minZoom,
    maxZoom: header.maxZoom,
    addressedTiles: header.numAddressedTiles,
    centerTileBytes: tile?.data.byteLength ?? 0,
    vectorLayers: metadata?.vector_layers?.map((layer) => layer.id) ?? [],
  }));
  if (!remote) await source.close();
}
