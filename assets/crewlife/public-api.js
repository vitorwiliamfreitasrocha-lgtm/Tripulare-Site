// Leitura pública do Crew Life via REST do Firestore.
// As páginas públicas não carregam o SDK do Firebase (~300 KB): duas chamadas
// HTTP bastam. A regra do Firestore só libera posts com status 'published'.
import { firebaseConfig, POSTS_COLLECTION } from './config.js';

const BASE = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents`;
const KEY = `key=${firebaseConfig.apiKey}`;

// Campos da listagem — o corpo do post (contentHtml/contentDelta) fica de fora.
const LIST_FIELDS = ['title', 'excerpt', 'coverUrl', 'authorName', 'publishedAt', 'readMinutes'];

function decodeValue(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return new Date(v.timestampValue);
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
  return null;
}

function decodeFields(fields) {
  const out = {};
  for (const k of Object.keys(fields || {})) out[k] = decodeValue(fields[k]);
  return out;
}

function decodeDoc(doc) {
  return { id: doc.name.split('/').pop(), _name: doc.name, _rawPublishedAt: doc.fields?.publishedAt?.timestampValue, ...decodeFields(doc.fields) };
}

/**
 * Lista posts publicados, do mais novo pro mais antigo.
 * `after` = último post da página anterior (paginação por cursor).
 */
export async function listPublishedPosts({ pageSize = 12, after = null } = {}) {
  const structuredQuery = {
    from: [{ collectionId: POSTS_COLLECTION }],
    select: { fields: LIST_FIELDS.map((f) => ({ fieldPath: f })) },
    where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'published' } } },
    orderBy: [
      { field: { fieldPath: 'publishedAt' }, direction: 'DESCENDING' },
      { field: { fieldPath: '__name__' }, direction: 'DESCENDING' },
    ],
    limit: pageSize,
  };
  if (after && after._rawPublishedAt) {
    structuredQuery.startAt = {
      values: [{ timestampValue: after._rawPublishedAt }, { referenceValue: after._name }],
      before: false,
    };
  }
  const res = await fetch(`${BASE}:runQuery?${KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery }),
  });
  if (!res.ok) throw new Error(`Falha ao carregar posts (${res.status})`);
  const rows = await res.json();
  return rows.filter((r) => r.document).map((r) => decodeDoc(r.document));
}

/** Busca um post publicado. Retorna null se não existe ou ainda é rascunho. */
export async function getPublishedPost(id) {
  const res = await fetch(`${BASE}/${POSTS_COLLECTION}/${encodeURIComponent(id)}?${KEY}`);
  // Rascunho e inexistente dão 403/404 (a regra nega leitura de não publicados).
  if (res.status === 403 || res.status === 404) return null;
  if (!res.ok) throw new Error(`Falha ao carregar o post (${res.status})`);
  const post = decodeDoc(await res.json());
  return post.status === 'published' ? post : null;
}
