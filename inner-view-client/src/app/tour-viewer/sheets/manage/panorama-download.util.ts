/** Caracteres recusados pelos nomes de arquivo no Windows e no macOS. */
const CARACTERES_INVALIDOS = /[\\/:*?"<>|]+/g;

/**
 * Monta um nome legível e seguro para a cena baixada.
 *
 * Mantido puro para o download não depender do DOM nos testes. O separador
 * entre imóvel e ambiente faz dois arquivos de nomes iguais continuarem
 * distinguíveis na pasta de downloads.
 */
export function panoramaFilename(propertyTitle: string, roomName: string): string {
  const base =
    [propertyTitle, roomName]
      .map((trecho) => (trecho ?? '').trim())
      .filter(Boolean)
      .join(' - ') || 'panorama';

  return `${base.replace(CARACTERES_INVALIDOS, '_').replace(/\s+/g, ' ').trim()}.jpg`;
}
