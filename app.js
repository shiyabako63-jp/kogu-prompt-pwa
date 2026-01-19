/* 古物鑑定 PWA (フロント)
   - 画像選択 → モード →（通常のみ入力）→ /api/appraise へ送信
   - 画像は自動圧縮して DataURL(base64) 化
*/

const API_BASE = "https://kogu-prompt-pwa.shiyabako63.workers.dev";
const $ = (sel) => document.querySelector(sel);

const els = {
  btnReset: $("#btnReset"),

  btnCamera: $("#btnCamera"),
  btnGallery: $("#btnGallery"),
  fileCamera: $("#fileCamera"),
  fileGallery: $("#fileGallery"),

  thumbs: $("#thumbs"),
  btnClearImages: $("#btnClearImages"),

  cardMode: $("#cardMode"),
  btnSimple: $("#btnSimple"),
  btnNormal: $("#btnNormal"),

  cardNormal: $("#cardNormal"),
  btnRunNormal: $("#btnRunNormal"),
  btnBackToMode: $("#btnBackToMode"),

  fSize: $("#fSize"),
  fMark: $("#fMark"),
  fPower: $("#fPower"),
  fAccessory: $("#fAccessory"),
  fCondition: $("#fCondition"),
  fNote: $("#fNote"),

  cardProgress: $("#cardProgress"),
  progressTitle: $("#progressTitle"),
  progressSub: $("#progressSub"),
  btnCancel: $("#btnCancel"),

  cardResult: $("#cardResult"),
  resultList: $("#resultList"),
  btnCopyAll: $("#btnCopyAll"),
  btnDownloadAll: $("#btnDownloadAll"),
};

const state = {
  files: /** @type {File[]} */ ([]),
  previews: /** @type {{name:string, size:number, dataUrl:string, mime:string}[]} */ ([]),
  abortCtrl: /** @type {AbortController|null} */ (null),
  lastResults: /** @type {{index:number, name:string, text:string}[]} */ ([]),
};

init();

function init(){
  // SW登録
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {});
  }

  // ボタン→input起動
  els.btnCamera.addEventListener("click", () => els.fileCamera.click());
  els.btnGallery.addEventListener("click", () => els.fileGallery.click());

  // 画像選択
  els.fileCamera.addEventListener("change", async (e) => onFilesPicked(e.target.files));
  els.fileGallery.addEventListener("change", async (e) => onFilesPicked(e.target.files));

  // 画像クリア
  els.btnClearImages.addEventListener("click", resetImagesOnly);

  // リセット
  els.btnReset.addEventListener("click", fullReset);

  // モード
  els.btnSimple.addEventListener("click", () => runAppraisal("simple"));
  els.btnNormal.addEventListener("click", () => showNormalForm());

  // 通常鑑定
  els.btnRunNormal.addEventListener("click", () => runAppraisal("normal"));
  els.btnBackToMode.addEventListener("click", () => {
    hide(els.cardNormal);
    show(els.cardMode);
    scrollToTop(els.cardMode);
  });

  // 中断
  els.btnCancel.addEventListener("click", () => {
    if (state.abortCtrl) state.abortCtrl.abort();
    hide(els.cardProgress);
  });

  // 結果操作
  els.btnCopyAll.addEventListener("click", copyAll);
  els.btnDownloadAll.addEventListener("click", downloadAll);

  syncUI();
}

function syncUI(){
  // 画像があるときだけモード表示
  if (state.previews.length > 0) {
    show(els.cardMode);
    els.btnClearImages.disabled = false;
  } else {
    hide(els.cardMode);
    hide(els.cardNormal);
    hide(els.cardResult);
    els.btnClearImages.disabled = true;
  }
  renderThumbs();
}

function show(el){ el.classList.remove("hidden"); }
function hide(el){ el.classList.add("hidden"); }

function scrollToTop(el){
  el.scrollIntoView({behavior:"smooth", block:"start"});
}

function resetImagesOnly(){
  state.files = [];
  state.previews = [];
  state.lastResults = [];
  els.fileCamera.value = "";
  els.fileGallery.value = "";
  els.resultList.innerHTML = "";
  syncUI();
}

function fullReset(){
  resetImagesOnly();
  // フォームもクリア
  els.fSize.value = "";
  els.fMark.value = "";
  els.fPower.value = "";
  els.fAccessory.value = "";
  els.fCondition.value = "";
  els.fNote.value = "";
  hide(els.cardProgress);
}

