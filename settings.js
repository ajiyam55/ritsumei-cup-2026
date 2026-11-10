// 大会設定の読み込み(全ページ共通)
// documents/settings.txt(静的ファイル)を読むだけで、Apps Script(API)は使いません。
// ファイルが無い・壊れているときは、下の DEFAULTS(初期値)で動きます。
// 設定の作り方は管理者ページの「大会設定」タブを見てください。
(function () {
  var SETTINGS_PATH = "documents/settings.txt"; // 設定ファイルの場所(変わったらここだけ直す)

  var ROUND_KEYS = ["1回戦", "2回戦", "3回戦", "準々決勝", "準決勝", "最終戦"];
  var DEFAULTS = {
    eventDate: "2026-12-05", // 開催日(YYYY-MM-DD)
    courts: 3,               // コート数(2 または 3)
    entryOpen: false,        // 応募セクションを出すか(true / false)
    wins: { "1回戦": 1, "2回戦": 2, "3回戦": 2, "準々決勝": 2, "準決勝": 2, "最終戦": 2 }
  };
  var FALLBACK_WINS = 2; // 設定に無い回戦は、この本数先取

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  // 変な値が入っていても、使える値だけを取り出す
  function normalize(raw) {
    var out = clone(DEFAULTS);
    if (!raw || typeof raw !== "object") return out;
    if (typeof raw.eventDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.eventDate)) {
      out.eventDate = raw.eventDate;
    }
    if (typeof raw.entryOpen === "boolean") out.entryOpen = raw.entryOpen;
    var courts = Number(raw.courts);
    if (courts === 2 || courts === 3) out.courts = courts;
    if (raw.wins && typeof raw.wins === "object") {
      ROUND_KEYS.forEach(function (key) {
        var wins = Number(raw.wins[key]);
        if (Number.isInteger(wins) && wins >= 1 && wins <= 9) out.wins[key] = wins;
      });
    }
    return out;
  }

  var WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

  // 開催日を表示用の文字にする。style: "dot" → 2026.12.5(土) / "long" → 2026年12月5日（土） / "year" → 2026 / "edition" → 17(第何回か)
  function formatDate(iso, style) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    if (!m) return "";
    var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    var date = new Date(y, mo - 1, d); // 端末のタイムゾーンのまま扱う(日付がずれない)
    if (date.getMonth() !== mo - 1) return ""; // 2月30日などは無効
    var wd = WEEKDAYS[date.getDay()];
    if (style === "dot") return y + "." + mo + "." + d + "(" + wd + ")";
    if (style === "long") return y + "年" + mo + "月" + d + "日（" + wd + "）";
    if (style === "year") return String(y);
    if (style === "edition") return String(y - 2009); // 第何回か(2026年=17回目)
    return "";
  }

  // <span data-setting="date-dot"></span> のような目印のある場所に、設定の値を入れる
  function applyToPage(settings) {
    // ページのタイトル・画像の説明に入っている「立命杯2026」の年は、開催日の年に自動で合わせる
    var yearText = formatDate(settings.eventDate, "year");
    if (yearText) {
      var yearPattern = /(立命杯\s?)20\d\d/;
      if (yearPattern.test(document.title)) document.title = document.title.replace(yearPattern, "$1" + yearText);
      var imgs = document.querySelectorAll("img[alt]");
      for (var k = 0; k < imgs.length; k++) {
        var alt = imgs[k].getAttribute("alt");
        if (yearPattern.test(alt)) imgs[k].setAttribute("alt", alt.replace(yearPattern, "$1" + yearText));
      }
    }
    // data-show-if="entryOpen" の付いた要素は、設定が true のときだけ出す(HTMLには display:none を付けておく)
    var shows = document.querySelectorAll("[data-show-if]");
    for (var j = 0; j < shows.length; j++) {
      var flag = shows[j].getAttribute("data-show-if");
      shows[j].style.display = settings[flag] === true ? "" : "none";
    }
    var nodes = document.querySelectorAll("[data-setting]");
    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute("data-setting");
      var text = "";
      if (key === "date-dot") text = formatDate(settings.eventDate, "dot");
      else if (key === "date-long") text = formatDate(settings.eventDate, "long");
      else if (key === "year") text = formatDate(settings.eventDate, "year");
      else if (key === "edition") text = formatDate(settings.eventDate, "edition");
      if (text) nodes[i].textContent = text;
    }
  }

  window.RRST_DEFAULT_SETTINGS = clone(DEFAULTS);
  window.RRST_ROUND_KEYS = ROUND_KEYS.slice();
  window.RRST_FALLBACK_WINS = FALLBACK_WINS;
  window.RRST_normalizeSettings = normalize;
  window.RRST_formatDate = formatDate;
  window.RRST_SETTINGS = clone(DEFAULTS); // 読み込みが終わるまでは初期値
  window.RRST_SETTINGS_LOADED = false;

  // 読み込み完了で解決される。失敗しても必ず(初期値で)解決するので、待っていてもページは止まらない
  window.RRST_SETTINGS_READY = fetch(SETTINGS_PATH, { cache: "no-cache" })
    .then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.text();
    })
    .then(function (text) {
      window.RRST_SETTINGS = normalize(JSON.parse(text.replace(/^\uFEFF/, "")));
      window.RRST_SETTINGS_LOADED = true; // settings.txt を読めた
    })
    .catch(function (err) {
      console.warn("settings.txt を読めなかったので初期値で動きます:", err);
    })
    .then(function () {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () { applyToPage(window.RRST_SETTINGS); });
      } else {
        applyToPage(window.RRST_SETTINGS);
      }
      return window.RRST_SETTINGS;
    });
})();
