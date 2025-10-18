// รอให้หน้าเว็บโหลดเสร็จก่อนเริ่มทำงาน
document.addEventListener('DOMContentLoaded', () => {

    /**
     * ===================================================================
     * CONFIG: ส่วนตั้งค่าหลักของแอปพลิเคชัน
     * ===================================================================
     */
    const CONFIG = {
        WEBHOOK_URL: "https://script.google.com/macros/s/AKfycbxIPNhZzcPduLQONpuaiMNYP028ZvIZld6_s_mg5x1QFCOEKPF76jDs9RTyq01jbcglTg/exec",
        PROXY_URL: "https://corsproxy.io/?",
        SHEET_ID: "1KTFaGCzmtjJtezumsWDXFdsWlpZtSriq2mEHe-ujGNc",
        UPDATE_INTERVAL: 300000, 
        ALERT_DISTANCE: 10,
        RESET_DISTANCE: 20,
        CHECK_NEARBY_THROTTLE: 2000,
        DEFAULT_ZOOM: 13,
        TRACKING_ZOOM: 17,
        NEARBY_ZOOM: 19,
        INITIAL_LAT_LNG: [13.736717, 100.523186],
    };

    /**
     * ===================================================================
     * STATE: ตัวแปรเก็บสถานะต่างๆ ของแอปพลิเคชัน
     * ===================================================================
     */
    const state = {
        map: null,
        sheetMarkers: new Map(),
        userMarker: null,
        userCircle: null,
        userPath: [],
        userPolyline: null,
        watchID: null,
        isZoomedToMarker: false,
        isCheckingNearby: false,
    };

    /**
     * ===================================================================
     * ELEMENTS: เก็บ Element ต่างๆ ที่ใช้บ่อย
     * ===================================================================
     */
    const elements = {
        mapContainer: document.getElementById("map"),
        trackBtn: document.getElementById("trackBtn"),
        refreshBtn: document.getElementById("refreshBtn"),
        status: document.getElementById("status").querySelector("span:first-child"),
        distanceInfo: document.getElementById("distance-info"),
        toast: document.getElementById("toast"),
        ding: document.getElementById("ding"),
        usernameInput: document.getElementById("username"),
    };

    /**
     * ===================================================================
     * CORE FUNCTIONS: ฟังก์ชันหลักในการทำงาน
     * ===================================================================
     */

    function initialize() {
        initMap();
        bindEvents();
        loadSheetData();
        setInterval(loadSheetData, CONFIG.UPDATE_INTERVAL);
    }

    function initMap() {
        state.map = L.map(elements.mapContainer).setView(CONFIG.INITIAL_LAT_LNG, CONFIG.DEFAULT_ZOOM);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(state.map);
        elements.status.textContent = "✅ โหลดแผนที่สำเร็จ";
    }

    function bindEvents() {
        elements.trackBtn.addEventListener('click', toggleTracking);
        elements.refreshBtn.addEventListener('click', loadSheetData);
    }

    async function loadSheetData() {
        elements.status.textContent = "🔄 กำลังโหลดข้อมูลเสาไฟ...";
        const sheetURL = `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/gviz/tq?tqx=out:json`;
        try {
            const response = await fetch(sheetURL);
            const text = await response.text();
            const json = JSON.parse(text.substring(47).slice(0, -2));
            
            // --- DEBUGGING POINT ---
            console.log("--- เริ่มการดีบักข้อมูลจาก Google Sheet ---");
            console.log("ข้อมูลดิบที่ได้รับ (JSON):", json);
            // --- END DEBUGGING POINT ---

            const newMarkerNames = new Set(json.table.rows.map(r => r.c[0]?.v));
            for (const [name, marker] of state.sheetMarkers.entries()) {
                if (!newMarkerNames.has(name)) {
                    state.map.removeLayer(marker);
                    state.sheetMarkers.delete(name);
                }
            }

            json.table.rows.forEach((r, index) => {
                // ดึงข้อมูลสถานะจากคอลัมน์ที่ 9 (index 8)
                const name = r.c[0]?.v;
                const lat = r.c[1]?.v;
                const lng = r.c[2]?.v;
                const statusCell = r.c[8]; // ดึงข้อมูลทั้ง cell ออกมาดูก่อน
                const status = statusCell?.v || "";

                // --- DEBUGGING POINT ---
                if(index < 10) { // แสดงข้อมูลแค่ 10 แถวแรกพอ
                    console.log(`[แถวที่ ${index + 1}] ชื่อ: ${name}, สถานะ: '${status}'`);
                    console.log("-> ข้อมูลดิบของทั้งแถว:", r.c);
                }
                // --- END DEBUGGING POINT ---

                if (name && lat && lng) {
                    updateMarker(name, lat, lng, status);
                }
            });

            if (state.sheetMarkers.size > 0 && !state.watchID) {
                const allMarkers = Array.from(state.sheetMarkers.values());
                state.map.fitBounds(L.featureGroup(allMarkers).getBounds(), { padding: [50, 50] });
            }
            elements.status.textContent = "✅ อัปเดตข้อมูลล่าสุด: " + new Date().toLocaleTimeString();
        } catch (error) {
            console.error("เกิดข้อผิดพลาดในการโหลดข้อมูล:", error);
            elements.status.textContent = "❌ โหลดข้อมูลไม่สำเร็จ";
            showToast("โหลดข้อมูลจาก Sheet ไม่สำเร็จ", "error");
        }
    }

    function updateMarker(name, lat, lng, status) {
        const color = getColorForStatus(status);
        const icon = L.divIcon({ html: `<div style='background:${color};width:18px;height:18px;border-radius:50%;border:2px solid white; box-shadow: 0 0 5px rgba(0,0,0,0.5);'></div>` });
        
        let marker = state.sheetMarkers.get(name);

        if (marker) {
            marker.setLatLng([lat, lng]);
            marker.setIcon(icon);
            marker.options.status = status;
        } else {
            marker = L.marker([lat, lng], { icon, name, status }).addTo(state.map);
            state.sheetMarkers.set(name, marker);
            bindPopupToMarker(marker);
        }
    }

    function bindPopupToMarker(marker) {
        const popupContent = `
            <b>${marker.options.name}</b><br>
            🔰 <b id="statusText" style="color:${getColorForStatus(marker.options.status)}">${marker.options.status || "-"}</b><br><br>
            <div class="btn-row">
                <button class="btn btn-green" data-status="ไฟติดA">ติด A</button>
                <button class="btn btn-green" data-status="ไฟติดB">ติด B</button>
                <button class="btn btn-green" data-status="ไฟติดAB">ติด AB</button>
                <button class="btn btn-red" data-status="ไฟดับA">ดับ A</button>
                <button class="btn btn-red" data-status="ไฟดับB">ดับ B</button>
                <button class="btn btn-red" data-status="ไฟดับAB">ดับ AB</button>
            </div>
        `;
        
        marker.bindPopup(popupContent);

        marker.on("popupopen", (e) => {
            const popupNode = e.popup.getElement();
            popupNode.querySelectorAll(".btn").forEach(btn => {
                btn.addEventListener('click', () => {
                    const newStatus = btn.dataset.status;
                    marker.options.status = newStatus;
                    const newColor = getColorForStatus(newStatus);
                    marker.setIcon(L.divIcon({ html: `<div style='background:${newColor};width:18px;height:18px;border-radius:50%;border:2px solid white; box-shadow: 0 0 5px rgba(0,0,0,0.5);'></div>` }));
                    elements.ding.currentTime = 0;
                    elements.ding.play();
                    marker.closePopup();
                    sendStatusToSheet(marker.options.name, newStatus);
                });
            });
        });
    }
    
    async function sendStatusToSheet(name, newStatus) {
        const fullURL = CONFIG.PROXY_URL + encodeURIComponent(CONFIG.WEBHOOK_URL);
        const user = elements.usernameInput.value.trim() || "ไม่ระบุผู้ตรวจ";
        try {
            await fetch(fullURL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, status: newStatus, user })
            });
            showToast(`✅ บันทึก "${newStatus}" แล้ว (${name})`, "success");
        } catch (error) {
            console.error("เกิดข้อผิดพลาดในการบันทึก:", error);
            showToast("❌ บันทึกล้มเหลว!", "error");
        }
    }

    function toggleTracking() {
        state.watchID ? stopTracking() : startTracking();
    }

    function startTracking() {
        if (!navigator.geolocation) {
            showToast("เบราว์เซอร์ของคุณไม่รองรับ Geolocation", "error");
            return;
        }

        showToast("🚀 เริ่มติดตามตำแหน่ง...", "success");
        elements.trackBtn.textContent = "⏸️ หยุดติดตาม";
        elements.trackBtn.classList.add("stop");
        if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
        
        const options = { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 };
        state.watchID = navigator.geolocation.watchPosition(updatePosition, handleLocationError, options);
    }
    
    function stopTracking() {
        if (!state.watchID) return;
        navigator.geolocation.clearWatch(state.watchID);
        state.watchID = null;
        elements.trackBtn.textContent = "▶️ เริ่มติดตาม";
        elements.trackBtn.classList.remove("stop");
        showToast("🛑 หยุดติดตามแล้ว", "info");
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }

    function updatePosition(pos) {
        const { latitude, longitude, accuracy } = pos.coords;
        const latLng = [latitude, longitude];

        if (!state.userMarker) {
            state.userMarker = L.marker(latLng, { icon: L.divIcon({ html: "📍", iconSize: [24, 24] }) }).addTo(state.map);
            state.userCircle = L.circle(latLng, { radius: accuracy }).addTo(state.map);
        } else {
            state.userMarker.setLatLng(latLng);
            state.userCircle.setLatLng(latLng);
            state.userCircle.setRadius(accuracy);
        }

        state.userPath.push(latLng);
        if (!state.userPolyline) {
            state.userPolyline = L.polyline(state.userPath, { color: "#007bff", weight: 4 }).addTo(state.map);
        } else {
            state.userPolyline.addLatLng(latLng);
        }

        state.map.setView(latLng, Math.max(state.map.getZoom(), CONFIG.TRACKING_ZOOM));
        throttledCheckNearby(latLng);
    }
    
    function handleLocationError(error) {
        stopTracking();
        elements.trackBtn.disabled = true;
        let message = "⚠️ ไม่สามารถระบุตำแหน่งได้!";
        if (error.code === error.PERMISSION_DENIED) {
            message = "❌ คุณปฏิเสธการเข้าถึงตำแหน่ง";
        }
        elements.status.textContent = message;
        showToast(message, "error");
    }

    function throttledCheckNearby(userLatLng) {
        if (state.isCheckingNearby) return;
        state.isCheckingNearby = true;
        
        let closestMarker = null;
        let minDistance = Infinity;

        for (const marker of state.sheetMarkers.values()) {
            const dist = state.map.distance(userLatLng, marker.getLatLng());
            if (dist < minDistance) {
                minDistance = dist;
                closestMarker = marker;
            }
        }

        if (closestMarker) {
            elements.distanceInfo.textContent = `ห่างจาก ${closestMarker.options.name}: ${minDistance.toFixed(0)} ม.`;
        }
        
        if (minDistance < CONFIG.ALERT_DISTANCE && !state.isZoomedToMarker) {
            state.isZoomedToMarker = true;
            state.map.setView(closestMarker.getLatLng(), CONFIG.NEARBY_ZOOM, { animate: true });
            closestMarker.openPopup();
            elements.ding.currentTime = 0;
            elements.ding.play();
            showToast(`📡 ใกล้จุด ${closestMarker.options.name} ระยะ ${minDistance.toFixed(1)} ม.`, "info");
        } else if (minDistance >= CONFIG.RESET_DISTANCE && state.isZoomedToMarker) {
            state.isZoomedToMarker = false;
        }

        setTimeout(() => { state.isCheckingNearby = false; }, CONFIG.CHECK_NEARBY_THROTTLE);
    }
    

    /**
     * ===================================================================
     * UTILITY FUNCTIONS: ฟังก์ชันเสริมช่วยการทำงาน
     * ===================================================================
     */

    function getColorForStatus(status) {
        if (!status) return "#8e44ad"; 
        
        const s = String(status).trim().toLowerCase(); // เพิ่ม String() เพื่อความปลอดภัย
        
        // 1. ตรวจสอบคำเฉพาะก่อน (SP, HM)
        if (s.startsWith("sp")) return "#ff66b2";
        if (s.startsWith("hm")) return "#ffd54f";
        
        // 2. ตรวจสอบคำทั่วไปทีหลัง (ไฟติด, ไฟดับ)
        if (s.includes("ดับ")) return "#dc3545";
        if (s.includes("ติด")) return "#28a745";
        
        // 3. ถ้าไม่เข้าเงื่อนไขไหนเลย ให้เป็นสี default
        return "#3498db";
    }
    
    function showToast(msg, type = "info") {
        elements.toast.textContent = msg;
        elements.toast.className = "toast show";
        switch (type) {
            case "success": elements.toast.style.background = "#28a745"; break;
            case "error": elements.toast.style.background = "#dc3545"; break;
            default: elements.toast.style.background = "#333";
        }
        setTimeout(() => elements.toast.classList.remove("show"), 3000);
    }

    // เริ่มต้นการทำงานของแอปพลิเคชัน
    initialize();
});
