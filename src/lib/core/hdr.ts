// Inspect metadata, not the filename, bit depth, or display's HDR capability.
export async function isHdrImage(file: Blob): Promise<boolean> {
  const data = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(data.buffer);
  const text = (start: number, end: number) =>
    new TextDecoder("latin1").decode(data.subarray(start, end));
  const hdr = (transfer: number) => transfer === 16 || transfer === 18;

  if (data[0] === 0x89 && text(1, 4) === "PNG") {
    for (let pos = 8; pos + 12 <= data.length;) {
      const size = view.getUint32(pos);
      if (size > data.length - pos - 12) break;
      const type = text(pos + 4, pos + 8);
      if (type === "cICP" && size === 4 && hdr(data[pos + 9])) return true;
      if (type === "gmAP" && size > 0) return true;
      pos += size + 12;
    }
  }

  if (data[0] === 0xff && data[1] === 0xd8) {
    for (let pos = 2; pos + 4 <= data.length;) {
      if (data[pos] !== 0xff) break;
      const marker = data[pos + 1];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0xff) {
        pos++;
        continue;
      }
      const size = view.getUint16(pos + 2);
      if (size < 2 || pos + size + 2 > data.length) break;
      if (marker === 0xe1 || marker === 0xe2) {
        const metadata = text(pos + 4, pos + 2 + size);
        if (
          (metadata.includes("http://ns.adobe.com/hdr-gain-map/1.0/") &&
            /(?:\w+:)?Version(?:\s*=|>)/.test(metadata)) ||
          metadata.startsWith("urn:iso:std:iso:ts:21496:-1\0") ||
          metadata.includes("urn:com:apple:photo:2020:aux:hdrgainmap")
        )
          return true;
      }
      pos += size + 2;
    }
  }

  if (text(4, 8) === "ftyp") {
    const boxes = (start: number, end: number, depth = 0): boolean => {
      if (depth > 8) return false;
      for (let pos = start; pos + 8 <= end;) {
        let size = view.getUint32(pos);
        let header = 8;
        const type = text(pos + 4, pos + 8);
        if (size === 1) {
          if (pos + 16 > end) break;
          size = Number(view.getBigUint64(pos + 8));
          header = 16;
        } else if (size === 0) size = end - pos;
        if (size < header || size > end - pos) break;
        const body = pos + header;
        if (
          type === "colr" &&
          size >= header + 11 &&
          text(body, body + 4) === "nclx" &&
          hdr(view.getUint16(body + 6))
        )
          return true;
        if (
          (type === "meta" || type === "iprp" || type === "ipco") &&
          boxes(body + (type === "meta" ? 4 : 0), pos + size, depth + 1)
        )
          return true;
        pos += size;
      }
      return false;
    };
    return boxes(0, data.length);
  }
  return false;
}
