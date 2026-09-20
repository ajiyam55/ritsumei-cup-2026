const API_URL = "https://script.google.com/macros/s/AKfycbyAPO3XOKBB4nJb_1x47j4HxGDsLG0aD4DLI7HcaVbeKDf4rbKJpco4aD0X7i7QgMlE9g/exec";

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

async function fetchNextMatch() {
  try {
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

      const currentNum = Number(courtData.currentNum);
      numEl.textContent = Number.isFinite(currentNum)
        ? String(Math.floor((currentNum - 1) / 3) + 1)
        : "—";

      // 現在の3体グループ（3試合、今の試合だけ強調）→ その下に3体分の機体名（全部灰色）
      const listEl = document.getElementById(`match-${court}-list`);
      if (listEl) {
        const matches = courtData.matches || [];
        listEl.innerHTML = matches.map(renderMatchRow).join("") + renderTrioRoster(courtData.trioRoster);
      }

      // 待機（次の3体グループ）
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
  }
}

window.addEventListener("DOMContentLoaded", () => {
  fetchNextMatch();

  // タブ/アプリから戻ってきた時だけ自動で1回更新（常時ポーリングはしない）
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      fetchNextMatch();
    }
  });

  // 「今すぐ更新」ボタン：ページリロードせずfetchNextMatchだけ再実行
  const refreshBtn = document.getElementById("refresh-match-btn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      fetchNextMatch();
      refreshBtn.classList.add("is-refreshing");
      setTimeout(() => refreshBtn.classList.remove("is-refreshing"), 500);
    });
  }

  // 各コート内のミニ更新ボタン（スマホ用：スクロールせず自分のコートだけ更新）
  document.querySelectorAll(".refresh-btn-mini").forEach((btn) => {
    btn.addEventListener("click", () => {
      fetchNextMatch();
      btn.classList.add("is-refreshing");
      setTimeout(() => btn.classList.remove("is-refreshing"), 500);
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
});
