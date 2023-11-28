const version = 1;

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
function upload() {
  clearErr();
  let xpertPromises = [];
  for(const file of $("#xpertfiles").get(0).files) {
    if(file.type !== "application/pdf") throw "Must be pdf";
    xpertPromises.push(fileReaderP(file));
  }
  Promise.all(Array.from($("#xpertfiles").get(0).files).map((file, fileindex) => {
    if(file.type !== "application/pdf") throw "Must be pdf";
    return fileReaderP(file, fileindex);
  })).then((result) => { // Files are loaded as array of arrayBuffers
    return Promise.all(
      result.map(res => {
        return pdfExtractTxt(res.ab).then(pages => {
          isXpert = pages.map(e => e.includes("Xpert HPV HR_16_18-45"));
          if (!isXpert.some(e => e)) throw "Not a valid xpert result pdf";
          return { 
            fileindex: res.fileindex,
            pages: pages.map((e,i) => {
              return {
                xpertPage: isXpert[i],
                xpert: e,
              };
            }) // end pages.map
          }; // End return
        }); // end pdfExtractTxt then
      }) // end result.map
    ); // 2nd promise all
  }).then(async (result) => {
    // parse
    result = result.map(o => {
      return {
        fileindex: o.fileindex,
        xpert: o.pages.map(e => {
          return e.xpertPage ? parseXpert(e.xpert) : null })
      }; });
    // Now try and load the pdfs
    result = Promise.all(
      await result.map(async (res) => {
        const file = await fileReaderP($("#xpertfiles").get(0).files[res.fileindex]);
        const pdf = await PDFLib.PDFDocument.load(file.ab);
        return Promise.all(
          res.xpert.map(async (xpertresult, i) => {
            if (xpertresult) {
              const xpertpdf = await PDFLib.PDFDocument.create();
              const page = await xpertpdf.copyPages(pdf, [i]);
              xpertpdf.addPage(page[0]);
              xpertresult.pdf = await xpertpdf.save();
              return xpertresult;
            } else return null;
          })
        ).then(xpert => {return xpert});
      })
    ).then(async (xpert) => {
      xpert =  xpert.flat().filter(x => x !== null);
      writeTabToDB(xpert).then((ids) => {
        updateTable(xpert);
        // update the pids
        REDCap.getPID(xpert.map(e => {return e.sample_id})).then(sn => {
          // upload the crfs
          REDCap.updateCRF(sn).then(() => {
            $(".file-message").text("or drag and drop files here");
            $("#processbtn").prop("disabled", true);
            $("#fileform").trigger("reset");
          });
        });
      }).catch((e) => {
        if (e.name === "ConstraintError") showErr("Unable to import. Duplicate results.", e.name + ": " + e.message);
        else showErr(e.message, e.name);
      });
    });
  });
}
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
    searchDB(val, result => { updateTable(result); });
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
  REDCap.clearCRF(sn).then((rc) => {
    return new Promise(async (resolve) => {
      const db = await initDB();
      let result =  db.transaction("xpert_results", "readwrite").objectStore("xpert_results").delete(sn);
      result.onsuccess = e => resolve();
    }).then(e => {
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
          ${data[d].pid === undefined ? "<a onclick=\"lookupPID(['" + data[d].sample_id + "']);\">" +  
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
        <td><a onclick="getPDF('${data[d].cartridge_sn}')"><img src="images/file-earmark-pdf.svg" alt="View PDF"></a>
            <a onclick="dlPDF('${data[d].cartridge_sn}')"><img src="images/download.svg" alt="Download PDF"></a></td>
        <td id="ul${data[d].cartridge_sn}">${data[d].uploaded === undefined ? 
          "<a onclick=\"REDCap.updateCRF(['" + data[d].cartridge_sn + "']);\">" +  
          "<img src=\"images/cloud-upload.svg\" alt=\"Import\"/></a>" : dateFormat.format(new Date(data[d].uploaded))}</td></tr>`);
    }
  } else tbody.append("<tr><td colspan='13' class='text-middle'>No results found</td></tr>");
  $("#resTbl").removeClass("d-none");
}
const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "short", timeStyle: "short" });
function processErr(jqXHR, modal) {
  // did we get an ajax HTTP 401 response?
  if(jqXHR.status == 401) {
    showModal("Not Authenticated", "You must log in again to access this resource");
    $("#myModal").on('hidden.bs.modal', e => { window.location = jqXHR.responseJSON.url });
  }  else {
    if (modal === undefined) showErr(jqXHR.responseJSON[0].msg, jqXHR.responseJSON[0].err);
    else showModal(modal.title, modal.msg);
  }
}
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
  REDCap.getPID(sampleId);
}
function uploadCRF(id, stackErr) {
  if (!stackErr) clearErr();
  $.post({
    url: "crf", 
    data: JSON.stringify({ "id" : id }),
    contentType: "application/json"
  })
  .done(data => {
    for(let x in data) {
      $(`#ul${data[x].id}`).text(dateFormat.format(new Date(data[x].uploaded + " UTC")));
    }
  }).fail((jqXHR) => processErr(jqXHR));
}
function checkbox(label, name, checked) {
  return `<div class="md-3 row">
          <label for="${ name }" class="col-md-3 col-form-label text-end fw-bold">${ label }</label>
          <div class="col-md-9"><input type="checkbox" class="form-check-input" name="${ name }" value="true" 
              ${ checked ? "checked" : ""}></div></div>`;
}
function passcode(label, name, required) {
  return `<div class="md-3 row">
          <label for="${ name }" class="col-md-3 col-form-label text-end fw-bold">${ label }</label>
          <div class="col-md-9"><input type="password" class="form-control" name="${ name }" value="" 
              ${ required ? "required" : ""} placeholder="Leave blank to keep current value"></div></div>`;
}
function getSettings() {
  sTab = $("#settingsDiv");
  sTab.empty();
  sTab.append(`<div class="mb-3 row">
    <label for="xpertTZ" class="col-md-3 col-form-label text-end fw-bold">Time Zone of Xpert Machine</label>
    <div class="col-md-9"><select class="form-select" name="xpertTZ">
      ${ Intl.supportedValuesOf("timeZone").map((o) => "<option " + (o === config.xpertTZ ? "selected" : "") + ">" + o + "</option>").join("") }
    </select></div></div>`);
  sTab.append(checkbox("Debug Mode?", "debug", config.debug));
  sTab.append('<div class="md-3 row"><div class="col-md fw-bold text-center">REDCap Settings</div></div>');
  sTab.append(`<div class="md-3 row">
          <label for="api" class="col-md-3 col-form-label text-end fw-bold">REDCap API URL</label>
          <div class="col-md-9"><input type="text" class="form-control" name="api" value="${ config.RC && config.RC.api ? config.RC.api : ""}" 
             required placeholder="https://..."></div></div>` + 
             passcode("REDCap API Token", "apikey", !REDCap.hasConf()));
  
  sTab.append('<div class="md-3 row"><div class="col-md fw-bold text-center">Modified Xpert Settings</div></div>');
  for (let x in config.xpert) {
    sTab.append(checkbox(`Use ${x}?`, `use${x}`, config.xpert[x].use)); 
    sTab.append(`<div class="mb-3 row">
          <label for="ct${ x }" class="col-md-3 col-form-label text-end fw-bold">Xpert ${ x } Ct</label>
          <div class="col-md-9"><input type="number" class="form-control" name="ct${ x }" 
            value="${ config.xpert[x].ct !== null ? config.xpert[x].ct : "" }" placeholder="Leave blank to ignore channel" min="0" max="40"></div></div>`);
  } 
}
function saveSettings() { 
  $("#settingsForm input:not(.btn),select").each((i, el) => {
    if(el.name.startsWith("api")) {
      if (!config.RC) config.RC = {};
      if (el.name.startsWith("apikey")) {
          if (el.value !== "") {
            Encryption.encrypt(el.value, s => { config.RC.apikey = s; });
          }
      } else {
        config.RC.api = el.value;
      }
    } else if(!el.name.match(/^(ct|use).*/)) {
      config[el.name] = el.type === "checkbox" ? el.checked :
        (el.value === "" ? null : el.value);
    } else {
      name = el.name.replace(/^(ct|use)/, "");
      if(el.name.startsWith("ct")) config.xpert[name].ct = el.value === "" ? null : el.value
      else config.xpert[name].use = el.checked
    }
  });
  config.version = version;
  localStorage.setItem("config", JSON.stringify(config));
  showToast("Settings Saved");
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