/* 古物鑑定プロンプト生成PWA
 * - 鑑定ロジックなし（プロンプト生成のみ）
 * - 強制挿入：「新規案件」「今回の画像のみ」「過去参照禁止」
 * - 古家具特則 ON/OFF
 * - 価格表記 v1.2.0：500円単位・平均併記
 * - Cloudflare Pages で静的ホスティング
 */

(function () {
  const $ = (id) => document.getElementById(id);

  const state = {
    mode: "simple", // simple | normal
    kogu: false,
    tone: "neutral",
    itemType: "auto",
    installPromptEvent: null,
  };

  // --- PWA install handling ---
  const btnInstall = $("btnInstall");
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    state.installPromptEvent = e;
    btnInstall.hidden = false;
  });

  btnInstall.addEventListener("click", async () => {
    if (!state.installPromptEvent) return;
    state.installPromptEvent.prompt();
    try {
      await state.installPromptEvent.userChoice;
    } catch (_) {}
    state.installPromptEvent = null;
    btnInstall.hidden = true;
  });

  // --- Service worker registration ---
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js").catch(() => {});
    });
  }

  // --- Mode segmented control ---
  const modeSimple = $("modeSimple");
  const modeNormal = $("modeNormal");

  function setMode(next) {
    state.mode = next;
    const isSimple = next === "simple";
    modeSimple.classList.toggle("is-active", isSimple);
    modeNormal.classList.toggle("is-active", !isSimple);
    modeSimple.setAttribute("aria-pressed", String(isSimple));
    modeNormal.setAttribute("aria-pressed", String(!isSimple));
  }

  modeSimple.addEventListener("click", () => setMode("simple"));
  modeNormal.addEventListener("click", () => setMode("normal"));

  // --- Toggles / selects ---
  const toggleKogu = $("toggleKogu");
  toggleKogu.addEventListener("change", () => (state.kogu = toggleKogu.checked));

  $("tone").addEventListener("change", (e) => (state.tone = e.target.value));
  $("itemType").addEventListener("change", (e) => (state.itemType = e.target.value));

  // --- Price formatting (v1.2.0) ---
  const priceMinRaw = $("priceMinRaw");
  const priceMaxRaw = $("priceMaxRaw");
  const priceMinRounded = $("priceMinRounded");
  const priceMaxRounded = $("priceMaxRounded");
  const priceAvg = $("priceAvg");

  function parseJPY(input) {
    if (!input) return null;
    const s = String(input).replace(/[^\d]/g, "");
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function roundDown500(n) {
    return Math.floor(n / 500) * 500;
  }
  function roundUp500(n) {
    return Math.ceil(n / 500) * 500;
  }
  function roundNearest500(n) {
    return Math.round(n / 500) * 500;
  }

  function formatJPY(n) {
    if (n === null || n === undefined) return "—";
    return `${n.toLocaleString("ja-JP")}円`;
  }

  function updatePricePreview() {
    const min = parseJPY(priceMinRaw.value);
    const max = parseJPY(priceMaxRaw.value);

    let minR = null;
    let maxR = null;
    let avgR = null;

    if (min !== null) minR = roundDown500(min);
    if (max !== null) maxR = roundUp500(max);

    if (minR !== null && maxR !== null) {
      const avg = (minR + maxR) / 2;
      avgR = roundNearest500(avg);
    }

    priceMinRounded.textContent = formatJPY(minR);
    priceMaxRounded.textContent = formatJPY(maxR);
    priceAvg.textContent = formatJPY(avgR);
  }

  [priceMinRaw, priceMaxRaw].forEach((el) => {
    el.addEventListener("input", updatePricePreview);
    el.addEventListener("blur", updatePricePreview);
  });

  updatePricePreview();

  // --- Reset ---
  $("btnReset").addEventListener("click", () => {
    setMode("simple");
    toggleKogu.checked = false;
    state.kogu = false;

    $("tone").value = "neutral";
    state.tone = "neutral";

    $("itemType").value = "auto";
    state.itemType = "auto";

    $("title").value = "";
    $("keywords").value = "";
    $("dims").value = "";
    $("weight").value = "";
    $("condition").value = "";
    $("marks").value = "";
    $("provenance").value = "";
    $("constraints").value = "";
    $("imageInfo").value = "";

    priceMinRaw.value = "";
    priceMaxRaw.value = "";
    $("buyPrice").value = "";

    updatePricePreview();

    $("output").value = "";
    setOutputButtonsEnabled(false);
  });

  // --- Prompt generation ---
  const btnGenerate = $("btnGenerate");
  const btnCopy = $("btnCopy");
  const btnDownload = $("btnDownload");
  const output = $("output");

  function setOutputButtonsEnabled(enabled) {
    btnCopy.disabled = !enabled;
    btnDownload.disabled = !enabled;
  }

  function mapItemType(v) {
    switch (v) {
      case "furniture": return "家具（棚/机/椅子/什器など）";
      case "tools": return "道具/民具";
      case "ceramics": return "陶磁器/ガラス";
      case "metal": return "金属（鉄/真鍮/銅など）";
      case "art": return "絵画/版画/工芸";
      case "toy": return "玩具/ホビー";
      case "brand": return "ブランド/服飾/小物";
      case "other": return "その他";
      default: return "自動判定（入力と画像から推定）";
    }
  }

  function toneHint(tone) {
    if (tone === "buyer") {
      return "仕入れ判断を重視。リスク・不確実性・偽物/復刻/改造の可能性を強めに指摘し、保守的なレンジも提示。";
    }
    if (tone === "seller") {
      return "販売を重視。魅力の言語化、物語性、見せ方、タイトル案、説明文の骨子、撮影/採寸の要点を厚めに。誇張は禁止。";
    }
    return "実務ニュートラル。根拠と不確実性の線引きを明確にし、次に取るべき確認行動を整理。";
  }

  function getRoundedPriceBlock() {
    const min = parseJPY(priceMinRaw.value);
    const max = parseJPY(priceMaxRaw.value);
    const buy = parseJPY($("buyPrice").value);

    const minR = min !== null ? roundDown500(min) : null;
    const maxR = max !== null ? roundUp500(max) : null;
    const avgR = (minR !== null && maxR !== null) ? roundNearest500((minR + maxR) / 2) : null;

    const lines = [];
    if (minR !== null || maxR !== null || avgR !== null || buy !== null) {
      lines.push("【入力済み価格メモ（アプリ側）】");
      if (minR !== null) lines.push(`- 想定レンジ下限（500円単位・切り下げ）: ${formatJPY(minR)}`);
      if (maxR !== null) lines.push(`- 想定レンジ上限（500円単位・切り上げ）: ${formatJPY(maxR)}`);
      if (avgR !== null) lines.push(`- 平均（(下限+上限)/2 を500円単位に丸め）: ${formatJPY(avgR)}`);
      if (buy !== null) lines.push(`- 仕入れ価格: ${formatJPY(buy)}`);
      lines.push("");
    }
    return lines.join("\n");
  }

  function forcedHeader() {
    return [
      "【強制条件（必ず遵守）】",
      "1) 新規案件：今回の案件のみを扱う（継続案件として扱わない）",
      "2) 今回の画像のみ：添付（今回提示）画像以外は参照しない",
      "3) 過去参照禁止：このチャットの過去ログ・記憶・以前の案件を一切参照しない",
      "4) 不確実な推定は断定しない。根拠と推定/確度を分離する。",
      "",
    ].join("\n");
  }

  function priceRulesV120() {
    return [
      "【価格表記ルール（v1.2.0 準拠）】",
      "- すべて日本円（円）で提示。",
      "- 価格は必ず「500円単位」で提示（例：12,500円 / 13,000円）。",
      "- 価格レンジを出す場合は「下限」「上限」に加えて「平均」も併記すること。",
      "- 平均は原則として (下限 + 上限) / 2 を用い、500円単位に丸めて示す。",
      "",
    ].join("\n");
  }

  function koguSpecialRules() {
    return [
      "【古家具特則（ON）】",
      "- 構造：ほぞ/蟻組/釘/ビス、組み方の年代感、後補/改造の疑いを観察ポイントとして列挙。",
      "- 材：無垢/突板/合板、木目、導管、木口、反り・割れ・虫穴の可能性をチェック項目化。",
      "- 金物：真鍮/鉄/アルミ等の材質推定、ネジ規格や経年、交換痕の見方。",
      "- 仕上げ：塗装（オイル/ラッカー/ウレタン等）推定、再塗装の兆候、剥離のリスク。",
      "- 実務：採寸（W/D/H/座面高など）、搬出導線、配送可否、梱包・破損リスクの注意点を必ず出す。",
      "- 販売：商品名（検索されやすい語）・説明文の骨子・撮影カット案（全景/ディテール/傷/裏/金物）を提示。",
      "",
    ].join("\n");
  }

  function buildPrompt() {
    const title = $("title").value.trim();
    const keywords = $("keywords").value.trim();
    const dims = $("dims").value.trim();
    const weight = $("weight").value.trim();
    const condition = $("condition").value.trim();
    const marks = $("marks").value.trim();
    const provenance = $("provenance").value.trim();
    const constraints = $("constraints").value.trim();
    const imageInfo = $("imageInfo").value.trim();

    const modeLabel = state.mode === "simple" ? "簡易鑑定" : "通常鑑定";
    const itemTypeLabel = mapItemType(state.itemType);

    const base = [];
    base.push(forcedHeader());

    base.push("あなたは古物（中古品）鑑定の実務担当者です。");
    base.push("目的：この案件の『鑑定・真贋/年代/材質推定・価値判断・販売戦略』を、画像と入力情報から整理してください。");
    base.push(`鑑定モード：${modeLabel}`);
    base.push(`対象カテゴリ：${itemTypeLabel}`);
    base.push(`出力の口調方針：${toneHint(state.tone)}`);
    base.push("");

    base.push(priceRulesV120());

    if (state.mode === "simple") {
      base.push("【出力要件（簡易鑑定）】");
      base.push("- まず結論（カテゴリ推定 / 要注意点 / 次の確認3つ）→ 根拠 → 価格レンジ → 出品方針の順。");
      base.push("- 文章は短め。箇条書き中心。推定は確度（高/中/低）を付ける。");
      base.push("- 不足情報が多い場合は『追加で必要な画像/情報』を最小限（最大7項目）で提示。");
      base.push("");
    } else {
      base.push("【出力要件（通常鑑定）】");
      base.push("- ①概要（カテゴリ/用途/年代感）②観察点（画像の何が根拠か）③真贋/復刻/改造リスク");
      base.push("- ④材質/製法/産地/作りの推定 ⑤相場（根拠付き：類似ワード/市場/状態差）");
      base.push("- ⑥価格レンジ（下限/上限/平均：500円単位）⑦販売戦略（タイトル案/説明骨子/注意書き）");
      base.push("- ⑧追加で撮るべき写真・確認質問（優先順位つき）");
      base.push("");
    }

    if (state.kogu) base.push(koguSpecialRules());

    base.push("【案件入力（ユーザー提供）】");
    base.push(`- 案件名/商品名: ${title || "（未入力）"}`);
    base.push(`- キーワード: ${keywords || "（未入力）"}`);
    base.push(`- サイズ: ${dims || "（未入力）"}`);
    base.push(`- 重量: ${weight || "（未入力）"}`);
    base.push(`- 状態: ${condition || "（未入力）"}`);
    base.push(`- 刻印/ラベル等: ${marks || "（未入力）"}`);
    base.push(`- 来歴/入手経路: ${provenance || "（未入力）"}`);
    base.push(`- 制約（発送/修理/地域など）: ${constraints || "（未入力）"}`);
    base.push(`- 画像情報メモ: ${imageInfo || "（未入力）"}`);
    base.push("");

    const priceBlock = getRoundedPriceBlock();
    if (priceBlock) base.push(priceBlock);

    base.push("【必須アウトプット形式】");
    base.push("以下の見出しをこの順で出力：");
    base.push("1) 結論（要約）");
    base.push("2) カテゴリ/年代/材質の推定（確度付き）");
    base.push("3) 真贋・復刻・改造・欠損リスク（不確実性の線引き）");
    base.push("4) 価格レンジ（下限/上限/平均：500円単位）と根拠");
    base.push("5) 出品戦略（販売先候補、タイトル案、説明文の骨子、注意書き）");
    base.push("6) 追加で必要な写真/情報（優先順位つき）");
    base.push("");
    base.push("【禁止】");
    base.push("- 過去案件や過去ログの参照、ユーザーの履歴推測。");
    base.push("- 断定口調での推測（根拠がない場合）。");
    base.push("- 誇張表現（販売目線でも誇張は不可）。");
    base.push("");

    return base.join("\n");
  }

  btnGenerate.addEventListener("click", () => {
    const text = buildPrompt();
    output.value = text;
    setOutputButtonsEnabled(true);
  });

  btnCopy.addEventListener("click", async () => {
    const text = output.value || "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      btnCopy.textContent = "コピー済み";
      setTimeout(() => (btnCopy.textContent = "コピー"), 900);
    } catch (_) {
      output.focus();
      output.select();
      document.execCommand("copy");
    }
  });

  btnDownload.addEventListener("click", () => {
    const text = output.value || "";
    if (!text) return;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    a.href = url;
    a.download = `kogu-prompt-${stamp}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
})();

// ===== Gemini Share / Image Preview (single block - final) =====
(function () {
  const outputEl = document.querySelector("textarea#output");
  const imgInput = document.getElementById("imgInput");
  const imgPreview = document.getElementById("imgPreview");
  const toastEl = document.getElementById("toast");

  const btnPickImage = document.getElementById("btnPickImage");
  const btnGemini = document.getElementById("btnGemini");
  const btnGeminiImg = document.getElementById("btnGeminiImg");

  // どれかが無い場合は静かに無効化
  if (!outputEl || !imgInput || !toastEl || !btnPickImage || !btnGemini || !btnGeminiImg) return;

  let selectedFile = null;
  let previewUrl = null;
  let toastTimer = null;

  function toast(msg, ms = 1400) {
    toastEl.textContent = msg;
    toastEl.style.display = "block";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.style.display = "none"), ms);
  }

  function getPromptText() {
    return (outputEl.value || "").trim();
  }

  async function copyToClipboard(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    outputEl.focus();
    outputEl.select();
    const ok = document.execCommand("copy");
    window.getSelection?.().removeAllRanges?.();
    if (!ok) throw new Error("copy failed");
    return true;
  }

  async function shareText(text) {
    if (!navigator.share) return false;
    await navigator.share({ text, title: "Prompt" });
    return true;
  }

  async function shareImageAndText(file, text) {
    if (!navigator.share) return false;
    if (navigator.canShare && !navigator.canShare({ files: [file] })) return false;
    await navigator.share({ files: [file], text, title: "Image + Prompt" });
    return true;
  }

  async function shareImageOnly(file) {
    if (!navigator.share) return false;
    if (navigator.canShare && !navigator.canShare({ files: [file] })) return false;
    await navigator.share({ files: [file], title: "Image" });
    return true;
  }

  function openGeminiWeb() {
    window.open("https://gemini.google.com/", "_blank", "noopener");
  }

  function updateImageButtons() {
    btnGeminiImg.disabled = !selectedFile;
  }

  function setBusy(isBusy) {
    btnPickImage.disabled = isBusy;
    btnGemini.disabled = isBusy;
    btnGeminiImg.disabled = isBusy || !selectedFile;
  }

  function revokePreviewUrlIfAny() {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
  }

  function clearSelectedImage() {
    selectedFile = null;
    imgInput.value = "";
    revokePreviewUrlIfAny();

    if (imgPreview) {
      imgPreview.src = "";
      imgPreview.style.display = "none";
    }
    updateImageButtons();
  }

  // 画像選択
  btnPickImage.addEventListener("click", () => imgInput.click());

  imgInput.addEventListener("change", () => {
    const f = imgInput.files?.[0] || null;
    selectedFile = f;

    if (imgPreview) {
      revokePreviewUrlIfAny();

      if (!selectedFile) {
        imgPreview.style.display = "none";
        imgPreview.src = "";
      } else {
        previewUrl = URL.createObjectURL(selectedFile);
        imgPreview.src = previewUrl;
        imgPreview.style.display = "block";
      }
    }

    updateImageButtons();
    if (selectedFile) toast("画像を選択しました");
  });

  // Geminiへ（テキスト）
  btnGemini.addEventListener("click", async () => {
    const text = getPromptText();
    if (!text) return toast("出力が空です");

    setBusy(true);
    try {
      try {
        await copyToClipboard(text);
        toast("コピーしました（共有を開きます）");
      } catch {
        toast("コピーできませんでした（共有を試します）");
      }

      try {
        const ok = await shareText(text);
        if (!ok) openGeminiWeb();
      } catch {
        openGeminiWeb();
      }
    } finally {
      setBusy(false);
    }
  });

  // 画像＋Gemini
  btnGeminiImg.addEventListener("click", async () => {
    const text = getPromptText();
    if (!selectedFile) return toast("画像が未選択です");
    if (!text) return toast("プロンプトが空です");

    setBusy(true);
    try {
      try {
        await copyToClipboard(text);
        toast("コピーしました（画像＋共有を開きます）");
      } catch {
        toast("コピーできませんでした（画像共有を試します）");
      }

      try {
        const ok = await shareImageAndText(selectedFile, text);
        if (ok) {
          clearSelectedImage();
          toast("共有しました（画像をクリア）");
          return;
        }

        const ok2 = await shareImageOnly(selectedFile);
        if (ok2) {
          clearSelectedImage();
          alert(
            "この端末では「画像＋テキスト」の同時共有が不安定です。\nGemini側でプロンプトを貼り付けてください（コピー済み）。"
          );
          return;
        }

        openGeminiWeb();
      } catch {
        openGeminiWeb();
      }
    } finally {
      setBusy(false);
    }
  });

  // 初期状態
  updateImageButtons();
})();