async function onFilesPicked(fileList){
  if (!fileList || fileList.length === 0) return;

  // 追加選択は「追記」扱い
  const files = Array.from(fileList).filter(f => f.type.startsWith("image/"));
  if (files.length === 0) return;

  // まずカード結果/通常フォームは隠す
  hide(els.cardResult);
  hide(els.cardNormal);

  // 圧縮&DataURL化
  els.btnCamera.disabled = true;
  els.btnGallery.disabled = true;

  try{
    const converted = [];
    for (const f of files) {
      const out = await fileToCompressedDataUrl(f, 1280, 0.85);
      converted.push({
        name: f.name || "image",
        size: f.size,
        dataUrl: out.dataUrl,
        mime: out.mime,
      });
    }

    // 追記
    state.files.push(...files);
    state.previews.push(...converted);
    syncUI();
    scrollToTop(els.cardMode);
  } finally {
    els.btnCamera.disabled = false;
    els.btnGallery.disabled = false;
    // inputの同じファイル再選択が効くように
    els.fileCamera.value = "";
    els.fileGallery.value = "";
  }
}

function renderThumbs(){
  els.thumbs.innerHTML = "";
  state.previews.forEach((p, i) => {
    const div = document.createElement("div");
    div.className = "thumb";
    div.innerHTML = `
      <img alt="選択画像 ${i+1}" src="${p.dataUrl}">
      <div class="meta">
        <span class="badge">#${i+1}</span>
        <span title="${escapeHtml(p.name)}">${escapeHtml(shorten(p.name, 16))}</span>
      </div>
    `;
    els.thumbs.appendChild(div);
  });
}

function shorten(s, n){
  if (!s) return "";
  return s.length > n ? s.slice(0, n-1) + "…" : s;
}

function escapeHtml(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#39;");
}

function showNormalForm(){
  hide(els.cardResult);
  show(els.cardNormal);
  hide(els.cardMode);
  scrollToTop(els.cardNormal);
}

function buildExtraForNormal(){
  const lines = [];

  const size = els.fSize.value.trim();
  const mark = els.fMark.value.trim();
  const power = els.fPower.value.trim();
  const acc = els.fAccessory.value.trim();
  const cond = els.fCondition.value.trim();
  const note = els.fNote.value.trim();

  if (size) lines.push(`- サイズ：${size}`);
  if (mark) lines.push(`- 刻印/型番/サイン：${mark}`);
  if (power) lines.push(`- 動作/通電：${power}`);
  if (acc)  lines.push(`- 付属品：${acc}`);
  if (cond) lines.push(`- 状態メモ：${cond}`);
  if (note) lines.push(`- 補足：${note}`);

  return lines.join("\n");
}

async function runAppraisal(mode){
  if (state.previews.length === 0) return;

  // UI
  hide(els.cardResult);
  hide(els.cardNormal);
  show(els.cardProgress);

  els.progressTitle.textContent = (mode === "simple") ? "簡易鑑定を実行中…" : "通常鑑定を実行中…";
  els.progressSub.textContent = "画像枚数が多いほど時間がかかります。";

  // cancel用
  state.abortCtrl = new AbortController();

  // payload
  const extra = (mode === "normal") ? buildExtraForNormal() : "";
  const payload = {
    mode: mode, // "simple" | "normal"
    // 画像ごとに処理して返してもらう想定
    images: state.previews.map(p => ({ dataUrl: p.dataUrl, mime: p.mime, name: p.name })),
    extra: extra,
  };

  try{
    const res = await fetch(`${API_BASE}/api/appraise`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(payload),
      signal: state.abortCtrl.signal,
    });

    if (!res.ok) {
      const t = await safeText(res);
      throw new Error(`HTTP ${res.status}\n${t || "リクエストに失敗しました"}`);
    }

    /** 期待するレスポンス例：
     * { results: [ { index:0, text:"..." }, { index:1, text:"..." } ] }
     */
    const data = await res.json();
    const results = Array.isArray(data?.results) ? data.results : [];
    if (results.length === 0) {
      throw new Error("結果が空です（Worker側の返却形式を確認してください）");
    }

    // 整形して表示
    state.lastResults = results.map(r => ({
      index: Number.isFinite(r.index) ? r.index : 0,
      name: state.previews[Number.isFinite(r.index) ? r.index : 0]?.name || `image`,
      text: String(r.text || ""),
    }));

    renderResults();
    show(els.cardResult);
    scrollToTop(els.cardResult);
  } catch(err){
    if (err?.name === "AbortError") return;
    renderError(String(err?.message || err));
    show(els.cardResult);
    scrollToTop(els.cardResult);
  } finally {
    hide(els.cardProgress);
    state.abortCtrl = null;
  }
}

