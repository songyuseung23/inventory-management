// =================================-------------------
// [중요] 배포된 Apps Script 웹 앱 URL 입력
// =================================-------------------
const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbwD8AR3Csj153b_i1t5SKcd_KVib52-EDhhKX41A-deCzwXpsPUlB046a_lnQarY5fs/exec"; 

let storedPin = "";
let allProducts = [];
let stagedItems = []; // 장바구니(대기열) 배열 추가 
let currentFilter = "폐기";

window.onload = function() {
  document.getElementById('receivedDate').value = new Date().toISOString().substring(0, 10);
  
  const savedInspector = localStorage.getItem('lastInspector');
  if (savedInspector) document.getElementById('inspector').value = savedInspector;

  const localPin = sessionStorage.getItem('userPin');
  if (localPin) {
    storedPin = localPin;
    document.getElementById('pinModal').removeAttribute('open');
  }

  // 1. 백그라운드 데이터 호출 (캐싱)
  fetchProductsSilently();

  // 2. 상품코드 자동완성 리스너
  const codeInput = document.getElementById('productCode');
  const nameInput = document.getElementById('productName');
  
  codeInput.addEventListener('input', function(e) {
    let currentCode = e.target.value.toUpperCase().trim();
    e.target.value = currentCode;

    if (/^(FC|DY|PT)\d{7}$/.test(currentCode)) {
      const foundProduct = allProducts.find(item => item.productCode === currentCode);
      if (foundProduct) {
        nameInput.value = foundProduct.productName;
        nameInput.style.backgroundColor = "#e6ffed";
        setTimeout(() => nameInput.style.backgroundColor = "", 800);
      }
    }
  });
};

function fetchProductsSilently() { 
  fetch(GAS_WEB_APP_URL)
    .then(res => res.json())
    .then(res => { if (res.result === "success") allProducts = res.data; })
    .catch(err => console.log("백그라운드 로드 실패"));
}

function savePin() {
  const pinVal = document.getElementById('pinInput').value.trim();
  if (!pinVal) return alert("비밀번호를 입력하세요.");
  storedPin = pinVal;
  sessionStorage.setItem('userPin', pinVal);
  document.getElementById('pinModal').removeAttribute('open');
}

function switchTab(tabId) {
  document.querySelectorAll('.tab-content, .nav-tab').forEach(el => el.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
  
  if (tabId === 'inputTab') {
    document.getElementById('tab-btn-input').classList.add('active');
    renderCart(); // 탭 이동 시 플로팅 버튼 제어
  } else if (tabId === 'listTab') {
    document.getElementById('tab-btn-list').classList.add('active');
    document.getElementById('floatingBatchBtn').style.display = 'none'; // 조회 탭에서는 버튼 숨김
    fetchProducts();
  }
}

// ----------------------------------------------------
// 신규 기능: 장바구니 담기 (서버 통신 없이 0.1초 즉시 처리)
// ----------------------------------------------------
function addToCart(e) {
  e.preventDefault();
  
  const pCode = document.getElementById('productCode').value.toUpperCase().trim();
  const pName = document.getElementById('productName').value.trim();
  const eDate = document.getElementById('expiryDate').value;
  const rDate = document.getElementById('receivedDate').value;
  const ins = document.getElementById('inspector').value.trim();
  
  localStorage.setItem('lastInspector', ins);
  
  // 배열에 추가
  stagedItems.push({
    productCode: pCode,
    productName: pName,
    expiryDate: eDate,
    receivedDate: rDate,
    inspector: ins
  });
  
  // 폼 비우기 (날짜, 조사자는 유지하여 빠른 연속 입력 지원)
  document.getElementById('productCode').value = '';
  document.getElementById('productName').value = '';
  document.getElementById('expiryDate').value = '';
  
  // 화면 그리기 및 입력창으로 커서 복귀
  renderCart();
  document.getElementById('productCode').focus();
}

function removeFromCart(index) {
  stagedItems.splice(index, 1);
  renderCart();
}

// 장바구니 UI 및 플로팅 버튼 상태 업데이트
function renderCart() {
  const cartSection = document.getElementById('cartSection');
  const cartList = document.getElementById('cartList');
  const floatingBtn = document.getElementById('floatingBatchBtn');
  
  if (stagedItems.length === 0) {
    cartSection.style.display = 'none';
    floatingBtn.style.display = 'none';
    return;
  }
  
  cartSection.style.display = 'block';
  cartList.innerHTML = '';
  
  stagedItems.forEach((item, index) => {
    const div = document.createElement('div');
    div.className = 'cart-item';
    div.innerHTML = `
      <div class="cart-item-info">
        <strong>${item.productName}</strong>
        <span>[${item.productCode}] 유통기한: ${item.expiryDate}</span>
      </div>
      <button class="remove-btn" type="button" onclick="removeFromCart(${index})">❌</button>
    `;
    cartList.appendChild(div);
  });
  
  // 플로팅 버튼 활성화
  floatingBtn.style.display = 'block';
  floatingBtn.innerText = `📦 총 ${stagedItems.length}건 서버로 일괄 전송`;
}

// ----------------------------------------------------
// 신규 기능: 서버로 일괄 전송 (배치 통신)
// ----------------------------------------------------
function submitBatch() {
  if (!storedPin) {
    document.getElementById('pinModal').setAttribute('open', true);
    return;
  }

  const floatingBtn = document.getElementById('floatingBatchBtn');
  floatingBtn.disabled = true;
  floatingBtn.innerText = "⏳ 전송 중... 잠시만 기다려주세요";

  const payload = {
    pin: storedPin,
    items: stagedItems // 장바구니 데이터 통째로 전송
  };

  fetch(GAS_WEB_APP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  })
  .then(res => res.json())
  .then(res => {
    if (res.result === "success") {
      alert(`${stagedItems.length}건이 성공적으로 저장되었습니다.`);
      stagedItems = []; // 장바구니 비우기
      renderCart();
      fetchProductsSilently(); // 백그라운드 캐싱 갱신
    } else {
      alert("오류: " + res.message);
      if (res.message.includes("비밀번호")) {
        sessionStorage.removeItem('userPin');
        storedPin = "";
        document.getElementById('pinModal').setAttribute('open', true);
      }
    }
  })
  .catch(err => alert("통신 중 오류가 발생했습니다: " + err))
  .finally(() => {
    floatingBtn.disabled = false;
    if (stagedItems.length > 0) {
      floatingBtn.innerText = `📦 총 ${stagedItems.length}건 서버로 일괄 전송`;
    }
  });
}

