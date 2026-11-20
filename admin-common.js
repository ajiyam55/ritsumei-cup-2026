// 管理者用の設定ページ(settings.html = 大会設定 / prepare.html = 更新準備)で共通の部品。
//  ・ログイン画面(開くたびにパスワードを確認する。パスワードはこのページの中だけで持つ)
//  ・APIへのPOST、回戦の一覧、文字のエスケープ
(function () {
  window.RRST_ADMIN = { apiUrl: "", token: "" };

  // 本数を決める回戦の一覧(settings.txt の wins のキー)
  window.RRST_ROUND_ITEMS = [
    { key: "1回戦", sub: "" },
    { key: "2回戦", sub: "" },
    { key: "3回戦", sub: "" },
    { key: "4回戦", sub: "" },
    { key: "5回戦", sub: "" },
    { key: "準々決勝", sub: "" },
    { key: "準決勝", sub: "" },
    { key: "最終戦", sub: "最終決戦・決勝・3位決定戦" }
  ];

  window.RRST_escapeHtml = function (value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  window.RRST_adminPost = function (body) {
    return fetch(window.RRST_ADMIN.apiUrl, {
      method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body)
    }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
  };

  // ログイン画面を動かす。パスワードが合ったら、ログイン画面を隠して #main を出し、onLogin(apiUrl) を呼ぶ。
  // HTML側に必要なもの: #gate #gate-form #gate-url-row #gate-url #gate-password #gate-button #gate-error #main
  window.RRST_adminGate = function (onLogin) {
    var byId = function (id) { return document.getElementById(id); };

    // settings.txt に apiUrl が無いときだけ、URLを入力する欄を出す
    window.RRST_SETTINGS_READY.then(function (settings) {
      if (!settings.apiUrl) byId("gate-url-row").hidden = false;
    });

    byId("gate-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var err = byId("gate-error");
      var btn = byId("gate-button");
      var pass = byId("gate-password").value;
      var url = window.RRST_SETTINGS.apiUrl || byId("gate-url").value.trim();
      if (!url) { err.textContent = "APIのURLを入力してください。"; return; }
      btn.disabled = true; err.textContent = "確認中…";
      window.RRST_ADMIN.apiUrl = url;
      window.RRST_adminPost({ action: "verify", token: pass }).then(function (res) {
        if (res && res.ok) {
          window.RRST_ADMIN.token = pass;
          byId("gate").hidden = true;
          byId("main").hidden = false;
          byId("gate-password").value = "";
          onLogin(url);
        } else {
          err.textContent = "パスワードが違います。";
        }
      }).catch(function () {
        err.textContent = "通信に失敗しました。URLと通信を確認してください。";
      }).then(function () { btn.disabled = false; });
    });
  };
})();
