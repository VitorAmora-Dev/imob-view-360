/**
 * Helpers puros do download de panorama. Separados do componente para os testes
 * exercitarem a construção do data-URI, do nome do arquivo e do Blob sem DOM.
 */

const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]+/g;

/** imageData pode vir como data-URI completo ou base64 cru — normaliza para data-URI. */
export function toPanoramaDataUri(imageData: string): string {
  return imageData.startsWith('data:') ? imageData : `data:image/jpeg;base64,${imageData}`;
}

/** Nome de arquivo seguro a partir do imóvel + ambiente (fallback: panorama.jpg). */
export function panoramaFilename(propertyTitle: string, roomName: string): string {
  const base =
    [propertyTitle, roomName]
      .map((s) => (s ?? '').trim())
      .filter(Boolean)
      .join(' - ') || 'panorama';
  // Troca só os caracteres inválidos de nome de arquivo por "_", preservando
  // espaços e o separador " - ".
  const safe = base.replace(INVALID_FILENAME_CHARS, '_').replace(/\s+/g, ' ').trim();
  return `${safe}.jpg`;
}

/**
 * Decodifica um data-URI base64 num Blob. Preferido ao `<a href="data:…">` porque
 * o equiretangular passa de 1 MB e alguns navegadores móveis truncam data-URIs
 * grandes no atributo href.
 */
export function dataUriToBlob(dataUri: string): Blob {
  const comma = dataUri.indexOf(',');
  const meta = dataUri.slice(0, comma);
  const b64 = dataUri.slice(comma + 1);
  const mime = /data:([^;]+)/.exec(meta)?.[1] ?? 'image/jpeg';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
