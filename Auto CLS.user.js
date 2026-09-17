// ==UserScript==
// @name         Auto CLS M3/M4 Smart Batch
// @namespace    medinet-auto-cls-m3-m4-smart-batch
// @version      2.0.14
// @description  Tự nhận diện M3/M4: có XN thì điền, không có XN vẫn lưu CLS; sau đó lưu Kết luận, quay lại danh sách và tiếp tục batch.
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
    // - Dùng trên DANH SÁCH M3 hoặc M4 đã lọc "Chưa có cận lâm sàng".
    // - Một ca chỉ được tính DONE sau chuỗi:
    //     điền CLS -> Lưu CLS -> mở Kết luận -> Lưu Kết luận
    //     -> quay về Danh sách -> chờ bảng tải ổn định -> tiếp tục ca kế.
    // - Không tìm thấy XN => vẫn Lưu CLS trống rồi mở/lưu Kết luận.
    // - Trùng XN / dữ liệu không đủ chắc chắn => SKIP.
    // - Lỗi kỹ thuật => RETRY giới hạn, sau đó ghi ERROR và tiếp tục.
    // - Không tự đoán kết quả xét nghiệm.

    const LOG = '[AUTO CLS SMART BATCH]';

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
    const KEY_ACTIVE = 'm34_cls_smart_active_v200';
    const KEY_STAGE = 'm34_cls_smart_stage_v200';
    const KEY_CASE = 'm34_cls_smart_case_v200';
    const KEY_STATS = 'm34_cls_smart_stats_v200';
    // Namespace mới để không mang theo các ca SKIP tích lũy từ những lần chạy
    // v1.0-v1.3.4. SKIP được giữ lại để tránh chạy lại ngoài ý muốn.
    const KEY_SKIPPED = 'm34_cls_smart_skipped_v200';
    const KEY_DONE = 'm34_cls_smart_done_v200';
    const KEY_ERRORS = 'm34_cls_smart_errors_v200';
    const KEY_RETRIES = 'm34_cls_smart_retries_v200';
    const KEY_LAST_URL = 'm34_cls_smart_last_url_v200';
    const KEY_UI_MODE = 'm34_cls_smart_ui_mode_v202';
    const KEY_RELOAD_COUNT = 'm34_cls_smart_reload_count_v200';
    // Mẫu hiện tại được ghi nhớ theo tab để khi từ danh sách đi vào hồ sơ
    // URL chi tiết vẫn biết chính xác đang chạy M3 hay M4.
    const KEY_MODEL = 'm34_cls_smart_model_v200';

    const MODEL_ROUTE = {
        M3_LIST: ['KSKDK_DanhSach_KSK_M13', 'KSKDK_DanhSach_KSK_M3'],
        M4_LIST: ['KSKDK_DanhSach_KSK_NguoiCaoTuoi_Report'],
        M4_DETAIL: ['/kskdk_NguoiCaoTuoi/', 'KNCT_', 'mauphieunct']
    };

    function detectModelFromLocation() {
        const u = location.href || '';
        if (MODEL_ROUTE.M3_LIST.some(x => u.includes(x))) return 'M3';
        if (MODEL_ROUTE.M4_LIST.some(x => u.includes(x))) return 'M4';
        if (MODEL_ROUTE.M4_DETAIL.some(x => u.includes(x))) return 'M4';

        const body = norm(document.body?.innerText || '');
        // Chỉ dùng body khi có dấu hiệu trang danh sách/hồ sơ đủ đặc hiệu.
        if (body.includes('nguoi cao tuoi') && (body.includes('chat luong du lieu') || body.includes('thong tin doi tuong kham'))) return 'M4';
        if ((body.includes('18 - 59') || body.includes('18-59') || body.includes('du 18')) && body.includes('chat luong du lieu')) return 'M3';
        return '';
    }

    function rememberDetectedModel() {
        const detected = detectModelFromLocation();
        if (detected) sessionStorage.setItem(KEY_MODEL, detected);
        return detected;
    }

    function getCurrentModel() {
        return rememberDetectedModel() || sessionStorage.getItem(KEY_MODEL) || '';
    }

    function getModelLabel() {
        return getCurrentModel() || 'M3/M4';
    }

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
        const model = c.model || getCurrentModel() || 'UNKNOWN';
        if (c.cccd) return `${model}|CCCD:${c.cccd}|DATE:${c.ngayKham || ''}`;
        return `${model}|NAME:${norm(c.hoTen)}|DOB:${c.ngaySinh || ''}|SEX:${norm(c.gioiTinh)}|DATE:${c.ngayKham || ''}`;
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

    function releaseLegacyNotFoundSkips() {
        // Bản cũ từng đưa ca không tìm thấy XN vào SKIP. Từ v2.0.13 các ca này
        // phải được chạy lại để lưu CLS trống + Kết luận; chỉ gỡ NOT_FOUND,
        // giữ nguyên DUPLICATE/INVALID vì đó là các ca chưa đủ chắc chắn.
        const skipped = getLocalJson(KEY_SKIPPED, {});
        let released = 0;
        for (const [key, item] of Object.entries(skipped)) {
            if (item?.type !== 'NOT_FOUND') continue;
            delete skipped[key];
            released++;
        }
        if (released) {
            setLocalJson(KEY_SKIPPED, skipped);
            log(`Đã mở lại ${released} ca NOT_FOUND cũ để lưu CLS trống + Kết luận.`);
        }
        return released;
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


    function getUiMode() {
        try {
            return localStorage.getItem(KEY_UI_MODE) || 'expanded';
        } catch (_) {
            return 'expanded';
        }
    }

    function setUiMode(mode) {
        try {
            localStorage.setItem(KEY_UI_MODE, mode === 'collapsed' ? 'collapsed' : 'expanded');
        } catch (_) {}
        updatePanel();
        positionBatchBubble();
    }

    // =====================================================================
    // UI
    // =====================================================================

    function ensureStyles() {
        if (document.getElementById('m3-cls-batch-style')) return;
        const style = document.createElement('style');
        style.id = 'm3-cls-batch-style';
        style.textContent = `
            #m3-cls-batch-panel{
                position:fixed;right:14px;bottom:10px;z-index:9999999;width:328px;
                color:#effbff;background:linear-gradient(160deg,rgba(4,12,24,.97),rgba(7,20,38,.96));
                border:1px solid rgba(71,226,255,.30);border-radius:20px;
                box-shadow:0 18px 42px rgba(2,6,23,.42),0 0 0 1px rgba(255,255,255,.03) inset,0 0 24px rgba(34,211,238,.10);
                backdrop-filter:blur(14px);font-family:'Segoe UI',Roboto,Arial,sans-serif;overflow:hidden;
                transition:opacity .18s ease,transform .18s ease;
            }
            #m3-cls-batch-panel.m3cls-hidden{display:none!important}
            #m3-cls-batch-panel.m3cls-collapsed{display:none!important}
            #m3-cls-batch-panel .h{display:grid;grid-template-columns:54px 1fr auto;gap:11px;align-items:center;padding:12px 14px 10px;border-bottom:1px solid rgba(148,163,184,.12);background:linear-gradient(90deg,rgba(8,47,73,.62),rgba(2,6,23,.16))}
            #m3-cls-batch-panel .m3cls-reactor{position:relative;width:48px;height:48px;border-radius:50%;display:grid;place-items:center;isolation:isolate;flex:none}
            #m3-cls-batch-panel .m3cls-reactor::before{content:'';position:absolute;inset:1px;border-radius:50%;background:repeating-conic-gradient(from 0deg,#6ee7f9 0 10deg,#155e75 10deg 19deg,#082f49 19deg 29deg,#164e63 29deg 34deg);box-shadow:0 0 0 3px #020617 inset,0 0 14px rgba(34,211,238,.42);animation:m3cls-idle-spin 4.8s linear infinite}
            #m3-cls-batch-panel.m3cls-running .m3cls-reactor::before{animation-duration:.9s;box-shadow:0 0 0 3px #020617 inset,0 0 18px rgba(34,211,238,.85)}
            #m3-cls-batch-panel .m3cls-reactor::after{content:'';position:absolute;inset:10px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#145369,#07111f 64%);border:1px solid rgba(165,243,252,.52);z-index:2}
            #m3-cls-batch-panel .m3cls-reactor b{position:relative;z-index:4;font-size:14px;font-weight:900;color:#ecfeff;text-shadow:0 0 8px rgba(103,232,249,.72)}
            @keyframes m3cls-idle-spin{to{rotate:360deg}}
            #m3-cls-batch-panel .m3cls-title{min-width:0}
            .m3cls-title-main{font-size:14px;font-weight:900;letter-spacing:.45px;color:#f8fdff}
            .m3cls-title-sub{font-size:11px;color:#9be7ff;margin-top:2px;font-weight:700;letter-spacing:.22px}
            #m3-cls-batch-panel .m3cls-header-tools{display:flex;align-items:center;gap:8px}
            #m3-cls-batch-panel .m3cls-state{font-size:10.5px;font-weight:900;padding:5px 8px;border-radius:999px;border:1px solid rgba(125,211,252,.28);background:rgba(14,116,144,.16);color:#bdf4ff;white-space:nowrap}
            #m3-cls-batch-panel.m3cls-running .m3cls-state{color:#ecfeff;background:rgba(8,145,178,.28);box-shadow:0 0 12px rgba(34,211,238,.16)}
            #m3-cls-batch-panel .m3cls-toggle{width:30px;height:30px;border-radius:10px;border:1px solid rgba(148,163,184,.16);background:rgba(15,23,42,.74);color:#dff9ff;font-size:16px;font-weight:900;display:grid;place-items:center;cursor:pointer;box-shadow:0 4px 12px rgba(2,6,23,.22)}
            #m3-cls-batch-panel .m3cls-toggle:hover{filter:brightness(1.08)}
            #m3-cls-batch-panel .b{padding:12px 14px 10px;font-size:12.8px;color:#dceaf6;line-height:1.48}
            #m3-cls-batch-panel .m3cls-statusline{padding:9px 11px;margin-bottom:10px;border-radius:12px;background:rgba(10,18,34,.86);border:1px solid rgba(103,232,249,.13);color:#f2fbff;min-height:40px;display:flex;align-items:center;font-size:12.5px;font-weight:700;letter-spacing:.1px}
            #m3-cls-batch-panel .m3cls-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
            #m3-cls-batch-panel .m3cls-card{padding:9px 10px;border-radius:12px;background:rgba(15,23,42,.62);border:1px solid rgba(148,163,184,.10)}
            #m3-cls-batch-panel .m3cls-card span{display:block;font-size:10px;color:#9cb3c7;text-transform:uppercase;letter-spacing:.38px}
            .m3cls-card b{display:block;margin-top:2px;font-size:16px;line-height:1.15;color:#f8fafc}
            .m3cls-card .m3cls-ok{color:#86efac}.m3cls-card .m3cls-warn{color:#fcd34d}.m3cls-card .m3cls-bad{color:#fda4af}
            #m3-cls-batch-panel .m3cls-mini{display:flex;justify-content:space-between;gap:8px;margin-top:9px;padding-top:8px;border-top:1px solid rgba(148,163,184,.11);font-size:11.2px;color:#9eb2c5}.m3cls-mini strong{color:#f8fafc;font-weight:800}
            #m3-cls-batch-panel .m3cls-patient{margin-top:9px;padding:9px 10px;border-radius:12px;background:linear-gradient(90deg,rgba(8,47,73,.42),rgba(15,23,42,.48));border:1px solid rgba(34,211,238,.12)}
            #m3cls-patient{display:block;color:#fff;font-size:12.3px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
            #m3cls-detail{font-size:10.8px;color:#a9bed1;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
            #m3-cls-batch-panel .actions{display:grid;grid-template-columns:1fr 1fr 40px 58px;gap:7px;padding:0 14px 14px}
            #m3-cls-batch-panel button{height:36px;border:1px solid rgba(148,163,184,.13);border-radius:11px;font-size:11px;font-weight:850;cursor:pointer;font-family:inherit;transition:transform .12s ease,filter .12s ease,box-shadow .12s ease}
            #m3-cls-batch-panel button:hover{transform:translateY(-1px);filter:brightness(1.08)}
            #m3cls-start{background:linear-gradient(135deg,#0891b2,#2563eb);color:#fff;box-shadow:0 5px 14px rgba(37,99,235,.18)}
            #m3cls-stop{background:linear-gradient(135deg,#7f1d1d,#dc2626);color:#fff}
            #m3cls-report{background:#111c2d;color:#bae6fd}
            #m3cls-reset-skip{background:#241b0b;color:#fde68a}
            #m3cls-status{display:none!important}
            #m3cls-report-overlay{position:fixed;inset:0;z-index:10000020;background:rgba(2,6,23,.72);display:flex;align-items:center;justify-content:center;padding:24px;font-family:Segoe UI,Arial,sans-serif;backdrop-filter:blur(7px)}
            #m3cls-report-box{width:min(920px,95vw);height:min(760px,90vh);background:#07111f;color:#e2e8f0;border:1px solid rgba(103,232,249,.24);border-radius:18px;box-shadow:0 24px 70px rgba(0,0,0,.5);display:flex;flex-direction:column;overflow:hidden}
            #m3cls-report-head{padding:13px 16px;background:linear-gradient(90deg,#0c4a6e,#172554);color:#fff;font-weight:800;display:flex;justify-content:space-between;align-items:center}
            #m3cls-report-text{flex:1;overflow:auto;white-space:pre-wrap;word-break:break-word;margin:0;padding:16px;font:12.5px/1.55 Consolas,monospace;color:#dbeafe;background:#07111f}
            #m3cls-report-actions{display:flex;justify-content:flex-end;gap:8px;padding:11px 14px;border-top:1px solid rgba(148,163,184,.13)}
            #m3cls-report-actions button{border:0;border-radius:9px;padding:9px 13px;font-weight:800;cursor:pointer}
            #m3cls-copy-all{background:#0891b2;color:#fff}#m3cls-clear-errors{background:#3f1218;color:#fecdd3}#m3cls-close-report{background:#162236;color:#cbd5e1}
            #m3cls-bubble{position:fixed;right:20px;bottom:352px;z-index:10000012;width:min(372px,calc(100vw - 36px));background:#fff;color:#111827;border:2px solid #0f172a;border-radius:18px 18px 18px 10px;box-shadow:0 18px 40px rgba(2,6,23,.28);font-family:'Segoe UI',Roboto,Arial,sans-serif;opacity:0;transform:scale(.96);transform-origin:90% 100%;transition:opacity .12s ease,transform .12s ease;overflow:visible}
            #m3cls-bubble.show{opacity:1;transform:scale(1)}
            #m3cls-bubble::after{content:'';position:absolute;right:28px;bottom:-13px;width:22px;height:22px;background:#fff;border-right:2px solid #0f172a;border-bottom:2px solid #0f172a;transform:rotate(45deg);border-radius:0 0 4px 0}
            #m3cls-bubble.warn{background:#fff9e8;border-color:#7c2d12}#m3cls-bubble.warn::after{background:#fff9e8;border-color:#7c2d12}
            #m3cls-bubble.error{background:#fff1f2;border-color:#991b1b}#m3cls-bubble.error::after{background:#fff1f2;border-color:#991b1b}
            #m3cls-bubble.ok{background:#f0fdf4;border-color:#166534}#m3cls-bubble.ok::after{background:#f0fdf4;border-color:#166534}
            #m3cls-bubble .bb-head{display:flex;gap:9px;align-items:flex-start;padding:13px 14px 7px;position:relative;z-index:2}.bb-dot{width:10px;height:10px;border-radius:50%;margin-top:4px;background:#38bdf8;box-shadow:0 0 0 3px rgba(56,189,248,.15)}
            #m3cls-bubble.warn .bb-dot{background:#f59e0b;box-shadow:0 0 0 3px rgba(245,158,11,.15)}#m3cls-bubble.error .bb-dot{background:#ef4444;box-shadow:0 0 0 3px rgba(239,68,68,.15)}#m3cls-bubble.ok .bb-dot{background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.15)}
            #m3cls-bubble .bb-title{font-size:14px;font-weight:900;line-height:1.3;color:#0f172a}.bb-body{padding:0 14px 13px;font-size:13px;line-height:1.56;white-space:pre-line;color:#334155;position:relative;z-index:2}.bb-actions{display:flex;justify-content:flex-end;gap:7px;padding:0 14px 13px;position:relative;z-index:2}.bb-actions button{border:0;border-radius:10px;padding:8px 12px;font-size:11.5px;font-weight:850;cursor:pointer;font-family:inherit}.bb-secondary{background:#e2e8f0;color:#334155}.bb-primary{background:linear-gradient(135deg,#0891b2,#2563eb);color:white}.bb-danger{background:#dc2626;color:white}
            #m3cls-fab{position:fixed;right:14px;bottom:12px;z-index:10000001;width:72px;height:72px;border-radius:50%;display:none;place-items:center;cursor:pointer;background:radial-gradient(circle at 35% 30%,rgba(8,47,73,.98),rgba(2,6,23,.98) 68%);border:1px solid rgba(71,226,255,.32);box-shadow:0 18px 42px rgba(2,6,23,.42),0 0 0 1px rgba(255,255,255,.03) inset,0 0 24px rgba(34,211,238,.10);backdrop-filter:blur(14px)}
            #m3cls-fab.show{display:grid}
            #m3cls-fab .m3cls-reactor{width:56px;height:56px}
            #m3cls-fab .m3cls-reactor::before{animation-duration:4.8s}
            #m3cls-fab.m3cls-running .m3cls-reactor::before{animation-duration:.9s;box-shadow:0 0 0 3px #020617 inset,0 0 18px rgba(34,211,238,.85)}
            #m3cls-fab .m3cls-reactor::after{inset:12px}
            #m3cls-fab .m3cls-reactor b{font-size:14px}
            #m3cls-fab .m3cls-fab-label{position:absolute;bottom:-16px;left:50%;transform:translateX(-50%);font-size:10px;font-weight:800;color:#c9f7ff;white-space:nowrap;text-shadow:0 2px 6px rgba(2,6,23,.55)}
            @media(max-width:640px){#m3-cls-batch-panel{right:8px;bottom:8px;width:286px}.m3cls-title-main{font-size:13px}#m3cls-bubble{right:10px;width:min(310px,calc(100vw - 20px))}#m3cls-fab{right:8px;bottom:8px;width:68px;height:68px}}
        `;
        document.head.appendChild(style);

        // v2.0.5: FAB thu nhỏ có reactor độc lập, không phụ thuộc CSS của panel lớn.
        if (!document.getElementById('m3cls-fab-v205-style')) {
            const fabStyle = document.createElement('style');
            fabStyle.id = 'm3cls-fab-v205-style';
            fabStyle.textContent = `
                #m3cls-fab{
                    width:72px!important;height:72px!important;border-radius:50%!important;
                    background:radial-gradient(circle at 40% 30%,#123b52 0,#071827 48%,#020617 78%)!important;
                    border:2px solid rgba(103,232,249,.62)!important;
                    box-shadow:0 12px 30px rgba(2,6,23,.42),0 0 22px rgba(34,211,238,.30)!important;
                    overflow:visible!important;padding:0!important;color:#ecfeff!important;
                }
                #m3cls-fab .m3cls-reactor{
                    position:relative!important;width:58px!important;height:58px!important;border-radius:50%!important;
                    display:grid!important;place-items:center!important;isolation:isolate!important;
                }
                #m3cls-fab .m3cls-reactor::before{
                    content:''!important;position:absolute!important;inset:0!important;border-radius:50%!important;
                    background:repeating-conic-gradient(from 0deg,#9bf6ff 0 8deg,#22d3ee 8deg 13deg,#155e75 13deg 23deg,#082f49 23deg 31deg)!important;
                    box-shadow:0 0 0 4px #020617 inset,0 0 16px rgba(34,211,238,.60)!important;
                    animation:m3cls-fab-spin 4.4s linear infinite!important;
                }
                #m3cls-fab.m3cls-running .m3cls-reactor::before{
                    animation-duration:.72s!important;
                    box-shadow:0 0 0 4px #020617 inset,0 0 24px rgba(34,211,238,.95)!important;
                }
                #m3cls-fab .m3cls-reactor::after{
                    content:''!important;position:absolute!important;inset:13px!important;border-radius:50%!important;
                    background:radial-gradient(circle at 35% 30%,#1d6078,#06111f 66%)!important;
                    border:1px solid rgba(207,250,254,.58)!important;z-index:2!important;
                }
                #m3cls-fab .m3cls-reactor b{
                    position:relative!important;z-index:5!important;color:#f8fdff!important;font-size:15px!important;
                    font-weight:950!important;text-shadow:0 0 9px rgba(103,232,249,.95)!important;
                }
                #m3cls-fab .m3cls-fab-label{
                    bottom:-18px!important;color:#d8faff!important;background:rgba(2,6,23,.88)!important;
                    border:1px solid rgba(103,232,249,.22)!important;border-radius:999px!important;
                    padding:2px 7px!important;font-size:9px!important;letter-spacing:.35px!important;
                }
                @keyframes m3cls-fab-spin{to{rotate:360deg}}
            `;
            document.head.appendChild(fabStyle);
        }
    }

    function ensurePanel() {
        ensureStyles();
        if (document.getElementById('m3-cls-batch-panel')) {
            updatePanel();
            return;
        }
        const p = document.createElement('div');
        p.id = 'm3-cls-batch-panel';
        p.innerHTML = `
            <div class="h">
                <div class="m3cls-reactor"><b id="m3cls-model">M?</b></div>
                <div class="m3cls-title"><div class="m3cls-title-main">AUTO CLS SMART</div><div class="m3cls-title-sub">MEDINET · M3 / M4</div></div>
                <div class="m3cls-header-tools"><span id="m3cls-active-label" class="m3cls-state">SẴN SÀNG</span><button id="m3cls-toggle" class="m3cls-toggle" type="button" title="Thu nhỏ">—</button></div>
            </div>
            <div class="b">
                <div id="m3cls-status-line" class="m3cls-statusline">Đang nhận diện mẫu...</div>
                <div class="m3cls-grid">
                    <div class="m3cls-card"><span>Đã xử lý</span><b id="m3cls-processed">0</b></div>
                    <div class="m3cls-card"><span>Hoàn tất</span><b id="m3cls-done" class="m3cls-ok">0</b></div>
                    <div class="m3cls-card"><span>Bỏ qua</span><b id="m3cls-skipped" class="m3cls-warn">0</b></div>
                    <div class="m3cls-card"><span>Lỗi</span><b id="m3cls-errors" class="m3cls-bad">0</b></div>
                </div>
                <div class="m3cls-mini"><span>Retry <strong id="m3cls-retries">0</strong></span><span>Hoàn tất <strong id="m3cls-success">—</strong></span><span id="m3cls-speed">—</span></div>
                <div class="m3cls-patient"><b id="m3cls-patient">Chưa có ca</b><div id="m3cls-detail"></div></div>
                <span id="m3cls-stage" style="display:none">-</span>
                <span id="m3cls-notfound" style="display:none">0</span><span id="m3cls-dup" style="display:none">0</span><span id="m3cls-invalid" style="display:none">0</span><span id="m3cls-elapsed" style="display:none">—</span>
            </div>
            <div class="actions"><button id="m3cls-start">▶ CHẠY</button><button id="m3cls-stop">■ DỪNG</button><button id="m3cls-report" title="Báo cáo">📋</button><button id="m3cls-reset-skip" title="Xóa SKIP để chạy lại">↻ SKIP</button></div>`;
        document.body.appendChild(p);

        const fab = document.createElement('button');
        fab.id = 'm3cls-fab';
        fab.type = 'button';
        fab.innerHTML = `<div class="m3cls-reactor"><b id="m3cls-fab-model">M?</b></div><span class="m3cls-fab-label" id="m3cls-fab-label">MỞ</span>`;
        document.body.appendChild(fab);

        document.getElementById('m3cls-start').addEventListener('click', startBatch);
        document.getElementById('m3cls-stop').addEventListener('click', stopBatch);
        document.getElementById('m3cls-report').addEventListener('click', showReport);
        document.getElementById('m3cls-reset-skip').addEventListener('click', resetSkippedList);
        document.getElementById('m3cls-toggle').addEventListener('click', () => setUiMode('collapsed'));
        fab.addEventListener('click', () => setUiMode('expanded'));
        updatePanel();
    }

    function updatePanel() {
        const p = document.getElementById('m3-cls-batch-panel');
        const fab = document.getElementById('m3cls-fab');
        if (!p) return;
        const model = getCurrentModel();
        const uiMode = getUiMode();
        const collapsed = uiMode === 'collapsed';
        // Chỉ hiện trên M3/M4 hoặc khi một batch đang chạy qua route con.
        p.classList.toggle('m3cls-hidden', !model && !isActive());
        p.classList.toggle('m3cls-running', isActive());
        p.classList.toggle('m3cls-collapsed', collapsed);
        if (fab) {
            fab.classList.toggle('show', collapsed && (!!model || isActive()));
            fab.classList.toggle('m3cls-running', isActive());
        }

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
            const sec = Math.floor(ms / 1000), h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), ss = sec % 60;
            return h ? `${h}g ${m}p` : (m ? `${m}p ${ss}s` : `${ss}s`);
        };

        const modelEl = document.getElementById('m3cls-model');
        if (modelEl) modelEl.textContent = model || 'M?';
        const fabModel = document.getElementById('m3cls-fab-model');
        if (fabModel) fabModel.textContent = model || 'M?';
        const activeLabel = document.getElementById('m3cls-active-label');
        if (activeLabel) activeLabel.textContent = isActive() ? 'ĐANG CHẠY' : (model ? 'SẴN SÀNG' : 'CHỜ MẪU');
        const toggleBtn = document.getElementById('m3cls-toggle');
        if (toggleBtn) {
            toggleBtn.textContent = collapsed ? '+' : '—';
            toggleBtn.title = collapsed ? 'Phóng to' : 'Thu nhỏ';
        }
        const fabLabel = document.getElementById('m3cls-fab-label');
        if (fabLabel) fabLabel.textContent = isActive() ? 'ĐANG CHẠY' : 'MỞ';
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
        document.getElementById('m3cls-speed').textContent = timedCases && timedMinutes > 0 ? `${(timedMinutes / timedCases).toFixed(1)}p/ca` : '—';
        document.getElementById('m3cls-elapsed').textContent = fmtElapsed(elapsedMs);
        document.getElementById('m3cls-patient').textContent = c ? `${c.hoTen || '(không tên)'} · ${c.model || model || ''}` : `Chưa có ca · ${model || 'M3/M4'}`;
        document.getElementById('m3cls-detail').textContent = c
            ? `${c.cccd || '—'} · khám ${c.ngayKham || '—'} · ${getStage()}`
            : (s.lastError ? `Lỗi gần nhất: ${s.lastError}` : `Tự nhận diện ${model || 'M3/M4'} theo URL`);

        const start = document.getElementById('m3cls-start');
        if (start) start.textContent = `▶ CHẠY ${model || ''}`.trim();

        positionBatchBubble();
    }

    function showStatus(message) {
        ensurePanel();
        const el = document.getElementById('m3cls-status-line');
        if (el) el.textContent = String(message || '');
        updatePanel();
    }

    function hideStatus() {
        const el = document.getElementById('m3cls-status-line');
        if (el) el.textContent = isActive() ? 'Đang xử lý...' : 'Đã dừng.';
    }

    let bubbleTimer = null;

    function closeBatchBubble() {
        if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = null; }
        const el = document.getElementById('m3cls-bubble');
        if (!el) return;
        el.classList.remove('show');
        setTimeout(() => el.remove(), 120);
    }


    function positionBatchBubble(el = null) {
        const bubble = el || document.getElementById('m3cls-bubble');
        if (!bubble) return;
        const collapsed = getUiMode() === 'collapsed';
        bubble.style.right = collapsed ? '14px' : '20px';
        bubble.style.bottom = collapsed ? '92px' : '352px';
        if (window.innerWidth <= 640) {
            bubble.style.right = '10px';
            bubble.style.bottom = collapsed ? '86px' : '344px';
        }
    }

    function showBatchBubble(title, message, type = 'info', duration = 4200) {
        ensurePanel();
        closeBatchBubble();
        const el = document.createElement('div');
        el.id = 'm3cls-bubble';
        el.className = type;
        el.innerHTML = `<div class="bb-head"><span class="bb-dot"></span><div class="bb-title"></div></div><div class="bb-body"></div>`;
        el.querySelector('.bb-title').textContent = String(title || 'Thông báo');
        el.querySelector('.bb-body').textContent = String(message || '');
        document.body.appendChild(el);
        positionBatchBubble(el);
        requestAnimationFrame(() => el.classList.add('show'));
        if (duration > 0) bubbleTimer = setTimeout(closeBatchBubble, duration);
        return el;
    }

    function confirmBatchBubble(title, message, options = {}) {
        ensurePanel();
        closeBatchBubble();
        return new Promise(resolve => {
            const el = document.createElement('div');
            el.id = 'm3cls-bubble';
            el.className = options.type || 'warn';
            el.innerHTML = `<div class="bb-head"><span class="bb-dot"></span><div class="bb-title"></div></div><div class="bb-body"></div><div class="bb-actions"><button type="button" class="bb-secondary">${options.cancelText || 'HỦY'}</button><button type="button" class="${options.danger ? 'bb-danger' : 'bb-primary'}">${options.okText || 'XÁC NHẬN'}</button></div>`;
            el.querySelector('.bb-title').textContent = String(title || 'Xác nhận');
            el.querySelector('.bb-body').textContent = String(message || '');
            document.body.appendChild(el);
            requestAnimationFrame(() => el.classList.add('show'));
            const buttons = el.querySelectorAll('.bb-actions button');
            const finish = value => { closeBatchBubble(); resolve(value); };
            buttons[0].onclick = () => finish(false);
            buttons[1].onclick = () => finish(true);
        });
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

        let txt = `AUTO CLS SMART ${getModelLabel()} v2.0.14 - SINGLE TAB
Bắt đầu: ${started}

=== THỐNG KÊ PHIÊN NÀY ===
Đã xử lý: ${processed}
Hoàn tất: ${done} (${success})
Bỏ qua: ${skippedCount}
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
                <div id="m3cls-report-head"><span>📋 AUTO CLS SMART ${getModelLabel()} · SKIP / ERROR</span><span>${Object.keys(getLocalJson(KEY_SKIPPED, {})).length} SKIP · ${getLocalJson(KEY_ERRORS, []).length} ERROR</span></div>
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
                showBatchBubble('Không thể tự sao chép', 'Trình duyệt không cho phép sao chép tự động. Hãy bôi đen nội dung trong cửa sổ báo cáo để copy.', 'warn', 6500);
            }
        };
    }

    async function resetErrorList(reportOverlay) {
        if (isActive()) {
            showBatchBubble('Chưa thể xóa ERROR', 'Hãy bấm DỪNG trước khi xóa danh sách ERROR.', 'warn', 5000);
            return;
        }
        const ok = await confirmBatchBubble('Xóa toàn bộ ERROR?', 'Danh sách SKIP và DONE không bị xóa.', { type: 'error', danger: true, okText: 'XÓA ERROR' });
        if (!ok) return;
        localStorage.removeItem(KEY_ERRORS);
        const s = getStats();
        s.errors = 0;
        saveStats(s);
        reportOverlay?.remove();
        showBatchBubble('Đã xóa ERROR', 'Danh sách ERROR đã được làm sạch.', 'ok', 3500);
    }

    async function resetSkippedList() {
        if (isActive()) {
            showBatchBubble('Chưa thể xóa SKIP', 'Hãy bấm DỪNG trước khi xóa danh sách SKIP.', 'warn', 5000);
            return;
        }
        const ok = await confirmBatchBubble('Xóa toàn bộ SKIP?', 'Các ca này sẽ được tìm xét nghiệm lại ở lần chạy kế tiếp. Danh sách DONE không bị xóa.', { type: 'warn', danger: true, okText: 'XÓA SKIP' });
        if (!ok) return;
        localStorage.removeItem(KEY_SKIPPED);
        const s = getStats();
        s.skippedNotFound = 0;
        s.skippedDuplicate = 0;
        s.skippedInvalid = 0;
        saveStats(s);
        showBatchBubble('Đã xóa SKIP', 'Có thể bấm CHẠY để tìm lại các ca đã bỏ qua.', 'ok', 4000);
    }

    async function startBatch() {
        const model = getCurrentModel();
        if (!model || !isListPage()) {
            showBatchBubble('Chưa đúng trang', 'Hãy mở DANH SÁCH M3 hoặc M4 và lọc “Chất lượng dữ liệu = Chưa có cận lâm sàng” trước khi bắt đầu.', 'warn', 6500);
            return;
        }
        sessionStorage.setItem(KEY_MODEL, model);

        const quality = getCurrentQualityFilterText();
        if (quality && !norm(quality).includes('chua co can lam sang')) {
            const proceed = await confirmBatchBubble(`Bộ lọc hiện là “${quality}”`, `AUTO CLS ${model} được thiết kế cho “Chưa có cận lâm sàng”. Ông vẫn muốn chạy?`, { type: 'warn', okText: 'VẪN CHẠY' });
            if (!proceed) return;
        }
        const confirmed = await confirmBatchBubble(`Bắt đầu AUTO CLS ${model}?`, `Script sẽ tự lưu trên Medinet:\n1) Có XN: điền + lưu Cận lâm sàng\n2) Không có XN: vẫn lưu Cận lâm sàng trống\n3) Mở + lưu Kết luận\n4) Quay lại danh sách và tiếp tục ca kế\n\nChỉ chừa lại ca trùng hoặc dữ liệu không chắc chắn. Nên theo dõi kỹ vài ca đầu.`, { type: 'info', okText: `CHẠY ${model}` });
        if (!confirmed) return;

        resetRunState();
        saveStats({
            processed: 0, done: 0, skipped: 0,
            skippedNotFound: 0, skippedDuplicate: 0, skippedInvalid: 0,
            errors: 0, retries: 0, startedAt: Date.now(),
            totalProcessMs: 0, timedCases: 0, lastError: '', lastErrorAt: 0
        });
        setActive(true);
        setStage(STAGE.LIST);
        showStatus(`AUTO CLS ${model} đã khởi động · đang đọc danh sách...`);
        queueRun();
    }


    async function stopBatch() {
        setActive(false);
        hideStatus();
        updatePanel();
        showBatchBubble(`Đã dừng AUTO CLS ${getModelLabel()}`, 'Trạng thái ca hiện tại vẫn được giữ để kiểm tra thủ công.', 'warn', 5500);
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
            showBatchBubble('AUTO đã dừng', `Medinet không tải xong ${context} sau 3 lần F5. Tiến trình ca hiện tại vẫn được giữ lại.`, 'error', 9000);
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
        const u = location.href || '';
        const body = norm(document.body.innerText || '');
        const isM3 = MODEL_ROUTE.M3_LIST.some(x => u.includes(x));
        const isM4 = MODEL_ROUTE.M4_LIST.some(x => u.includes(x));
        if (isM3) {
            sessionStorage.setItem(KEY_MODEL, 'M3');
            return true;
        }
        if (isM4) {
            sessionStorage.setItem(KEY_MODEL, 'M4');
            return true;
        }
        // Dự phòng nếu portal thay route nhưng vẫn là đúng trang danh sách.
        if (body.includes('chat luong du lieu') && body.includes('dinh danh ca nhan')) {
            if (body.includes('nguoi cao tuoi') && body.includes('ngay kham')) {
                sessionStorage.setItem(KEY_MODEL, 'M4');
                return true;
            }
            if ((body.includes('18 - 59') || body.includes('18-59') || body.includes('du 18')) && body.includes('ngay kham')) {
                sessionStorage.setItem(KEY_MODEL, 'M3');
                return true;
            }
        }
        return false;
    }


    function isClsPage() {
        const u = location.href;
        const body = norm(document.body.innerText);
        // Không dùng riêng chữ "Khám cận lâm sàng": chữ này luôn có trong
        // sidebar, kể cả khi đang ở Thông tin hành chính.
        return u.includes('KSKDK_Phieu_CanLamSang') ||
               u.includes('KNCT_PhieuCLS_CanLamSang') ||
               u.includes('KNCT_PhieuCLS') ||
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

    function getM4GearButtonInScope(scope) {
        if (!scope) return null;

        // Chỉ làm việc với DOM node thật. Một số nhánh M4 trước đây có thể truyền
        // proxy/action object vào đây; Cốc Cốc sẽ lỗi khi spread querySelectorAll.
        let root = scope;
        if (typeof root.querySelectorAll !== 'function') {
            root = root?.closest?.('tr,[role="row"]') || null;
        }
        if (!root || typeof root.querySelectorAll !== 'function') {
            return null;
        }

        const iconSelector = 'i.fa.fa-cog, i[class~="fa-cog"], i[class*="fa-cog"]';

        // Dùng Array.from thay cho spread NodeList để tránh lỗi iterable trên một số Chromium/Cốc Cốc.
        const icons = Array.from(root.querySelectorAll(iconSelector))
            .filter(isVisibleElement);

        for (const icon of icons) {
            const btn = icon.closest('button.dropdown-toggle, button[aria-haspopup="true"], button');
            if (btn && isVisibleElement(btn)) return btn;
        }

        const buttons = Array.from(
            root.querySelectorAll('button.dropdown-toggle, button[aria-haspopup="true"], button')
        ).filter(isVisibleElement);

        return buttons.find(btn => {
            try {
                return !!btn.querySelector(iconSelector);
            } catch (_) {
                return false;
            }
        }) || null;
    }

    function getM4ActionButtonFromCell(cell) {
        return getM4GearButtonInScope(cell);
    }

    function findPencilLinks() {
        const found = [];
        const seen = new Set();
        const add = el => {
            if (!el || seen.has(el) || !isVisibleElement(el)) return;
            seen.add(el);
            found.push(el);
        };

        const iconSelectors = [
            'i.fa-edit', 'i[class*="fa-edit"]',
            'i.fa-pen', 'i[class*="fa-pen"]',
            'i[class*="pencil"]', 'i[class*="edit"]',
            'span[class*="pencil"]', 'span[class*="edit"]',
            'svg[class*="pencil"]', 'svg[class*="edit"]'
        ].join(',');

        const currentModel = getCurrentModel();

        for (const row of getListDataRows()) {
            const cells = [...row.querySelectorAll(':scope > td, :scope > [role="gridcell"]')];

            // M4: KHÔNG tìm cây viết toàn dòng trước, vì "Chỉnh sửa" chỉ xuất hiện
            // sau khi mở dropdown. Luôn lấy đúng nút bánh răng ở cột Xử lý.
            if (currentModel === 'M4') {
                // M4 khác M3: chỉ cần dòng dữ liệu đã render là coi như có action.
                // Nếu đọc được nút bánh răng thì dùng nút; nếu chưa đọc được thì
                // dùng chính ô Xử lý làm proxy, openCaseFromListAction sẽ tìm lại.
                add(getM4ActionButtonFromCell(cells[1]) || cells[1]);
                continue;
            }

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

            if (!action && cells[1]) {
                action = cells[1].querySelector(
                    'a,button,[role="button"],.dx-button,i,svg'
                );
            }

            add(action);
        }
        return found;
    }

    function clickOnce(el) {
        if (!el) return false;
        try {
            el.focus?.({ preventScroll: true });
        } catch (_) {}
        try {
            el.click();
            return true;
        } catch (_) {
            try {
                el.dispatchEvent(new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    composed: true,
                    view: window
                }));
                return true;
            } catch (_) {
                return false;
            }
        }
    }

    function getVisibleM4EditItems() {
        // Menu ngx-bootstrap được append container="body" nên nằm ngoài <tr>.
        // Bám vào icon fa-pen + text Chỉnh sửa, không phụ thuộc href tuyệt đối.
        return [...document.querySelectorAll('a,button,[role="menuitem"]')]
            .filter(isVisibleElement)
            .filter(el => {
                const hasPen = !!el.querySelector('i.fas.fa-pen, i.fa.fa-pen, i[class~="fa-pen"], i[class*="fa-pen"]');
                const t = norm(el.textContent || '');
                return hasPen && t.includes('chinh sua');
            });
    }

    function pickNearestM4EditItem(items, action) {
        if (!items?.length) return null;
        const ar = action?.getBoundingClientRect?.();

        const normalized = items.map(el =>
            el.closest('a,button,[role="menuitem"],[role="button"],.dropdown-item,.dx-menu-item,li') || el
        );

        const unique = [...new Set(normalized)].filter(isVisibleElement);
        if (!ar || !unique.length) return unique[0] || null;

        return unique.sort((a, b) => {
            const ra = a.getBoundingClientRect();
            const rb = b.getBoundingClientRect();
            const da = Math.abs(ra.top - ar.bottom) + Math.abs(ra.left - ar.left) * 0.35;
            const db = Math.abs(rb.top - ar.bottom) + Math.abs(rb.left - ar.left) * 0.35;
            return da - db;
        })[0] || null;
    }

    async function openCaseFromListAction(action, c) {
        const model = c?.model || getCurrentModel();

        if (model !== 'M4') {
            return robustClick(action);
        }

        // Không tin vào index cột Xử lý của M4. Tìm lại đúng dòng bằng CCCD/Họ tên,
        // rồi quét toàn bộ dòng để lấy button chứa icon fa-cog thực tế.
        let row = findM4RowForCase(c) || action?.closest?.('tr,[role="row"]') || null;
        if (row && typeof row.querySelectorAll !== 'function') row = null;

        let gearButton = getM4GearButtonForCase(c, row);

        // Fallback cuối: action bản thân đã là button/ở trong button bánh răng.
        if (!gearButton && action) {
            const direct = action.matches?.('button') ? action : action.closest?.('button');
            if (direct && isVisibleElement(direct)) gearButton = direct;
        }

        if (!gearButton) {
            const rowText = norm(row?.textContent || '').slice(0, 180);
            throw new Error(
                `M4: không tìm được nút bánh răng của ${c?.hoTen || 'ca hiện tại'}. ` +
                `Row="${rowText || 'không đọc được'}" · gearVisible=${getVisibleM4GearButtons().length}`
            );
        }

        showStatus(`M4 · mở bánh răng: ${c?.hoTen || ''}`);

        // Ngx-bootstrap dropdown là toggle thật sự: chỉ gọi native click đúng 1 lần.
        try {
            gearButton.focus?.({ preventScroll: true });
        } catch (_) {}
        gearButton.click();

        // Menu được container="body" nên item có thể nằm ngoài row.
        const editItem = await waitFor(() => {
            const items = getVisibleM4EditItems();
            if (!items.length) return null;
            return pickNearestM4EditItem(items, gearButton) || items[0];
        }, 6000, 80);

        if (!editItem) {
            throw new Error(
                `M4: đã bấm đúng bánh răng nhưng không thấy mục ` +
                `a[href="javascript:;"] > i.fas.fa-pen + “Chỉnh sửa” của ${c?.hoTen || 'ca hiện tại'}.`
            );
        }

        showStatus(`M4 · chọn Chỉnh sửa: ${c?.hoTen || ''}`);

        const opened = await activateM4EditAndWait(editItem, c);
        if (!opened) {
            throw new Error(`M4: đã bấm “Chỉnh sửa” nhưng Medinet vẫn ở trang danh sách của ${c?.hoTen || 'ca hiện tại'}.`);
        }

        return true;
    }


    function isM4ListUrl() {
        const u = location.href || '';
        return MODEL_ROUTE.M4_LIST.some(x => u.includes(x));
    }

    function isM4DetailContext() {
        const u = location.href || '';
        if (MODEL_ROUTE.M4_DETAIL.some(x => u.includes(x))) return true;
        if (isM4ListUrl()) return false;
        const body = norm(document.body?.innerText || '');
        return (
            body.includes('thong tin hanh chinh') &&
            body.includes('luu thay doi') &&
            (body.includes('tien su') || body.includes('kham can lam sang'))
        );
    }

    function sameCaseIdentity(a, b) {
        if (!a || !b) return false;
        const cccdA = String(a.cccd || '').replace(/\s/g, '');
        const cccdB = String(b.cccd || '').replace(/\s/g, '');
        if (cccdA && cccdB) return cccdA === cccdB;
        return norm(a.hoTen) === norm(b.hoTen) && sameDate(a.ngayKham, b.ngayKham);
    }

    function findM4RowForCase(c) {
        const found = getM4RowCandidates().find(x => sameCaseIdentity(x.c, c));
        return found?.row || null;
    }

    function getVisibleM4GearButtons() {
        const buttons = Array.from(document.querySelectorAll(
            'button.dropdown-toggle.btn-kcl-success, ' +
            'button.dropdown-toggle[aria-haspopup="true"], ' +
            'button.dropdown-toggle'
        )).filter(isVisibleElement);

        return buttons.filter(btn => {
            try {
                return !!btn.querySelector('i.fa-cog, i[class~="fa-cog"], i[class*="fa-cog"]');
            } catch (_) {
                return false;
            }
        });
    }

    function getM4GearButtonForCase(c, preferredRow = null) {
        // 1) Ưu tiên đúng row đã match theo CCCD/Họ tên.
        const row = preferredRow || findM4RowForCase(c);
        if (row) {
            const direct = getM4GearButtonInScope(row);
            if (direct) return direct;

            // DOM inspect thực tế M4: button.dropdown-toggle.btn-kcl-success.
            const btn = row.querySelector?.('button.dropdown-toggle.btn-kcl-success, button.dropdown-toggle');
            if (btn && isVisibleElement(btn)) return btn;
        }

        // 2) Quét toàn bộ gear visible rồi match row của từng button bằng CCCD.
        const allGears = getVisibleM4GearButtons();
        for (const btn of allGears) {
            const r = btn.closest?.('tr,[role="row"]');
            const parsed = r ? parseCaseFromRow(r) : null;
            if (parsed && sameCaseIdentity(parsed, c)) return btn;
        }

        // 3) Fallback theo thứ tự row <-> gear button nếu framework tách DOM action khỏi row.
        const candidates = getM4RowCandidates();
        const idx = candidates.findIndex(x => sameCaseIdentity(x.c, c));
        if (idx >= 0 && allGears[idx]) return allGears[idx];

        return null;
    }

    async function waitUntilM4Detail(timeout = 12000) {
        return await waitFor(() => isM4DetailContext() ? true : null, timeout, 120);
    }

    async function activateM4EditAndWait(editItem, c) {
        if (!editItem) return false;

        const anchor = editItem.matches?.('a')
            ? editItem
            : (editItem.querySelector?.('a') || editItem.closest?.('a') || editItem);

        showStatus(`M4 · mở hồ sơ: ${c?.hoTen || ''}`);

        // Lần 1: native click đúng cơ chế Angular/ngx-bootstrap.
        clickOnce(anchor);
        let opened = await waitUntilM4Detail(1800);
        if (opened) return true;

        // Một số build Angular không nhận HTMLElement.click() khi dropdown vừa render.
        // Fallback: bắn chuỗi pointer/mouse đúng 1 lần rồi chờ route/detail thật sự.
        showStatus(`M4 · đang kích hoạt Chỉnh sửa lần 2: ${c?.hoTen || ''}`);
        robustClick(anchor);
        opened = await waitUntilM4Detail(6500);
        return !!opened;
    }

    function parseCaseFromRow(row) {
        if (!row) return null;
        const cells = [...row.querySelectorAll(':scope > td, :scope > [role="gridcell"]')];
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
            ngayKham: (cells[indexes.examDate]?.textContent || '').trim(),
            model: getCurrentModel()
        });

        let c = readCase(idx);
        if (!c.hoTen || !c.ngayKham || !/\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}/.test(c.ngayKham)) {
            c = readCase({ name: 3, cccd: 4, dob: 5, sex: 6, examDate: 8 });
        }
        if (!c.hoTen || !c.ngayKham) return null;
        return c;
    }

    function getM4RowCandidates() {
        return getListDataRows()
            .map(row => {
                const c = parseCaseFromRow(row);
                if (!c) return null;
                const cells = [...row.querySelectorAll(':scope > td, :scope > [role="gridcell"]')];
                const actionCell = cells[1] || null;
                return actionCell ? { row, actionCell, c } : null;
            })
            .filter(Boolean);
    }

    function parseCaseFromPencil(link) {
        const row = link?.closest?.('tr,[role="row"]');
        return parseCaseFromRow(row);
    }

    function getVisibleAvailableCase() {
        const model = getCurrentModel();

        if (model === 'M4') {
            for (const item of getM4RowCandidates()) {
                if (isDone(item.c) || isSkipped(item.c)) continue;
                return { link: item.actionCell, c: item.c, row: item.row };
            }
            return null;
        }

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
            const model = getCurrentModel();
            const pencils = findPencilLinks().length;
            const rows = getListDataRows().length;
            const valid = count === 0 || (count > 0 && (model === 'M4' ? getM4RowCandidates().length > 0 : pencils > 0));
            if (!valid) {
                signature = '';
                stableSince = 0;
                return false;
            }

            const nextSignature = `${count}|${model === 'M4' ? rows : pencils}`;
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

    // =====================================================================
    // PAGER ROBUST - v2.0.14
    // =====================================================================
    // M3/M4 đều dùng DevExtreme nhưng DOM pager có thể khác nhau theo route/theme.
    // Tuyệt đối không kết luận hết batch chỉ vì không bắt được một selector "Next".

    function getPagerContainers() {
        const selectors = [
            '.dx-datagrid-pager',
            '.dx-pager',
            '.dx-pagination',
            '.dx-pages',
            '[class*="pager"]',
            '[class*="pagination"]'
        ].join(',');

        const all = [...document.querySelectorAll(selectors)]
            .filter(el => el && el.isConnected);

        return [...new Set(all)];
    }

    function pagerNodeDisabled(el) {
        if (!el) return true;
        let p = el;
        for (let i = 0; i < 4 && p; i++, p = p.parentElement) {
            if (p.disabled === true) return true;
            if (p.getAttribute?.('aria-disabled') === 'true') return true;
            const cls = p.classList;
            if (cls?.contains('dx-state-disabled') || cls?.contains('disabled')) return true;
        }
        return false;
    }

    function pagerNodeSelected(el) {
        let p = el;
        for (let i = 0; i < 4 && p; i++, p = p.parentElement) {
            if (p.getAttribute?.('aria-current') === 'page') return true;
            if (p.getAttribute?.('aria-selected') === 'true') return true;
            const cls = p.classList;
            if (
                cls?.contains('dx-selection') ||
                cls?.contains('dx-page-selected') ||
                cls?.contains('selected') ||
                cls?.contains('active')
            ) return true;
        }
        return false;
    }

    function getPagerNumberNodes() {
        const out = [];
        const seen = new Set();

        for (const root of getPagerContainers()) {
            const nodes = [root, ...root.querySelectorAll('a,button,div,span')];
            for (const el of nodes) {
                if (!el || seen.has(el)) continue;
                const txt = (el.textContent || '').trim();
                if (!/^\d{1,4}$/.test(txt)) continue;

                const n = Number(txt);
                if (!Number.isFinite(n) || n < 1) continue;

                seen.add(el);
                out.push({ el, n, selected: pagerNodeSelected(el) });
            }
        }

        return out;
    }

    function getCurrentPageNumber() {
        // Instance của đúng grid đang hiển thị là nguồn ổn định nhất sau khi
        // bảng đã tải xong. Ưu tiên nó để tránh DOM pager còn giữ số trang cũ.
        const grid = getListGridInstance();
        try {
            const index = Number(grid?.pageIndex?.());
            if (Number.isFinite(index) && index >= 0) return index + 1;
        } catch (_) {}

        // Dự phòng khi route chưa expose được instance DevExtreme.
        const explicit = [
            ...document.querySelectorAll(
                '.dx-page.dx-selection, .dx-page[aria-current="page"], .dx-page-selected, ' +
                '.pagination .active, [class*="pager"] [aria-current="page"]'
            )
        ];

        for (const el of explicit) {
            const n = parseInt((el.textContent || '').trim(), 10);
            if (Number.isFinite(n) && n >= 1) return n;
        }

        const selected = getPagerNumberNodes().find(x => x.selected);
        if (selected?.n) return selected.n;

        return 1;
    }

    function getPageSize() {
        const grid = getListGridInstance();
        try {
            const n = Number(grid?.pageSize?.());
            if (Number.isFinite(n) && n >= 5 && n <= 1000) return n;
        } catch (_) {}

        const selectors = [
            '.dx-page-sizes .dx-page.dx-selection',
            '.dx-page-sizes .dx-selection',
            '.dx-page-size.dx-selection',
            '.dx-pager .dx-page-sizes [aria-selected="true"]'
        ];

        for (const sel of selectors) {
            for (const el of document.querySelectorAll(sel)) {
                const n = parseInt((el.textContent || '').trim(), 10);
                if (Number.isFinite(n) && n >= 5 && n <= 1000) return n;
            }
        }

        // Medinet hiện thường hiển thị 50 dòng/trang.
        // Fallback này chỉ dùng để CHẶN finish sai, không dùng để chọn dữ liệu.
        return 50;
    }

    function getRenderedPageSignature() {
        const model = getCurrentModel();
        let cases = [];

        if (model === 'M4') {
            cases = getM4RowCandidates().slice(0, 6).map(x => x.c);
        } else {
            cases = findPencilLinks()
                .slice(0, 6)
                .map(link => parseCaseFromPencil(link))
                .filter(Boolean);
        }

        const keys = cases.map(c => `${c?.cccd || ''}|${c?.hoTen || ''}|${c?.ngayKham || ''}`);
        return `${model || '?'}|${getCurrentPageNumber()}|${getResultCount() ?? '?'}|${keys.join('||')}`;
    }

    function getRenderedRowsSignature() {
        const model = getCurrentModel();
        let cases = [];

        if (model === 'M4') {
            cases = getM4RowCandidates().slice(0, 10).map(x => x.c);
        } else {
            cases = findPencilLinks()
                .slice(0, 10)
                .map(link => parseCaseFromPencil(link))
                .filter(Boolean);
        }

        return cases
            .map(c => `${c?.cccd || ''}|${norm(c?.hoTen || '')}|${c?.ngayKham || ''}`)
            .join('||');
    }

    function getGridPageNumber() {
        const grid = getListGridInstance();
        try {
            const index = Number(grid?.pageIndex?.());
            if (Number.isFinite(index) && index >= 0) return index + 1;
        } catch (_) {}
        return null;
    }

    function findNextPageButton() {
        const localSelectors = [
            '.dx-next-button',
            '.dx-navigate-button.dx-next-button',
            '[aria-label*="next" i]',
            '[title*="next" i]',
            '[aria-label*="trang sau" i]',
            '[title*="trang sau" i]',
            '[aria-label*="tiếp" i]',
            '[title*="tiếp" i]',
            '.dx-icon-chevronright',
            '.dx-icon-arrowright'
        ].join(',');

        const candidates = [];

        for (const root of getPagerContainers()) {
            candidates.push(...root.querySelectorAll(localSelectors));

            candidates.push(
                ...[...root.querySelectorAll('a,button,div,span')].filter(el => {
                    const t = (el.textContent || '').trim();
                    return t === '>' || t === '›' || t === '»';
                })
            );
        }

        // Fallback toàn trang khi pager không nằm trong wrapper chuẩn.
        candidates.push(
            ...document.querySelectorAll(
                '.dx-next-button,' +
                '[aria-label*="Next" i],[title*="Next" i],' +
                '[aria-label*="trang sau" i],[title*="trang sau" i]'
            )
        );

        const seen = new Set();
        for (let el of candidates) {
            el = el?.closest?.('button,a,[role="button"],.dx-page,.dx-navigate-button') || el;
            if (!el || seen.has(el)) continue;
            seen.add(el);
            if (!pagerNodeDisabled(el)) return el;
        }

        return null;
    }

    function findNumericPageButton(targetPage) {
        const items = getPagerNumberNodes()
            .filter(x => x.n === targetPage && !x.selected);

        for (const item of items) {
            const el =
                item.el.closest?.('button,a,[role="button"],.dx-page') ||
                item.el;

            if (!pagerNodeDisabled(el)) return el;
        }

        return null;
    }

    function pagerSaysThereMustBeAnotherPage(totalCount, currentPage) {
        const grid = getListGridInstance();

        // Nguồn mạnh nhất: pageCount thật của DevExtreme.
        try {
            const pageCount = Number(grid?.pageCount?.());
            if (Number.isFinite(pageCount) && pageCount > currentPage) return true;
        } catch (_) {}

        // Nguồn thứ hai: tổng kết quả / pageSize.
        const pageSize = getPageSize();
        if (Number.isFinite(totalCount) && totalCount > 0) {
            const estimatedPages = Math.ceil(totalCount / pageSize);
            if (estimatedPages > currentPage) return true;
        }

        // Nguồn thứ ba: pager DOM.
        const nums = getPagerNumberNodes()
            .map(x => x.n)
            .filter(Number.isFinite);

        if (nums.some(n => n > currentPage)) return true;

        const next = findNextPageButton();
        return !!(next && !pagerNodeDisabled(next));
    }

    async function confirmPageMoved(oldPage, oldSig, oldRowsSig, targetPage = null) {
        const model = getCurrentModel();

        const changed = await waitFor(() => {
            if (isListLoading()) return false;

            const pageNow = getCurrentPageNumber();
            const gridPageNow = getGridPageNumber();
            const sigNow = getRenderedPageSignature();
            const rowsSigNow = getRenderedRowsSignature();

            const pageChanged = pageNow !== oldPage;
            const gridReachedTarget = targetPage != null && gridPageNow === targetPage;
            const pagerReachedTarget = targetPage != null && pageNow === targetPage;
            const rowsChanged = !!rowsSigNow && !!oldRowsSig && rowsSigNow !== oldRowsSig;
            const sigChanged = sigNow !== oldSig;

            // Một số trang Medinet đã đổi dữ liệu nhưng DOM pager vẫn giữ số cũ
            // trong vài giây hoặc giữ hẳn instance cũ. Chỉ cần một bằng chứng
            // chắc chắn cho thấy trang/bảng đã đổi; không bắt buộc mọi nguồn
            // cùng báo đúng targetPage.
            return pageChanged || gridReachedTarget || pagerReachedTarget || rowsChanged || sigChanged;
        }, 20000, 120);

        if (!changed) return false;

        // Sau khi pager đổi, chờ bảng thật sự render xong.
        const stableReady = createStableListReadyCheck(900);
        const ready = await waitFor(() => {
            if (!stableReady()) return false;
            if (getResultCount() === 0) return true;

            return model === 'M4'
                ? getM4RowCandidates().length > 0
                : findPencilLinks().length > 0;
        }, 20000, 120);

        if (!ready) return false;

        await sleep(180);
        return true;
    }

    async function tryGridPageIndex(targetPage, oldPage, oldSig, oldRowsSig) {
        const grid = getListGridInstance();
        if (!grid?.pageIndex) return false;

        try {
            grid.pageIndex(targetPage - 1);
        } catch (_) {
            return false;
        }

        return await confirmPageMoved(oldPage, oldSig, oldRowsSig, targetPage);
    }

    // return: 'MOVED' | 'LAST' | 'BLOCKED'
    async function goNextPageIfPossible(totalCount) {
        const oldPage = getCurrentPageNumber();
        const targetPage = oldPage + 1;
        const oldSig = getRenderedPageSignature();
        const oldRowsSig = getRenderedRowsSignature();
        const mustHaveNext = pagerSaysThereMustBeAnotherPage(totalCount, oldPage);

        if (!mustHaveNext) return 'LAST';

        showStatus(`Trang ${oldPage}: đã xử lý hết ca đang thấy → sang trang ${targetPage}...`);

        // 1) DevExtreme API
        if (await tryGridPageIndex(targetPage, oldPage, oldSig, oldRowsSig)) {
            return 'MOVED';
        }

        // 2) Bấm trực tiếp số trang kế tiếp
        let b = findNumericPageButton(targetPage);
        if (b) {
            robustClick(b);
            if (await confirmPageMoved(oldPage, oldSig, oldRowsSig, targetPage)) {
                return 'MOVED';
            }
        }

        // 3) Nút Next nhiều biến thể
        b = findNextPageButton();
        if (b) {
            robustClick(b);
            if (await confirmPageMoved(oldPage, oldSig, oldRowsSig, targetPage)) {
                return 'MOVED';
            }
        }

        // Quan trọng: còn bằng chứng có trang kế thì KHÔNG ĐƯỢC báo hoàn tất.
        warn('PAGER BLOCKED: còn trang kế nhưng chưa chuyển được.', {
            model: getCurrentModel(),
            totalCount,
            oldPage,
            targetPage,
            pageSize: getPageSize(),
            pagerNumbers: getPagerNumberNodes().map(x => x.n)
        });

        return 'BLOCKED';
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
        let c = null;
        if (getCurrentModel() === 'M4') {
            c = getM4RowCandidates()[0]?.c || null;
        } else {
            const first = findPencilLinks()[0];
            c = first ? parseCaseFromPencil(first) : null;
        }
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


    // Portal mới đổi Glucose máu thành "Đường máu bất kỳ (mmol/L)" và
    // dùng hnumberbox/dx-number-box. Vẫn hỗ trợ nhãn cũ; nếu chỉ còn
    // "Glucose" thì phải tách Glucose máu khỏi Glucose niệu.
    function findBloodGlucoseLabelElements(scope) {
        for (const alias of ['Đường máu bất kỳ', 'Đường máu', 'Glucose máu', 'Glucose bất kỳ']) {
            const exact = findLabelElements(alias).filter(el => isInScope(el, scope));
            if (exact.length) return exact;
        }

        const glucoseLabels = findLabelElements('Glucose').filter(el => isInScope(el, scope));
        if (!glucoseLabels.length) return [];

        const urineBoundary = [
            ...findLabelElements('Tỉ trọng'),
            ...findLabelElements('pH')
        ].filter(el => isInScope(el, scope)).sort((a, b) =>
            a === b ? 0 : (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)
        )[0] || null;

        if (urineBoundary) {
            const beforeUrine = glucoseLabels.filter(el =>
                !!(el.compareDocumentPosition(urineBoundary) & Node.DOCUMENT_POSITION_FOLLOWING)
            );
            if (beforeUrine.length) return [beforeUrine[0]];
        }
        return [glucoseLabels[0]];
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


    // Glucose máu cần cơ chế riêng vì control mới là hnumberbox/dx-number-box.
    // Ưu tiên ghi trực tiếp vào dxNumberBox instance để Angular nhận state thật;
    // nếu portal không expose instance thì fallback sang chuỗi event như người gõ.
    async function setBloodGlucoseValue(input, rawValue) {
        if (!input) return false;
        const val = String(rawValue ?? '').trim();
        if (!val) return false;

        const numericValue = parseNumberLoose(val);
        if (!Number.isFinite(numericValue)) return false;
        const displayVal = formatNumberForMedinet(val);

        CLS_WRITES.pending++;
        try {
            const numberBoxEl = input.closest('.dx-numberbox') ||
                input.closest('dx-number-box') ||
                input.closest('hnumberbox');
            let instance = null;

            if (numberBoxEl) {
                try {
                    instance = window.DevExpress?.ui?.dxNumberBox?.getInstance?.(numberBoxEl) || null;
                } catch (_) {}
                if (!instance) {
                    try {
                        const jq = window.jQuery || window.$;
                        if (jq?.fn?.dxNumberBox) instance = jq(numberBoxEl).dxNumberBox('instance');
                    } catch (_) {}
                }
            }

            if (instance?.option) {
                try {
                    instance.option('value', numericValue);
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
                    await sleep(60);
                    const committed = Number(instance.option('value'));
                    if (Number.isFinite(committed) && Math.abs(committed - numericValue) < 0.000001) {
                        return true;
                    }
                } catch (e) {
                    warn('Glucose máu: set dxNumberBox instance thất bại:', e);
                }
            }

            input.focus();
            try { input.select(); } catch (_) {}
            nativeInputSetter.call(input, '');
            input.dispatchEvent(new InputEvent('input', {
                bubbles: true, inputType: 'deleteContentBackward', data: null
            }));
            nativeInputSetter.call(input, displayVal);
            input.dispatchEvent(new InputEvent('input', {
                bubbles: true, inputType: 'insertText', data: displayVal
            }));
            input.dispatchEvent(new KeyboardEvent('keyup', {
                bubbles: true, key: 'Enter', code: 'Enter'
            }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.blur();
            input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
            await sleep(80);

            // Hidden input chỉ đồng bộ phụ sau khi control hiển thị đã nhận giá trị.
            if (numberBoxEl) {
                const hidden = numberBoxEl.querySelector('input[type="hidden"]');
                if (hidden) {
                    hidden.value = String(numericValue);
                    hidden.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
            return String(input.value || '').trim() !== '';
        } finally {
            CLS_WRITES.pending = Math.max(0, CLS_WRITES.pending - 1);
            CLS_WRITES.completed++;
            CLS_WRITES.lastCompletedAt = Date.now();
        }
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
                const labels = f.column === 'Glucose'
                    ? findBloodGlucoseLabelElements(scope)
                    : findLabelElements(f.label).filter(el => isInScope(el, scope));
                const label = labels[0] || null;
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
                const labels = f.column === 'Glucose'
                    ? findBloodGlucoseLabelElements(scope)
                    : findLabelElements(f.label).filter(el => isInScope(el, scope));
                const label = labels[0] || null;
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
            const labels = f.column === 'Glucose'
                ? findBloodGlucoseLabelElements(scope)
                : findLabelElements(f.label).filter(el => isInScope(el, scope));
            if (!labels.length) { notFound.push(f.label); continue; }
            const info = findNumberInputForLabel(labels[0]);
            if (!info) { notFound.push(f.label); continue; }
            const raw = getData(data, f.column);
            if (raw === undefined || raw === '') { if (!MISSING_WARNING_EXCLUDE.includes(f.label)) missing.push(f.label); continue; }
            const value = raw;
            const setter = async () => {
                if (QUALITATIVE_URINE_COLUMNS.includes(f.column)) return await setQualitative(info, value);
                if (f.column === 'Glucose') return await setBloodGlucoseValue(info.element, value);
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
        // SPA Medinet có thể giữ DOM trang CLS cũ khi đang chuyển sang Kết luận.
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
        const modelNow = getCurrentModel();
        showStatus(`Đang chờ Medinet tải xong danh sách ${modelNow || ''}...`);

        const pageReady = await waitForPageReadyOrReload(
            30000,
            'trang danh sách',
            createStableListReadyCheck()
        );
        if (!pageReady) return;

        let resultCount = getResultCount();
        showStatus(`Danh sách thiếu CLS${resultCount !== null ? `: ${resultCount} kết quả` : ''} · Trang ${getCurrentPageNumber()}`);

        if (resultCount === 0) {
            if (isListLoading()) {
                queueRun(500);
                return;
            }
            finishBatch('Filter đã còn 0 kết quả.');
            return;
        }

        // M4 dùng trực tiếp dòng dữ liệu, tuyệt đối không phụ thuộc selector cây viết/bánh răng của M3.
        if (modelNow === 'M4') {
            let rows = getM4RowCandidates();
            if (resultCount > 0 && rows.length === 0) {
                showStatus(`M4 · Có ${resultCount} kết quả · đang chờ các dòng bệnh nhân render...`);
                await waitFor(() => getM4RowCandidates().length > 0 || getResultCount() === 0, 12000, 180);
                resultCount = getResultCount();
                rows = getM4RowCandidates();
            }

            if (resultCount === 0) {
                finishBatch('Filter đã còn 0 kết quả.');
                return;
            }

            if (resultCount > 0 && rows.length === 0) {
                throw new Error(`M4: bảng báo ${resultCount} kết quả nhưng chưa đọc được dòng bệnh nhân.`);
            }

            const found = rows.find(x => !isDone(x.c) && !isSkipped(x.c)) || null;
            if (found) {
                found.c.startedAt = Date.now();
                setCase(found.c);
                setStage(STAGE.OPENING_CASE);
                showStatus(`M4 · mở ca: ${found.c.hoTen} · ${found.c.cccd}`);

                if (!await openCaseFromListAction(found.actionCell, found.c)) {
                    throw new Error(`M4: không mở được hồ sơ của ${found.c.hoTen}.`);
                }

                setStage(STAGE.OPEN_CLS);
                queueRun();
                return;
            }

            const pageMoveM4 = await goNextPageIfPossible(resultCount);
            if (pageMoveM4 === 'MOVED') {
                queueRun(120);
                return;
            }
            if (pageMoveM4 === 'BLOCKED') {
                showStatus(`M4 · còn trang kế nhưng Medinet chưa chuyển trang được · đang thử lại...`);
                queueRun(1200);
                return;
            }

            finishBatch('Đã quét hết trang cuối M4; chỉ còn ca đã SKIP/DONE hoặc không còn ca thiếu CLS.');
            return;
        }

        // M3 giữ nguyên logic nút cây viết.
        if (resultCount > 0 && findPencilLinks().length === 0) {
            showStatus(`Có ${resultCount} kết quả · đang chờ bảng và nút Xử lý hiển thị...`);
            await waitFor(
                () => findPencilLinks().length > 0 || getResultCount() === 0,
                12000,
                180
            );
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
            showStatus(`Mở ca M3: ${found.c.hoTen} · ${found.c.cccd}`);
            if (!await openCaseFromListAction(found.link, found.c)) {
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

        if (resultCount > 0 && pencilLinks.length === 0) {
            throw new Error(`M3: bảng báo ${resultCount} kết quả nhưng không đọc được nút cây viết ở cột Xử lý.`);
        }
        if (resultCount > 0 && pencilLinks.length > 0 && parsedCases.length === 0) {
            throw new Error(`M3: đã thấy ${pencilLinks.length} nút Xử lý nhưng không đọc được Họ tên/Ngày khám của dòng.`);
        }

        const pageMoveM3 = await goNextPageIfPossible(resultCount);
        if (pageMoveM3 === 'MOVED') {
            queueRun(120);
            return;
        }
        if (pageMoveM3 === 'BLOCKED') {
            showStatus(`M3 · còn trang kế nhưng Medinet chưa chuyển trang được · đang thử lại...`);
            queueRun(1200);
            return;
        }

        finishBatch('Đã quét hết trang cuối M3; chỉ còn ca đã SKIP/DONE hoặc không còn ca thiếu CLS.');
    }


    async function handleOpeningCase() {
        const c = getCase();
        if (!c) {
            setStage(STAGE.LIST);
            queueRun();
            return;
        }

        // Nếu hồ sơ đã mở thật sự thì mới được chuyển sang bước mở CLS.
        if (!isListPage() || (c.model === 'M4' && isM4DetailContext())) {
            setStage(STAGE.OPEN_CLS);
            queueRun();
            return;
        }

        if (c.model === 'M4') {
            showStatus(`M4 · mở lại hồ sơ: ${c.hoTen} · ${c.cccd || ''}`);
            const found = findM4RowForCase(c);
            if (!found) {
                throw new Error(`M4: không tìm lại được dòng của ${c.hoTen} trên danh sách.`);
            }

            await openCaseFromListAction(found.actionCell, c);
            if (!isM4DetailContext()) {
                throw new Error(`M4: thao tác Chỉnh sửa xong nhưng chưa vào được hồ sơ ${c.hoTen}.`);
            }

            setStage(STAGE.OPEN_CLS);
            queueRun();
            return;
        }

        // M3: nếu vẫn còn ở danh sách thì tìm lại đúng ca và bấm cây viết.
        const match = findPencilLinks()
            .map(link => ({ link, c: parseCaseFromPencil(link) }))
            .find(x => x.c && sameCaseIdentity(x.c, c));
        if (!match) throw new Error(`M3: không tìm lại được nút Xử lý của ${c.hoTen}.`);
        robustClick(match.link);
        const leftList = await waitFor(() => !isListPage(), 12000, 180);
        if (!leftList) throw new Error(`M3: bấm Xử lý nhưng chưa mở hồ sơ ${c.hoTen}.`);
        setStage(STAGE.OPEN_CLS);
        queueRun();
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
            // Theo quy trình: ca không có kết quả xét nghiệm vẫn phải bấm Lưu
            // Cận lâm sàng và tiếp tục Lưu Kết luận. Chỉ SKIP khi có nhiều
            // kết quả hoặc dữ liệu không đủ chắc chắn để tự chọn.
            c.noLab = true;
            c.sid = '';
            // Cờ này chỉ tồn tại trong ca đang chạy để bỏ qua bước chờ lệnh
            // điền. Không đưa ca không có XN vào SKIP/ERROR/báo cáo.
            setCase(c);
            setStage(STAGE.SAVE_CLS);
            showStatus('Không có XN · vẫn chuẩn bị lưu Cận lâm sàng trống...');
            queueRun();
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

        if (c.noLab) {
            showStatus('Không có XN · chuẩn bị lưu Cận lâm sàng trống...');
        } else {
            showStatus('CLS đã đầy đủ và đứng yên · chuẩn bị lưu Cận lâm sàng...');
            const writesFinished = await waitForClsWritesFinished();
            if (!writesFinished) {
                showStatus('Tab đang ẩn hoặc lệnh điền chưa hoàn tất · chưa bấm Lưu...');
                queueRun(1000);
                return;
            }
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

        // ID Kết luận thay đổi giữa các mẫu; dò theo text để dùng chung M3/M4.
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

        // Ca không có XN được xem như ca hoàn tất bình thường. Xóa cờ nội bộ
        // trước khi lưu DONE để không tạo log riêng cho nhóm này.
        if (c.noLab) delete c.noLab;
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
        showBatchBubble(
            `AUTO CLS ${getModelLabel()} kết thúc`,
            `${message}\n\nĐã xử lý: ${processed}\nHoàn tất: ${s.done || 0} (${success}%)\nBỏ qua: ${s.skipped || 0}\n• Trùng kết quả: ${s.skippedDuplicate || 0}\n• Không hợp lệ/lỗi: ${s.skippedInvalid || 0}\nRetry: ${s.retries || 0}\nLỗi ghi nhận: ${s.errors || 0}\n\nBấm 📋 để xem chi tiết.`,
            (s.errors || s.skipped) ? 'warn' : 'ok',
            10000
        );
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
            else if (stage === STAGE.OPENING_CASE) await handleOpeningCase();
            else if (stage === STAGE.OPEN_CLS) await handleOpenCls();
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
        if (window.__m34ClsBatchNavInstalled) return;
        window.__m34ClsBatchNavInstalled = true;

        const fire = () => setTimeout(() => runSafely(), 500);
        const p = history.pushState, r = history.replaceState;
        history.pushState = function (...args) { const out = p.apply(this, args); window.dispatchEvent(new Event('m34cls-locationchange')); return out; };
        history.replaceState = function (...args) { const out = r.apply(this, args); window.dispatchEvent(new Event('m34cls-locationchange')); return out; };
        window.addEventListener('popstate', () => window.dispatchEvent(new Event('m34cls-locationchange')));
        window.addEventListener('m34cls-locationchange', fire);

        let last = location.href;
        setInterval(() => {
            if (location.href !== last) {
                last = location.href;
                sessionStorage.setItem(KEY_LAST_URL, last);
                rememberDetectedModel();
                updatePanel();
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
        rememberDetectedModel();
        releaseLegacyNotFoundSkips();
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
        log('READY v2.0.14 SMART M3/M4 · ROBUST PAGER · SINGLE TAB');
    }

    init();
})();
