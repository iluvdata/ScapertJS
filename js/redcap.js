/* 
 * REDCapS is for specimens and REDCapD is for data (CRFs) and REDCapDB is for storing data (vs indexedDB)
*/
self.REDCapS = (() => {
  async function getPID(xpert) {
    // To save round trips to the database, maybe the data is already loaded!
    if (!(xpert instanceof Array)) xpert = await Data.getSamples([xpert]);
    let sample_ids = xpert.map(e => e.sample_id);
    let data = {
      content: "record",
      format: "json",
      type: "flat",
      fields: "sample_id,pid",
      filterLogic:  `[sample_id]='${ sample_ids.join("' OR [sample_id]='") }'`,
      returnFormat: "json"
    };
    results = await post(data)
    .catch(e => 
      showErr("Unable to get PID(s)", "REDCap Error: " + e.message)
    );
    let haspid = false;
    results.filter(e => e.pid ? true : false).forEach(x => {
      xpert.find(e => e.sample_id === x.sample_id).pid = x.pid;
      $("#sid" + x.sample_id).text(x.pid);
      haspid = true;
    });
    if (haspid) haspid = await Data.write(xpert, true);
    return xpert;
  }
  async function post(data, key, options) {
    checkConf();
    if (key === undefined) key = await Encryption.getSecret(config.RCS.apikey).catch(e => {
      throw new Error(e);
    });
    let x  = { url: config.RCS.api};
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
        .fail((jqXHR) => {
          reject("REDCap Error: " + (jqXHR.responseJSON ? jqXHR.responseJSON.error : JSON.parse(jqXHR.responseText).error)); 
        });
    });
  }
  function checkConf() {
    if(!hasConf()) {
      new bootstrap.Tab("#pills-setting-tab").show();
      showModal("REDCap Specimen API Not Configured", 'Please enter the REDCap Specimen API URL and/or API Token on the "Settings" tab');
      throw new Error("REDCap specimen configuration missing");
    }
  }
  function hasConf () {
    if (config) {
      if (config.RCS) {
        if (config.RCS.api && config.RCS.apikey) return true;
      }
    }
    return false;
  } 
  return {
    getPID: getPID,
    hasConf: hasConf,
    checkConf: checkConf,
    post: post
  };
})();
self.REDCapDB = (() => {
  async function get(filter) {
    let data = {
      content: "record",
      action: "export",
      format: "json",
      type: "flat",
      fields:  "csn, sid, pid, data",
      returnFormat: "json",
      filterLogic: filter
    };
    return (new Promise((resolve) => {
      post(data).then((data) => {
        data = data.map((e) => {
          e.data = JSON.parse(e.data);
          return(e);
        });
        resolve(data);
      });
    }));
  }
  async function getSample(sid) {
    return get("[sid] = '" + sid + "'");
  }
  async function put(data) {
    data.data = JSON.stringify(data.data);
    xp = {
      content: "record",
      format: "json",
      type: "flat",
      overWriteBehavior: "normal",
      forceAutoNumber: "false",
      returnContent: "count",
      returnFormat: "json",
      data: JSON.stringify([data])
    }
    const count = await post(xp);
    return(count);
  }
  async function write(xpert, update) {
    key = await Encryption.getSecret(config.RCDB.apikey).catch(e => {
      throw new Error(e);
    });
    xp = xpert.map((e, idx) => {
      // everything except the pdf
      let {pdf : _ , ...d} = e;
      return {
        csn : e.cartridge_sn,
        sid : e.sample_id,
        pid : e.pid,
        data : JSON.stringify(d)
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
    let count = await post(data, key)
      .catch(e => 
        showError("Unable to upload to database", "REDCap Error: " + e.message));
    xp = xpert.map((e, idx) => {
      return {
        pdf: e.pdf,
        csn: e.cartridge_sn
      };
    });
    if(!update) {
      // Now the pdfs
      data = new FormData();
      data.set("content", "file");
      data.set("action", "import");
      data.set("field", "pdf");
      data.set("event", "");
      data.set("returnFormat", "json");
      data.set("token", key);
      xp.forEach(async function (e) {
        data.set("record", e.csn);
        data.set("file", new Blob([e.pdf], {type: "application/pdf"}), e.csn + ".pdf");
        const result = await post(data, key)
        .catch(e => {
          showErr("Unable to upload file", "REDCap Error: " + e.message);
        });
      }); 
      xp = undefined;
    }
  }
  async function getPDF(csn) {
    let data = {
      content: "file",
      action: "export",
      record: csn,
      field: "pdf",
      event: "",
      returnFormat: "json"
    };
    const file = await post(data, undefined, {xhr: () => {
      const xhr = new XMLHttpRequest();
      xhr.onreadystatechange = () => {
        if (xhr.readyState == 2 && xhr.status == 200) xhr.responseType = "blob";
      };
      return xhr;
    }}).catch(e => {
        throw new Error("Unable to download PDF file: " + e);
      });
    return file;
  }
  async function post(data, key, options) {
    if (key === undefined) key = await Encryption.getSecret(config.RCDB.apikey).catch(e => {
      throw new Error(e);
    });
    let x  = { url: config.RCDB.api};
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
        .fail((jqXHR) => {
          reject("REDCap Error: " + (jqXHR.responseJSON ? jqXHR.responseJSON.error : JSON.parse(jqXHR.responseText).error)); 
        });
    });
  }
  function hasConf () {
    if (config) {
      if (config.RCDB) {
        if (config.RCDB.api && config.RCDB.apikey) return true;
      }
    }
    return false;
  } 
  return {
    hasConf: hasConf,
    write: write,
    post: post,
    put: put,
    get: get,
    getPDF : getPDF,
    getSample: getSample
  };
})();
self.REDCapD = (() => {
  async function clearCRF(sn) {
    let xpert = await Data.getAll([sn]);
    xpert = xpert.filter(e => { return e.pid !== undefined });
    if (xpert.length === 0) return;
    let recid = xpert[0].crf_id;
    xpert = null;
    const key = await Encryption.getSecret(config.RCD.apikey);
    let data = {
      content: "file",
      action: "delete",
      record: recid,
      field: "xpert_data",
      event: "",
      returnFormat: "json"
    };
    let result = await post(data, key, {dataType: "text"})
      .catch(e => console.warn("Unable to delete file: " + e));
    data = {
      content: "record",
      format: "json",
      type: "flat",
      overwriteBehavior: "overwrite",
      forceAutoNumber: "false",
      returnContent: "count",
      returnFormat: "json",
      data: JSON.stringify ([{
        record_id: recid,
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
  async function updateCRF(xpert) {
    if(!(xpert instanceof Array)) xpert = await Data.getAll(xpert);
    xpert = xpert.filter(e => e.pid !== undefined );
    const key = await Encryption.getSecret(config.RCD.apikey);
    let recids = await getRecordIDs(xpert, key);
    // This is the crf record id, not the record id in the redcap data project
    xpert = xpert.map(e => { 
      e.crf_id =  recids.find(({pid}) => pid === e.pid).record_id;
      return e;
    });
    xp = xpert.map(e => {
      return {
        xpert_result: e.test_result,
        xpert_timestamp: e.end_time,
        record_id: e.crf_id,
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
        showError("Error updating CRF", "REDCap Error: " + e.message));
    xp = undefined;
    data = new FormData();
    data.set("content", "file");
    data.set("action", "import");
    data.set("field", "xpert_data");
    data.set("event", "");
    data.set("returnFormat", "json");
    data.set("token", key);
    /* We need to change the way we get pdfs from the database so it's agnostic of redcap vs indexeddb */
    xpert = await Promise.all(xpert.map(async function (e) {
      if (!e.pdf) data.set("file", new Blob([await REDCapDB.getPDF(e.cartridge_sn)], {type: "application/pdf"}), e.sample_id + ".pdf");
      else data.set("file", new Blob([e.pdf], {type: "application/pdf"}), e.sample_id + ".pdf");
      data.set("record", e.crf_id);
      const result = await post(data, key)
      .catch(e => {
        showErr("Unable to upload file", "REDCap Error: " + e.message);
      });
      // delete the file from the (local) database if we uploaded and release from memory
      delete e.pdf;
      e.uploaded = new Date();
      $("#ul" + e.cartridge_sn).text(dateFormat.format(e.uploaded));
      return e;
    }));
    if (xpert.length > 0) Data.write(xpert, true);
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
    const file = await post(data, undefined, {xhr: () => {
      const xhr = new XMLHttpRequest();
      xhr.onreadystatechange = () => {
        if (xhr.readyState == 2 && xhr.status == 200) xhr.responseType = "blob";
      };
      return xhr;
    }}).catch(e => {
        throw new Error("Unable to download PDF file: " + e);
      });
    return file;
  }
  async function post(data, key, options) {
    checkConf();
    if (key === undefined) key = await Encryption.getSecret(config.RCD.apikey).catch(e => {
      throw new Error(e);
    });
    let x  = { url: config.RCD.api};
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
        .fail((jqXHR) => {
          reject("REDCap Error: " + (jqXHR.responseJSON ? jqXHR.responseJSON.error : JSON.parse(jqXHR.responseText).error)); 
        });
    });
  }
  function checkConf() {
    if(!hasConf()) {
      new bootstrap.Tab("#pills-setting-tab").show();
      showModal("REDCap Data API Not Configured", 'Please enter the REDCap Data API URL and/or API Token on the "Settings" tab');
      throw new Error("REDCap data project configuration missing");
    }
  }
  function hasConf () {
    if (config) {
      if (config.RCD) {
        if (config.RCD.api && config.RCD.apikey) return true;
      }
    }
    return false;
  } 
  return {
    updateCRF: updateCRF,
    hasConf: hasConf,
    checkConf: checkConf,
    getPDF: getPDF,
    clearCRF: clearCRF,
    post: post
  };
})();