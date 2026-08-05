const API_URL = "https://script.google.com/macros/s/AKfycbx_YKfaDrUCjURsOrAa3-nWQE9nd_jjn1xilldP491wKJph-iIJ7hTPSpSll_rUR1Jw/exec";
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

      // 現在の試合番号（スタッフが入力した番号そのまま）
      numEl.textContent = data[`next${key}`] || "—";

      // 次の試合の対戦カード（機体番号＋機体名）
      const teamRed = data[`team${key}1`] || "未設定";
      const teamBlue = data[`team${key}2`] || "未設定";
      const teamsEl = document.getElementById(`match-${court}-teams`);
      if (teamsEl) {
        teamsEl.innerHTML =
          `<div class="team-line red-team">
            <span class="label-red">赤</span>
            <span class="team-red">${teamRed}</span>
          </div>
          <span class="vs">VS</span>
          <div class="team-line blue-team">
            <span class="label-blue">青</span>
            <span class="team-blue">${teamBlue}</span>
          </div>`;
      }

      // 次の次の対戦カード（小さく表示）
      const next2NumEl = document.getElementById(`match-${court}-next2-num`);
      const next2TeamsEl = document.getElementById(`match-${court}-next2-teams`);
      if (next2NumEl && next2TeamsEl) {
        next2NumEl.textContent = data[`afterNext${key}`] || "—";

        const teamRed2 = data[`team${key}1Next2`] || "未設定";
        const teamBlue2 = data[`team${key}2Next2`] || "未設定";
        next2TeamsEl.innerHTML =
          `<div class="team-line red-team">
            <span class="label-red">赤</span>
            <span class="team-red">${teamRed2}</span>
          </div>
          <span class="vs">VS</span>
          <div class="team-line blue-team">
            <span class="label-blue">青</span>
            <span class="team-blue">${teamBlue2}</span>
          </div>`;
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

// 次の試合情報を更新する関数
function updateMatchInfo() {
  fetch('match-info.json')
    .then(response => response.json())
    .then(data => {
      // Aコート
      document.getElementById('match-a').textContent = data.courtA.current || '—';
      const teamsA = document.getElementById('match-a-teams');
      if (data.courtA.next && data.courtA.next.red && data.courtA.next.blue) {
        teamsA.innerHTML = `
          <div class="teams">
            <div class="team-line red-team">
              <span class="label-red">赤</span>
              <span class="team-red">${data.courtA.next.red}</span>
            </div>
            <div class="vs">VS</div>
            <div class="team-line blue-team">
              <span class="label-blue">青</span>
              <span class="team-blue">${data.courtA.next.blue}</span>
            </div>
          </div>
        `;
      } else {
        teamsA.textContent = '—';
      }

      // Bコート
      document.getElementById('match-b').textContent = data.courtB.current || '—';
      const teamsB = document.getElementById('match-b-teams');
      if (data.courtB.next && data.courtB.next.red && data.courtB.next.blue) {
        teamsB.innerHTML = `
          <div class="teams">
            <div class="team-line red-team">
              <span class="label-red">赤</span>
              <span class="team-red">${data.courtB.next.red}</span>
            </div>
            <div class="vs">VS</div>
            <div class="team-line blue-team">
              <span class="label-blue">青</span>
              <span class="team-blue">${data.courtB.next.blue}</span>
            </div>
          </div>
        `;
      } else {
        teamsB.textContent = '—';
      }
    })
    .catch(error => {
      console.error('試合情報の取得に失敗しました:', error);
    });
}

// 初回読み込み
updateMatchInfo();

// 10秒ごとに自動更新
setInterval(updateMatchInfo, 10000);
