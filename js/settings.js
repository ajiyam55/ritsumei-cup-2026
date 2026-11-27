// 大会設定の読み込み(全ページ共通)
// documents/settings.txt(静的ファイル)を読むだけで、Apps Script(API)は使いません。
// ファイルが無い・壊れているときは、下の DEFAULTS(初期値)で動きます。
// 設定の作り方は管理者ページの「大会設定」タブを見てください。
// ※ 応募の表示/非表示は、サイト公開後に切り替えたいので、このファイルではなくAPI(管理者ページの
//    「大会設定」→「公開・表示の管理」)に保存されています。data-show-if="entryOpen" の要素は、
//    下の loadFlags() がAPIから読んで出し入れします(読めないときは隠したままです)。
(function () {
  var SETTINGS_PATH = "documents/settings.txt"; // 設定ファイルの場所(変わったらここだけ直す)

  var ROUND_KEYS = ["1回戦", "2回戦", "3回戦", "4回戦", "5回戦", "準々決勝", "準決勝", "最終戦"];
  var DEFAULTS = {
    eventDate: "2026-12-05", // 開催日(YYYY-MM-DD)
    edition: 17,             // 第何回(「今年で17回目」などの表示に使う)。書かなければ 開催年−2009 で自動
    courts: 3,               // コート数(2 または 3)
    mode: "league",          // "league" = リーグ戦→トーナメント / "tournamentOnly" = リーグ無し(出場者を手で決めたトーナメントだけ)
    apiUrl: "",              // API(Apps Script のウェブアプリURL。次の試合・呼び出し・トーナメント表など全部これ1つ)
    entryFormUrl: "",        // 応募フォーム(Googleフォーム)のURL
    wins: { "1回戦": 1, "2回戦": 2, "3回戦": 2, "4回戦": 2, "5回戦": 2, "準々決勝": 2, "準決勝": 2, "最終戦": 2 }
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
    out.edition = Number(out.eventDate.slice(0, 4)) - 2009; // 書いてなければ開催年から自動(2026年=17回目)
    var edition = Number(raw.edition);
    if (Number.isInteger(edition) && edition >= 1 && edition <= 999) out.edition = edition;
    if (typeof raw.apiUrl === "string" && /^https:\/\/script\.google\.com\/\S+$/.test(raw.apiUrl.trim())) out.apiUrl = raw.apiUrl.trim();
    if (typeof raw.entryFormUrl === "string" && /^https?:\/\/\S+$/.test(raw.entryFormUrl.trim())) out.entryFormUrl = raw.entryFormUrl.trim();
    if (raw.mode === "league" || raw.mode === "tournamentOnly") out.mode = raw.mode;
    var courts = Number(raw.courts);
    if (courts === 2 || courts === 3) out.courts = courts;
    if (raw.wins && typeof raw.wins === "object") {
      ROUND_KEYS.forEach(function (key) {
        var wins = Number(raw.wins[key]);
        if (Number.isInteger(wins) && wins >= 0 && wins <= 9 /* 0 = その回戦は使わない(なし) */) out.wins[key] = wins;
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
    // data-href-setting="entryFormUrl" の付いたリンクは、設定のURLに差し替える
    var links = document.querySelectorAll("[data-href-setting]");
    for (var h = 0; h < links.length; h++) {
      var url = settings[links[h].getAttribute("data-href-setting")];
      if (url) links[h].setAttribute("href", url);
    }
    // data-show-mode="league" の要素は、リーグ戦ありの年だけ表示(tournamentOnly の年は隠す)。"tournamentOnly" ならその逆
    var modeNodes = document.querySelectorAll("[data-show-mode]");
    for (var k = 0; k < modeNodes.length; k++) {
      if (modeNodes[k].getAttribute("data-show-mode") !== settings.mode) modeNodes[k].style.display = "none";
    }
    var nodes = document.querySelectorAll("[data-setting]");
    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute("data-setting");
      var text = "";
      if (key === "date-dot") text = formatDate(settings.eventDate, "dot");
      else if (key === "date-long") text = formatDate(settings.eventDate, "long");
      else if (key === "year") text = formatDate(settings.eventDate, "year");
      else if (key === "edition") text = String(settings.edition);
      if (text) nodes[i].textContent = text;
    }
  }

  // data-show-if="entryOpen" の付いた要素(HTMLには display:none を付けておく)を、APIの値に合わせて出し入れする。
  // そういう要素があるページだけ、軽いAPI(mode=flags。シートは読まない)を1回呼ぶ。
  function loadFlags(settings) {
    var shows = document.querySelectorAll("[data-show-if]");
    if (!shows.length || !settings.apiUrl) return;
    var url = settings.apiUrl + (settings.apiUrl.indexOf("?") >= 0 ? "&" : "?") + "mode=flags";
    window.RRST_FLAGS_READY = fetch(url)
      .then(function (res) { return res.json(); })
      .then(function (flags) {
        window.RRST_FLAGS = flags || {};
        for (var j = 0; j < shows.length; j++) {
          shows[j].style.display = flags && flags[shows[j].getAttribute("data-show-if")] === true ? "" : "none";
        }
      })
      .catch(function (err) { console.warn("公開設定(flags)を読めなかったので、応募は隠したままです:", err); });
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
      var run = function () { applyToPage(window.RRST_SETTINGS); loadFlags(window.RRST_SETTINGS); };
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", run);
      } else {
        run();
      }
      return window.RRST_SETTINGS;
    });
})();