// 데이터 조회 (기존 로직 유지)
function fetchProducts() {
  const loadingEl = document.getElementById('loading');
  const listEl = document.getElementById('productList');
  loadingEl.style.display = 'block';
  listEl.innerHTML = '';

  fetch(GAS_WEB_APP_URL)
    .then(res => res.json())
    .then(res => {
      if (res.result === "success") {
        allProducts = res.data;
        renderList();
      }
    })
    .catch(err => alert("조회 중 오류 발생"))
    .finally(() => loadingEl.style.display = 'none');
}

function setFilter(status) {
  currentFilter = status;
  renderList();
}

function renderList() {
  const listEl = document.getElementById('productList');
  const searchKeyword = document.getElementById('searchInput').value.toLowerCase().trim();
  listEl.innerHTML = '';

  // 1. 전체보기(ALL) 조건을 삭제하고 선택된 필터와 정확히 일치하는 것만 필터링
  const filtered = allProducts.filter(item => {
    const matchesStatus = (item.status === currentFilter);
    const matchesSearch = item.productName.toLowerCase().includes(searchKeyword) || 
                          item.productCode.toLowerCase().includes(searchKeyword);
    return matchesStatus && matchesSearch;
  });

  if (filtered.length === 0) {
    listEl.innerHTML = '<p style="text-align: center; color: #888; padding: 20px 0;">조회된 데이터가 없습니다.</p>';
    return;
  }

  filtered.slice().reverse().forEach(item => {
    // 2. 상태에 따른 뱃지 색상 명확하게 분리
    let badgeClass = "badge-secondary";
    if (item.status === "폐기") badgeClass = "badge-danger";
    else if (item.status === "유통기한 임박상품") badgeClass = "badge-warning";
    else if (item.status === "OK") badgeClass = "badge-success";

    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="card-header">
        <span class="card-title">${item.productName}</span>
        <span class="badge ${badgeClass}">${item.status || '기타'}</span>
      </div>
      <div class="card-info"><b>코드:</b> ${item.productCode}</div>
      <div class="card-info"><b>유통기한:</b> ${item.expiryDate}</div>
      <div class="card-info"><b>입고일자:</b> ${item.receivedDate} | <b>조사자:</b> ${item.inspector}</div>
    `;
    listEl.appendChild(card);
  });
}
