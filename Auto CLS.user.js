// ==UserScript==
// @name         Auto CLS M3 Batch Clean
// @namespace    medinet-auto-cls-m3-batch-clean
// @version      1.5.0
// @description  M3: tìm XN theo Họ tên + ngày XN, điền/lưu CLS, mở/lưu Kết luận, quay lại danh sách và tiếp tục batch.
// @match        https://quanlyskcd.medinet.org.vn/*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    // =====================================================================
    // CẢNH BÁO / TRIẾT LÝ AN TOÀN
    // =====================================================================
    // - Script CHỈ khởi chạy khi người dùng bấm nút.
    // - Chỉ dùng trên DANH SÁCH M3 đã lọc "Chưa có cận lâm sàng".
    // - Một ca chỉ được tính DONE sau chuỗi:
    //     điền CLS -> Lưu CLS -> mở Kết luận -> Lưu Kết luận
    //     -> quay về Danh sách -> chờ bảng tải ổn định -> tiếp tục ca kế.
    // - Không tìm thấy XN / trùng XN / dữ liệu không đủ chắc chắn => SKIP.
    // - Lỗi kỹ thuật => RETRY giới hạn, sau đó ghi ERROR và tiếp tục.
    // - Không tự đoán kết quả xét nghiệm.

    const LOG = '[AUTO CLS M3 BATCH]';

    // =====================================================================
    // NGUỒN DỮ LIỆU XÉT NGHIỆM - GIỮ NGUYÊN TỪ SCRIPT AUTO KSK TD
    // =====================================================================

    const CAN_LAM_SANG_SHEET_ID =
        '1ZN2Y7WRZUgbLQZp-fI1HQ7xlB22fVE6titx8BB1UuUk';

    const CAN_LAM_SANG_CSV_URL =
        `https://docs.google.com/spreadsheets/d/${CAN_LAM_SANG_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=DATA`;

    const FIELD_MAP = [
        { label: 'Số lượng HC', column: 'RBC' },
        { label: 'Huyết sắc tố', column: 'HGB' },
        { label: 'Hematocrit', column: 'HCT' },
        { label: 'MCV', column: 'MCV' },
        { label: 'MCH', column: 'MCH' },
        { label: 'MCHC', column: 'MCHC' },
        { label: 'RDW', column: 'RDW' },
        { label: 'Số lượng bạch cầu', column: 'WBC' },
        { label: 'Số lượng bạch cầu trung tính', column: 'NEU#' },
        { label: 'Số lượng bạch cầu lympho', column: 'LYM#' },
        { label: 'Số lượng bạch cầu đơn nhân', column: 'MONO#' },
        { label: 'Số lượng bạch cầu ái toan', column: 'EOS#' },
        { label: 'Số lượng bạch cầu ái kiềm', column: 'BASO#' },
        { label: 'Số lượng tiểu cầu', column: 'PLT' },
        { label: 'Đường máu', column: 'Glucose' },
        { label: 'Urê', column: 'Ure' },
        { label: 'Creatinin', column: 'Creatinine' },
        { label: 'ASAT(GOT)', column: 'AST' },
        { label: 'ALAT (GPT)', column: 'ALT' },
        { label: 'Tỉ trọng', column: 'S.G' },
        { label: 'pH', column: 'pH' },
        { label: 'Bạch cầu', column: 'LEU' },
        { label: 'Hồng cầu', column: 'BLD' },
        { label: 'Protein', column: 'PRO' },
        { label: 'Glucose', column: 'GLU' },
        { label: 'Thể cetonic', column: 'KET' },
        { label: 'Bilirubin', column: 'BIL' },
        { label: 'Urobilinogen', column: 'URO' }
    ];

    const QUALITATIVE_URINE_COLUMNS =
        ['LEU', 'BLD', 'PRO', 'GLU', 'KET', 'BIL', 'URO'];

    // Urê có thể không được chạy thường quy; giữ logic loại cảnh báo như script cũ.
    const MISSING_WARNING_EXCLUDE = ['Urê'];

    // =====================================================================
    // STORAGE
    // =====================================================================

    // Namespace mới: tuyệt đối không tiếp tục stage dở của chuỗi v0.1.x.
    const KEY_ACTIVE = 'm3_cls_clean_active_v100';
    const KEY_STAGE = 'm3_cls_clean_stage_v100';
    const KEY_CASE = 'm3_cls_clean_case_v100';
    const KEY_STATS = 'm3_cls_clean_stats_v100';
    // Namespace mới để không mang theo các ca SKIP tích lũy từ những lần chạy
    // v1.0-v1.3.4. SKIP được giữ lại để tránh chạy lại ngoài ý muốn.
    const KEY_SKIPPED = 'm3_cls_clean_skipped_v135';
    const KEY_DONE = 'm3_cls_clean_done_v100';
    const KEY_ERRORS = 'm3_cls_clean_errors_v100';
    const KEY_RETRIES = 'm3_cls_clean_retries_v100';
    const KEY_LAST_URL = 'm3_cls_clean_last_url_v100';
    const KEY_RELOAD_COUNT = 'm3_cls_clean_reload_count_v100';
    // Đổi sau mỗi lần trình duyệt tải lại toàn trang. Được lưu vào ca trước khi
    // bấm Lưu CLS để nhận biết chính xác lần reload đã hoàn tất.
    const PAGE_INSTANCE_ID = `P-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

    // Các stage được lưu qua SPA/page reload.
    const STAGE = {
        LIST: 'LIST',
        OPENING_CASE: 'OPENING_CASE',
        OPEN_CLS: 'OPEN_CLS',
        FILL_CLS: 'FILL_CLS',
        SAVE_CLS: 'SAVE_CLS',
        WAIT_CLS_RELOAD: 'WAIT_CLS_RELOAD',
        OPEN_CONCLUSION: 'OPEN_CONCLUSION',
        SAVE_CONCLUSION: 'SAVE_CONCLUSION',
        RETURN_LIST: 'RETURN_LIST',
        VERIFY_FILTER: 'VERIFY_FILTER'
    };

    // =====================================================================
    // BASIC
    // =====================================================================

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Theo dõi request mạng phát sinh từ nút Lưu. @grant none giúp userscript
    // chạy cùng page context và bắt được cả fetch lẫn XMLHttpRequest.
    const NET = { installed: false, seq: 0, records: new Map() };

    function beginNetRecord(url, method) {
        const id = ++NET.seq;
        NET.records.set(id, {
            id, url: String(url || ''), method: String(method || 'GET'),
            startedAt: Date.now(), done: false, status: 0, error: ''
        });
        return id;
    }

    function finishNetRecord(id, status, error) {
        const r = NET.records.get(id);
        if (!r) return;
        r.done = true;
        r.status = Number(status) || 0;
        r.error = error ? String(error) : '';
        r.finishedAt = Date.now();

        // Batch có thể chạy hàng trăm ca; tránh Map request tăng vô hạn.
        if (NET.records.size > 300) {
            const cutoff = Date.now() - 2 * 60 * 1000;
            for (const [key, rec] of NET.records) {
                if (rec.done && Number(rec.finishedAt || 0) < cutoff) NET.records.delete(key);
                if (NET.records.size <= 200) break;
            }
        }
    }

    function installNetworkTracker() {
        if (NET.installed) return;
        NET.installed = true;

        const originalFetch = window.fetch;
        if (typeof originalFetch === 'function') {
            window.fetch = function (input, init) {
                const id = beginNetRecord(input?.url || input, init?.method || 'GET');
                return originalFetch.apply(this, arguments).then(response => {
                    finishNetRecord(id, response.status, '');
                    return response;
                }).catch(error => {
                    finishNetRecord(id, 0, error?.message || error);
                    throw error;
                });
            };
        }

        const originalOpen = XMLHttpRequest.prototype.open;
        const originalSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (method, url) {
            this.__m3clsMethod = method;
            this.__m3clsUrl = url;
            return originalOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function () {
            const id = beginNetRecord(this.__m3clsUrl || '', this.__m3clsMethod || 'GET');
            this.addEventListener('loadend', () => {
                finishNetRecord(id, this.status, this.status === 0 ? 'XHR status 0' : '');
            }, { once: true });
            return originalSend.apply(this, arguments);
        };
    }

    async function waitForTriggeredNetwork(marker, clickedAt, label) {
        const getTriggered = () => [...NET.records.values()].filter(r =>
            r.id > marker && r.startedAt >= clickedAt && r.startedAt - clickedAt <= 1800
        );

        const first = await waitFor(() => getTriggered().length ? getTriggered() : null, 2500, 50);
        if (!first) {
            // Dự phòng nếu trang dùng cơ chế mạng không thể hook được.
            await sleep(500);
            return { captured: false, count: 0 };
        }

        // Gom đủ các request con bắt đầu sát sau cú bấm; kết thúc sớm khi yên 200 ms.
        let lastSeq = NET.seq;
        let quietSince = Date.now();
        while (Date.now() - clickedAt < 1800) {
            await sleep(50);
            if (NET.seq !== lastSeq) {
                lastSeq = NET.seq;
                quietSince = Date.now();
            }
            if (Date.now() - quietSince >= 200) break;
        }

        const triggered = getTriggered();
        const mutating = triggered.filter(r => /^(POST|PUT|PATCH|DELETE)$/i.test(r.method));
        const relevant = mutating.length ? mutating : triggered;
        const completed = await waitFor(
            () => relevant.length && relevant.every(r => r.done) ? relevant : null,
            15000,
            80
        );

        // Hook được gắn sau khi Angular khởi tạo nên status 0 có thể chỉ là
        // request bị framework hủy/chuyển trang, không chứng minh thao tác Lưu
        // thất bại. Chỉ HTTP 4xx/5xx mới là lỗi chắc chắn; status 0 hoặc timeout
        // được coi là chưa xác định; chỉ lỗi HTTP 4xx/5xx mới chặn luồng lưu.
        if (!completed) {
            warn(`${label}: không xác định được trạng thái request; không có lỗi HTTP rõ ràng.`);
            return { captured: true, confirmed: false, uncertain: true, count: relevant.length };
        }

        const succeeded = completed.some(r => !r.error && r.status > 0 && r.status < 400);
        const explicitHttpError = completed.find(r => r.status >= 400);
        if (!succeeded && explicitHttpError) {
            throw new Error(`${label}: request lưu lỗi HTTP ${explicitHttpError.status}.`);
        }
        if (!succeeded) {
            warn(`${label}: chỉ bắt được status 0; không có lỗi HTTP rõ ràng.`);
        }
        await sleep(150); // cho Angular cập nhật state sau response.
        return { captured: true, confirmed: succeeded, uncertain: !succeeded, count: completed.length };
    }

    function norm(text) {
        return (text || '')
            .toString()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/g, 'd')
            .replace(/Đ/g, 'D')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    function log(...args) { console.log(LOG, ...args); }
    function warn(...args) { console.warn(LOG, ...args); }

    function getJson(key, fallback) {
        try {
            const raw = sessionStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (_) {
            return fallback;
        }
    }

    function setJson(key, value) {
        sessionStorage.setItem(key, JSON.stringify(value));
    }

    function getLocalJson(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (_) {
            return fallback;
        }
    }

    function setLocalJson(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
    }

    function isActive() {
        return sessionStorage.getItem(KEY_ACTIVE) === '1';
    }

    function setActive(v) {
        if (v) sessionStorage.setItem(KEY_ACTIVE, '1');
        else sessionStorage.removeItem(KEY_ACTIVE);
    }

    function getStage() {
        return sessionStorage.getItem(KEY_STAGE) || STAGE.LIST;
    }

    function setStage(stage) {
        sessionStorage.setItem(KEY_STAGE, stage);
        updatePanel();
    }

    function getCase() {
        return getJson(KEY_CASE, null);
    }

    function setCase(c) {
        if (c) setJson(KEY_CASE, c);
        else sessionStorage.removeItem(KEY_CASE);
        updatePanel();
    }

    function getStats() {
        return getJson(KEY_STATS, {
            processed: 0,
            done: 0,
            skipped: 0,
            skippedNotFound: 0,
            skippedDuplicate: 0,
            skippedInvalid: 0,
            errors: 0,
            retries: 0,
            startedAt: 0,
            totalProcessMs: 0,
            timedCases: 0,
            lastError: '',
            lastErrorAt: 0
        });
    }

    function saveStats(s) {
        setJson(KEY_STATS, s);
        updatePanel();
    }

    function resetRunState() {
        sessionStorage.removeItem(KEY_STAGE);
        sessionStorage.removeItem(KEY_CASE);
        sessionStorage.removeItem(KEY_STATS);
        sessionStorage.removeItem(KEY_RETRIES);
        sessionStorage.removeItem(KEY_RELOAD_COUNT);
        // DONE/SKIP/ERROR được giữ lại giữa các lần chạy để tránh xử lý lại ca cũ.
    }

    function caseKey(c) {
        if (!c) return '';
        if (c.cccd) return `CCCD:${c.cccd}|DATE:${c.ngayKham || ''}`;
        return `NAME:${norm(c.hoTen)}|DOB:${c.ngaySinh || ''}|SEX:${norm(c.gioiTinh)}|DATE:${c.ngayKham || ''}`;
    }

    // Bản 1.5 chỉ chạy một tab: bỏ toàn bộ claim/lease/worker để state đơn giản và ổn định hơn.

    async function addDone(c) {
        const key = caseKey(c);
        if (!key) return;
        const done = getLocalJson(KEY_DONE, {});
        done[key] = { time: Date.now(), c };
        setLocalJson(KEY_DONE, done);
    }

    function isDone(c) {
        return !!getLocalJson(KEY_DONE, {})[caseKey(c)];
    }

    async function addSkipped(c, reason, type) {
        const key = caseKey(c);
        const stage = getStage();
        const retryCount = getRetryCount(c || {}, stage);
        const skipped = getLocalJson(KEY_SKIPPED, {});
        skipped[key] = { time: Date.now(), c, reason, type, stage, retryCount };
        setLocalJson(KEY_SKIPPED, skipped);

        const s = getStats();
        if (type === 'NOT_FOUND') s.skippedNotFound++;
        else if (type === 'DUPLICATE') s.skippedDuplicate++;
        else s.skippedInvalid++;
        s.skipped = (s.skipped || 0) + 1;
        s.processed = (s.processed || 0) + 1;
        if (c?.startedAt) {
            s.totalProcessMs = (s.totalProcessMs || 0) + Math.max(0, Date.now() - c.startedAt);
            s.timedCases = (s.timedCases || 0) + 1;
        }
        saveStats(s);
    }

    function isSkipped(c) {
        return !!getLocalJson(KEY_SKIPPED, {})[caseKey(c)];
    }

    async function addError(c, reason) {
        const stage = getStage();
        const retryCount = getRetryCount(c || {}, stage);
        const errors = getLocalJson(KEY_ERRORS, []);
        errors.push({ time: new Date().toISOString(), c, reason, stage, retryCount });
        setLocalJson(KEY_ERRORS, errors);
        const s = getStats();
        s.errors++;
        s.lastError = reason;
        s.lastErrorAt = Date.now();
        saveStats(s);
    }

    function getRetryCount(c, stage) {
        const all = getJson(KEY_RETRIES, {});
        return all[`${caseKey(c)}|${stage}`] || 0;
    }

    function incRetry(c, stage) {
        const all = getJson(KEY_RETRIES, {});
        const k = `${caseKey(c)}|${stage}`;
        all[k] = (all[k] || 0) + 1;
        setJson(KEY_RETRIES, all);
        return all[k];
    }

    // =====================================================================
    // UI
    // =====================================================================

    function ensureStyles() {
        if (document.getElementById('m3-cls-batch-style')) return;
        const style = document.createElement('style');
        style.id = 'm3-cls-batch-style';
        style.textContent = `
            #m3-cls-batch-panel{position:fixed;right:18px;bottom:18px;z-index:9999999;width:315px;background:#fff;border:1px solid #cbd5e1;border-radius:14px;box-shadow:0 12px 35px rgba(0,0,0,.28);font-family:Segoe UI,Arial,sans-serif;overflow:hidden}
            #m3-cls-batch-panel .h{background:#173f78;color:#fff;padding:11px 13px;font-weight:750;font-size:13px;display:flex;justify-content:space-between;align-items:center}
            #m3-cls-batch-panel .b{padding:11px 13px;font-size:12.5px;color:#334155;line-height:1.45}
            #m3-cls-batch-panel .row{display:flex;justify-content:space-between;gap:10px;margin:3px 0}.m3cls-ok{color:#15803d;font-weight:700}.m3cls-warn{color:#b45309;font-weight:700}.m3cls-bad{color:#b91c1c;font-weight:700}
            #m3-cls-batch-panel .actions{display:flex;gap:7px;padding:0 13px 12px}
            #m3-cls-batch-panel button{border:0;border-radius:8px;padding:8px 10px;font-size:12px;font-weight:700;cursor:pointer}
            #m3cls-start{background:#2563eb;color:white;flex:1}#m3cls-stop{background:#dc2626;color:white;flex:1}#m3cls-report{background:#e2e8f0;color:#334155}#m3cls-reset-skip{background:#fef3c7;color:#92400e}
            #m3cls-status{position:fixed;top:0;left:0;right:0;z-index:9999998;background:#0f172a;color:white;text-align:center;padding:8px;font:600 13px Segoe UI,Arial,sans-serif;display:none}
            #m3cls-report-overlay{position:fixed;inset:0;z-index:10000020;background:rgba(15,23,42,.58);display:flex;align-items:center;justify-content:center;padding:24px;font-family:Segoe UI,Arial,sans-serif}
            #m3cls-report-box{width:min(920px,95vw);height:min(760px,90vh);background:#fff;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.38);display:flex;flex-direction:column;overflow:hidden}
            #m3cls-report-head{padding:13px 16px;background:#173f78;color:#fff;font-weight:750;display:flex;justify-content:space-between;align-items:center}
            #m3cls-report-text{flex:1;overflow:auto;white-space:pre-wrap;word-break:break-word;margin:0;padding:16px;font:13px/1.5 Consolas,monospace;color:#172033;background:#f8fafc}
            #m3cls-report-actions{display:flex;justify-content:flex-end;gap:8px;padding:11px 14px;border-top:1px solid #e2e8f0}
            #m3cls-report-actions button{border:0;border-radius:8px;padding:9px 13px;font-weight:700;cursor:pointer}#m3cls-copy-all{background:#2563eb;color:#fff}#m3cls-clear-errors{background:#fee2e2;color:#991b1b}#m3cls-close-report{background:#e2e8f0;color:#334155}
        `;
        document.head.appendChild(style);
    }

    function ensurePanel() {
        ensureStyles();
        if (document.getElementById('m3-cls-batch-panel')) return;
        const p = document.createElement('div');
        p.id = 'm3-cls-batch-panel';
        p.innerHTML = `
            <div class="h"><span>🤖 AUTO SỬA CLS M3</span><span id="m3cls-active-label">DỪNG</span></div>
            <div class="b">
                <div class="row"><span>Trạng thái</span><b id="m3cls-stage">-</b></div>
                <div class="row"><span>Đã xử lý</span><b id="m3cls-processed">0</b></div>
                <div class="row"><span>Hoàn tất</span><span id="m3cls-done" class="m3cls-ok">0</span></div>
                <div class="row"><span>Bỏ qua</span><span id="m3cls-skipped" class="m3cls-warn">0</span></div>
                <div class="row"><span>↳ Không tìm thấy XN</span><span id="m3cls-notfound">0</span></div>
                <div class="row"><span>↳ Trùng kết quả</span><span id="m3cls-dup">0</span></div>
                <div class="row"><span>↳ Không hợp lệ</span><span id="m3cls-invalid">0</span></div>
                <div class="row"><span>Lỗi ghi nhận</span><span id="m3cls-errors" class="m3cls-bad">0</span></div>
                <div class="row"><span>Retry</span><span id="m3cls-retries">0</span></div>
                <div class="row"><span>Tỷ lệ hoàn tất</span><b id="m3cls-success">—</b></div>
                <div class="row"><span>Tốc độ TB</span><span id="m3cls-speed">—</span></div>
                <div class="row"><span>Đã chạy</span><span id="m3cls-elapsed">—</span></div>
                <div style="margin-top:7px;padding-top:7px;border-top:1px solid #e2e8f0"><b id="m3cls-patient">Chưa chạy</b><div id="m3cls-detail" style="color:#64748b;margin-top:2px"></div></div>
            </div>
            <div class="actions"><button id="m3cls-start">▶ BẮT ĐẦU</button><button id="m3cls-stop">⏹ DỪNG</button><button id="m3cls-report">📋</button><button id="m3cls-reset-skip" title="Xóa danh sách SKIP để chạy lại">↻ SKIP</button></div>
        `;
        document.body.appendChild(p);

        document.getElementById('m3cls-start').addEventListener('click', startBatch);
        document.getElementById('m3cls-stop').addEventListener('click', stopBatch);
        document.getElementById('m3cls-report').addEventListener('click', showReport);
        document.getElementById('m3cls-reset-skip').addEventListener('click', resetSkippedList);
        updatePanel();
    }

    function updatePanel() {
        const p = document.getElementById('m3-cls-batch-panel');
        if (!p) return;
        const s = getStats();
        const c = getCase();
        const processed = Number(s.processed || 0);
        const done = Number(s.done || 0);
        const skipped = Number(s.skipped || (s.skippedNotFound || 0) + (s.skippedDuplicate || 0) + (s.skippedInvalid || 0));
        const timedCases = Number(s.timedCases || 0);
        const timedMinutes = Number(s.totalProcessMs || 0) / 60000;
        const elapsedMs = s.startedAt ? Math.max(0, Date.now() - s.startedAt) : 0;
        const fmtElapsed = ms => {
            if (!ms) return '—';
            const sec = Math.floor(ms / 1000);
            const h = Math.floor(sec / 3600);
            const m = Math.floor((sec % 3600) / 60);
            const ss = sec % 60;
            return h ? `${h}g ${m}p` : (m ? `${m}p ${ss}s` : `${ss}s`);
        };

        document.getElementById('m3cls-active-label').textContent = isActive() ? 'ĐANG CHẠY' : 'DỪNG';
        document.getElementById('m3cls-stage').textContent = getStage();
        document.getElementById('m3cls-processed').textContent = processed;
        document.getElementById('m3cls-done').textContent = done;
        document.getElementById('m3cls-skipped').textContent = skipped;
        document.getElementById('m3cls-notfound').textContent = s.skippedNotFound || 0;
        document.getElementById('m3cls-dup').textContent = s.skippedDuplicate || 0;
        document.getElementById('m3cls-invalid').textContent = s.skippedInvalid || 0;
        document.getElementById('m3cls-errors').textContent = s.errors || 0;
        document.getElementById('m3cls-retries').textContent = s.retries || 0;
        document.getElementById('m3cls-success').textContent = processed ? `${((done / processed) * 100).toFixed(1)}%` : '—';
        document.getElementById('m3cls-speed').textContent = timedCases && timedMinutes > 0
            ? `${(timedMinutes / timedCases).toFixed(1)} phút/ca`
            : '—';
        document.getElementById('m3cls-elapsed').textContent = fmtElapsed(elapsedMs);
        document.getElementById('m3cls-patient').textContent = c ? (c.hoTen || '(không tên)') : 'Chưa có ca';
        document.getElementById('m3cls-detail').textContent = c
            ? `${c.cccd || '—'} · khám ${c.ngayKham || '—'} · ${getStage()}`
            : (s.lastError ? `Lỗi gần nhất: ${s.lastError}` : '');
    }

    function showStatus(message) {
        ensureStyles();
        let el = document.getElementById('m3cls-status');
        if (!el) {
            el = document.createElement('div');
            el.id = 'm3cls-status';
            document.body.appendChild(el);
        }
        el.textContent = message;
        el.style.display = 'block';
    }

    function hideStatus() {
        const el = document.getElementById('m3cls-status');
        if (el) el.style.display = 'none';
    }

    function buildFullReport() {
        const skipped = Object.values(getLocalJson(KEY_SKIPPED, {}))
            .sort((a, b) => Number(a.time || 0) - Number(b.time || 0));
        const errors = getLocalJson(KEY_ERRORS, [])
            .slice()
            .sort((a, b) => new Date(a.time || 0) - new Date(b.time || 0));
        const s = getStats();
        const processed = Number(s.processed || 0);
        const done = Number(s.done || 0);
        const skippedCount = Number(s.skipped || 0);
        const success = processed ? ((done / processed) * 100).toFixed(1) + '%' : '—';
        const avg = s.timedCases ? ((s.totalProcessMs || 0) / 60000 / s.timedCases).toFixed(1) + ' phút/ca' : '—';
        const started = s.startedAt ? new Date(s.startedAt).toLocaleString('vi-VN') : '—';

        let txt = `AUTO SỬA CLS M3 v1.5.0 - SINGLE TAB
