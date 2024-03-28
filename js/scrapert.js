const version = 1;

var usePID = false;
$( document ).ready(async () => {
  var { pdfjsLib } = globalThis;
  // The workerSrc property shall be specified.
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://mozilla.github.io/pdf.js/build/pdf.worker.mjs";
  $("#fileform").submit(function(event) {
    event.preventDefault();
    event.stopPropagation();
    PDFTools.upload();
  });
  $("#settingsForm").submit(e => {
    e.preventDefault();
    e.stopPropagation();
    saveSettings();
  });
  // Capture refreshing the settings screen
  $("#pills-setting-tab").on("show.bs.tab", e => {
    getSettings();
  });
  const ser = await setupEnviroment();
  //use pids
  usePID = config.usePID;
  if (!config.usePID) {
    $("#pidcolumn").addClass("d-none");
  } else {
    $("#search").attr("placeholder", `Search by Sample ID or ${config.pidName}`)
    $("#pidcolumn").text(config.pidName);
  }
  // do we need config?
  REDCapS.checkConf();
});
async function setupEnviroment() {
  const local = window.location.protocol === "file:";
  config = await Config.getConfig();
  self.Encryption = new Encrypt();
  self.REDCapS = new RCS();
  self.REDCapDB = new RCDB();
  self.REDCapD = new RCD();
  if (local) {
    if (REDCapDB.hasConf()) self.Data = RCData;
    else self.Data = LocalData;
    self.PDFTools = LocalPDFTools;
  }
  if(config.debug && local) $("#utilbtns").append(`<button id="deletedbbtn" type="button" class="btn btn-warning" 
                                                   onclick="deleteDB()">Delete DB</button>`);
}
$(document).on('change', '.file-input', function() {
  let filesCount = $(this)[0].files.length;
  let textbox = $(this).prev();
  // Clear errs, table, and search box
  clearErr();
  $("#resTbl").addClass("d-none");
  $("#search").val("");
  for(let i=0; i < filesCount; i++) {
    let f = $(this)[0].files[i];
    if (f.type !== "application/pdf") {
      showErr(`Selected files must be all pdfs. The file "${f.name}" is not a pdf.`);
      $("#fileform").trigger("reset");
      return;
    }
  }
  if (filesCount > 0 ) {
    $("#processbtn").prop("disabled", false);
    if (filesCount === 1) {
      var fileName = $(this).val().split('\\').pop();
      textbox.text(fileName);
    } else {
      textbox.text(filesCount + ' files selected');
    }
  } else {
    $("#processbtn").prop("disabled", true);
    textbox = $(this);
  }
});
function calcXpert(xpert) {
  let ct = {}, use = {};
  let keys = ["HPV_16", "HPV_18_45", "P3", "P4", "P5"];
  keys.forEach(e => {
    channel = config.xpert[e.replaceAll("HPV_", "")];
    // Assign max cutoffs for the channel.
    ct[e] = channel.ct !== null ? Number.parseInt(channel.ct) : (e.startsWith("HPV") ? 40 : 38);
    use[e] = channel.use;
  });
  // Modify every row
  return xpert.map(e => {
    e.restrict_result = keys.some(k => { return e[`${ k }_result`] === "POS" && use[k] }) ? "POS" : "NEG";
    e.mod_ct_result = keys.some(k => { return e[`${ k }_Ct`] != 0 && e[`${ k }_Ct`] < ct[k] }) ? "POS" : "NEG";
    return e;
  });
}
function search(e){
  let val = e.value;
  if (val.length > 1) {
    Data.search(val, result => { updateTable(result); });
  } else {
    $("#resTbl").addClass("d-none");
  }
}
function del(sn, sampleId) {
  $(".modal-footer").prepend(`<button id="confirmDel" class="btn btn-danger"  disabled>Confirm Delete</button>`);
  showModal("Confirm Delete?", `<p>Delete sample <span id="sampleId">${sampleId}</span>?</p><p>Type the sample id below to confirm</p>
      <input type="text" class="form-control" id="sampleidconf" maxlength="${sampleId.length}">`);
  $("#confirmDel").click((e) => confDel(sn));
  $("#myModal").on('hidden.bs.modal', e => { $("#confirmDel").remove(); });
  $("#sampleidconf").keyup(e => {
    $("#confirmDel").attr("disabled", e.target.value.toLowerCase() != $("#sampleId").text().toLowerCase()); 
    }).trigger("focus");
}
function confDel(sn) {
  REDCapD.clearCRF(sn).then((rc) => {
    Data.deleteRec(sn).then(e => {
      showToast("Sample Successfully Deleted");
      $("#resTbl").addClass("d-none");
      $("#search").val("");
    }).catch(e => console.log(e));
  });
  $("#myModal").modal("hide"); 
}
function updateTable(data) {
  data = calcXpert(data);
  tbody = $("tbody");
  tbody.empty();
  if (data.length > 0) {
    for (let d in data) {
      tbody.append(`<tr><td><a href="#" class="link-underline-danger"
          onClick="del('${data[d].cartridge_sn }', '${data[d].sample_id}');">${data[d].sample_id}</a></td>
        <td ${ usePID ? "" : "class='d-none'"} id="sid${data[d].sample_id}">
          ${data[d].pid === undefined ? "<a onclick=\"lookupPID('" + data[d].sample_id + "')\">" +  
            "<img src=\"images/search.svg\" alt=\"Lookup PID\"/></a>" : data[d].pid }</td>
        <td>${data[d].cartridge_sn}</td>
        <td>${data[d].error}</td>
        <td>${data[d].test_result}</td>
        <td>${data[d].restrict_result}</td>
        <td>${data[d].mod_ct_result}</td>
        <td>${data[d].SAC_result === undefined ? "-": data[d].SAC_result}</td>
        <td>${data[d].HPV_16_result}</td>
        <td>${data[d].HPV_18_45_result}</td>
        <td>${data[d].P3_result}</td><td>${data[d].P4_result}</td><td>${data[d].P5_result}</td>
        <td><a onclick="PDFTools.getPDF('${data[d].cartridge_sn}')"><img src="images/file-earmark-pdf.svg" alt="View PDF"></a>
            <a onclick="PDFTools.dlPDF('${data[d].cartridge_sn}')"><img src="images/download.svg" alt="Download PDF"></a></td>
        <td id="ul${data[d].cartridge_sn}">${data[d].uploaded === undefined ? 
          "<a onclick=\"REDCapD.updateCRF(['" + data[d].cartridge_sn + "']);\">" +  
          "<img src=\"images/cloud-upload.svg\" alt=\"Import\"/></a>" : dateFormat.format(new Date(data[d].uploaded))}</td></tr>`);
    }
  } else tbody.append("<tr><td colspan='13' class='text-middle'>No results found</td></tr>");
  $("#resTbl").removeClass("d-none");
}
const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "short", timeStyle: "short" });
function showErr(msg, err) {
  let msgBox = $("#msgBox");
  msgBox.append(`<div class="alert alert-danger" id="msg" style="cursor: pointer"
                    onclick='showModal("Error", "${err.replaceAll("\"","\\\"").replaceAll("'","&apos;")}");'>${msg}</div>`);
  $("#msgRow").removeClass("d-none");
}
function clearErr() {
  $("#msgRow").addClass("d-none");
  $("#msgBox").empty();
}
function lookupPID(sampleId, stackErr) {
  if (!stackErr) clearErr();
  Data.getPID(sampleId);
}
function checkbox(label, name, checked) {
  return `<div class="md-3 row">
          <label for="${ name }" class="col-md-3 col-form-label text-end fw-bold">${ label }</label>
          <div class="col-md-9"><input type="checkbox" class="form-check-input" name="${ name }" id="${name}" value="true" 
              ${ checked ? "checked" : ""}></div></div>`;
}
function passcode(label, name, required) {
  return `<div class="md-3 row">
          <label for="${ name }" class="col-md-3 col-form-label text-end fw-bold">${ label }</label>
          <div class="col-md-9"><input type="password" class="form-control" name="${ name }" id="${ name }" value="" 
              ${ required ? "required" : ""} placeholder="Leave blank to keep current value"></div></div>`;
}
function getSettings() {
  sTab = $("#settingsDiv");
  sTab.empty();
  sTab.append(`<div class="mb-3 row">
    <label for="xpertTZ" class="col-md-3 col-form-label text-end fw-bold">Time Zone of Xpert Machine</label>
    <div class="col-md-9"><select class="form-select" name="xpertTZ" id="xpertTZ">
      ${ Intl.supportedValuesOf("timeZone").map((o) => "<option " + (o === config.xpertTZ ? "selected" : "") + ">" + o + "</option>").join("") }
    </select></div></div>`);
  sTab.append(checkbox("Debug Mode?", "debug", config.debug));
  sTab.append('<div class="md-3 mt-3 row"><div class="col-md fw-bold text-center">REDCap Specimens Settings</div></div>');
  sTab.append(`<div class="md-3 row">
          <label for="RCSapi" class="col-md-3 col-form-label text-end fw-bold">Specimen API URL</label>
          <div class="col-md-9"><input type="text" class="form-control" name="RCSapi" id="RCSapi" value="${ config.RCS && config.RCS.api ? config.RCS.api : ""}" 
             required placeholder="https://..."></div></div>` + 
             passcode("Specimen API Token", "RCSapikey", !REDCapS.hasConf()));
  sTab.append('<div class="md-3 mt-3 row"><div class="col-md fw-bold text-center">REDCap Database Store</div></div>');
  sTab.append(`<div class="md-3 row">
          <label for="RCDBapi" class="col-md-3 col-form-label text-end fw-bold">Database API URL</label>
          <div class="col-md-9"><input type="text" class="form-control" name="RCDBapi" id="RCDBapi" value="${ config.RCDB && config.RCDB.api ? config.RCDB.api : ""}" 
            placeholder="https://...  (leave blank to use browser database)"></div></div>` + 
            passcode("Database API Token", "RCDBapikey", REDCapDB.hasConf()));
  sTab.append('<div class="md-3 mt-3 row"><div class="col-md fw-bold text-center">REDCap Data System Settings</div></div>');
  sTab.append(`<div class="md-3 row">
          <label for="RCDapi" class="col-md-3 col-form-label text-end fw-bold">Data API URL</label>
          <div class="col-md-9"><input type="text" class="form-control" name="RCDapi" id="RCDapi" value="${ config.RCD && config.RCD.api ? config.RCD.api : ""}" 
             required placeholder="https://..."></div></div>` + 
             passcode("Data API Token", "RCDapikey", !REDCapD.hasConf()));
  
  sTab.append('<div class="md-3 row mt-3"><div class="col-md fw-bold text-center">Modified Xpert Settings</div></div>');
  for (let x in config.xpert) {
    sTab.append(checkbox(`Use ${x}?`, `use${x}`, config.xpert[x].use)); 
    sTab.append(`<div class="mb-3 row">
          <label for="ct${ x }" class="col-md-3 col-form-label text-end fw-bold">Xpert ${ x } Ct</label>
          <div class="col-md-9"><input type="number" class="form-control" id="ct${ x }" name="ct${ x }" 
            value="${ config.xpert[x].ct !== null ? config.xpert[x].ct : "" }" placeholder="Leave blank to ignore channel" min="0" max="40"></div></div>`);
  } 
}
function saveSettings() { 
  Promise.all($("#settingsForm input:not(.btn),select").map(async (i, el) => {
    if(el.name.endsWith("api")) {
      const keyname = el.name.replace("api", "");
      if (!config[keyname]) config[keyname] = {};
      config[keyname].api = el.value;
    } else if (el.name.endsWith("apikey")) {
      const keyname = el.name.replace("apikey", "");
      if (!config[keyname]) config[keyname] = {};
      if (el.value !== "") config[keyname].apikey = await Encryption.encrypt(el.value);
    } else if(!el.name.match(/^(ct|use).*/)) {
      config[el.name] = el.type === "checkbox" ? el.checked :
        (el.value === "" ? null : el.value);
    } else {
      name = el.name.replace(/^(ct|use)/, "");
      if(el.name.startsWith("ct")) config.xpert[name].ct = el.value === "" ? null : el.value
      else config.xpert[name].use = el.checked
    }
  })).then(() => { 
    config.version = version;
    Config.save(config).then(() => {
      if (REDCapDB.hasConf()) self.Data = RCData;
      else self.Data = LocalData;
      showToast("Settings Saved");
    }).catch(err => showModal("Unable to Save Settings", err));
  });
}
function showModal(title, body) {
  $("#myModalLabel").text(title);
  $(".modal-body").html(body);
  const myModal = new bootstrap.Modal("#myModal");
  myModal.show();
}
function showToast(msg) {
  $(".toast-body").text(msg);
  const myToast = new bootstrap.Toast(".toast");
  myToast.show();
}
function deleteDB () {
  $(".modal-footer").prepend(`<button id="confirmDel" class="btn btn-danger">Confirm Delete</button>`);
  $("#myModal").on('hidden.bs.modal', e => { $("#confirmDel").remove(); });
  $("#confirmDel").click(() => {
    Data.deleteDB().then(() => {
      $("#resTbl").addClass("d-none");
      $("#search").val("");
      $("#myModal").modal("hide");
    }).catch((e) => console.error(e));
  });
  showModal("Confirm Delete DB?", "This cannot be undone. Consider backup!");
}