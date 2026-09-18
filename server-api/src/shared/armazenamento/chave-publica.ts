/** Caminho exato de imagem/capa; nunca aceita referências, encoding ou traversal. */
export function panoramaDaChavePublica(chave: unknown): string | null {
  if (typeof chave !== 'string') return null;
  const resultado =
    /^panoramas\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[0-9]{1,16}\/(?:original|tratada|capa)\.jpg$/.exec(
      chave,
    );
  return resultado?.[1] ?? null;
}