Bắt đầu: ${started}

=== THỐNG KÊ PHIÊN NÀY ===
Đã xử lý: ${processed}
Hoàn tất: ${done} (${success})
Bỏ qua: ${skippedCount}
  - Không tìm thấy XN: ${s.skippedNotFound || 0}
  - Trùng kết quả: ${s.skippedDuplicate || 0}
  - Không hợp lệ/lỗi: ${s.skippedInvalid || 0}
Lỗi ghi nhận: ${s.errors || 0}
Retry: ${s.retries || 0}
Tốc độ trung bình: ${avg}

=== DỮ LIỆU ĐANG LƯU ===
Tổng SKIP: ${skipped.length}
Tổng ERROR: ${errors.length}`;

        if (skipped.length) {
            txt += `\n\n=== SKIP ===\n` + skipped.map((x, i) =>
                `${i + 1}. Trang ${x.c?.pageNumber || '?'} · STT ${x.c?.rowStt || '?'} | ${x.c?.hoTen || '?'} | ${x.c?.cccd || '?'} | khám ${x.c?.ngayKham || '?'} | ${x.type || 'SKIP'} | stage=${x.stage || '?'} | retry=${x.retryCount || 0} | ${x.reason || ''}`
            ).join('\n');
        }
        if (errors.length) {
            txt += `\n\n=== ERROR ===\n` + errors.map((x, i) =>
                `${i + 1}. ${new Date(x.time).toLocaleString('vi-VN')} | Trang ${x.c?.pageNumber || '?'} · STT ${x.c?.rowStt || '?'} | ${x.c?.hoTen || '?'} | ${x.c?.cccd || '?'} | stage=${x.stage || '?'} | retry=${x.retryCount || 0} | ${x.reason || ''}`
            ).join('\n');
        }
        return txt;
    }

    function showReport() {
        document.getElementById('m3cls-report-overlay')?.remove();
        const txt = buildFullReport();
        const overlay = document.createElement('div');
        overlay.id = 'm3cls-report-overlay';
        overlay.innerHTML = `
            <div id="m3cls-report-box">
                <div id="m3cls-report-head"><span>📋 DANH SÁCH SKIP / ERROR ĐẦY ĐỦ</span><span>${Object.keys(getLocalJson(KEY_SKIPPED, {})).length} SKIP · ${getLocalJson(KEY_ERRORS, []).length} ERROR</span></div>
                <pre id="m3cls-report-text"></pre>
                <div id="m3cls-report-actions"><button id="m3cls-copy-all">SAO CHÉP TOÀN BỘ</button><button id="m3cls-clear-errors">XÓA ERROR</button><button id="m3cls-close-report">ĐÓNG</button></div>
            </div>`;
        document.body.appendChild(overlay);
        document.getElementById('m3cls-report-text').textContent = txt;
        document.getElementById('m3cls-close-report').onclick = () => overlay.remove();
        document.getElementById('m3cls-clear-errors').onclick = () => resetErrorList(overlay);
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
        document.getElementById('m3cls-copy-all').onclick = async e => {
            try {
                await navigator.clipboard.writeText(txt);
                e.currentTarget.textContent = 'ĐÃ SAO CHÉP';
            } catch (_) {
                alert('Trình duyệt không cho sao chép tự động. Hãy bôi đen nội dung trong cửa sổ báo cáo để copy.');
            }
        };
    }

    async function resetErrorList(reportOverlay) {
        if (isActive()) {
            alert('Hãy bấm DỪNG trước khi xóa ERROR.');
            return;
        }
        if (!confirm('XÓA TOÀN BỘ DANH SÁCH ERROR?\n\nDanh sách SKIP và DONE không bị xóa.')) return;
        localStorage.removeItem(KEY_ERRORS);
        const s = getStats();
        s.errors = 0;
        saveStats(s);
        reportOverlay?.remove();
        alert('Đã xóa toàn bộ danh sách ERROR.');
    }

    async function resetSkippedList() {
        if (isActive()) {
            alert('Hãy bấm DỪNG trước khi xóa danh sách SKIP.');
            return;
        }
        if (!confirm('XÓA TOÀN BỘ DANH SÁCH SKIP?\n\nCác ca này sẽ được tìm XN lại ở lần chạy kế tiếp. Danh sách DONE không bị xóa.')) return;
        localStorage.removeItem(KEY_SKIPPED);
        const s = getStats();
        s.skippedNotFound = 0;
        s.skippedDuplicate = 0;
        s.skippedInvalid = 0;
        saveStats(s);
        alert('Đã xóa danh sách SKIP. Có thể bấm BẮT ĐẦU để tìm lại các ca.');
    }

    async function startBatch() {
        if (!isListPage()) {
            alert('Hãy mở trang DANH SÁCH M3 và lọc "Chất lượng dữ liệu = Chưa có cận lâm sàng" trước khi bắt đầu.');
            return;
        }
        const quality = getCurrentQualityFilterText();
        if (quality && !norm(quality).includes('chua co can lam sang')) {
            if (!confirm(`Bộ lọc Chất lượng dữ liệu hiện là "${quality}".\n\nScript được thiết kế cho "Chưa có cận lâm sàng". Vẫn chạy?`)) return;
        }
        if (!confirm('BẮT ĐẦU AUTO SỬA CLS M3?\n\nScript sẽ TỰ LƯU dữ liệu trên Medinet:\n1) điền + lưu Cận lâm sàng\n2) mở + lưu Kết luận\n3) quay lại danh sách, chờ bảng tải xong rồi tiếp tục\n\nNên theo dõi kỹ vài ca đầu.')) return;

        resetRunState();
        saveStats({
            processed: 0, done: 0, skipped: 0,
            skippedNotFound: 0, skippedDuplicate: 0, skippedInvalid: 0,
            errors: 0, retries: 0, startedAt: Date.now(),
            totalProcessMs: 0, timedCases: 0, lastError: '', lastErrorAt: 0
        });
        setActive(true);
        setStage(STAGE.LIST);
        queueRun();
    }

    async function stopBatch() {
        setActive(false);
        hideStatus();
        updatePanel();
        alert('Đã dừng Auto CLS M3. Trạng thái ca hiện tại vẫn được giữ để kiểm tra thủ công.');
    }

    // =====================================================================
    // CLICK / WAIT
    // =====================================================================

    function fastClick(el) {
        if (!el) return false;
        try { el.click(); return true; } catch (_) { return false; }
    }

    function robustClick(el) {
        if (!el) return false;
        try {
            const r = el.getBoundingClientRect();
            const base = { bubbles: true, cancelable: true, composed: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
            const popt = { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true };
            el.dispatchEvent(new PointerEvent('pointerdown', popt));
            el.dispatchEvent(new MouseEvent('mousedown', base));
            el.dispatchEvent(new PointerEvent('pointerup', popt));
            el.dispatchEvent(new MouseEvent('mouseup', base));
            el.dispatchEvent(new MouseEvent('click', base));
            return true;
        } catch (_) {
            return fastClick(el);
        }
    }

    async function waitFor(fn, timeout = 30000, interval = 150) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const v = fn();
            if (v) return v;
            await sleep(interval);
        }
        return null;
    }

    // Giữ đúng cơ chế đã chạy ổn ở Auto KL M2: không xử lý ngay khi khung
    // HTML vừa xuất hiện; chờ document hoàn tất rồi cho Angular thêm 700 ms.
    async function waitPageReady(timeoutMs = 30000) {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
            if (document.readyState === 'complete' && (document.body.innerText || '').length > 50) {
                await sleep(700);
                return true;
            }
            await sleep(150);
        }
        return false;
    }

    // Ngoài điều kiện chung, từng trang có thể đưa thêm điều kiện dữ liệu đã render.
    // Nếu Medinet tải dở, F5 tối đa 3 lần; stage/case vẫn nằm trong sessionStorage
    // nên batch tiếp tục đúng chỗ cũ sau khi tải lại.
    async function waitForPageReadyOrReload(timeoutMs = 30000, context = 'trang', extraReady = null) {
        let ready = await waitPageReady(timeoutMs);
        if (ready && extraReady) {
            ready = !!await waitFor(extraReady, timeoutMs, 150);
        }

        if (ready) {
            sessionStorage.removeItem(KEY_RELOAD_COUNT);
            return true;
        }

        const reloadCount = Number(sessionStorage.getItem(KEY_RELOAD_COUNT) || 0);
        if (reloadCount >= 3) {
            sessionStorage.removeItem(KEY_RELOAD_COUNT);
            setActive(false);
            hideStatus();
            updatePanel();
            alert(`⛔ AUTO ĐÃ DỪNG\n\nMedinet không tải xong ${context} sau 3 lần F5. Tiến trình ca hiện tại vẫn được giữ lại.`);
            return false;
        }

        sessionStorage.setItem(KEY_RELOAD_COUNT, String(reloadCount + 1));
        showStatus(`Medinet chưa tải xong ${context} · F5 thử lại ${reloadCount + 1}/3...`);
        await sleep(500);
        location.reload();
        return false;
    }

    function findButtonByText(text) {
        const t = norm(text);
        return [...document.querySelectorAll('button,a,div[role="button"],span[role="button"],.dx-button')]
            .find(el => norm(el.textContent).includes(t)) || null;
    }

    async function clickButtonText(text, timeout = 20000) {
        const b = await waitFor(() => findButtonByText(text), timeout);
        if (!b) return false;
        robustClick(b);
        return true;
    }

    // =====================================================================
    // PAGE RECOGNITION / SIDEBAR
    // =====================================================================

    function isListPage() {
        const u = location.href;
        const body = norm(document.body.innerText);
        return u.includes('KSKDK_DanhSach_KSK_M13') ||
               u.includes('KSKDK_DanhSach_KSK_M3') ||
               (body.includes('du 18 - 59 tuoi') && body.includes('chat luong du lieu') && body.includes('dinh danh ca nhan'));
    }

    function isClsPage() {
        const u = location.href;
        const body = norm(document.body.innerText);
        // Không dùng riêng chữ "Khám cận lâm sàng": chữ này luôn có trong
        // sidebar, kể cả khi đang ở Thông tin hành chính.
        return u.includes('KSKDK_Phieu_CanLamSang') ||
               body.includes('ket qua xet nghiem mau') &&
                   (body.includes('so luong hc') || body.includes('huyet sac to')) ||
               body.includes('kham suc khoe dinh ky') && body.includes('so luong hc');
    }

    function isConclusionPage() {
        const body = norm(document.body.innerText);
        const title = norm((document.querySelector('h2.hidden-web-title,.hidden-web-title') || {}).textContent || '');
        return title.includes('ket luan') ||
               body.includes('phan loai suc khoe') && body.includes('de nghi') && body.includes('luu thay doi');
    }

    function findSidebarItemByText(candidates) {
        const wanted = candidates.map(norm);
        const items = [...document.querySelectorAll(
            'li[data-item-id], .dx-treeview-item, .dx-treeview-node, nav a, aside a, .nav-item, .menu-item'
        )].filter(isVisibleElement);
        let best = null;
        for (const el of items) {
            const txt = norm(el.textContent);
            if (!txt || txt.length > 180) continue;
            if (wanted.some(x => txt === x || txt.includes(x))) {
                const li = el.closest('li[data-item-id]') || el;
                if (!best || txt.length < norm(best.textContent).length) best = li;
            }
        }
        return best;
    }

    async function clickSidebar(candidates, pageCheck, label) {
        let item = await waitFor(() => findSidebarItemByText(candidates), 12000);
        if (!item) {
            const wanted = candidates.map(norm);
            item = [...document.querySelectorAll('a,button,li,div,span')]
                .filter(isVisibleElement)
                .filter(el => wanted.includes(norm(el.textContent)))
                .sort((a, b) => a.children.length - b.children.length)[0] || null;
            item = item?.closest('a,button,li,[role="button"],.dx-treeview-item') || item;
        }
        if (!item) throw new Error(`Không tìm thấy mục sidebar: ${label}`);
        const targets = [item.querySelector('.dx-treeview-item'), item.querySelector('.dx-item-content'), item, item.querySelector('span')].filter(Boolean);
        for (const t of targets) {
            robustClick(t);
            // SPA đổi URL trước khi form đích render. Chỉ URL đổi là chưa đủ;
            // phải chờ pageCheck xác nhận đúng nội dung trang đích.
            const ok = await waitFor(() => pageCheck(), 20000, 200);
            if (ok) return true;
        }
        throw new Error(`Bấm sidebar "${label}" nhưng trang không chuyển.`);
    }

    // =====================================================================
    // LIST TABLE: parse headers instead of hard-coding indexes when possible
    // =====================================================================

    function getHeaderMap(row) {
        // Chỉ lấy header của đúng bảng chứa dòng hiện tại. Trang Medinet có thể
        // giữ thêm grid/bảng ẩn trong DOM; gom header toàn trang sẽ làm index > số cột.
        const table = row?.closest('table');
        let ths = table
            ? [...table.querySelectorAll('thead tr:last-child th, thead tr:last-child td')]
            : [];

        if (!ths.length) {
            const grid = row?.closest('.dx-datagrid');
            ths = grid ? [...grid.querySelectorAll('.dx-datagrid-headers td')] : [];
        }

        const map = {};
        ths.forEach((th, i) => {
            const t = norm(th.textContent);
            if (t.includes('ho ten')) map.name = i;
            else if (t.includes('dinh danh ca nhan')) map.cccd = i;
            else if (t.includes('ngay sinh')) map.dob = i;
            else if (t.includes('gioi tinh')) map.sex = i;
            else if (t.includes('ngay kham')) map.examDate = i;
        });
        return map;
    }

    function isVisibleElement(el) {
        if (!el || !el.isConnected) return false;
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    }

    function getListDataRows() {
        return [...document.querySelectorAll(
            'table tbody tr, .dx-datagrid-rowsview tr.dx-data-row, .dx-datagrid-rowsview [role="row"]'
        )].filter(row => {
            if (!isVisibleElement(row)) return false;
            const cells = row.querySelectorAll(':scope > td, :scope > [role="gridcell"]');
            return cells.length >= 8;
        });
    }

    function findPencilLinks() {
        const found = [];
        const seen = new Set();
        const add = el => {
            if (!el || seen.has(el) || !isVisibleElement(el)) return;
            seen.add(el);
            found.push(el);
        };

        // Các phiên bản giao diện Medinet từng dùng fa-edit, fa-pencil,
        // glyphicon-pencil, DevExtreme button hoặc chỉ gắn title/aria-label.
        const iconSelectors = [
            'i.fa-edit', 'i[class*="fa-edit"]',
            'i.fa-pen', 'i[class*="fa-pen"]',
            'i[class*="pencil"]', 'i[class*="edit"]',
            'span[class*="pencil"]', 'span[class*="edit"]',
            'svg[class*="pencil"]', 'svg[class*="edit"]'
        ].join(',');

        for (const row of getListDataRows()) {
            const cells = [...row.querySelectorAll(':scope > td, :scope > [role="gridcell"]')];

            let action = row.querySelector(
                'a[title*="Sửa" i],button[title*="Sửa" i],' +
                'a[title*="Edit" i],button[title*="Edit" i],' +
                'a[aria-label*="Sửa" i],button[aria-label*="Sửa" i],' +
                'a[aria-label*="Edit" i],button[aria-label*="Edit" i]'
            );

            if (!action) {
                const icon = row.querySelector(iconSelectors);
                action = icon?.closest('a,button,[role="button"]') || icon;
            }

            // Fallback ổn định nhất cho bảng trong ảnh: cột 0 = STT,
            // cột 1 = XỬ LÝ. Chỉ dùng trong một dòng dữ liệu đủ >= 8 cột.
            if (!action && cells[1]) {
                action = cells[1].querySelector('a,button,[role="button"],.dx-button,i,svg');
            }

            add(action);
        }
        return found;
    }

    function parseCaseFromPencil(link) {
        const row = link.closest('tr') || link.closest('[role="row"]');
        if (!row) return null;
        const cells = [...row.querySelectorAll('td, [role="gridcell"]')];
        if (cells.length < 8) return null;
        const hm = getHeaderMap(row);
        const idx = {
            name: hm.name ?? 3,
            cccd: hm.cccd ?? 4,
            dob: hm.dob ?? 5,
            sex: hm.sex ?? 6,
            examDate: hm.examDate ?? 8
        };
        const readCase = indexes => ({
            pageNumber: getCurrentPageNumber(),
            rowStt: (cells[0]?.textContent || '').trim(),
            hoTen: (cells[indexes.name]?.textContent || '').trim(),
            cccd: (cells[indexes.cccd]?.textContent || '').replace(/\s/g, '').trim(),
            ngaySinh: (cells[indexes.dob]?.textContent || '').trim(),
            gioiTinh: (cells[indexes.sex]?.textContent || '').trim(),
            ngayKham: (cells[indexes.examDate]?.textContent || '').trim()
        });

        let c = readCase(idx);

        // Layout cố định đang hiển thị trong danh sách M3:
        // 0 STT, 1 Xử lý, 2 Đơn vị, 3 Họ tên, 4 CCCD,
        // 5 Ngày sinh, 6 Giới tính, 7 Mã phiếu, 8 Ngày khám.
        // Nếu header động bị lệch, quay về đúng layout này.
        if (!c.hoTen || !c.ngayKham || !/\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}/.test(c.ngayKham)) {
            c = readCase({ name: 3, cccd: 4, dob: 5, sex: 6, examDate: 8 });
        }
        if (!c.hoTen || !c.ngayKham) return null;
        return c;
    }

    function getVisibleAvailableCase() {
        for (const link of findPencilLinks()) {
            const c = parseCaseFromPencil(link);
            if (!c) continue;
            if (isDone(c) || isSkipped(c)) continue;
            return { link, c };
        }
        return null;
    }

    function getResultCount() {
        const m = (document.body.innerText || '').match(/Có\s+(\d+)\s+kết quả/i);
        return m ? parseInt(m[1], 10) : null;
    }

    // DevExtreme có thể đặt bộ đếm tạm thời về "Có 0 kết quả" trong lúc XHR
    // vẫn đang chạy. Không được dùng con số đó cho tới khi load panel biến mất.
    function isListLoading() {
        const selectors = [
            '.dx-loadpanel',
            '.dx-loadpanel-wrapper',
            '.dx-loadindicator',
            '.dx-overlay-wrapper .dx-loadpanel-content',
            '.dx-datagrid .dx-overlay-wrapper',
            '[class*="loading-overlay"]',
            '[class*="loading-mask"]'
        ].join(',');
        return [...document.querySelectorAll(selectors)].some(isVisibleElement);
    }

    // Chỉ báo sẵn sàng sau khi trạng thái không đổi liên tục một khoảng ngắn:
    // 0 kết quả thật, hoặc đã có cả số kết quả lẫn nút Xử lý của bảng.
    function createStableListReadyCheck(stableMs = 1200) {
        let signature = '';
        let stableSince = 0;
        return () => {
            if (isListLoading()) {
                signature = '';
                stableSince = 0;
                return false;
            }

            const count = getResultCount();
            const pencils = findPencilLinks().length;
            const valid = count === 0 || (count > 0 && pencils > 0);
            if (!valid) {
                signature = '';
                stableSince = 0;
                return false;
            }

            const nextSignature = `${count}|${pencils}`;
            if (nextSignature !== signature) {
                signature = nextSignature;
                stableSince = Date.now();
                return false;
            }
            return Date.now() - stableSince >= stableMs;
        };
    }

    function getListGridInstance() {
        const grids = [...document.querySelectorAll('.dx-datagrid')]
            .filter(g => isVisibleElement(g) && g.querySelector('.dx-datagrid-rowsview'));
        for (const grid of grids) {
            try {
                const instance = window.DevExpress?.ui?.dxDataGrid?.getInstance?.(grid);
                if (instance) return instance;
            } catch (_) {}
            try {
                const jq = window.jQuery || window.$;
                if (jq?.fn?.dxDataGrid) {
                    const instance = jq(grid).dxDataGrid('instance');
                    if (instance) return instance;
                }
            } catch (_) {}
        }
        return null;
    }

    function getCurrentPageNumber() {
        const grid = getListGridInstance();
        try {
            const index = Number(grid?.pageIndex?.());
            if (Number.isFinite(index)) return index + 1;
        } catch (_) {}
        const selected = document.querySelector('.dx-page.dx-selection, .dx-page[aria-current="page"], .dx-page-selected');
        const n = parseInt((selected?.textContent || '').trim(), 10);
        return Number.isFinite(n) ? n : 1;
    }

    function findPageNumberButton(pageNumber) {
        return [...document.querySelectorAll('.dx-pager .dx-page, .dx-pages .dx-page')]
            .find(el => parseInt((el.textContent || '').trim(), 10) === pageNumber) || null;
    }

    function findNextPageButton() {
        const candidates = [
            document.querySelector('.dx-next-button'),
            document.querySelector('[aria-label="Next page"]'),
            document.querySelector('[aria-label*="Next"]'),
            document.querySelector('.dx-pager .dx-navigate-button.dx-next-button')
        ].filter(Boolean);
        for (const b of candidates) {
            const disabled = b.classList.contains('dx-state-disabled') || b.getAttribute('aria-disabled') === 'true';
            if (!disabled) return b;
        }
        return null;
    }

    async function goNextPageIfPossible() {
        const oldPage = getCurrentPageNumber();
        const targetPage = oldPage + 1;
        const oldSignature = listSignature();
        const grid = getListGridInstance();

        try {
            const pageCount = Number(grid?.pageCount?.());
            if (Number.isFinite(pageCount) && targetPage > pageCount) return false;
        } catch (_) {}

        showStatus(`Trang ${oldPage}: toàn bộ ca đang thấy đã DONE/SKIP → sang trang ${targetPage}...`);
        let triggered = false;

        if (grid?.pageIndex) {
            try {
                grid.pageIndex(targetPage - 1);
                triggered = true;
            } catch (_) {}
        }

        if (!triggered) {
            const numbered = findPageNumberButton(targetPage);
            if (numbered) triggered = robustClick(numbered);
        }

        if (!triggered) {
            const next = findNextPageButton();
            if (next) triggered = robustClick(next);
        }
        if (!triggered) return false;

        const stableReady = createStableListReadyCheck(400);
        const changed = await waitFor(
            () => getCurrentPageNumber() === targetPage &&
                listSignature() !== oldSignature && stableReady(),
            20000,
            100
        );
        if (!changed) return false;
        return true;
    }

    function getCurrentQualityFilterText() {
        const el = findQualityFilterInput();
        return el?.value || '';
    }

    function findQualityFilterInput() {
        const inputs = [...document.querySelectorAll('input.dx-texteditor-input, input')].filter(isVisibleElement);
        return inputs.find(x => {
            let p = x;
            for (let i = 0; i < 5 && p; i++, p = p.parentElement) {
                const txt = norm(p.textContent);
                if (txt.includes('chat luong du lieu') && txt.length < 250) return true;
            }
            return false;
        }) || inputs.find(x => norm(x.value).includes('can lam sang')) || null;
    }

    const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;

    function listSignature() {
        const first = findPencilLinks()[0];
        const c = first ? parseCaseFromPencil(first) : null;
        return `${getResultCount() ?? '?'}|${c?.cccd || ''}|${c?.hoTen || ''}`;
    }

    // =====================================================================
    // CSV / LAB MATCHING
    // =====================================================================

    function parseCsv(text) {
        const rows = [];
        let row = [], field = '', inQuotes = false;
        for (let i = 0; i < text.length; i++) {
            const c = text[i];
            if (inQuotes) {
                if (c === '"') {
                    if (text[i + 1] === '"') { field += '"'; i++; }
                    else inQuotes = false;
                } else field += c;
            } else {
                if (c === '"') inQuotes = true;
                else if (c === ',') { row.push(field); field = ''; }
                else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
                else if (c !== '\r') field += c;
            }
        }
        if (field.length || row.length) { row.push(field); rows.push(row); }
        return rows;
    }

    let sheetCache = null;
    let sheetCacheTime = 0;
    const SHEET_CACHE_TTL = 2 * 60 * 1000;

    async function fetchSheetRows() {
        if (sheetCache && Date.now() - sheetCacheTime < SHEET_CACHE_TTL) return sheetCache;
        const res = await fetch(CAN_LAM_SANG_CSV_URL);
        if (!res.ok) throw new Error(`Không tải được sheet XN (HTTP ${res.status})`);
        const rows = parseCsv(await res.text());
        if (!rows.length) throw new Error('Sheet XN rỗng.');
        sheetCache = { header: rows[0], rows: rows.slice(1) };
        sheetCacheTime = Date.now();
        return sheetCache;
    }

    function colIndex(header, wanted) {
        const w = norm(wanted).replace(/\s/g, '');
        return header.findIndex(h => norm(h).replace(/\s/g, '') === w);
    }

    function buildData(header, row) {
        const o = {};
        header.forEach((h, i) => o[(h || '').trim()] = (row[i] || '').trim());
        return o;
    }

    function getData(data, col) {
        if (data[col] !== undefined) return data[col];
        const t = norm(col).replace(/\s/g, '');
        const k = Object.keys(data).find(x => norm(x).replace(/\s/g, '') === t);
        return k ? data[k] : undefined;
    }

    function parseDateDMY(s) {
        const m = String(s || '').match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
        if (!m) return null;
        let y = parseInt(m[3], 10);
        if (y < 100) y += 2000;
        return new Date(y, parseInt(m[2], 10) - 1, parseInt(m[1], 10));
    }

    function sameDate(a, b) {
        const da = parseDateDMY(a), db = parseDateDMY(b);
        if (!da || !db) return false;
        return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
    }

    function expectedAgeRange(dobText, examDateText) {
        const dob = parseDateDMY(dobText), exam = parseDateDMY(examDateText);
        if (!dob || !exam) return [];
        let exact = exam.getFullYear() - dob.getFullYear();
        const hadBirthday = (exam.getMonth() > dob.getMonth()) || (exam.getMonth() === dob.getMonth() && exam.getDate() >= dob.getDate());
        if (!hadBirthday) exact--;
        // Lab có thể ghi tuổi theo năm đơn giản; cho exact ±1 nhưng ngày + tên + giới phải khớp tuyệt đối.
        return [exact - 1, exact, exact + 1];
    }

    function genderCode(v) {
        const n = norm(v);
        if (n === 'nam' || n === 'm' || n.includes('male')) return 'M';
        if (n === 'nu' || n === 'f' || n.includes('female')) return 'F';
        return '';
    }

    function sidPrefixForExamDate(examDateText) {
        const d = parseDateDMY(examDateText);
        if (!d) return '';
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yy = String(d.getFullYear()).slice(-2);
        return `${dd}${mm}${yy}-`;
    }

    async function findLabForCase(c) {
        const { header, rows } = await fetchSheetRows();
        const iName = colIndex(header, 'Tên bệnh nhân');
        const iAge = colIndex(header, 'Tuổi');
        const iSex = colIndex(header, 'Giới tính');
        const iDate = colIndex(header, 'Ngày XN');
        const iSid = colIndex(header, 'SID');
        if ([iName, iDate, iSid].some(i => i < 0)) {
            throw new Error('Sheet XN thiếu một trong các cột: Tên bệnh nhân, Ngày XN, SID.');
        }

        const name = norm(c.hoTen);

        const candidates = [];
        for (const r of rows) {
            if (norm(r[iName]) !== name) continue;
            if (!sameDate(r[iDate], c.ngayKham)) continue;
            candidates.push({
                data: buildData(header, r),
                age: iAge >= 0 ? String(r[iAge] || '').trim() : '',
                sex: iSex >= 0 ? String(r[iSex] || '').trim() : ''
            });
        }

        if (candidates.length === 0) return { status: 'NOT_FOUND', matches: [] };
        if (candidates.length === 1) return { status: 'OK', data: candidates[0].data };

        // Chỉ dùng năm sinh/tuổi và giới để GỠ TRÙNG, không dùng ở bước tìm chính.
        // Sheet hiện có dòng ghi "1993 tuổi": số 1900–2100 được hiểu là năm sinh;
        // số nhỏ hơn được hiểu là tuổi thực tại ngày khám.
        const dob = parseDateDMY(c.ngaySinh);
        const birthYear = dob ? dob.getFullYear() : null;
        const validAges = expectedAgeRange(c.ngaySinh, c.ngayKham);
        let narrowed = candidates;

        if (iAge >= 0 && (birthYear || validAges.length)) {
            const byBirth = narrowed.filter(x => {
                const n = parseInt(x.age, 10);
                if (!Number.isFinite(n)) return false;
                if (n >= 1900 && n <= 2100) return n === birthYear;
                return validAges.includes(n);
            });
            if (byBirth.length) narrowed = byBirth;
        }

        if (narrowed.length > 1 && iSex >= 0) {
            const wantedSex = genderCode(c.gioiTinh);
            const bySex = narrowed.filter(x => genderCode(x.sex) === wantedSex);
            if (bySex.length) narrowed = bySex;
        }

        if (narrowed.length === 1) return { status: 'OK', data: narrowed[0].data };
        return { status: 'DUPLICATE', matches: narrowed.map(x => x.data) };
    }

    // =====================================================================
    // CLS ENGINE - adapted from Auto KSK TD
    // =====================================================================

    function stripTrailingUnit(text) {
        return norm(text).replace(/\s*\([^)]*\)\s*$/, '').trim();
    }

    function findLabelElements(labelText) {
        const target = norm(labelText);
        return [...document.querySelectorAll('b,label')].filter(b => {
            const raw = norm(b.textContent);
            return raw === target || stripTrailingUnit(b.textContent) === target;
        });
    }

    function findNumberInputForLabel(labelEl) {
        let current = labelEl;
        for (let level = 0; level < 12 && current; level++, current = current.parentElement) {
            const input = current.querySelector('input.dx-texteditor-input');
            if (input) return { element: input, role: input.getAttribute('role') || 'unknown' };
        }
        return null;
    }

    function findNumberedHeaders() {
        return [...document.querySelectorAll('b,strong,h1,h2,h3,h4,h5,h6,.card-title,.panel-title')]
            .filter(isVisibleElement)
            .filter(b => /^\d+\.\s*\S/.test((b.textContent || '').trim()));
    }

    function getDinhKyScope() {
        const headers = findNumberedHeaders();
        const idx = headers.findIndex(h => norm(h.textContent).includes('kham suc khoe dinh ky'));
        if (idx >= 0) return { start: headers[idx], end: headers[idx + 1] || null };

        // Một số hồ sơ render tiêu đề bằng div/span thay vì b/strong.
        const fallback = [...document.querySelectorAll('div,span,p')]
            .filter(isVisibleElement)
            .filter(el => {
                const t = norm(el.textContent);
                return t.includes('kham suc khoe dinh ky') && t.length < 100;
            })
            .sort((a, b) => a.children.length - b.children.length)[0] || null;
        return fallback ? { start: fallback, end: null } : null;
    }

    function isInScope(el, scope) {
        if (!scope) return true;
        const after = !!(scope.start.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
        if (!after) return false;
        if (!scope.end) return true;
        return !!(scope.end.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING);
    }

    function parseNumberLoose(v) {
        let s = String(v ?? '').trim().replace(/\s/g, '');
        if (!s) return NaN;
        const lastDot = s.lastIndexOf('.');
        const lastComma = s.lastIndexOf(',');
        if (lastDot >= 0 && lastComma >= 0) {
            // VD 1.013,00 -> 1013.00; 1,013.00 -> 1013.00
            if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
            else s = s.replace(/,/g, '');
        } else if (lastComma >= 0) {
            s = s.replace(',', '.');
        }
        const n = Number(s);
        return Number.isFinite(n) ? n : NaN;
    }

    async function dispatchInputValue(input, value) {
        input.focus();
        nativeInputSetter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.blur();
        input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        await sleep(40);
    }

    function getDevExtremeEditor(input) {
        const roots = [
            input?.closest('.dx-numberbox'),
            input?.closest('.dx-autocomplete'),
            input?.closest('.dx-selectbox'),
            input?.closest('.dx-textbox'),
            input?.closest('.dx-texteditor')
        ].filter(Boolean);
        const types = ['dxNumberBox', 'dxAutocomplete', 'dxSelectBox', 'dxTextBox'];

        for (const root of roots) {
            for (const type of types) {
                try {
                    const ctor = window.DevExpress?.ui?.[type];
                    const instance = ctor?.getInstance?.(root);
                    if (instance) return { root, type, instance };
                } catch (_) {}
                try {
                    const jq = window.jQuery || window.$;
                    if (jq?.fn?.[type]) {
                        const instance = jq(root)[type]('instance');
                        if (instance) return { root, type, instance };
                    }
                } catch (_) {}
            }
        }
        return null;
    }

    const CLS_WRITES = { pending: 0, completed: 0, lastCompletedAt: 0 };

    async function setCommittedEditorValue(input, rawValue, displayValue) {
        CLS_WRITES.pending++;
        try {
            const editor = getDevExtremeEditor(input);
            if (!editor) {
                await dispatchInputValue(input, displayValue);
                return false;
            }

            let widgetValue = displayValue;
            if (editor.type === 'dxNumberBox') {
                const n = parseNumberLoose(rawValue);
                if (!Number.isFinite(n)) {
                    await dispatchInputValue(input, displayValue);
                    return false;
                }
                widgetValue = n;
            }

            // Ghi vào chính state của DevExtreme để Angular nhận valueChanged và
            // đưa giá trị vào payload Lưu; không chỉ làm chữ xuất hiện trên input.
            editor.instance.option('value', widgetValue);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
            await sleep(40);
            return true;
        } finally {
            CLS_WRITES.pending = Math.max(0, CLS_WRITES.pending - 1);
            CLS_WRITES.completed++;
            CLS_WRITES.lastCompletedAt = Date.now();
        }
    }

    function formatNumberForMedinet(raw) {
        const val = String(raw ?? '').trim();
        if (!val) return '';

        // Google CSV trả số thập phân bằng dấu chấm, trong khi NumberBox của
        // Medinet dùng locale vi-VN và hiểu dấu chấm là phân cách hàng nghìn.
        // Chỉ đổi ký tự nhập cho đúng control; không parse, không làm tròn và
        // không thay đổi giá trị số lấy từ sheet DATA.
        if (/^[+-]?\d+\.\d+$/.test(val)) return val.replace('.', ',');
        return val;
    }

    async function setNumberValue(input, raw) {
        const val = formatNumberForMedinet(raw);
        await setCommittedEditorValue(input, raw, val);
        return val;
    }

    async function setQualitative(inputInfo, raw) {
        // Giữ đúng nguyên cơ chế Auto KSKTD: với nhóm định tính niệu, thử
        // "Negative" khi giá trị nguồn = 0. Nếu control không nhận chữ
        // (NumberBox kiểu cũ) thì tự rơi về số 0.
        const val = String(raw ?? '').trim();
        if (!val) return '';

        const n = parseNumberLoose(val);
        if (Number.isFinite(n) && n === 0) {
            await setCommittedEditorValue(inputInfo.element, 'Negative', 'Negative');
            // Một số control hiển thị Negative thoáng qua rồi Angular loại bỏ.
            // Chờ đủ lâu để phân biệt đã commit thật với giá trị tạm trên input.
            await sleep(350);
            const displayed = (inputInfo.element.value || '').trim();
            if (norm(displayed).includes('negative')) return 'Negative';
            return await setNumberValue(inputInfo.element, '0');
        }

        return await setNumberValue(inputInfo.element, val);
    }

    function findRadioNearLabel(labelEl, answerText) {
        const t = norm(answerText);
        let cur = labelEl;
        for (let i = 0; i < 12 && cur; i++, cur = cur.parentElement) {
            const rs = [...cur.querySelectorAll('.dx-item.dx-radiobutton,[role="radio"]')];
            const m = rs.find(r => norm((r.querySelector('.dx-item-content') || r).textContent) === t);
            if (m) return m;
        }
        return null;
    }

    function isRadioSelected(radio) {
        if (!radio) return false;
        const root = radio.closest('[role="radio"],.dx-radiobutton') || radio;
        return radio.getAttribute('aria-checked') === 'true' ||
            root.getAttribute('aria-checked') === 'true' ||
            radio.classList.contains('dx-radiobutton-checked') ||
            root.classList.contains('dx-radiobutton-checked') ||
            !!root.querySelector('.dx-radiobutton-checked,.dx-radiobutton-icon-checked,input:checked,[aria-checked="true"]');
    }

    async function ensureLoaiKhamDinhKy(scope) {
        // Chỉ click các CONTROL có text đúng; tuyệt đối không click header chữ thường.
        const answers = ['Khám Định kỳ', 'Khám sức khỏe định kỳ'];
        for (const answer of answers) {
            const t = norm(answer);
            const controls = [...document.querySelectorAll('[role="radio"], .dx-list-item[role="option"], .dx-radiobutton')]
                .filter(el => isInScope(el, scope) && norm((el.querySelector('.dx-item-content') || el).textContent) === t);
            if (!controls.length) continue;
            const c = controls[0];
            const selected = c.getAttribute('aria-checked') === 'true' || c.getAttribute('aria-selected') === 'true' || c.classList.contains('dx-list-item-selected');
            if (!selected) {
                robustClick(c);
                await sleep(200);
            }
            return true;
        }
        // Có portal render 2 khung tách sẵn, không có control loại khám; khung 2 chính là định kỳ.
        return !!scope;
    }

    async function fillNitrit(data, scope) {
        const raw = getData(data, 'NIT');
        if (raw === undefined || raw === '') return { filled: false, missing: true };
        const answer = String(raw).trim() === '0' ? 'âm tính' : 'dương tính';
        const labels = findLabelElements('Nitrit').filter(el => isInScope(el, scope));
        if (!labels.length) return { filled: false, notFound: true };
        const radio = findRadioNearLabel(labels[0], answer);
        if (!radio) return { filled: false, notFound: true };
        if (!isRadioSelected(radio)) {
            robustClick(radio);
            await waitFor(() => isRadioSelected(radio), 1200, 50);
        }
        CLS_WRITES.completed++;
        CLS_WRITES.lastCompletedAt = Date.now();
        return { filled: true };
    }

    function resolveClsScope() {
        let scope = getDinhKyScope();
        if (scope) return scope;
        const rbcLabels = findLabelElements('Số lượng HC');
        const hgbLabels = findLabelElements('Huyết sắc tố');
        if (rbcLabels.length <= 1 && hgbLabels.length <= 1 && (rbcLabels.length || hgbLabels.length)) {
            return null;
        }
        throw new Error('Không xác định được khung định kỳ và trang có nhiều bộ trường CLS.');
    }

    async function waitForAllClsControlsStable(scope, data, timeoutMs = 15000) {
        // Chờ TOÀN BỘ control có dữ liệu nguồn, không chỉ RBC/HGB. Nhờ vậy chỉ
        // bắt đầu một lượt điền sau khi cả phần máu và nước tiểu đã render xong.
        const startedAt = Date.now();
        let lastNodes = new Map();
        let lastMissing = [];
        let stableSince = 0;

        const sameNodes = (a, b) => {
            if (a.size !== b.size) return false;
            for (const [key, node] of a) if (b.get(key) !== node) return false;
            return true;
        };

        while (Date.now() - startedAt < timeoutMs) {
            if (document.hidden) return { ok: false, hidden: true, missing: lastMissing };

            const nodes = new Map();
            const missing = [];
            for (const f of FIELD_MAP) {
                const raw = getData(data, f.column);
                if (raw === undefined || raw === '') continue;
                const label = findLabelElements(f.label).find(el => isInScope(el, scope));
                const input = label ? findNumberInputForLabel(label)?.element : null;
                if (!input || !input.isConnected || !isVisibleElement(input) || input.disabled) {
                    missing.push(f.label);
                    continue;
                }
                nodes.set(`${f.column}:${f.label}`, input);
            }

            const nitRaw = getData(data, 'NIT');
            if (nitRaw !== undefined && nitRaw !== '') {
                const nitLabel = findLabelElements('Nitrit').find(el => isInScope(el, scope));
                const answer = String(nitRaw).trim() === '0' ? 'âm tính' : 'dương tính';
                const radio = nitLabel ? findRadioNearLabel(nitLabel, answer) : null;
                if (!radio || !radio.isConnected || !isVisibleElement(radio) || radio.getAttribute('aria-disabled') === 'true') {
                    missing.push('Nitrit');
                } else {
                    nodes.set('NIT:Nitrit', radio);
                }
            }

            const ready = missing.length === 0 && nodes.size >= 5 && !isListLoading();
            if (ready && sameNodes(nodes, lastNodes)) {
                if (!stableSince) stableSince = Date.now();
                if (Date.now() - stableSince >= 500) {
                    return { ok: true, hidden: false, missing: [], count: nodes.size };
                }
            } else {
                stableSince = 0;
            }
            lastNodes = nodes;
            lastMissing = missing;
            await sleep(50);
        }
        return { ok: false, hidden: false, missing: lastMissing };
    }

    async function waitForClsWritesFinished(timeoutMs = 15000) {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
            if (document.hidden) return false;
            const quietFor = Date.now() - Number(CLS_WRITES.lastCompletedAt || 0);
            if (CLS_WRITES.pending === 0 && CLS_WRITES.completed > 0 && quietFor >= 700 && !isListLoading()) {
                return true;
            }
            await sleep(100);
        }
        return false;
    }

    async function waitForFilledClsValuesStable(scope, data, stableMs = 1500, timeoutMs = 30000) {
        // Chỉ quan sát, tuyệt đối không điền lại. Các ô có dữ liệu nguồn chỉ cần
        // không trống và toàn bộ trạng thái hiển thị không đổi trong stableMs.
        const startedAt = Date.now();
        let stableSince = 0;
        let lastUnstable = [];
        let lastSignature = '';

        while (Date.now() - startedAt < timeoutMs) {
            if (document.hidden) return { ok: false, hidden: true, unstable: lastUnstable };
            const unstable = [];
            const signatureParts = [];

            for (const f of FIELD_MAP) {
                const raw = getData(data, f.column);
                if (raw === undefined || raw === '') continue;
                const label = findLabelElements(f.label).find(el => isInScope(el, scope));
                const input = label ? findNumberInputForLabel(label)?.element : null;
                const displayed = String(input?.value ?? '').trim();
                if (!input || !input.isConnected || !displayed) {
                    unstable.push(f.label);
                } else {
                    signatureParts.push(`${f.column}:${displayed}`);
                }
            }

            const nitRaw = getData(data, 'NIT');
            if (nitRaw !== undefined && nitRaw !== '') {
                const nitLabel = findLabelElements('Nitrit').find(el => isInScope(el, scope));
                const answer = String(nitRaw).trim() === '0' ? 'âm tính' : 'dương tính';
                const radio = nitLabel ? findRadioNearLabel(nitLabel, answer) : null;
                const selected = isRadioSelected(radio);
                if (!selected) unstable.push('Nitrit');
                else signatureParts.push(`NIT:${answer}`);
            }

            const signature = signatureParts.join('|');
            if (unstable.length === 0 && !isListLoading()) {
                if (!stableSince || signature !== lastSignature) stableSince = Date.now();
                lastSignature = signature;
                const stableFor = Date.now() - stableSince;
                showStatus(`CLS đã đầy đủ · chờ yên ${(stableFor / 1000).toFixed(1)}/${(stableMs / 1000).toFixed(1)} giây...`);
                if (stableFor >= stableMs) return { ok: true, hidden: false, unstable: [] };
            } else {
                stableSince = 0;
                lastSignature = '';
                if (unstable.length) showStatus(`CLS còn đang hoàn tất: ${unstable.join(', ')}...`);
            }
            lastUnstable = unstable;
            await sleep(100);
        }
        return { ok: false, hidden: false, unstable: lastUnstable };
    }

    async function fillCls(data) {
        // SPA có thể đổi URL trước khi các input CLS render xong.
        await waitFor(() =>
            findLabelElements('Số lượng HC').length > 0 ||
            findLabelElements('Huyết sắc tố').length > 0,
        20000, 200);

        const scope = resolveClsScope();

        await ensureLoaiKhamDinhKy(scope);
        const controlsReady = await waitForAllClsControlsStable(scope, data);
        if (!controlsReady.ok) {
            if (controlsReady.hidden) throw new Error('TAB_HIDDEN: tạm dừng trước khi điền CLS.');
            const detail = controlsReady.missing.length ? ` Các ô chưa sẵn sàng: ${controlsReady.missing.join(', ')}.` : '';
            throw new Error(`Khung CLS chưa render đủ; chưa điền và chưa lưu ca này.${detail}`);
        }
        CLS_WRITES.pending = 0;
        CLS_WRITES.completed = 0;
        CLS_WRITES.lastCompletedAt = 0;

        let filled = 0, missing = [], notFound = [];

        // Nitrit là radio có thể làm Angular render lại toàn bộ khối nước tiểu.
        // Xử lý nó trước, rồi mới lấy lại các input để điền một lượt duy nhất.
        const nit = await fillNitrit(data, scope);
        if (nit.missing) missing.push('Nitrit');
        if (nit.notFound) notFound.push('Nitrit');

        const controlsAfterNitrit = await waitForAllClsControlsStable(scope, data, 10000);
        if (!controlsAfterNitrit.ok) {
            if (controlsAfterNitrit.hidden) throw new Error('TAB_HIDDEN: tạm dừng sau khi chọn Nitrit.');
            const detail = controlsAfterNitrit.missing.length ? ` Các ô chưa sẵn sàng: ${controlsAfterNitrit.missing.join(', ')}.` : '';
            throw new Error(`Khối nước tiểu chưa render ổn định sau Nitrit; chưa điền và chưa lưu.${detail}`);
        }

        for (const f of FIELD_MAP) {
            if (document.hidden) throw new Error('TAB_HIDDEN: tạm dừng điền CLS.');
            const labels = findLabelElements(f.label).filter(el => isInScope(el, scope));
            if (!labels.length) { notFound.push(f.label); continue; }
            const info = findNumberInputForLabel(labels[0]);
            if (!info) { notFound.push(f.label); continue; }
            const raw = getData(data, f.column);
            if (raw === undefined || raw === '') { if (!MISSING_WARNING_EXCLUDE.includes(f.label)) missing.push(f.label); continue; }
            const value = raw;
            const setter = async () => {
                if (QUALITATIVE_URINE_COLUMNS.includes(f.column)) return await setQualitative(info, value);
                return await setNumberValue(info.element, value);
            };
            await setter();
            filled++;
            await sleep(20);
        }

        if (filled < 5) {
            throw new Error(`Chỉ điền được ${filled} thông số - quá ít, không an toàn để tự lưu.`);
        }
        const writesFinished = await waitForClsWritesFinished();
        if (!writesFinished) throw new Error('TAB_HIDDEN: chưa hoàn tất toàn bộ lệnh điền CLS.');

        const valuesStable = await waitForFilledClsValuesStable(scope, data);
        if (!valuesStable.ok) {
            if (valuesStable.hidden) throw new Error('TAB_HIDDEN: tạm dừng trước khi lưu CLS.');
            const detail = valuesStable.unstable.length ? ` Các ô chưa ổn định: ${valuesStable.unstable.join(', ')}.` : '';
            throw new Error(`CLS chưa điền đủ và ổn định; chưa bấm Lưu.${detail}`);
        }

        return { filled, missing, notFound, sid: getData(data, 'SID') || '' };
    }

    // =====================================================================
    // SAVE - NGUYÊN CƠ CHẾ AUTO KL M2
    // =====================================================================

    function findVisibleButtonByText(text) {
        const target = norm(text);
        const buttons = [...document.querySelectorAll(
            'button,a,div[role="button"],span[role="button"],.dx-button'
        )].filter(isVisibleElement)
          .filter(b => norm(b.textContent).includes(target));

        return buttons.sort((a, b) => {
            const ae = norm(a.textContent) === target ? 0 : 1;
            const be = norm(b.textContent) === target ? 0 : 1;
            return ae - be || norm(a.textContent).length - norm(b.textContent).length;
        })[0] || null;
    }

    async function saveCurrentPage(label) {
        showStatus(`Đang ${label}...`);

        // Cùng fastClick của Auto KL M2, nhưng giới hạn vào nút ĐANG HIỂN THỊ.
        // SPA M3 giữ DOM trang CLS cũ khi đang chuyển sang Kết luận.
        const btn = await waitFor(
            () => findVisibleButtonByText('lưu thay đổi'),
            20000,
            200
        );
        if (!btn) {
            throw new Error(`${label}: không tìm thấy nút Lưu đang hiển thị.`);
        }

        const marker = NET.seq;
        const clickedAt = Date.now();
        if (!fastClick(btn)) throw new Error(`${label}: không kích hoạt được nút Lưu.`);
        const network = await waitForTriggeredNetwork(marker, clickedAt, label);
        log(`${label}:`, network.captured ? `đã chờ ${network.count} request` : 'không bắt được request, dùng fallback ngắn');

        // Không được gắn confirmed=true giả. Khi tracker không bắt được request
        // hoặc chỉ thấy status 0, vẫn cho state machine tiếp tục và dùng kiểm tra
        // render/trang ở bước sau; nhưng giữ đúng mức độ tin cậy để log/debug.
        return {
            confirmed: network.confirmed === true,
            uncertain: network.uncertain === true || !network.captured,
            captured: network.captured === true,
            requestCount: Number(network.count || 0),
            attempt: 1
        };
    }

    // Sau khi Lưu CLS, Medinet có thể reload toàn trang hoặc chỉ render lại
    // khung Angular. Không chuyển mục ngay khi request vừa xong: phải chờ
    // trang CLS hiện lại đầy đủ và giữ nguyên trạng thái liên tục.
    function getClsReloadSnapshot() {
        if (document.readyState !== 'complete' || !isClsPage() || isListLoading()) return null;

        const saveButton = findVisibleButtonByText('lưu thay đổi');
        const hasBloodBlock = findLabelElements('Số lượng HC').some(isVisibleElement) ||
                              findLabelElements('Huyết sắc tố').some(isVisibleElement);
        const inputs = [...document.querySelectorAll('input.dx-texteditor-input,input[type="text"],input[type="number"]')]
            .filter(isVisibleElement);
        if (!saveButton || !hasBloodBlock || inputs.length < 5) return null;

        // Theo dõi cả số ô lẫn giá trị. Nếu Angular còn đang nạp/ghi lại form,
        // chữ ký sẽ đổi và thời gian ổn định được tính lại từ đầu.
        const values = inputs.slice(0, 30).map(input => String(input.value ?? '')).join('\u001f');
        return `${location.href}|${inputs.length}|${values}`;
    }

    async function waitForClsReloadSettled(c, timeoutMs = 30000, stableMs = 2000) {
        const startedAt = Date.now();
        let signature = '';
        let stableSince = 0;

        while (Date.now() - startedAt < timeoutMs) {
            if (document.hidden) return { ok: false, hidden: true };
            if (isConclusionPage()) return { ok: true, alreadyConclusion: true };

            const next = getClsReloadSnapshot();
            if (!next) {
                signature = '';
                stableSince = 0;
            } else if (next !== signature) {
                signature = next;
                stableSince = Date.now();
            } else if (Date.now() - stableSince >= stableMs) {
                return {
                    ok: true,
                    fullReload: !!c?.clsSavePageInstance && c.clsSavePageInstance !== PAGE_INSTANCE_ID
                };
            }
            await sleep(150);
        }
        return { ok: false, hidden: false };
    }

    // =====================================================================
    // RETURN / SKIP
    // =====================================================================

    async function goBackToList() {
        // GIỮ NGUYÊN cơ chế Auto KL M2 v1.1.
        const b = await waitFor(() => findButtonByText('quay lại'), 20000, 200);
        if (b) {
            fastClick(b);
            await waitFor(isListPage, 20000, 250);
            if (isListPage()) return true;
        }
        history.back();
        return !!await waitFor(isListPage, 20000, 250);
    }

    async function skipCurrent(reason, type) {
        const c = getCase();
        warn('SKIP:', c, reason);
        await addSkipped(c, reason, type);
        setStage(STAGE.RETURN_LIST);
        if (!isListPage()) await goBackToList();
        setCase(null);
        setStage(STAGE.LIST);
        await sleep(300);
        queueRun();
    }

    async function failCurrent(reason) {
        const c = getCase();
        const stage = getStage();

        // Lỗi của một ca không được dừng cả batch. Thử lại tại chỗ 2 lần;
        // nếu vẫn lỗi thì ghi nhận + bỏ qua ca để tiếp tục ca kế tiếp.
        if (stage === STAGE.SAVE_CLS || stage === STAGE.SAVE_CONCLUSION) {
            const n = incRetry(c || {}, stage);
            if (n <= 2) {
                const s = getStats();
                s.retries = (s.retries || 0) + 1;
                saveStats(s);
                showStatus(`Lỗi lưu tạm thời · thử lại ${n}/2: ${reason}`);
                await sleep(700);
                queueRun();
                return;
            }
            await addError(c, `${stage}: ${reason}`);
            if (c) await addSkipped(c, `Lỗi lưu sau 2 lần thử: ${stage} - ${reason}`, 'INVALID');
            setStage(STAGE.RETURN_LIST);
            if (!isListPage()) await goBackToList();
                setCase(null);
            setStage(STAGE.LIST);
            queueRun(500);
            return;
        }

        const n = incRetry(c || {}, stage);
        warn(`ERROR stage=${stage} retry=${n}`, reason);
        if (n <= 2) {
            const s = getStats();
            s.retries = (s.retries || 0) + 1;
            saveStats(s);
            showStatus(`Lỗi tạm thời (${stage}) - thử lại ${n}/2: ${reason}`);
            await sleep(1200);
            queueRun();
            return;
        }
        await addError(c, `${stage}: ${reason}`);
        if (c) await addSkipped(c, `Lỗi sau 2 lần thử: ${stage} - ${reason}`, 'INVALID');
        setStage(STAGE.RETURN_LIST);
        if (!isListPage()) await goBackToList();
        setCase(null);
        setStage(STAGE.LIST);
        queueRun();
    }

    // =====================================================================
    // MAIN STATE MACHINE
    // =====================================================================

    async function handleList() {
        showStatus('Đang chờ Medinet tải xong danh sách...');
        const pageReady = await waitForPageReadyOrReload(
            30000,
            'trang danh sách',
            createStableListReadyCheck()
        );
        if (!pageReady) {
            return;
        }

        let resultCount = getResultCount();

        showStatus(`Danh sách thiếu CLS${resultCount !== null ? `: ${resultCount} kết quả` : ''} · Trang ${getCurrentPageNumber()}`);

        if (resultCount === 0) {
            // Chốt lần cuối ngay trước khi kết thúc để không dính bộ đếm 0 tạm.
            if (isListLoading()) {
                queueRun(500);
                return;
            }
            finishBatch('Filter đã còn 0 kết quả.');
            return;
        }

        // Dòng bảng được Angular/DevExtreme render sau phần khung trang.
        // Nếu bộ đếm > 0, tuyệt đối không kết luận "hết ca" trước khi chờ dòng/nút xử lý.
        if (resultCount > 0 && findPencilLinks().length === 0) {
            showStatus(`Có ${resultCount} kết quả · đang chờ bảng và nút Xử lý hiển thị...`);
            await waitFor(() => findPencilLinks().length > 0 || getResultCount() === 0, 20000, 250);
            resultCount = getResultCount();
        }

        const pencilLinks = findPencilLinks();
        const parsedCases = pencilLinks
            .map(link => ({ link, c: parseCaseFromPencil(link) }))
            .filter(x => x.c);
        const found = parsedCases.find(candidate => !isDone(candidate.c) && !isSkipped(candidate.c)) || null;
        if (found) {
            found.c.startedAt = Date.now();
            setCase(found.c);
            setStage(STAGE.OPENING_CASE);
            showStatus(`Mở ca: ${found.c.hoTen} · ${found.c.cccd}`);
            if (!robustClick(found.link)) {
                throw new Error(`Không kích hoạt được nút Xử lý của ${found.c.hoTen}.`);
            }
            await sleep(500);
            const leftList = await waitFor(() => !isListPage(), 15000, 250);
            if (!leftList) {
                throw new Error(`Đã bấm Xử lý nhưng trang không mở hồ sơ của ${found.c.hoTen}.`);
            }
            setStage(STAGE.OPEN_CLS);
            queueRun();
            return;
        }

        // Có kết quả nhưng không đọc được bất kỳ nút Xử lý nào là lỗi selector/render,
        // không được báo nhầm là đã quét hết.
        if (resultCount > 0 && findPencilLinks().length === 0) {
            throw new Error(`Bảng báo ${resultCount} kết quả nhưng không đọc được nút ở cột Xử lý.`);
        }

        if (resultCount > 0 && pencilLinks.length > 0 && parsedCases.length === 0) {
            throw new Error(`Đã thấy ${pencilLinks.length} nút Xử lý nhưng không đọc được Họ tên/Ngày khám của dòng.`);
        }

        // Không còn ca khả dụng ở trang hiện tại: chuyển trang.
        if (await goNextPageIfPossible()) {
            queueRun();
            return;
        }

        // Đến trang cuối, không còn ca ngoài SKIP/DONE.
        finishBatch('Đã quét hết các trang; chỉ còn ca đã SKIP hoặc không còn ca thiếu CLS.');
    }

    async function handleOpenCls() {
        if (isClsPage()) {
            setStage(STAGE.FILL_CLS);
            queueRun();
            return;
        }
        showStatus('Đang mở mục Khám cận lâm sàng...');
        await clickSidebar(['Khám cận lâm sàng', 'Cận lâm sàng'], isClsPage, 'Khám cận lâm sàng');
        setStage(STAGE.FILL_CLS);
        queueRun();
    }

    async function handleFillCls() {
        const c = getCase();
        if (!c) throw new Error('Mất thông tin ca hiện tại.');
        if (!isClsPage()) { setStage(STAGE.OPEN_CLS); queueRun(); return; }
        if (document.hidden) {
            showStatus('Tab đang ẩn · tạm dừng điền CLS để tránh rớt ô...');
            queueRun(1000);
            return;
        }

        showStatus(`Tìm XN: ${c.hoTen} · ngày XN ${c.ngayKham}`);
        const match = await findLabForCase(c);
        if (match.status === 'NOT_FOUND') {
            await skipCurrent('Không tìm thấy XN khớp chính xác Họ tên + Ngày XN/Ngày khám.', 'NOT_FOUND');
            return;
        }
        if (match.status === 'DUPLICATE') {
            await skipCurrent(`Tìm thấy ${match.matches.length} kết quả cùng Họ tên và Ngày XN - không tự chọn.`, 'DUPLICATE');
            return;
        }

        const report = await fillCls(match.data);
        c.sid = report.sid;
        c.fillReport = report;
        setCase(c);
        setStage(STAGE.SAVE_CLS);
        queueRun();
    }

    async function handleSaveCls() {
        const c = getCase();
        if (!c) throw new Error('Mất thông tin ca trước khi lưu CLS.');
        if (document.hidden) {
            showStatus('Tab đang ẩn · chưa lưu CLS...');
            queueRun(1000);
            return;
        }

        showStatus('CLS đã đầy đủ và đứng yên · chuẩn bị lưu Cận lâm sàng...');
        const writesFinished = await waitForClsWritesFinished();
        if (!writesFinished) {
            showStatus('Tab đang ẩn hoặc lệnh điền chưa hoàn tất · chưa bấm Lưu...');
            queueRun(1000);
            return;
        }

        // Ghi stage TRƯỚC cú bấm. Nếu Medinet reload toàn trang ngay trong lúc
        // lưu, userscript khởi động lại ở WAIT_CLS_RELOAD và không bấm Lưu lần 2.
        c.clsSavePageInstance = PAGE_INSTANCE_ID;
        c.clsSaveStartedAt = Date.now();
        setCase(c);
        setStage(STAGE.WAIT_CLS_RELOAD);

        try {
            const save = await saveCurrentPage('LƯU Cận lâm sàng');
            c.clsSaveConfirmed = save.confirmed;
            c.clsSaveUncertain = save.uncertain;
            c.clsSaveRequestFinishedAt = Date.now();
            setCase(c);
        } catch (error) {
            // Nút/request lưu lỗi thật thì cho phép thử lại chính bước Lưu.
            setStage(STAGE.SAVE_CLS);
            throw error;
        }
        queueRun();
    }

    async function handleWaitClsReload() {
        const c = getCase();
        if (!c) throw new Error('Mất thông tin ca trong lúc chờ trang CLS tải lại.');
        if (document.hidden) {
            showStatus('Đã gửi Lưu CLS · tab đang ẩn, chờ hiển thị để xác nhận trang tải xong...');
            queueRun(1000);
            return;
        }

        showStatus('Đã gửi Lưu CLS · đang chờ trang tải/render lại hoàn tất...');
        const settled = await waitForClsReloadSettled(c);
        if (settled.hidden) {
            showStatus('Tab bị ẩn khi chờ CLS tải lại · chưa mở Kết luận...');
            queueRun(1000);
            return;
        }
        if (!settled.ok) {
            throw new Error('Trang CLS chưa tải/render lại ổn định sau khi Lưu; chưa mở Kết luận.');
        }

        c.clsReloadSettledAt = Date.now();
        c.clsReloadMode = settled.fullReload ? 'FULL_RELOAD' : 'SPA_RENDER';
        setCase(c);
        setStage(STAGE.OPEN_CONCLUSION);
        queueRun();
    }

    async function handleOpenConclusion() {
        if (isConclusionPage()) {
            setStage(STAGE.SAVE_CONCLUSION);
            queueRun();
            return;
        }
        showStatus('Đã lưu CLS · đang mở Kết luận...');

        // ID KSKD18_KetLuanKham thuộc M2; M3 có thể dùng ID khác.
        // Dùng lại cơ chế dò đúng mục "Kết luận" đã mở được trang ở các bản trước.
        await clickSidebar(['Kết luận', 'Kết luận khám'], isConclusionPage, 'Kết luận');
        setStage(STAGE.SAVE_CONCLUSION);
        queueRun();
    }

    async function handleSaveConclusion() {
        if (!isConclusionPage()) {
            setStage(STAGE.OPEN_CONCLUSION);
            queueRun();
            return;
        }
        if (document.hidden) {
            showStatus('Tab đang ẩn · chưa lưu Kết luận...');
            queueRun(1000);
            return;
        }
        const c = getCase();
        if (!c) throw new Error('Mất thông tin ca trước khi lưu Kết luận.');

        // Ghi stage TRƯỚC cú bấm giống Lưu CLS. Nếu Medinet full reload ngay
        // sau khi lưu, userscript sẽ tiếp tục ở RETURN_LIST thay vì bấm Lưu lại.
        c.conclusionSavePageInstance = PAGE_INSTANCE_ID;
        c.conclusionSaveStartedAt = Date.now();
        setCase(c);
        setStage(STAGE.RETURN_LIST);

        try {
            const save = await saveCurrentPage('LƯU Kết luận');
            c.conclusionSaveConfirmed = save.confirmed;
            c.conclusionSaveUncertain = save.uncertain;
            c.conclusionSaveRequestFinishedAt = Date.now();
            setCase(c);
        } catch (error) {
            // Chỉ quay lại SAVE_CONCLUSION khi cú lưu lỗi rõ ràng và trang chưa
            // reload mất context; failCurrent sẽ áp dụng retry giới hạn.
            setStage(STAGE.SAVE_CONCLUSION);
            throw error;
        }
        queueRun();
    }

    async function handleReturnList() {
        showStatus('Đã lưu Kết luận · quay lại và chờ danh sách tải xong...');
        if (!isListPage()) {
            const ok = await goBackToList();
            if (!ok) throw new Error('Không quay lại được trang danh sách.');
        }
        const pageReady = await waitForPageReadyOrReload(
            30000,
            'trang danh sách sau khi lưu Kết luận',
            createStableListReadyCheck(500)
        );
        if (!pageReady) return;
        await completeCurrentCase();
    }

    async function completeCurrentCase() {
        const c = getCase();
        if (!c) throw new Error('Mất ca vừa lưu Kết luận.');

        await addDone(c);
        const s = getStats();
        s.done++;
        s.processed = (s.processed || 0) + 1;
        if (c.startedAt) {
            s.totalProcessMs = (s.totalProcessMs || 0) + Math.max(0, Date.now() - c.startedAt);
            s.timedCases = (s.timedCases || 0) + 1;
        }
        saveStats(s);
        log('DONE SAVED:', c.hoTen, c.cccd, c.sid || '');
        setCase(null);
        setStage(STAGE.LIST);
        await sleep(350);
        queueRun();
    }

    // Tương thích nếu tab đang dở ở stage cũ khi cập nhật userscript.
    async function handleVerifyFilter() {
        if (!isListPage()) {
            setStage(STAGE.RETURN_LIST);
            queueRun();
            return;
        }
        await completeCurrentCase();
    }

    function finishBatch(message) {
        setActive(false);
        hideStatus();
        updatePanel();
        const s = getStats();
        const processed = Number(s.processed || 0);
        const success = processed ? ((Number(s.done || 0) / processed) * 100).toFixed(1) : '0.0';
        alert(`✅ AUTO SỬA CLS M3 KẾT THÚC

