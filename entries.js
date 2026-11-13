// 出場機体一覧: CSVファイル1つを読み込んで、index.html の <div id="entry-list"> に表で表示する。
// CSVは同じサイト内の静的ファイルを読むだけなので、Apps Script(API)は使わない。
// 列(あるものだけ表示): 機体番号, 機体名, フリガナ, 操縦者名, 所属, コート名, 試合番号(見出しが「試合」で始まる列・「2戦目」「2試合目」のような列・そのすぐ右の見出しが空の列は、1つの欄に並べて表示)。意気込みは表示しない
//   ・1行目が見出し(上の名前)なら、列の順番が違っても自動で合わせる
//   ・見出しが無ければ、上の順番どおりとして読む
//   ・文字コードはUTF-8でもExcel標準のShift_JISでも自動判定。"..." で囲んだ項目内のカンマ・改行もOK
//   ・CSVが無い/空のときは、セクションごと非表示
(function () {
  // ===== 設定 =====
  const CSV_PATH = "documents/entries.csv"; // CSVの場所(index.htmlからの相対パス。変わったらここだけ直す)
  const MOBILE_TABLE_WIDTH_PX = 560;        // スマホでの表の幅(枠より広いと横スクロール)
  const FRAME_MAX_HEIGHT = "75vh";          // 枠の高さ
  // =================

  const FIELDS = [
    { key: "num", label: "出場番号", names: ["機体番号", "出場番号", "番号", "No", "No.", "ナンバー"] },
    { key: "robot", label: "出場機体", names: ["機体名", "出場機体", "機体"] },
    { key: "kana", label: "フリガナ", names: ["出場機体のフリガナ", "機体のフリガナ", "機体名フリガナ", "フリガナ", "ふりがな", "ヨミ"] },
    { key: "pilot", label: "操縦者名", names: ["操縦者名", "操縦者", "操縦者氏名", "名前", "氏名"] },
    { key: "team", label: "所属団体", names: ["所属団体", "所属", "団体", "チーム"] },
    { key: "msg", label: "意気込み", names: ["意気込み", "コメント", "一言"] },
    { key: "court", label: "コート", names: ["コート名", "コート", "出場コート", "ブロック"] },
    { key: "match", label: "試合番号", names: ["試合番号", "試合", "第一試合", "初戦"] } // 「試合」で始まる列は全部使う
  ];

  const root = document.getElementById("entry-list");
  if (!root) return;
  const section = root.closest("section") || root;
  section.hidden = true;

  const style = document.createElement("style");
  style.textContent = `
    .entries-frame{max-height:${FRAME_MAX_HEIGHT};overflow:auto;border:1px solid #d4cdd0;border-radius:10px;background:#fff;-webkit-overflow-scrolling:touch}
    .entries-frame:focus-visible{outline:2px solid #7b1e24}
    .entries-table{border-collapse:collapse;width:${MOBILE_TABLE_WIDTH_PX}px;font-size:.9rem;line-height:1.5}
    .entries-table th,.entries-table td{padding:8px 10px;border-bottom:1px solid #eee;text-align:left;vertical-align:top;overflow-wrap:anywhere}
    .entries-table thead th{position:sticky;top:0;background:#f4f0ee;color:#7b1e24;z-index:1;white-space:nowrap}
    .entries-table td.num{font-weight:bold;white-space:nowrap;text-align:center}
    .entries-table .kana{display:block;font-size:.72rem;color:#777176}
    .entries-table .robot{font-weight:bold}
    .entries-table td.msg{white-space:pre-wrap}
    .entries-table .narrow{width:1%;white-space:nowrap;text-align:center}
    @media (min-width:768px){
      .entries-frame{overflow-x:hidden}
      .entries-table{width:100%}
    }
    .entries-table.wide{width:${MOBILE_TABLE_WIDTH_PX + 60}px}
    @media (min-width:768px){
      .entries-table.wide{width:100%}
    }
  `;
  style.textContent += "#entries[hidden]{display:none!important}";
  document.head.appendChild(style);

  // バイト列 → 文字列(UTF-8として読めなければShift_JIS)
  function decode(buffer) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^﻿/, "");
    } catch (e) {
      return new TextDecoder("shift_jis").decode(buffer);
    }
  }

  // CSV解析("..."内のカンマ・改行・"" に対応)
  function parseCsv(text) {
    const rows = [];
    let row = [], cell = "", inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false;
        } else cell += c;
      } else if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); cell = "";
        rows.push(row); row = [];
      } else cell += c;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((v) => v.trim() !== ""));
  }

  // 見出し行から「どの列が何か」を決める。見出しが無ければ既定の順番。
  function mapColumns(rows) {
    const norm = (s) => s.trim().replace(/\s+/g, "");
    const head = rows[0].map(norm);
    const map = {};
    FIELDS.forEach((f) => {
      const idx = head.findIndex((h) => f.names.map(norm).includes(h));
      if (idx >= 0) map[f.key] = idx;
    });
    // 「試合」で始まる見出しの列と、そのすぐ右にある見出しが空の列は、まとめて1つの「試合番号」欄にする
    const matchCols = [];
    const matchNames = FIELDS.find((f) => f.key === "match").names.map(norm);
    head.forEach((h, i) => {
      if (h.startsWith("試合") || /^[0-9０-９]+(戦目|試合目)$/.test(h) || matchNames.includes(h)) {
        matchCols.push(i);
        for (let j = i + 1; j < head.length && head[j] === ""; j++) matchCols.push(j);
      }
    });
    if (matchCols.length) map.match = matchCols[0];
    if (Object.keys(map).length >= 2) return { map, body: rows.slice(1), matchCols, matchHeads: [] }; // 見出しあり
    const fallback = {};
    FIELDS.forEach((f, i) => { fallback[f.key] = i; });
    return { map: fallback, body: rows, matchCols: [], matchHeads: [] };
  }

  function td(className, text) {
    const el = document.createElement("td");
    if (className) el.className = className;
    el.textContent = text;
    return el;
  }

  function render(rows) {
    const { map, body, matchCols, matchHeads } = mapColumns(rows);
    const get = (r, key) => (map[key] === undefined ? "" : (r[map[key]] || "").trim());
    const items = body.map((r) => ({
      num: get(r, "num"), robot: get(r, "robot"), kana: get(r, "kana"),
      pilot: get(r, "pilot"), team: get(r, "team"), msg: get(r, "msg"),
      court: get(r, "court"), match: get(r, "match"),
      matches: matchCols.map((i) => (r[i] || "").trim()).filter((v) => v !== "")
    })).filter((it) => it.num || it.robot || it.pilot);
    if (items.length === 0) return;

    // 出場番号が数字なら番号順に並べる(CSVの並びが違っても揃う)
    items.sort((a, b) => {
      const x = parseFloat(a.num), y = parseFloat(b.num);
      return Number.isNaN(x) || Number.isNaN(y) ? 0 : x - y;
    });

    // CSVに入っている列だけ表示する(例: フリガナ・操縦者・意気込みが空なら列ごと出さない)
    const has = (key) => items.some((it) => it[key] !== "");
    const showKana = has("kana"), showPilot = has("pilot"), showTeam = has("team"), showMsg = false, showNum = has("num"); // 意気込みは表示しない
    const showCourt = has("court");
    const showMatch = items.some((it) => it.matches.length > 0);

    const table = document.createElement("table");
    table.className = "entries-table" + (showCourt || showMatch ? " wide" : "");
    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    const heads = [];
    if (showNum) heads.push("機体番号");
    heads.push("機体名");
    if (showPilot) heads.push("操縦者名");
    if (showTeam) heads.push("所属");
    if (showCourt) heads.push("コート");
    if (showMatch) heads.push("試合番号");
    if (showMsg) heads.push("意気込み");
    heads.forEach((t) => {
      const th = document.createElement("th");
      if (t === "コート" || t === "試合番号") th.className = "narrow";
      th.textContent = t;
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    items.forEach((it) => {
      const tr = document.createElement("tr");
      if (showNum) tr.appendChild(td("num", it.num));
      const robotCell = document.createElement("td");
      if (showKana && it.kana) {
        const k = document.createElement("span");
        k.className = "kana";
        k.textContent = it.kana;
        robotCell.appendChild(k);
      }
      const r = document.createElement("span");
      r.className = "robot";
      r.textContent = it.robot;
      robotCell.appendChild(r);
      tr.appendChild(robotCell);
      if (showPilot) tr.appendChild(td("", it.pilot));
      if (showTeam) tr.appendChild(td("", it.team));
      if (showCourt) tr.appendChild(td("narrow", it.court));
      if (showMatch) tr.appendChild(td("narrow", it.matches.join(" / "))); // 2つあるときは「3 / 12」のように並べる
      if (showMsg) tr.appendChild(td("msg", it.msg));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    const frame = document.createElement("div");
    frame.className = "entries-frame";
    frame.tabIndex = 0;
    frame.setAttribute("role", "region");
    frame.setAttribute("aria-label", "出場機体一覧");
    frame.appendChild(table);
    root.appendChild(frame);
    section.hidden = false;
  }

  fetch(CSV_PATH, { cache: "no-cache" }) // 更新したら次回表示で反映(変更なしなら再ダウンロードしない)
    .then((res) => { if (!res.ok) throw new Error("HTTP " + res.status); return res.arrayBuffer(); })
    .then((buf) => {
      const rows = parseCsv(decode(buf));
      if (rows.length) render(rows);
    })
    .catch((err) => console.error("entries.csv の読み込みに失敗:", err));
})();
