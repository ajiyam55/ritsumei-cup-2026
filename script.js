const API_URL = "https://script.google.com/macros/s/AKfycbwh3lXG7IJeWDe0i93ydI2xyIkhDCezdwb4A5UamDScSTeL5-oao9b_hEFStMw6aRc_/exec";

function renderMatchRow(m) {
  const namesBlock = m.current
    ? `<div class="current-names">
        <div>${m.red.num}番 ${m.red.name}</div>
        <div>${m.blue.num}番 ${m.blue.name}</div>
      </div>`
    : "";
  return `<div class="match-row${m.current ? " is-current" : ""}">
    <span class="match-num">${m.num}</span>
    <span class="team-plain">${m.red.num}番</span>
    <span class="vs">VS</span>
    <span class="team-plain">${m.blue.num}番</span>
  </div>${namesBlock}`;
}

function renderWaitingRow(m) {
  return `<div class="waiting-row">
    <span class="match-num">${m.num}</span>
    <span class="team-plain">${m.red.num}番</span>
    <span class="vs">VS</span>
    <span class="team-plain">${m.blue.num}番</span>
  </div>`;
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

      numEl.textContent = courtData.currentNum || "—";

      // 現在の3体グループ（3試合、今の試合だけ強調）
      const listEl = document.getElementById(`match-${court}-list`);
      if (listEl) {
        listEl.innerHTML = (courtData.matches || []).map(renderMatchRow).join("");
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
  } catch (err) {
    console.error("fetch error:", err);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  fetchNextMatch();
  setInterval(fetchNextMatch, 3000); // 3秒ごとに自動更新

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
