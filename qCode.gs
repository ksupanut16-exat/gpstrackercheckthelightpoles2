function doGet(e) {
  // ✅ ถ้าถูกเรียกด้วย ?sw=1 ให้ส่ง service-worker.js (สcope = /exec)
  if (e && e.parameter && e.parameter.sw === '1') {
    return ContentService
      .createTextOutput(getServiceWorker_())
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  // ✅ หน้าเว็บหลัก (Index) ตามเดิม
  const t = HtmlService.createTemplateFromFile('Index'); // ชื่อไฟล์ HTML ของคุณ
  t.BASE_URL = ScriptApp.getService().getUrl();
  return t.evaluate()
    .setTitle('Expressway Electricity Command')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// 👉 คืนเนื้อหาไฟล์ SW จากข้อ B) ข้างบน (คัดลอกวางมาเป็นสตริง)
function getServiceWorker_() {
  return `
/* ==== BEGIN SW ==== */
${swSource_()}
/* ==== END SW ==== */
  `.trim();
}

// แยกเนื้อหา SW ไว้ในฟังก์ชันนี้ จะอ่านง่ายและแก้ภายหลังสะดวก
function swSource_() {
  return String.raw`/* วางโค้ด Service Worker จากข้อ B) ทั้งบล็อก ตรงนี้เลย */`;
}
