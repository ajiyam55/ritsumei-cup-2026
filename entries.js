// 出場機体一覧(index.html の <div id="entry-list"> の中に自動で並べる)
// documents/ に 1.txt, 2.txt, 3.txt ... と「出場番号.txt」の名前で置くだけ(最大192まで)。
// ファイルが無い番号は枠も作らない。1つも無ければセクションごと非表示。
// API(Apps Script)は使わず、同じサイト内のファイルを読むだけなのでアクセスが増えても影響なし。
(function () {
  // ===== 設定 =====
  const ENTRY_MAX = 192;                 // 探す番号の上限(1〜この番号まで探す)
  const ENTRY_DIR = "documents/";        // 置き場所(index.htmlと同じ階層のdocumentsフォルダ。変わったらここだけ直す)
  const EXTENSIONS = ["txt"];            // 探す拡張子。png等も使うなら ["svg","png"] のように足す(無い番号の探索が増える)
  const FILE_NAME = (n) => String(n);    // ファイル名。2桁ゼロ埋めなら String(n).padStart(2, "0")
  const MOBILE_WIDTH_PX = 720;           // スマホでの画像の幅(枠より広いと横スクロール)
  const FRAME_MAX_HEIGHT = "75vh";       // 枠の高さ
  // =================

  const root = document.getElementById("entry-list");
  if (!root) return;
  const section = root.closest("section") || root;
  section.hidden = true; // 見つかるまで出さない

  const style = document.createElement("style");
  style.textContent = `
    .entries-frame{max-height:${FRAME_MAX_HEIGHT};overflow:auto;border:1px solid #d4cdd0;border-radius:10px;background:#fff;-webkit-overflow-scrolling:touch}
    .entries-frame:focus-visible{outline:2px solid #7b1e24}
    .entries-frame figure{margin:0;border-bottom:1px solid #eee}
    .entries-frame figure:last-child{border-bottom:0}
    .entries-frame img{display:block;height:auto;width:${MOBILE_WIDTH_PX}px;max-width:none}
    @media (min-width:768px){
      .entries-frame{overflow-x:hidden}
      .entries-frame img{width:100%;max-width:100%}
    }
  `;
  document.head.appendChild(style);

  // 1つの番号について、実在する画像を探す(読み込めたimg要素 or null)
  function probe(n) {
    return new Promise((resolve) => {
      let i = 0;
      const img = new Image();
      img.decoding = "async";
      img.alt = `出場番号${n}`;
      img.onload = () => resolve(img);
      img.onerror = () => {
        i += 1;
        if (i < EXTENSIONS.length) img.src = `${ENTRY_DIR}${FILE_NAME(n)}.${EXTENSIONS[i]}`;
        else resolve(null);
      };
      img.src = `${ENTRY_DIR}${FILE_NAME(n)}.${EXTENSIONS[0]}`;
    });
  }

  const tasks = [];
  for (let n = 1; n <= ENTRY_MAX; n++) tasks.push(probe(n));

  Promise.all(tasks).then((imgs) => {
    const found = imgs.filter(Boolean);
    if (found.length === 0) return; // 1つも無ければセクションごと非表示のまま
    const frame = document.createElement("div");
    frame.className = "entries-frame";
    frame.tabIndex = 0;
    frame.setAttribute("role", "region");
    frame.setAttribute("aria-label", "出場機体一覧");
    found.forEach((img) => {
      const figure = document.createElement("figure");
      figure.appendChild(img);
      frame.appendChild(figure);
    });
    root.appendChild(frame);
    section.hidden = false;
  });
})();