${message}

Đã xử lý: ${processed}
Hoàn tất: ${s.done || 0} (${success}%)
Bỏ qua: ${s.skipped || 0}
- Không tìm thấy XN: ${s.skippedNotFound || 0}
- Trùng kết quả: ${s.skippedDuplicate || 0}
- Không hợp lệ/lỗi: ${s.skippedInvalid || 0}
Retry: ${s.retries || 0}
Lỗi ghi nhận: ${s.errors || 0}

Bấm 📋 để xem chi tiết.`);
    }

    let busy = false;

    function queueRun(delay = 80) {
        setTimeout(() => runSafely(), delay);
    }

    async function runSafely() {
        if (!isActive() || busy) return;
        busy = true;
        try {
            updatePanel();
            const stage = getStage();
            log('RUN stage:', stage, 'URL:', location.href);
            if (stage === STAGE.LIST) await handleList();
            else if (stage === STAGE.OPENING_CASE || stage === STAGE.OPEN_CLS) await handleOpenCls();
            else if (stage === STAGE.FILL_CLS) await handleFillCls();
            else if (stage === STAGE.SAVE_CLS) await handleSaveCls();
            else if (stage === STAGE.WAIT_CLS_RELOAD) await handleWaitClsReload();
            else if (stage === STAGE.OPEN_CONCLUSION) await handleOpenConclusion();
            else if (stage === STAGE.SAVE_CONCLUSION) await handleSaveConclusion();
            else if (stage === STAGE.RETURN_LIST) await handleReturnList();
            else if (stage === STAGE.VERIFY_FILTER) await handleVerifyFilter();
            else { setStage(STAGE.LIST); await handleList(); }
        } catch (e) {
            console.error(LOG, e);
            const msg = e?.message || String(e);
            if (msg.startsWith('TAB_HIDDEN:') || msg.includes('Tab bị ẩn trong lúc xác nhận CLS')) {
                showStatus('Tab đang ẩn · tạm dừng, sẽ tiếp tục khi hiển thị lại...');
                queueRun(1000);
                return;
            }
            // release busy trước khi retry qua failCurrent.
            busy = false;
            await failCurrent(msg);
            return;
        } finally {
            busy = false;
        }
    }

    // =====================================================================
    // SPA WATCHER + POLLING
    // =====================================================================

    function installNavigationWatcher() {
        if (window.__m3ClsBatchNavInstalled) return;
        window.__m3ClsBatchNavInstalled = true;

        const fire = () => setTimeout(() => runSafely(), 500);
        const p = history.pushState, r = history.replaceState;
        history.pushState = function (...args) { const out = p.apply(this, args); window.dispatchEvent(new Event('m3cls-locationchange')); return out; };
        history.replaceState = function (...args) { const out = r.apply(this, args); window.dispatchEvent(new Event('m3cls-locationchange')); return out; };
        window.addEventListener('popstate', () => window.dispatchEvent(new Event('m3cls-locationchange')));
        window.addEventListener('m3cls-locationchange', fire);

        let last = location.href;
        setInterval(() => {
            if (location.href !== last) {
                last = location.href;
                sessionStorage.setItem(KEY_LAST_URL, last);
                if (isActive()) fire();
            }
        }, 500);

        // DOM thay đổi nhưng URL không đổi (DevExtreme tab đôi lúc vậy).
        let domTimer = null;
        const mo = new MutationObserver(() => {
            if (!isActive() || busy) return;
            clearTimeout(domTimer);
            domTimer = setTimeout(() => runSafely(), 900);
        });
        mo.observe(document.documentElement, { childList: true, subtree: true });
    }

    // =====================================================================
    // INIT
    // =====================================================================

    async function init() {
        installNetworkTracker();
        ensurePanel();
        installNavigationWatcher();
        setInterval(() => { if (isActive()) updatePanel(); }, 1000);
        document.addEventListener('visibilitychange', () => {
            updatePanel();
            // Chromium có thể trì hoãn timer ở tab ẩn; chạy bù ngay khi tab
            // được hiển thị lại.
            if (!document.hidden && isActive()) queueRun(30);
        });
        updatePanel();
        if (isActive()) {
            await sleep(700);
            queueRun();
        }
        log('READY v1.5.0 SINGLE-TAB STATS+ERRORS');
    }

    init();
})();
