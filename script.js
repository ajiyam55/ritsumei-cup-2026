const API_URL = "https://script.google.com/macros/s/AKfycbwPCtb11HP0bb0JGxftEW8zJo0b11WoTMTIiW7IXrNHHIj2CizQK6qKhZNYwfbZS7RggA/exec";
async function fetchNextMatch() {
  try {
    const res = await fetch(API_URL, { cache: "no-store" }); // キャッシュ無効化で常に最新データ取得
    if (!res.ok) throw new Error(`HTTP error: ${res.status}`);

    const data = await res.json();
    console.log("fetched data:", data); // デバッグ用

    // 試合番号（空欄対応）
    document.getElementById("match-a").textContent = data.nextA || "—";
    document.getElementById("match-b").textContent = data.nextB || "—";
    document.getElementById("match-c").textContent = data.nextC || "—";

    // Aコート対戦カード（赤左・青右固定 + ラベル付き）
    const teamA_red = data.teamA1 || "未設定";
    const teamA_blue = data.teamA2 || "未設定";
    document.getElementById("match-a-teams").innerHTML =
      `<div class="team-line red-team">
        <span class="label-red">赤</span>
        <span class="team-red">${teamA_red}</span>
      </div>
      <span class="vs">VS</span>
      <div class="team-line blue-team">
        <span class="label-blue">青</span>
        <span class="team-blue">${teamA_blue}</span>
      </div>`;

    // Bコート対戦カード（赤左・青右固定 + ラベル付き）
    const teamB_red = data.teamB1 || "未設定";
    const teamB_blue = data.teamB2 || "未設定";
    document.getElementById("match-b-teams").innerHTML =
      `<div class="team-line red-team">
        <span class="label-red">赤</span>
        <span class="team-red">${teamB_red}</span>
      </div>
      <span class="vs">VS</span>
      <div class="team-line blue-team">
        <span class="label-blue">青</span>
        <span class="team-blue">${teamB_blue}</span>
      </div>`;

      // Cコート対戦カード（赤左・青右固定 + ラベル付き）
    const teamC_red = data.teamC1 || "未設定";
    const teamC_blue = data.teamC2 || "未設定";
    document.getElementById("match-c-teams").innerHTML =
      `<div class="team-line red-team">
        <span class="label-red">赤</span>
        <span class="team-red">${teamC_red}</span>
      </div>
      <span class="vs">VS</span>
      <div class="team-line blue-team">
        <span class="label-blue">青</span>
        <span class="team-blue">${teamC_blue}</span>
      </div>`;
  } catch (err) {
    console.error("fetch error:", err);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  fetchNextMatch();
  setInterval(fetchNextMatch, 3000); // 3秒ごとに自動更新
  
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
