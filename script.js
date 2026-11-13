// APIのURLは documents/settings.txt の apiUrl から読みます(settings.js が先に読み込まれている必要があります)

function renderMatchRow(m) {
  return `<div class="match-row${m.current ? " is-current" : ""}">
    <span class="match-num">${m.num}</span>
    <span class="team-plain">${m.red.num}番</span>
    <span class="vs">VS</span>
    <span class="team-plain">${m.blue.num}番</span>
  </div>`;
}

function renderTrioRoster(trioRoster) {
  if (!trioRoster || trioRoster.length === 0) return "";
  return `<div class="current-names">
    ${trioRoster.map((t) => `<div>${t.num}番 ${t.name}</div>`).join("")}
  </div>`;
}

function renderWaitingRow(m) {
  return `<div class="waiting-row">
    <span class="match-num">${m.num}</span>
    <span class="team-plain">${m.red.num}番</span>
    <span class="vs">VS</span>
    <span class="team-plain">${m.blue.num}番</span>
  </div>`;
}

function updateLastUpdated() {
  const el = document.getElementById("last-updated");
  if (!el) return;
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  el.textContent = `最終更新: ${hh}:${mm}:${ss}`;
}

// 連打・タブ復帰・自動更新などが重なっても、APIへのfetchは同時に1本だけにする
let fetchNextMatchInFlight = false;

async function fetchNextMatch() {
  if (fetchNextMatchInFlight) return;
  fetchNextMatchInFlight = true;

  try {
    await window.RRST_SETTINGS_READY; // 設定ファイルを読み終えてからURLを使う
    const API_URL = window.RRST_SETTINGS.apiUrl;
    if (!API_URL) throw new Error("settings.txt に apiUrl がありません");
    const res = await fetch(API_URL, { cache: "no-store" }); // キャッシュ無効化で常に最新データ取得
    if (!res.ok) throw new Error(`HTTP error: ${res.status}`);

    const data = await res.json();
    console.log("fetched data:", data); // デバッグ用

    const courts = ["a", "b", "c"];
    const keyMap = { a: "A", b: "B", c: "C" };

    courts.forEach((court) => {
      const key = keyMap[court];
      const numEl = document.getElementById(`match-${court}`);
      if (!numEl) return; // このコートが存在しない場合はスキップ

      const courtData = (data.courts && data.courts[key]) || {};

      if (data.namesVisible === false) {
        // 対戦カードが非表示のときは、ブロック番号(数字)も「？」で伏せる
        numEl.textContent = "？";
      } else {
        const currentNum = Number(courtData.currentNum);
        numEl.textContent = Number.isFinite(currentNum)
          ? String(Math.floor((currentNum - 1) / 3) + 1)
          : "—";
      }

      // 現在の3体グループ(3試合、今の試合だけ強調)→ その下に3体分の機体名(全部灰色)
      const listEl = document.getElementById(`match-${court}-list`);
      if (listEl) {
        const matches = courtData.matches || [];
        listEl.innerHTML = matches.map(renderMatchRow).join("") + renderTrioRoster(courtData.trioRoster);
      }

      // 待機(次の3体グループ)
      const rosterEl = document.getElementById(`match-${court}-waiting-roster`);
      if (rosterEl) {
        const roster = courtData.waitingRoster || [];
        rosterEl.innerHTML = roster.length ? roster.join("<br>") : "—";
      }

      const waitingListEl = document.getElementById(`match-${court}-waiting-list`);
      if (waitingListEl) {
        waitingListEl.innerHTML = (courtData.waitingMatches || []).map(renderWaitingRow).join("");
      }
    });

    updateLastUpdated();
  } catch (err) {
    console.error("fetch error:", err);
  } finally {
    fetchNextMatchInFlight = false;
  }
}

// 連打・大人数の同時アクセス対策: どれか1つのボタンを押したら、
// (全ボタン共通で)一定時間は再度押せないようにする。
// すべてのボタンが同じ fetchNextMatch() を呼ぶだけなので、1つが押せない間は全部押せなくてよい。
const REFRESH_COOLDOWN_MS = 5000;

function startRefreshCooldown(buttons) {
  buttons.forEach((btn) => { if (btn) btn.disabled = true; });
  setTimeout(() => {
    buttons.forEach((btn) => { if (btn) btn.disabled = false; });
  }, REFRESH_COOLDOWN_MS);
}

// 大会設定のコート数が2のときは、Cコートの欄を隠す(settings.js を script.js より先に読み込んでいるとき)
function applyCourtSettings() {
  if (!window.RRST_SETTINGS_READY) return;
  window.RRST_SETTINGS_READY.then((settings) => {
    const keys = ["a", "b", "c"];
    keys.forEach((key, index) => {
      const numEl = document.getElementById(`match-${key}`);
      const courtEl = numEl && numEl.closest(".court");
      if (courtEl) courtEl.style.display = index >= settings.courts ? "none" : "";
    });
  });
}

window.addEventListener("DOMContentLoaded", () => {
  applyCourtSettings();
  fetchNextMatch();

  // タブ/アプリから戻ってきた時だけ自動で1回更新(常時ポーリングはしない)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      fetchNextMatch();
    }
  });

  const refreshBtn = document.getElementById("refresh-match-btn");
  const miniButtons = Array.from(document.querySelectorAll(".refresh-btn-mini"));
  const allRefreshButtons = refreshBtn ? [refreshBtn, ...miniButtons] : miniButtons;

  // 「今すぐ更新」ボタン:ページリロードせずfetchNextMatchだけ再実行
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      if (refreshBtn.disabled) return;
      fetchNextMatch();
      refreshBtn.classList.add("is-refreshing");
      setTimeout(() => refreshBtn.classList.remove("is-refreshing"), 500);
      startRefreshCooldown(allRefreshButtons);
    });
  }

  // 各コート内のミニ更新ボタン(スマホ用:スクロールせず自分のコートだけ更新)
  miniButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      fetchNextMatch();
      btn.classList.add("is-refreshing");
      setTimeout(() => btn.classList.remove("is-refreshing"), 500);
      startRefreshCooldown(allRefreshButtons);
    });
  });

  // トーナメント表の自動リロード
  const tournamentIframe = document.getElementById('tournament-iframe');
  if (tournamentIframe) {
    setInterval(() => {
      const currentSrc = tournamentIframe.src;
      tournamentIframe.src = currentSrc + '&_=' + Date.now(); // キャッシュ回避
    }, 10000); // 10秒ごとに更新
  }
});

// ハンバーガーメニュー
document.addEventListener('DOMContentLoaded', function() {
  const menuToggle = document.querySelector('.menu-toggle');
  const header = document.querySelector('header');

  if (menuToggle) {
    menuToggle.addEventListener('click', function() {
      header.classList.toggle('nav-open');
    });
  }

  // メニューリンクをクリックしたらメニューを閉じる
  const navLinks = document.querySelectorAll('header nav a');
  navLinks.forEach(link => {
    link.addEventListener('click', function() {
      header.classList.remove('nav-open');
    });
  });

    // メニューの外(ページ下部など)をタップしたら閉じる
  document.addEventListener('click', function(e) {
    if (header && header.classList.contains('nav-open') && !header.contains(e.target)) {
      header.classList.remove('nav-open');
    }
  });
});