async function safeText(res){
  try { return await res.text(); } catch { return ""; }
}

function renderResults(){
  els.resultList.innerHTML = "";

  state.lastResults.forEach((r) => {
    const card = document.createElement("div");
    card.className = "resultCard";

    const title = `画像 #${r.index + 1}（${shorten(r.name, 24)}）`;
    card.innerHTML = `
      <div class="resultHead">
        <div class="resultTitle">${escapeHtml(title)}</div>
        <div class="row" style="margin:0;">
          <button class="btn btn-ghost btnCopyOne" type="button">コピー</button>
        </div>
      </div>
      <div class="resultBody">
        <div class="resultText"></div>
      </div>
    `;

    card.querySelector(".resultText").textContent = r.text;

    const btn = card.querySelector(".btnCopyOne");
    btn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(r.text);
      btn.textContent = "コピー済み";
      setTimeout(() => (btn.textContent = "コピー"), 900);
    });

    els.resultList.appendChild(card);
  });
}

function renderError(msg){
  els.resultList.innerHTML = "";
  const card = document.createElement("div");
  card.className = "resultCard";
  card.innerHTML = `
    <div class="resultHead">
      <div class="resultTitle">エラー</div>
    </div>
    <div class="resultBody">
      <div class="resultText"></div>
    </div>
  `;
  card.querySelector(".resultText").textContent =
`鑑定に失敗しました。

考えられる原因：
- /api/appraise（Worker）が未設定
- Worker側でGemini APIが失敗
- 画像が大きすぎる / 枚数が多すぎる

詳細：
${msg}`;
  els.resultList.appendChild(card);
}

async function copyAll(){
  if (!state.lastResults.length) return;
  const txt = state.lastResults
    .sort((a,b)=>a.index-b.index)
    .map(r => `【画像 #${r.index+1}】\n${r.text}`)
    .join("\n\n--------------------\n\n");
  await navigator.clipboard.writeText(txt);
  els.btnCopyAll.textContent = "コピー済み";
  setTimeout(()=> els.btnCopyAll.textContent = "全部コピー", 900);
}

function downloadAll(){
  if (!state.lastResults.length) return;
  const txt = state.lastResults
    .sort((a,b)=>a.index-b.index)
    .map(r => `【画像 #${r.index+1}】\n${r.text}`)
    .join("\n\n--------------------\n\n");

  const blob = new Blob([txt], {type:"text/plain;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `appraisal_${new Date().toISOString().slice(0,10)}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * 画像を圧縮して DataURL にする
 * @param {File} file
 * @param {number} maxSide
 * @param {number} quality 0-1 (jpeg/webp)
 * @returns {Promise<{dataUrl:string, mime:string}>}
 */
function fileToCompressedDataUrl(file, maxSide, quality){
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = async () => {
      try{
        const {w, h} = fitInside(img.width, img.height, maxSide);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", {alpha:false});
        ctx.drawImage(img, 0, 0, w, h);

        // 出力形式：できれば webp、だめなら jpeg、PNGはそのままだと重いのでjpeg/webpへ寄せる
        const prefer = "image/webp";
        let mime = prefer;
        let dataUrl = "";
        try{
          dataUrl = canvas.toDataURL(mime, quality);
          if (!dataUrl.startsWith("data:image/webp")) throw new Error("webp not supported");
        } catch {
          mime = "image/jpeg";
          dataUrl = canvas.toDataURL(mime, quality);
        }

        resolve({dataUrl, mime});
      } catch(e){
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("画像の読み込みに失敗しました"));
    };

    img.src = url;
  });
}

function fitInside(w, h, maxSide){
  if (w <= maxSide && h <= maxSide) return {w, h};
  const scale = maxSide / Math.max(w, h);
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}
