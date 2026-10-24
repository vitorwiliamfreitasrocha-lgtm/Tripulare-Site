// Editor do Crew Life: criar/editar post com Quill 2 (formatação rica estilo Blogger).
import { db, requireStaff, toast, confirmDialog, uploadImage, slugify, friendlyError } from './admin.js';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { POSTS_COLLECTION, postUrl, escapeHtml, formatDate } from './config.js';

const staff = await requireStaff();
const $ = (id) => document.getElementById(id);
const Quill = window.Quill;

// ── Formatos: estilos inline (o HTML salvo fica autossuficiente pro site e o app) ──
const Size = Quill.import('attributors/style/size');
Size.whitelist = ['13px', '20px', '24px', '30px', '38px'];
Quill.register(Size, true);
const Font = Quill.import('attributors/style/font');
Font.whitelist = ['sora', 'serif', 'monospace'];
Quill.register(Font, true);
Quill.register(Quill.import('attributors/style/align'), true);

// Linha divisória (<hr>)
const BlockEmbed = Quill.import('blots/block/embed');
class Divider extends BlockEmbed {}
Divider.blotName = 'divider';
Divider.tagName = 'hr';
Quill.register(Divider);

// "google.com" vira "https://google.com" (sem isso o link quebraria como relativo).
const Link = Quill.import('formats/link');
const baseSanitize = Link.sanitize.bind(Link);
Link.sanitize = (url) => {
  let u = String(url || '').trim();
  if (u && !/^(https?:|mailto:|tel:|#|\/)/i.test(u)) u = `https://${u}`;
  return baseSanitize(u);
};

const Delta = Quill.import('delta');

function toVideoEmbed(url) {
  const u = String(url || '').trim();
  let m = u.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/);
  if (m) return `https://www.youtube.com/embed/${m[1]}`;
  m = u.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (m) return `https://player.vimeo.com/video/${m[1]}`;
  return null;
}

async function insertImages(files, index) {
  let at = index;
  for (const file of files) {
    toast('Enviando imagem…');
    try {
      const url = await uploadImage(file);
      quill.insertEmbed(at, 'image', url, 'user');
      at += 1;
      quill.setSelection(at, 0, 'silent');
      toast('Imagem inserida ✓');
    } catch (e) {
      toast(friendlyError(e), 'error');
    }
  }
}

const quill = new Quill('#editor', {
  theme: 'snow',
  placeholder: 'Comece a escrever seu post…',
  modules: {
    toolbar: {
      container: '#toolbar',
      handlers: {
        undo: () => quill.history.undo(),
        redo: () => quill.history.redo(),
        divider() {
          const r = quill.getSelection(true);
          quill.insertEmbed(r.index, 'divider', true, 'user');
          quill.setSelection(r.index + 1, 0, 'silent');
        },
        image() {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.multiple = true;
          input.onchange = () => {
            const r = quill.getSelection(true);
            insertImages([...input.files], r ? r.index : quill.getLength());
          };
          input.click();
        },
        video() {
          const url = prompt('Cole o link do vídeo do YouTube ou Vimeo:');
          if (!url) return;
          const embed = toVideoEmbed(url);
          if (!embed) return toast('Link de vídeo não reconhecido (use YouTube ou Vimeo).', 'error');
          const r = quill.getSelection(true);
          quill.insertEmbed(r.index, 'video', embed, 'user');
          quill.setSelection(r.index + 1, 0, 'silent');
        },
      },
    },
    history: { delay: 700, maxStack: 300, userOnly: true },
    // Imagem arrastada/colada sobe pro Cloudinary (em vez de virar base64 no texto).
    uploader: {
      mimetypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
      handler(range, files) { insertImages(files, range.index); },
    },
  },
});
quill.theme.tooltip.textbox.dataset.link = 'https://exemplo.com.br';

// HTML colado com imagem embutida (base64, ex.: Word) é descartado — pesaria o post.
quill.clipboard.addMatcher('IMG', (node, delta) =>
  (node.getAttribute('src') || '').startsWith('data:') ? new Delta() : delta);

// ── Estado ────────────────────────────────────────────────────────────────
let postId = new URLSearchParams(location.search).get('id');
let current = { status: 'draft', publishedAt: null };
let coverUrl = '';
let dirty = false;
let saving = false;
const backupKey = () => `crewlife_backup_${postId || 'new'}`;

const titleEl = $('title');
const excerptEl = $('excerpt');

function autoGrow() { titleEl.style.height = 'auto'; titleEl.style.height = `${titleEl.scrollHeight}px`; }

function plainText() { return quill.getText().replace(/\s+/g, ' ').trim(); }

function autoExcerpt() {
  const t = plainText();
  if (t.length <= 200) return t;
  const cut = t.slice(0, 200);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 120 ? cut.lastIndexOf(' ') : 200)}…`;
}

function stats() {
  const words = plainText().split(' ').filter(Boolean).length;
  const minutes = Math.max(1, Math.round(words / 200));
  $('words').textContent = words.toLocaleString('pt-BR');
  $('minutes').textContent = minutes;
  excerptEl.placeholder = autoExcerpt() || 'Gerado automaticamente a partir do texto';
  return { words, minutes };
}

function contentHtml() {
  // getSemanticHTML gera <ul>/<ol> de verdade; &nbsp; viraria texto sem quebra de linha.
  return quill.getSemanticHTML().replace(/&nbsp;/g, ' ');
}

function firstImage() {
  return quill.root.querySelector('img')?.getAttribute('src') || '';
}

function setDirty(v = true) {
  dirty = v;
  if (v) {
    $('savedInfo').textContent = 'Alterações não salvas';
    $('savedInfo').classList.add('dirty');
    scheduleBackup();
  }
}

function renderStatus() {
  const pub = current.status === 'published';
  $('statusBadge').textContent = pub ? 'Publicado' : 'Rascunho';
  $('statusBadge').className = `badge ${pub ? 'pub' : 'draft'}`;
  $('publishBtn').textContent = pub ? 'Atualizar post' : 'Publicar';
  $('saveBtn').textContent = pub ? 'Despublicar' : 'Salvar rascunho';
  $('crumbMode').textContent = postId ? 'Editar post' : 'Novo post';
  $('deleteBtn').hidden = !postId;
  $('viewLink').hidden = !(postId && pub);
  if (postId) $('viewLink').href = postUrl(postId);
}

function renderCover() {
  $('coverImg').hidden = !coverUrl;
  $('coverPlaceholder').hidden = !!coverUrl;
  $('coverActions').hidden = !coverUrl;
  if (coverUrl) $('coverImg').src = coverUrl;
}

// ── Backup local (protege contra aba fechada/queda de energia) ───────────
let backupTimer;
function scheduleBackup() {
  clearTimeout(backupTimer);
  backupTimer = setTimeout(() => {
    try {
      localStorage.setItem(backupKey(), JSON.stringify({
        at: Date.now(), title: titleEl.value, excerpt: excerptEl.value, coverUrl, delta: quill.getContents(),
      }));
    } catch {}
  }, 800);
}
function clearBackup() { try { localStorage.removeItem(backupKey()); localStorage.removeItem('crewlife_backup_new'); } catch {} }
function readBackup() { try { return JSON.parse(localStorage.getItem(backupKey()) || 'null'); } catch { return null; } }

function offerRestore(savedAtMs) {
  const b = readBackup();
  if (!b || (savedAtMs && b.at <= savedAtMs)) return;
  const box = $('restore');
  box.innerHTML = `Você tem alterações não salvas de ${new Date(b.at).toLocaleString('pt-BR')}.
    <button class="btn sm" id="doRestore" style="margin-left:8px">Restaurar</button>
    <button class="btn sm ghost" id="dropRestore">Descartar</button>`;
  box.hidden = false;
  $('doRestore').onclick = () => {
    titleEl.value = b.title || '';
    excerptEl.value = b.excerpt || '';
    coverUrl = b.coverUrl || '';
    quill.setContents(b.delta || [], 'silent');
    autoGrow(); renderCover(); stats(); setDirty(true);
    box.hidden = true;
  };
  $('dropRestore').onclick = () => { clearBackup(); box.hidden = true; };
}

// ── Carregar ─────────────────────────────────────────────────────────────
async function load() {
  if (postId) {
    try {
      const snap = await getDoc(doc(db, POSTS_COLLECTION, postId));
      if (!snap.exists()) {
        toast('Post não encontrado.', 'error');
        setTimeout(() => (location.href = 'crew-life.html'), 1200);
        return;
      }
      const p = snap.data();
      current = p;
      titleEl.value = p.title || '';
      excerptEl.value = p.excerptCustom ? p.excerpt || '' : '';
      coverUrl = p.coverIsCustom === false ? '' : p.coverUrl || '';
      if (p.contentDelta) quill.setContents(JSON.parse(p.contentDelta), 'silent');
      else quill.clipboard.dangerouslyPasteHTML(p.contentHtml || '', 'silent');
      const at = p.updatedAt?.toDate?.();
      $('savedInfo').textContent = at ? `Salvo em ${at.toLocaleString('pt-BR')}` : 'Salvo';
      offerRestore(at ? at.getTime() : 0);
    } catch (e) {
      toast(friendlyError(e), 'error');
    }
  } else {
    offerRestore(0);
  }
  quill.history.clear();
  renderCover(); renderStatus(); stats();
  $('excerptCount').textContent = excerptEl.value.length;
  $('loading').hidden = true;
  $('layout').hidden = false;
  autoGrow(); // só depois de visível: escondido, o scrollHeight é 0
  if (!titleEl.value) titleEl.focus();
}

// ── Salvar ───────────────────────────────────────────────────────────────
async function uniqueId(base) {
  for (let i = 1; i < 50; i++) {
    const id = i === 1 ? base : `${base}-${i}`;
    const snap = await getDoc(doc(db, POSTS_COLLECTION, id));
    if (!snap.exists()) return id;
  }
  return `${base}-${Date.now().toString(36)}`;
}

function setBusy(b) {
  saving = b;
  ['publishBtn', 'saveBtn', 'deleteBtn'].forEach((id) => ($(id).disabled = b));
}

async function save(status) {
  if (saving) return;
  const title = titleEl.value.trim();
  if (!title) { toast('Dê um título ao post.', 'error'); titleEl.focus(); return; }
  const html = contentHtml();
  if (status === 'published' && plainText().length < 20 && !firstImage()) {
    toast('Escreva o conteúdo antes de publicar.', 'error');
    return;
  }
  if (html.length > 700000) { toast('O post ficou grande demais. Divida em duas partes.', 'error'); return; }

  const { minutes } = stats();
  const customExcerpt = excerptEl.value.trim();
  const wasPublished = current.status === 'published';
  const data = {
    title,
    excerpt: customExcerpt || autoExcerpt(),
    excerptCustom: !!customExcerpt,
    // Sem capa escolhida, usa a primeira imagem do texto (o card do app fica com foto).
    coverUrl: coverUrl || firstImage(),
    coverIsCustom: !!coverUrl,
    contentHtml: html,
    contentDelta: JSON.stringify(quill.getContents()),
    status,
    readMinutes: minutes,
    updatedAt: serverTimestamp(),
  };

  setBusy(true);
  try {
    if (!postId) {
      const id = await uniqueId(slugify(title));
      await setDoc(doc(db, POSTS_COLLECTION, id), {
        ...data,
        authorUid: staff.uid,
        authorName: staff.name,
        createdAt: serverTimestamp(),
        publishedAt: status === 'published' ? serverTimestamp() : null,
      });
      clearBackup();
      postId = id;
      history.replaceState(null, '', `editor.html?id=${encodeURIComponent(id)}`);
    } else {
      // A data de publicação é a da PRIMEIRA publicação: editar não joga o post pro topo.
      const patch = { ...data };
      if (status === 'published' && !current.publishedAt) patch.publishedAt = serverTimestamp();
      await updateDoc(doc(db, POSTS_COLLECTION, postId), patch);
      clearBackup();
    }
    current = { ...current, ...data, publishedAt: current.publishedAt || (status === 'published' ? new Date() : null) };
    dirty = false;
    $('savedInfo').textContent = `Salvo em ${new Date().toLocaleString('pt-BR')}`;
    $('savedInfo').classList.remove('dirty');
    renderStatus();
    toast(status === 'published'
      ? (wasPublished ? 'Post atualizado no site e no app ✓' : 'Post publicado! Já aparece no site e no app ✓')
      : (wasPublished ? 'Post despublicado — voltou a ser rascunho.' : 'Rascunho salvo ✓'));
  } catch (e) {
    toast(friendlyError(e), 'error');
  } finally {
    setBusy(false);
  }
}

$('publishBtn').addEventListener('click', () => save('published'));
$('saveBtn').addEventListener('click', async () => {
  if (current.status === 'published') {
    const ok = await confirmDialog({
      title: 'Despublicar este post?',
      text: 'Ele sai do site e do app, mas continua salvo como rascunho para você publicar de novo quando quiser.',
      okLabel: 'Despublicar',
    });
    if (!ok) return;
  }
  save('draft');
});
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    save(current.status === 'published' ? 'published' : 'draft');
  }
});

$('deleteBtn').addEventListener('click', async () => {
  const ok = await confirmDialog({
    title: 'Excluir este post?',
    text: 'Ele sai do site e do app imediatamente. Essa ação não pode ser desfeita.',
    okLabel: 'Excluir', danger: true,
  });
  if (!ok) return;
  setBusy(true);
  try {
    await deleteDoc(doc(db, POSTS_COLLECTION, postId));
    clearBackup();
    dirty = false;
    location.href = 'crew-life.html';
  } catch (e) { toast(friendlyError(e), 'error'); setBusy(false); }
});

window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

// ── Campos ───────────────────────────────────────────────────────────────
titleEl.addEventListener('input', () => { autoGrow(); setDirty(); });
titleEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); quill.focus(); } });
excerptEl.addEventListener('input', () => { $('excerptCount').textContent = excerptEl.value.length; setDirty(); });
quill.on('text-change', (_d, _o, source) => { stats(); hideImgTools(); if (source === 'user') setDirty(); });

// Capa
async function setCoverFile(file) {
  if (!file) return;
  $('coverDrop').classList.add('uploading');
  $('coverPlaceholder').textContent = 'Enviando…';
  try {
    coverUrl = await uploadImage(file);
    renderCover();
    setDirty();
  } catch (e) { toast(friendlyError(e), 'error'); }
  finally {
    $('coverDrop').classList.remove('uploading');
    $('coverPlaceholder').textContent = '＋ Escolher imagem';
  }
}
$('coverInput').addEventListener('change', (e) => setCoverFile(e.target.files[0]));
$('coverChange').addEventListener('click', () => $('coverInput').click());
$('coverRemove').addEventListener('click', () => { coverUrl = ''; $('coverInput').value = ''; renderCover(); setDirty(); });
['dragenter', 'dragover'].forEach((ev) => $('coverDrop').addEventListener(ev, (e) => { e.preventDefault(); $('coverDrop').classList.add('drag'); }));
['dragleave', 'drop'].forEach((ev) => $('coverDrop').addEventListener(ev, () => $('coverDrop').classList.remove('drag')));
$('coverDrop').addEventListener('drop', (e) => { e.preventDefault(); setCoverFile(e.dataTransfer.files[0]); });

// ── Ferramenta de tamanho de imagem ──────────────────────────────────────
const tools = $('imgTools');
const outline = document.createElement('div');
outline.style.cssText = 'position:absolute;pointer-events:none;border:3px solid #0EA08C;border-radius:12px;z-index:14';
outline.hidden = true;
$('editorWrap').appendChild(outline);
let selImg = null;

function placeImgTools() {
  if (!selImg || !selImg.isConnected) return hideImgTools();
  const wrap = $('editorWrap').getBoundingClientRect();
  const r = selImg.getBoundingClientRect();
  const top = r.top - wrap.top;
  Object.assign(outline.style, { top: `${top - 3}px`, left: `${r.left - wrap.left - 3}px`, width: `${r.width + 6}px`, height: `${r.height + 6}px` });
  tools.style.top = `${top > 52 ? top - 48 : top + 8}px`;
  tools.style.left = `${Math.max(8, r.left - wrap.left)}px`;
  const w = selImg.getAttribute('width') || '';
  tools.querySelectorAll('[data-w]').forEach((b) => b.classList.toggle('on', b.dataset.w === w));
  tools.hidden = false;
  outline.hidden = false;
}
function hideImgTools() { selImg = null; tools.hidden = true; outline.hidden = true; }

quill.root.addEventListener('click', (e) => {
  if (e.target.tagName === 'IMG') { selImg = e.target; placeImgTools(); }
  else hideImgTools();
});
document.addEventListener('click', (e) => {
  if (!$('editorWrap').contains(e.target)) hideImgTools();
});
window.addEventListener('resize', hideImgTools);

tools.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn || !selImg) return;
  const blot = Quill.find(selImg);
  if (!blot) return hideImgTools();
  const index = quill.getIndex(blot);
  if ('remove' in btn.dataset) {
    quill.deleteText(index, 1, 'user');
    return hideImgTools();
  }
  const img = selImg;
  quill.formatText(index, 1, 'width', btn.dataset.w || false, 'user');
  selImg = img;
  requestAnimationFrame(placeImgTools);
});

// ── Pré-visualização ─────────────────────────────────────────────────────
function previewDoc() {
  const cover = coverUrl || firstImage();
  const meta = [`Por ${staff.name}`, formatDate(current.publishedAt?.toDate ? current.publishedAt.toDate() : current.publishedAt || new Date()), `${stats().minutes} min de leitura`].join(' · ');
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <link href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="../assets/crewlife/site.css"></head><body>
    <article class="article">
      <span class="eyebrow" style="color:#0EA08C;background:#E6F6F3;border-color:#C9ECE5">Crew Life</span>
      <h1>${escapeHtml(titleEl.value.trim() || 'Título do post')}</h1>
      <div class="meta">${escapeHtml(meta)}</div>
      ${cover ? `<img class="cover" src="${escapeHtml(cover)}" alt="">` : ''}
      <div class="post-body">${contentHtml()}</div>
    </article></body></html>`;
}
$('previewBtn').addEventListener('click', () => {
  $('previewFrame').srcdoc = previewDoc();
  $('preview').hidden = false;
  document.body.style.overflow = 'hidden';
});
$('closePreview').addEventListener('click', () => { $('preview').hidden = true; document.body.style.overflow = ''; });
document.querySelectorAll('[data-device]').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('[data-device]').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelector('.preview-stage').classList.toggle('mobile', b.dataset.device === 'mobile');
}));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('preview').hidden) $('closePreview').click(); });

load();
