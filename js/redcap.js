self.REDCap = (() => {
  async function getPID(sample_ids) {
    let data = {
      content: "record",
      format: "json",
      type: "flat",
      fields: "sample_id,pid",
      filterLogic:  `[sample_id]='${ sample_ids.join("' OR [sample_id]='") }'`,
      returnFormat: "json"
    };
    sn = [];
    results = await post(data)
    .catch(e => 
      showErr("Unable to get PID(s)", "REDCap Error: " + e.message)
    );
    return Promise.all(results.filter(e => e.pid ? true : false).map(e =>  {
        $("#sid" + e.sample_id).text(e.pid);
        return updatePID(e.sample_id, e.pid);
    }));
  }
  async function clearCRF(sn) {
    let xpert = await dbGetAll([sn]);
    xpert = xpert.filter(e => { return e.pid !== undefined });
    if (xpert.length === 0) return;
    let recid = xpert[0].crf_id;
    xpert = null;
    const key = await Encryption.getSecret(config.RC.apikey);
    let data = {
      content: "file",
      action: "delete",
      record: recid,
      field: "xpert_data",
      event: "",
      returnFormat: "json"
    };
    let result = await post(data, key, { dataType: "text"})
      .catch(e => console.warn("REDCap unable to delete file: " + JSON.parse(e.responseText).error));
    data = {
      content: "record",
      format: "json",
      type: "flat",
      overwriteBehavior: "overwrite",
      forceAutoNumber: "false",
      returnContent: "count",
      returnFormat: "json",
      data: JSON.stringify ([{
        record_id: crf_id,
        xpert_result_complete: "",
        xpert_result: "",
        xpert_timestamp: "",
        cartridge_sn: "",
        xpert_processed_by: ""
      }])
    };
    result = await post(data, key).catch(e => {throw "REDCap unable to clear record: " + e.responseJSON.error});
  }
  async function getRecordIDs(xpert, key) {
    let data = {
      content: "record",
      format: "json",
      type: "flat",
      fields: "record_id,pid",
      filterLogic:  "[pid]='" + xpert.map(e => e.pid).join("' OR [pid]='") + "'",
      returnFormat: "json"
    };
    return await post(data, key)
      .catch(e => 
        showErr("Unable to map pids to record_ids", "REDCap Error: " + e.message));
  } 
  async function updateCRF(sn) {
    xpert = await dbGetAll(sn);
    xpert = xpert.filter(e => { return e.pid !== undefined });
    const key = await Encryption.getSecret(config.RC.apikey);
    let recids = await getRecordIDs(xpert, key);
    xpert = xpert.map(e => { 
      e.record_id =  recids.find(({pid}) => pid === e.pid).record_id;
      return e;
    });
    xp = xpert.map(e => {
      return {
        xpert_result: e.test_result,
        xpert_timestamp: e.end_time,
        record_id: e.record_id,
        cartridge_sn: e.cartridge_sn,
        xpert_processed_by: "ScrapertJS",
        xpert_result_complete: 2,
      };
    });
    let data = {
      content: "record",
      format: "json",
      type: "flat",
      overWriteBehavior: "normal",
      forceAutoNumber: "false",
      returnContent: "count",
      returnFormat: "json",
      data: JSON.stringify(xp)
    };
    const count = await post(data, key)
      .catch(e => 
        showErr("Error updating CRF", "REDCap Error: " + e.message));
    xp = undefined;
    data = new FormData();
    data.set("content", "file");
    data.set("action", "import");
    data.set("field", "xpert_data");
    data.set("event", "");
    data.set("returnFormat", "json");
    data.set("token", key);
    xpert.forEach(async function (e, i) {
      data.set("record", e.record_id);
      data.set("file", new Blob([e.pdf], {type: "application/pdf"}), e.sample_id + ".pdf");
      const result = await post(data, key)
      .catch(e => {
        showErr("Unable to upload file", "REDCap Error: " + e.message);
      });
      // delete the file from the database if we uploaded and release from memory
      delete xpert[i].pdf;
      let res = await crfDB(e.cartridge_sn, e.record_id);
      $("#ul" + res.sn).text(dateFormat.format(res.uploaded));
    }); 
  }
  async function getPDF(record_id) {
    let data = {
      content: "file",
      action: "export",
      record: record_id,
      field: "xpert_data",
      event: "",
      returnFormat: "json"
    };
    const file = await post(data, undefined, {xhrFields: { responseType: "blob" }})
      .catch(e => {
        throw new Error("REDCap unable to download PDF file: " + e.message);
      });
    return file;
  }
  async function post(data, key, options) {
    if(!hasConf()){
        new bootstrap.Tab("#pills-setting-tab").show();
        showModal("REDCap API Not Configured", 'Please enter the REDCap API URL and/or API Token on the "Settings" tab');
        throw new Error("REDCap configuration missing");
    }
    if (key === undefined) key = await Encryption.getSecret(config.RC.apikey).catch(e => {
      throw new Error(e);
    });
    let x  = { url: config.RC.api};
    if (options !== undefined) x = {...x, ...options };
    if (data instanceof FormData) {
      x.contentType =  false;
      x.processData = false;
      x.dataType = "text";
      data.set("token", key);
    } else data = { ...data, token: key};
    x.data = data;
    return new Promise((resolve, reject) => {
      $.post(x)
        .done(result => resolve(result))
        .fail(e => reject("REDCap Error: " + e.message));
    });
  }
  function backup() {
    let backup = {};
    backup.config = config;
    backup.db = [];
    initDB().then (db => {
      const obs = db.transaction("xpert_results").objectStore("xpert_results");
      let result = obs.openCursor();
      result.onsuccess = async (e) => {
        const cursor = e.target.result;
        if(cursor) {
          backup.db.push(cursor.value);
          cursor.continue();
        } else {
          // Convert pdfs to base64
          backup.db = await Promise.all(backup.db.map(async xpert => {
            return new Promise((resolve) => {
              if (xpert.pdf) {
                const blob = new Blob([xpert.pdf]);
                const reader = new FileReader();
                reader.onload = (event) => {
                  const dataUrl = event.target.result;
                  xpert.pdf = dataUrl.split(',')[1];
                  resolve(xpert);
                };
                reader.readAsDataURL(blob);
              } else {
                resolve(xpert);
              }
            });
          }));
          let data = {
            content : "fileRepository",
            action : "list",
            format : "json",
            returnFormat : "json"
          };
          const key = await Encryption.getSecret(config.RC.apikey);
          result = await post(data, key)
          .catch(e => {

            showErr("Unable to get file repository", "REDCap Error: " + e.message);
          });
          let file = result.find(e => e.name === "Scrapert_Backup.json");
          if (file) {
            data.action = "delete";
            data.doc_id = file.doc_id;
            result = await post(data, key, { dataType: "text"})
            .catch(e => {
              showErr("Unable to delete prior backup", "REDCap Error: " + e.message);
            });
          }
          data = new FormData();
          data.set("content", "fileRepository");
          data.set("action", "import");
          data.set("returnFormat", "json");
          data.set("file", new Blob([JSON.stringify(backup)], {type: "application/json"}), "Scrapert_Backup.json");
          result = await post(data, key);
          showToast("Backup Complete (Backed up to REDCap as Scrapert_Backup.json)");
        }
      };
    });
  }
  async function restoreBackup() {
    let data = {
      content : "fileRepository",
      action : "list",
      format : "json",
      returnFormat : "json"
    };
    const key = await Encryption.getSecret(config.RC.apikey);
    result = await post(data, key)
    .catch(e => {
      showModal("Unable to get file repository", "REDCap Error: " + e.message);
    });
    let file = result.find(e => e.name === "Scrapert_Backup.json");
    data = {
      content: "fileRepository",
      action: "export",
      doc_id: file.doc_id,
      returnFormat: "json"
    };
    file = await post(data, key, {dataType: "json"})
      .catch(e => {
        showModal("Unable to download file", "REDCap Error: " + e.message);
      });
    // Convert pdfs from Base64
    file.db = await Promise.all(file.db.map(db => {
      return new Promise((resolve) => {
        if (db.pdf) {
          const dURL = "data:application/pdf;base64," + db.pdf;
          fetch(dURL).then(res => res.arrayBuffer())
            .then(buffer => {
              db.pdf = buffer;
              resolve(db);
            });
        } else resolve(db);
      });
    }));
    // Save the data
    config = file.config;
    localStorage.setItem("config", JSON.stringify(config));
    writeTabToDB(file.db, true);
    showToast("Backup Restored");
  }
  function hasConf () {
    if (config) {
      if (config.RC) {
        if (config.RC.api && config.RC.apikey) return true;
      }
    }
    return false;
  } 
  return {
    getPID: getPID,
    updateCRF: updateCRF,
    hasConf: hasConf,
    getPDF: getPDF,
    backup: backup,
    restoreBackup: restoreBackup,
    clearCRF: clearCRF
  };
})();