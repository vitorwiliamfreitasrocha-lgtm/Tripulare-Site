// Núcleo da área de colaboradores: Firebase (Auth + Firestore), verificação de
// colaborador, topo da página, upload de imagens e utilitários.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore, doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { firebaseConfig, CLOUDINARY, escapeHtml } from './config.js';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

/** Resolve com o usuário logado (ou null) assim que o Auth restaura a sessão. */
export function currentUser() {
  return new Promise((resolve) => {
    const off = onAuthStateChanged(auth, (u) => { off(); resolve(u); });
  });
}

/**
 * Colaborador = existe o doc `staff/{uid}` (criado pelo dono no console do
 * Firebase). As regras do Firestore usam o mesmo critério pra liberar escrita.
 */
export async function getStaff(user) {
  if (!user) return null;
  const snap = await getDoc(doc(db, 'staff', user.uid));
  if (!snap.exists()) return null;
  const data = snap.data();
  return { uid: user.uid, email: user.email, name: data.name || user.email, ...data };
}

/** Use no topo das páginas internas: sem login/permissão, volta pro login. */
export async function requireStaff() {
  const user = await currentUser();
  const staff = user ? await getStaff(user).catch(() => null) : null;
  if (!staff) {
    location.replace(`./?next=${encodeURIComponent(location.pathname.split('/').pop() + location.search)}`);
    throw new Error('redirect');
  }
  renderTopbar(staff);
  return staff;
}

export function renderTopbar(staff) {
  let bar = document.querySelector('.topbar');
  if (!bar) {
    bar = document.createElement('header');
    bar.className = 'topbar';
    document.body.prepend(bar);
  }
  bar.innerHTML = `
    <a class="brand" href="./"><img src="../assets/tripulare-logo.png" alt="" />Tripulare <small>Colaboradores</small></a>
    <div class="user"><span class="name">${escapeHtml(staff.name)}</span><button class="btn sm" id="logout">Sair</button></div>`;
  bar.querySelector('#logout').addEventListener('click', async () => {
    await signOut(auth);
    location.href = './';
  });
}

// ── Utilitários ──────────────────────────────────────────────────────────

export function toast(text, type = '') {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

/** Modal de confirmação. Resolve true/false. */
export function confirmDialog({ title, text, okLabel = 'Confirmar', danger = false }) {
  return new Promise((resolve) => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
      <h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p>
      <div class="btns"><button class="btn ghost" data-v="0">Cancelar</button>
      <button class="btn ${danger ? 'danger' : ''}" data-v="1">${escapeHtml(okLabel)}</button></div></div>`;
    const close = (v) => { bg.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(false); };
    bg.addEventListener('click', (e) => {
      if (e.target === bg) return close(false);
      const v = e.target.closest('[data-v]')?.dataset.v;
      if (v) close(v === '1');
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(bg);
    bg.querySelector('[data-v="1"]').focus();
  });
}

export function slugify(text) {
  return String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 80).replace(/-+$/g, '') || 'post';
}

/**
 * Reduz a imagem no navegador (máx. 1600px) antes de subir — fotos de celular
 * chegam com 4–8 MB e deixariam o post pesado no app. GIF sobe como está
 * (pra não perder a animação).
 */
async function shrinkImage(file, maxSide = 1600) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  if (scale === 1 && file.size < 900 * 1024) return file;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise((r) => canvas.toBlob(r, type, 0.86));
  return blob || file;
}

/** Sobe a imagem pro Cloudinary e devolve a URL https. */
export async function uploadImage(file) {
  if (!file || !file.type.startsWith('image/')) throw new Error('Escolha um arquivo de imagem.');
  if (file.size > 15 * 1024 * 1024) throw new Error('Imagem muito grande (máx. 15 MB).');
  const body = new FormData();
  body.append('file', await shrinkImage(file));
  body.append('upload_preset', CLOUDINARY.preset);
  body.append('folder', CLOUDINARY.folder);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY.cloud}/image/upload`, { method: 'POST', body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.secure_url) throw new Error(json?.error?.message || 'Falha no upload da imagem.');
  return json.secure_url;
}

export function friendlyError(e) {
  const code = e?.code || '';
  if (code === 'permission-denied') return 'Sem permissão. Sua conta precisa estar cadastrada como colaborador.';
  if (code === 'unavailable') return 'Sem conexão com o servidor. Tente de novo.';
  return e?.message || 'Algo deu errado. Tente de novo.';
}
