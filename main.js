// ===========================================
// 유통기한 관리 시스템 — Refactored
// ===========================================
// Phase 3-1: DOMContentLoaded 콜백으로 전역 스코프 오염 방지
// Phase 3-3: window.onload → DOMContentLoaded 전환
document.addEventListener('DOMContentLoaded', function () {

  // ========================================
  // 상수
  // ========================================
  const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbwD8AR3Csj153b_i1t5SKcd_KVib52-EDhhKX41A-deCzwXpsPUlB046a_lnQarY5fs/exec";

  // Phase 2-4: 정규식 상수화 (Single Source of Truth)
  const CODE_PATTERN = /^(FC|DY|PT)\d{7}$/;

  // Phase 2-2: 캐시 유효시간 (30초)
  const CACHE_TTL = 30000;

  // Phase 5: 페이지네이션 단위
  const PAGE_SIZE = 50;

  // ========================================
  // 상태 (전역 → 클로저 스코프)
  // ========================================
  let storedPin = "";
  let allProducts = [];
  let stagedItems = [];
  let currentFilter = "폐기";
  let lastFetchTime = 0;
  let searchTimer = null;
  let currentPage = 1;
  let pendingDeleteItem = null; // 삭제 대기 중인 물품 정보
  let isDeleting = false; // 삭제 진행 중 중복 방지

  // ========================================
  // Phase 2-3: DOM 요소 캐싱
  // ========================================
  const DOM = {
    productCode:  document.getElementById('productCode'),
    productName:  document.getElementById('productName'),
    expiryDate:   document.getElementById('expiryDate'),
    receivedDate: document.getElementById('receivedDate'),
    inspector:    document.getElementById('inspector'),
    pinModal:     document.getElementById('pinModal'),
    pinInput:     document.getElementById('pinInput'),
    floatingBtn:  document.getElementById('floatingBatchBtn'),
    cartSection:  document.getElementById('cartSection'),
    cartList:     document.getElementById('cartList'),
    productList:  document.getElementById('productList'),
    searchInput:  document.getElementById('searchInput'),
    loading:      document.getElementById('loading'),
    entryForm:    document.getElementById('entryForm'),
    tabBtnInput:  document.getElementById('tab-btn-input'),
    tabBtnList:   document.getElementById('tab-btn-list'),
    deleteModal:      document.getElementById('deleteModal'),
    deleteModalMsg:   document.getElementById('deleteModalMessage'),
    deleteCancelBtn:  document.getElementById('deleteCancelBtn'),
    deleteConfirmBtn: document.getElementById('deleteConfirmBtn'),
  };

  // ========================================
  // Phase 1-1: XSS 방어 유틸리티
  // ========================================
  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ========================================
  // Phase 1-2: 검색 디바운싱
  // ========================================
  function debouncedSearch() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderList, 200);
  }

  // ========================================
  // 초기화
  // ========================================
  function init() {
    // Phase 2-4: HTML pattern 속성을 JS에서 세팅
    DOM.productCode.pattern = CODE_PATTERN.source;

    // 입고날짜 기본값: 오늘
    DOM.receivedDate.value = new Date().toISOString().substring(0, 10);

    // 조사자 복원
    const savedInspector = localStorage.getItem('lastInspector');
    if (savedInspector) DOM.inspector.value = savedInspector;

    // PIN 세션 복원
    const localPin = sessionStorage.getItem('userPin');
    if (localPin) {
      storedPin = localPin;
      DOM.pinModal.removeAttribute('open');
    }

    // 이벤트 바인딩
    bindEvents();

    // 백그라운드 데이터 로드 (캐싱)
    fetchProducts();
  }

  // ========================================
  // Phase 3-2: addEventListener 일괄 바인딩
  // ========================================
  function bindEvents() {
    // 탭 전환
    DOM.tabBtnInput.addEventListener('click', function () { switchTab('inputTab'); });
    DOM.tabBtnList.addEventListener('click', function () { switchTab('listTab'); });

    // 입고 폼 제출
    DOM.entryForm.addEventListener('submit', addToCart);

    // 검색 입력 (디바운싱)
    DOM.searchInput.addEventListener('input', debouncedSearch);

    // 플로팅 일괄 전송 버튼
    DOM.floatingBtn.addEventListener('click', submitBatch);

    // 필터 버튼 — 이벤트 위임 (data-filter 속성 활용)
    document.querySelector('.filter-group').addEventListener('click', function (e) {
      var btn = e.target.closest('.filter-btn');
      if (btn && btn.dataset.filter) {
        setFilter(btn.dataset.filter);
      }
    });

    // PIN 모달 확인 버튼
    document.querySelector('#pinModal footer button').addEventListener('click', savePin);

    // 상품코드 유효성 검사 메시지 (인라인 oninvalid/oninput 대체)
    DOM.productCode.addEventListener('invalid', function () {
      this.setCustomValidity('FC, DY, PT로 시작하는 9자리 코드를 입력해 주세요.');
    });

    // 상품코드 입력: 자동 대문자 변환 + 자동완성 + 유효성 초기화
    DOM.productCode.addEventListener('input', function (e) {
      this.setCustomValidity('');

      var currentCode = e.target.value.toUpperCase().trim();
      e.target.value = currentCode;

      if (CODE_PATTERN.test(currentCode)) {
        var foundProduct = allProducts.find(function (item) { return item.productCode === currentCode; });
        if (foundProduct) {
          DOM.productName.value = foundProduct.productName;
          DOM.productName.style.backgroundColor = "#e6ffed";
          setTimeout(function () { DOM.productName.style.backgroundColor = ""; }, 800);
        }
      }
    });

    // 장바구니 삭제 버튼 — 이벤트 위임
    DOM.cartList.addEventListener('click', function (e) {
      var btn = e.target.closest('.remove-btn');
      if (btn) {
        removeFromCart(parseInt(btn.dataset.index, 10));
      }
    });

    // 물품 카드 삭제 버튼 — 이벤트 위임
    DOM.productList.addEventListener('click', function (e) {
      var btn = e.target.closest('.card-delete-btn');
      if (btn) {
        showDeleteModal(btn);
      }
    });

    // 삭제 모달: 취소 버튼
    DOM.deleteCancelBtn.addEventListener('click', closeDeleteModal);

    // 삭제 모달: 삭제 확인 버튼
    DOM.deleteConfirmBtn.addEventListener('click', confirmDelete);
  }

  // ========================================
  // Phase 2-1: 데이터 Fetch 통합 (중복 제거)
  // ========================================
  function fetchProducts(options) {
    var showUI = options && options.showUI;

    if (showUI) {
      DOM.productList.innerHTML = '';
      DOM.loading.style.display = 'block';
    }

    return fetch(GAS_WEB_APP_URL)
      .then(function (res) { return res.json(); })
      .then(function (res) {
        if (res.result === "success") {
          allProducts = res.data;
          lastFetchTime = Date.now();
          if (showUI) renderList();
        }
      })
      .catch(function (err) {
        if (showUI) alert("조회 중 오류 발생");
        else console.log("백그라운드 로드 실패");
      })
      .finally(function () {
        if (showUI) DOM.loading.style.display = 'none';
      });
  }

  // ========================================
  // PIN 인증
  // ========================================
  function savePin() {
    var pinVal = DOM.pinInput.value.trim();
    if (!pinVal) return alert("비밀번호를 입력하세요.");
    storedPin = pinVal;
    sessionStorage.setItem('userPin', pinVal);
    DOM.pinModal.removeAttribute('open');
  }

  // ========================================
  // Phase 2-2: 탭 전환 (캐시 기반 조회)
  // ========================================
  function switchTab(tabId) {
    document.querySelectorAll('.tab-content, .nav-tab').forEach(function (el) {
      el.classList.remove('active');
    });
    document.getElementById(tabId).classList.add('active');

    if (tabId === 'inputTab') {
      DOM.tabBtnInput.classList.add('active');
      renderCart();
    } else if (tabId === 'listTab') {
      DOM.tabBtnList.classList.add('active');
      DOM.floatingBtn.style.display = 'none';

      // 캐시 유효시간 내면 서버 호출 생략
      var now = Date.now();
      if (now - lastFetchTime > CACHE_TTL) {
        fetchProducts({ showUI: true });
      } else {
        renderList();
      }
    }
  }

  // ========================================
  // 장바구니 (입고 대기열)
  // ========================================
  function addToCart(e) {
    e.preventDefault();

    var pCode = DOM.productCode.value.toUpperCase().trim();
    var pName = DOM.productName.value.trim();
    var eDate = DOM.expiryDate.value;
    var rDate = DOM.receivedDate.value;
    var ins   = DOM.inspector.value.trim();

    localStorage.setItem('lastInspector', ins);

    stagedItems.push({
      productCode:  pCode,
      productName:  pName,
      expiryDate:   eDate,
      receivedDate: rDate,
      inspector:    ins
    });

    // 폼 초기화 (날짜·조사자 유지하여 연속 입력 지원)
    DOM.productCode.value = '';
    DOM.productName.value = '';
    DOM.expiryDate.value  = '';

    renderCart();
    DOM.productCode.focus();
  }

  function removeFromCart(index) {
    stagedItems.splice(index, 1);
    renderCart();
  }

  function renderCart() {
    if (stagedItems.length === 0) {
      DOM.cartSection.style.display = 'none';
      DOM.floatingBtn.style.display = 'none';
      return;
    }

    DOM.cartSection.style.display = 'block';
    DOM.cartList.innerHTML = '';

    // Phase 1-3: DocumentFragment로 Reflow 최소화
    var fragment = document.createDocumentFragment();

    stagedItems.forEach(function (item, index) {
      var div = document.createElement('div');
      div.className = 'cart-item';
      // Phase 1-1: escapeHTML 적용
      div.innerHTML =
        '<div class="cart-item-info">' +
          '<strong>' + escapeHTML(item.productName) + '</strong>' +
          '<span>[' + escapeHTML(item.productCode) + '] 유통기한: ' + escapeHTML(item.expiryDate) + '</span>' +
        '</div>' +
        '<button class="remove-btn" type="button" data-index="' + index + '">❌</button>';
      fragment.appendChild(div);
    });

    DOM.cartList.appendChild(fragment);

    // 플로팅 버튼 활성화
    DOM.floatingBtn.style.display = 'block';
    DOM.floatingBtn.innerText = '📦 총 ' + stagedItems.length + '건 서버로 일괄 전송';
  }

  // ========================================
  // 일괄 전송
  // ========================================
  function submitBatch() {
    if (!storedPin) {
      DOM.pinModal.setAttribute('open', true);
      return;
    }

    DOM.floatingBtn.disabled = true;
    DOM.floatingBtn.innerText = "⏳ 전송 중... 잠시만 기다려주세요";

    var payload = {
      pin: storedPin,
      items: stagedItems
    };

    fetch(GAS_WEB_APP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    })
      .then(function (res) { return res.json(); })
      .then(function (res) {
        if (res.result === "success") {
          alert(stagedItems.length + '건이 성공적으로 저장되었습니다.');
          stagedItems = [];
          renderCart();
          lastFetchTime = 0; // 캐시 무효화 → 다음 탭 전환 시 강제 갱신
          fetchProducts();
        } else {
          alert("오류: " + res.message);
          if (res.message.includes("비밀번호")) {
            sessionStorage.removeItem('userPin');
            storedPin = "";
            DOM.pinModal.setAttribute('open', true);
          }
        }
      })
      .catch(function (err) { alert("통신 중 오류가 발생했습니다: " + err); })
      .finally(function () {
        DOM.floatingBtn.disabled = false;
        if (stagedItems.length > 0) {
          DOM.floatingBtn.innerText = '📦 총 ' + stagedItems.length + '건 서버로 일괄 전송';
        }
      });
  }

  // ========================================
  // 물품 삭제
  // ========================================

  // 삭제 확인 모달 표시
  function showDeleteModal(btn) {
    if (isDeleting) return; // 삭제 진행 중에는 새 삭제 요청 차단

    pendingDeleteItem = {
      productCode:  btn.dataset.code,
      expiryDate:   btn.dataset.expiry,
      receivedDate: btn.dataset.received,
      productName:  btn.dataset.name,
      btnElement:   btn
    };

    DOM.deleteModalMsg.textContent = '「' + btn.dataset.name + '」 항목을 삭제하시겠습니까?';
    // 사유 라디오 초기화 (폐기 기본 선택)
    var defaultRadio = document.querySelector('input[name="deleteReason"][value="폐기"]');
    if (defaultRadio) defaultRadio.checked = true;
    DOM.deleteModal.setAttribute('open', true);
  }

  // 삭제 모달 닫기
  function closeDeleteModal() {
    DOM.deleteModal.removeAttribute('open');
    pendingDeleteItem = null;
  }

  // 삭제 실행
  function confirmDelete() {
    if (!pendingDeleteItem) return;

    if (!storedPin) {
      closeDeleteModal();
      DOM.pinModal.setAttribute('open', true);
      return;
    }

    var item = pendingDeleteItem;
    var card = item.btnElement.closest('.card');

    // 모달 닫기 + 카드에 로딩 오버레이 + 중복 삭제 방지
    DOM.deleteModal.removeAttribute('open');
    card.classList.add('card-deleting');
    isDeleting = true;

    var deleteReason = document.querySelector('input[name="deleteReason"]:checked').value;

    var payload = {
      pin: storedPin,
      action: "delete",
      productCode:  item.productCode,
      expiryDate:   item.expiryDate,
      receivedDate: item.receivedDate,
      deleteReason: deleteReason
    };

    fetch(GAS_WEB_APP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    })
      .then(function (res) { return res.json(); })
      .then(function (res) {
        if (res.result === "success") {
          alert("삭제되었습니다.");
          // 로컬 데이터에서 첫 번째 매칭 항목만 제거
          var removed = false;
          allProducts = allProducts.filter(function (p) {
            if (!removed &&
                p.productCode === item.productCode &&
                p.expiryDate === item.expiryDate &&
                p.receivedDate === item.receivedDate) {
              removed = true;
              return false;
            }
            return true;
          });
          lastFetchTime = 0; // 캐시 무효화
          renderList();
        } else {
          alert("삭제 실패: " + res.message);
          card.classList.remove('card-deleting');
          if (res.message.includes("비밀번호")) {
            sessionStorage.removeItem('userPin');
            storedPin = "";
            DOM.pinModal.setAttribute('open', true);
          }
        }
      })
      .catch(function (err) {
        alert("통신 중 오류가 발생했습니다: " + err);
        card.classList.remove('card-deleting');
      })
      .finally(function () {
        pendingDeleteItem = null;
        isDeleting = false;
      });
  }

  // ========================================
  // 목록 조회 · 필터링
  // ========================================
  function setFilter(status) {
    currentFilter = status;
    currentPage = 1; // Phase 5: 필터 변경 시 페이지 초기화
    renderList();
  }

  // Phase 1-3: DocumentFragment + 역방향 루프 최적화
  // Phase 5: "더 보기" 페이지네이션
  function renderList() {
    var searchKeyword = DOM.searchInput.value.toLowerCase().trim();
    DOM.productList.innerHTML = '';

    var filtered = allProducts.filter(function (item) {
      var matchesStatus = (item.status === currentFilter);
      var matchesSearch = item.productName.toLowerCase().includes(searchKeyword) ||
                          item.productCode.toLowerCase().includes(searchKeyword);
      return matchesStatus && matchesSearch;
    });

    if (filtered.length === 0) {
      DOM.productList.innerHTML = '<p class="empty-message">조회된 데이터가 없습니다.</p>';
      return;
    }

    var fragment = document.createDocumentFragment();

    // Phase 5: 페이지네이션 — 표시할 범위 계산
    var startIndex = Math.max(filtered.length - currentPage * PAGE_SIZE, 0);

    // Phase 1-3: 역방향 for 루프 (slice().reverse() 배열 복사 제거)
    for (var i = filtered.length - 1; i >= startIndex; i--) {
      var item = filtered[i];
      var badgeClass = "badge-secondary";
      if (item.status === "폐기") badgeClass = "badge-danger";
      else if (item.status === "유통기한 임박상품") badgeClass = "badge-warning";
      else if (item.status === "OK") badgeClass = "badge-success";

      var card = document.createElement('div');
      card.className = 'card';
      // Phase 1-1: escapeHTML 적용
      card.innerHTML =
        '<div class="card-header">' +
          '<span class="card-title">' + escapeHTML(item.productName) + '</span>' +
          '<div class="card-header-actions">' +
            '<span class="badge ' + badgeClass + '">' + escapeHTML(item.status || '기타') + '</span>' +
            '<button type="button" class="card-delete-btn" ' +
              'data-code="' + escapeHTML(item.productCode) + '" ' +
              'data-expiry="' + escapeHTML(item.expiryDate) + '" ' +
              'data-received="' + escapeHTML(item.receivedDate) + '" ' +
              'data-name="' + escapeHTML(item.productName) + '">✕</button>' +
          '</div>' +
        '</div>' +
        '<div class="card-info"><b>코드:</b> ' + escapeHTML(item.productCode) + '</div>' +
        '<div class="card-info"><b>유통기한:</b> ' + escapeHTML(item.expiryDate) + '</div>' +
        '<div class="card-info"><b>입고일자:</b> ' + escapeHTML(item.receivedDate) + ' | <b>조사자:</b> ' + escapeHTML(item.inspector) + '</div>';
      fragment.appendChild(card);
    }

    // Phase 5: "더 보기" 버튼
    if (startIndex > 0) {
      var moreBtn = document.createElement('button');
      moreBtn.className = 'load-more-btn';
      moreBtn.textContent = startIndex + '건 더 보기';
      moreBtn.addEventListener('click', function () {
        currentPage++;
        renderList();
      });
      fragment.appendChild(moreBtn);
    }

    // Reflow 1회로 일괄 삽입
    DOM.productList.appendChild(fragment);
  }

  // ========================================
  // 실행
  // ========================================
  init();

});
