// Configuração compartilhada do Crew Life (site público + área de colaboradores).
// A apiKey do Firebase é pública por natureza — quem protege os dados são as
// regras do Firestore (firestore.rules → crewLifePosts / staff).
export const firebaseConfig = {
  apiKey: 'AIzaSyBmgAS0sYvbfQp2GSDIDp7xNFWkA5k0WGs',
  authDomain: 'tripulare-app.firebaseapp.com',
  projectId: 'tripulare-app',
  storageBucket: 'tripulare-app.firebasestorage.app',
  messagingSenderId: '206499560101',
  appId: '1:206499560101:web:a6c0bafb59617b512e2b4c',
};

export const POSTS_COLLECTION = 'crewLifePosts';
export const SITE_URL = 'https://www.tripulare.com.br';
export const postUrl = (id) => `${SITE_URL}/crew-life/post.html?p=${encodeURIComponent(id)}`;

// Cloudinary: mesmo preset unsigned usado pelo app (fotos de perfil).
export const CLOUDINARY = {
  cloud: 'dpzv3dmmm',
  preset: 'tripulare_upload',
  folder: 'tripulare/crewlife',
};

export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.tripulare.app';
export const APP_STORE_URL = 'https://apps.apple.com/br/app/id6784053888';

/** Aplica uma transformação do Cloudinary (thumb/capa) sem tocar em URLs de fora. */
export function cloudinaryResize(url, transform) {
  if (!url || !url.includes('res.cloudinary.com') || !url.includes('/upload/')) return url;
  return url.replace('/upload/', `/upload/${transform}/`);
}

export function formatDate(d) {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date)) return '';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Só deixa passar iframes de vídeo (YouTube/Vimeo) — o resto do HTML do post
// passa pelo DOMPurify antes de ir pra tela.
const IFRAME_HOSTS = /^https:\/\/(www\.)?(youtube\.com|youtube-nocookie\.com|player\.vimeo\.com)\//i;

export function sanitizePostHtml(html) {
  const purify = window.DOMPurify;
  if (!purify) return escapeHtml(html); // sem sanitizador, não renderiza HTML cru
  purify.removeAllHooks();
  purify.addHook('uponSanitizeElement', (node, data) => {
    if (data.tagName === 'iframe' && !IFRAME_HOSTS.test(node.getAttribute('src') || '')) {
      node.parentNode && node.parentNode.removeChild(node);
    }
  });
  purify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.getAttribute('href')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
  return purify.sanitize(html, {
    ADD_TAGS: ['iframe'],
    ADD_ATTR: ['allowfullscreen', 'frameborder', 'target'],
  });
}
