// 結果発表(index.html の一番上のセクション)
// 表示するかどうか・中身は、API(mode=flags)の返事に入っています(管理者ページの「大会設定」で入力・公開)。
// index が元々1回だけ呼ぶ API の返事を使うので、この機能のための通信は増えません。
// 自動更新や更新ボタンはありません(ページを開いたときだけ読み込みます)。
(function () {
  var STYLE = [
    "#results{background:#fff}",
    "#results .results-thanks{margin:0 0 18px;color:#888;font-size:.82rem;line-height:1.8;text-align:center}",
    /* 企業賞の行: 基本は1行。幅に入らないときは、まず文字を少し縮め(fit())、それでも入らなければ折り返す */
    "#results .fit-row{display:flex;align-items:baseline;gap:.2em .6em;white-space:nowrap;overflow:hidden}",
    "#results .fit-row.is-wrapped{flex-wrap:wrap;white-space:normal}",
    /* 1〜3位: 縦に3つ並べる。文字は縮めず、長い名前は折り返す */
    "#results .podium{display:flex;flex-direction:column;gap:10px;list-style:none;margin:0;padding:0}",
    "#results .podium-item{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:center;gap:.15em .6em;text-align:center;padding:16px 14px;border:2px solid var(--medal-edge);border-radius:12px;background:var(--medal-face);color:var(--medal-ink);font-weight:bold;box-shadow:0 6px 16px rgb(60 40 10 / 20%);position:relative}",
    "#results .podium-item.rank-1{font-size:2rem;padding:24px 14px;border-width:3px;box-shadow:0 10px 26px rgb(176 125 0 / 38%)}",
    "#results .podium-item.rank-2{font-size:1.6rem}",
    "#results .podium-item.rank-3{font-size:1.4rem}",
    "#results .podium-item.rank-1{--medal-face:linear-gradient(145deg,#fff6c2 0%,#f8d64e 28%,#e0a814 55%,#fbe27a 78%,#d99a0b 100%);--medal-edge:#b07d00;--medal-ink:#4a3000}",
    "#results .podium-item.rank-2{--medal-face:linear-gradient(145deg,#fff 0%,#dfe4ea 30%,#b4bcc6 58%,#eef1f4 80%,#a3acb7 100%);--medal-edge:#8b95a1;--medal-ink:#2b3138}",
    "#results .podium-item.rank-3{--medal-face:linear-gradient(145deg,#fbdcbc 0%,#e0a672 30%,#c47a3a 58%,#eab98a 80%,#a9642a 100%);--medal-edge:#8f5320;--medal-ink:#3b1f0a}",
    "#results .podium-rank{font-size:.6em;letter-spacing:.15em}",
    "#results .podium-name{min-width:0;overflow-wrap:anywhere}",
    "#results .podium-num,#results .award-num{font-size:.6em;font-weight:normal;opacity:.8}",
    "@media (prefers-reduced-motion:no-preference){#results .rank-1::after{content:'';position:absolute;inset:0;background:linear-gradient(105deg,transparent 35%,rgb(255 255 255 / 75%) 50%,transparent 65%);transform:translateX(-120%);animation:results-shine 1.6s ease-out .5s 1 forwards;pointer-events:none}}",
    "@keyframes results-shine{to{transform:translateX(120%)}}",
    /* 企業賞 */
    "#results .awards-heading{margin:26px 0 12px;padding-bottom:6px;border-bottom:2px solid var(--primary);color:var(--primary);font-size:1.15rem}",
    "#results .awards{display:flex;flex-direction:column;gap:8px;list-style:none;margin:0;padding:0}",
    "#results .award{padding:14px 16px;border:1px solid #e4dcde;border-left:5px solid var(--winner,#c58a18);border-radius:8px;background:#fffdf8;font-size:1.05rem;justify-content:flex-start}",
    "#results .award-title{color:#7a5a10;font-size:.8em;font-weight:bold}",
    "#results .award-name{font-weight:bold}"
  ].join("\n");

  function esc(value) {
    return String(value === undefined || value === null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // 企業賞の行が幅に収まるまで、文字を少しずつ小さくする(短い名前は元の大きさのまま)。
  // MIN_FONT_PX より小さくはしないで、それでも入らなければ折り返す
  var MIN_FONT_PX = 14;
  function fit(row) {
    row.style.fontSize = "";
    row.classList.remove("is-wrapped");
    var size = parseFloat(getComputedStyle(row).fontSize);
    while (row.scrollWidth > row.clientWidth && size > MIN_FONT_PX) {
      size -= 1;
      row.style.fontSize = size + "px";
    }
    if (row.scrollWidth > row.clientWidth) row.classList.add("is-wrapped");
  }

  function fitAll() {
    var rows = document.querySelectorAll("#results .fit-row");
    for (var i = 0; i < rows.length; i++) fit(rows[i]);
  }

  function render(results) {
    var podiumEl = document.getElementById("results-podium");
    var awardsEl = document.getElementById("results-awards");
    if (!podiumEl || !awardsEl) return;

    var podium = (results.podium || []).map(function (item, index) { return { rank: index + 1, item: item }; })
      .filter(function (entry) { return entry.item && (entry.item.name || entry.item.number); });
    podiumEl.innerHTML = podium.length
      ? '<ol class="podium">' + podium.map(function (entry) {
          var item = entry.item;
          return '<li class="podium-item rank-' + entry.rank + '">' +
            '<span class="podium-rank">' + (entry.rank === 1 ? "優勝" : entry.rank + "位") + "</span>" +
            '<span class="podium-name">' + esc(item.name || (item.number ? item.number + "番" : "")) + "</span>" +
            (item.name && item.number ? '<span class="podium-num">' + esc(item.number) + "番</span>" : "") +
            "</li>";
        }).join("") + "</ol>"
      : "";

    var awards = (results.awards || []).filter(function (item) { return item && (item.name || item.number); });
    awardsEl.innerHTML = awards.length
      ? '<h3 class="awards-heading">企業賞</h3><ul class="awards">' + awards.map(function (item) {
          return '<li class="award fit-row">' +
            (item.title ? '<span class="award-title">' + esc(item.title) + "</span>" : "") +
            '<span class="award-name">' + esc(item.name || (item.number + "番")) + "</span>" +
            (item.name && item.number ? '<span class="award-num">' + esc(item.number) + "番</span>" : "") + "</li>";
        }).join("") + "</ul>"
      : "";
    fitAll();
  }

  function start() {
    var style = document.createElement("style");
    style.textContent = STYLE;
    document.head.appendChild(style);

    var resizeTimer = null;
    window.addEventListener("resize", function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(fitAll, 150); });

    // settings.js が API(mode=flags)を呼び終わるのを待つ(公開されていなければ、何も出ない)
    var tries = 0;
    (function waitFlags() {
      if (window.RRST_FLAGS_READY) {
        window.RRST_FLAGS_READY.then(function () {
          var flags = window.RRST_FLAGS || {};
          if (flags.resultsPublished === true && flags.results) render(flags.results);
        });
        return;
      }
      if (tries++ < 100) setTimeout(waitFlags, 50);
    })();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
