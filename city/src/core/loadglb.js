// Models ship as base64 text (`name.glb.txt`): the artifact host serves text
// but not .glb. Decoding here keeps everything inside one fetch per model,
// with no data: URLs (which a page's CSP may refuse to fetch).
export async function loadGLB(loader, url) {
  const res = await fetch(`${url}.txt`);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const b64 = (await res.text()).trim();
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const base = url.slice(0, url.lastIndexOf('/') + 1);
  return loader.parseAsync(bytes.buffer, base);
}
