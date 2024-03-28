self.Encryption = (() => {
  async function encrypt(message) {
    let nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const key = await loadKey();
    return sodium.to_hex(nonce) + "_" + sodium.to_hex(sodium.crypto_secretbox_easy(message, nonce, sodium.from_hex(key)));
  } 
  function decrypt(nonce_and_cipher, key) {
    let nonce_cipher = nonce_and_cipher.split("_");
    let nonce = sodium.from_hex(nonce_cipher[0]),
      cipher = sodium.from_hex(nonce_cipher[1]);
    return sodium.to_string(sodium.crypto_secretbox_open_easy(cipher, nonce, sodium.from_hex(key)));
  }
  function loadKey() {
    return new Promise((resolve, reject) => {
      let script = document.createElement("script");
      script.src = "config.js";
      script.onload = function () {
        resolve(mySecret());
        script.parentNode.removeChild(script);
      };
      script.onerror = function(e) {
        new bootstrap.Tab("#pills-setting-tab").show();
        showModal("Error", '<code>config.js</code> not found. Have you downloaded it to the base directory with <code>index.html</code>? '
          + 'Click on "Settings" tab to download (and set up REDCap API Tokens).');
        reject('"config.js" not found.');
      };
      script = document.documentElement.firstChild.appendChild(script);
    });
  }
  async function getSecret(secret) {
    const key = await loadKey();
    if (!secret) return null;
    let txt = null;
    try {
      txt = decrypt(secret, key);
    } catch (e) {
      if (e.message.includes("wrong secret key")) {
        showModal("Secret Key Mismatch", `Unfortuneately the key in <code>config.js</code> does not decode the current REDCap API Token.
          <ol><li>The REDCap API Token will be unset</li><li>Reenter the REDCap API Token on the "Settings" tab</li></ol>`);
          config.RC.apikey = null;
          localStorage.setItem("config", JSON.stringify(config));
          new bootstrap.Tab("#pills-setting-tab").show();
      } else showModal("Error", e.message);
    }
    return txt;
  }
  function newKey() {
    $(".modal-footer").prepend(`<button id="confirmKey" class="btn btn-danger">Download</button>`);
    $("#confirmKey").click(async (e) => { 
      // get old key
      let key = sodium.to_hex(sodium.crypto_secretbox_keygen());
      // Reencrypt old apikey if present
      let sapikey = config.RCS.apikey ? await getSecret(config.RCS.apikey) : null;
      if (sapikey !== null) {
        let nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
        config.RCS.apikey = sodium.to_hex(nonce) + "_" + sodium.to_hex(sodium.crypto_secretbox_easy(sapikey, nonce, sodium.from_hex(key)));
      }
      let dbapikey = config.RCDB.apikey ? await getSecret(config.RCDB.apikey) : null;
      if (dbapikey !== null) {
        let nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
        config.RCDB.apikey = sodium.to_hex(nonce) + "_" + sodium.to_hex(sodium.crypto_secretbox_easy(dbapikey, nonce, sodium.from_hex(key)));
      }
      let dapikey = config.RCD.apikey ? await getSecret(config.RCD.apikey) : null;
      if (dapikey !== null) {
        let nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
        config.RCD.apikey = sodium.to_hex(nonce) + "_" + sodium.to_hex(sodium.crypto_secretbox_easy(dapikey, nonce, sodium.from_hex(key)));
      }
      localStorage.setItem("config", JSON.stringify(config));
      let text = `function mySecret () {return "${ key }";}`;
      let element = document.createElement('a');
      element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
      element.setAttribute('download', "config.js");
      element.style.display = 'none';
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);
        $("#myModal").modal("hide");
    });
    showModal("Continue?", "You must save this file as 'config.js' in the root directory with 'index.html' in order to access any authentication keys.");
    $("#myModal").on('hidden.bs.modal', e => { $("#confirmKey").remove(); });
  }
  return {
    encrypt,
    getSecret,
    newKey
  };
})();
var config = {};
self.LocalConfig = (() => {
  async function getConfig() {
    if(!localStorage.getItem("config")) {
      config = {
        usePID: true,
        pidName: "PID",
        xpertTZ:  "America/Sao_Paulo",
        debug: true,
        xpert: {
          '16': {
            use: true,
            ct: 40
          },
          '18_45': {
            use: true,
            ct: 32
          },
          P3: {
            use: true,
            ct: 30
          },
          P4: {
            use: false,
            ct: null
          },
          P5: {
            use: false,
            ct: null
          }
        }
      };
      config.version = version;
      config.RCS = {
        api: null,
        apikey: null
      };
      config.RCD = {
        api: null,
        apikey: null
      }
      localStorage.setItem("config", JSON.stringify(config));
    }
   return JSON.parse(localStorage.getItem("config"));
  }
  async function save() {
    localStorage.setItem("config", JSON.stringify(config));
    return;
  }
  return {
    getConfig: getConfig,
    save: save
  };
})();
self.rcData = (() => {
  function search(s, cb) {
    REDCapDB.get(`contains([sid], '${s}') or contains([pid], '${s}')`).then((data) => {
      data = data.map((e) => {
        return(e.data);
      })
      cb(data);
    });
  }
  async function getAll(sn) {
    return get("[csn] = '" + sn.join("' or [csn] ='") + "'");
  }
  async function getSamples(sample_id) {
    return get("[sid] = '" + sample_id.join("' or [sid] ='") + "'");
  }
  async function get(filter) {
    xpert = await REDCapDB.get(filter);
    return (xpert.map((e) => { 
      return(e.data);
    }));
  }
  async function getPID(sample_id) {
    return REDCapS.getPID(sample_id);
  }
  async function write(xpert, update) {
    return REDCapDB.write(xpert, update); 
  }
  function deleteDB() {
    return new Promise((resolve) => {
      let data = {
        content : "record",
        type : "flat",
        format : "json",
        fields :  "csn"
      }
      REDCapDB.post(data).then((data) => {
        if (data.length > 0) {
          data = data.map(e => { return e.csn });
          data = {
            content : "record",
            action : "delete",
            records : data,
            returnFormat : "json"
          };
          REDCapDB.post(data, undefined, { dataType : "text"} ).then((result) => {
            clearErr();
            showToast("Database Deleted");
            resolve(result);
          }).catch(e => console.log(e));
        } else resolve();
      });
    });
  }
  async function deleteRec(sn) {
    let data = {
      content : "record",
      action : "delete",
      records : [sn]
    };
    return REDCapDB.post(data, undefined, { dataType : "text"});
  }
  function getCSV() {
    REDCapDB.get("").then((data) => {
      data = data.map((e) => {
        return (e.data);
      });
      let keys = ['SAC_result', 'SAC_Ct', 'HPV_16_result', 'HPV_16_Ct', 'HPV_18_45_result', 'HPV_18_45_Ct', 'P3_result', 'P3_Ct', 'P4_result', 
      'P4_Ct', 'P5_result', 'P5_Ct', 'restrict_result', 'mod_ct_result', 'sample_id', 'test_result', 'status', 'error', 'error_message', 
      'start_time', 'end_time', 'instrument_sn', 'cartridge_sn', 'reagant_lot', 'notes', 'pid', 'uploaded'];
      data = calcXpert(data);
      data = data.map(x => {
        return keys.map(key => {
          if (['uploaded', 'start_time', 'end_time'].indexOf(key) >= 0) {
            x[key] = luxon.DateTime.fromISO(x[key]);
            x[key] = x[key].invalid === null ? x[key].toFormat("yyyy-MM-dd HH:mm:ss") : "";
          } 
          return x[key];
        }).join(",");
      }).join("\n");
      let element = document.createElement('a');
      element.setAttribute('href', "data:text/csv;charset=utf-8," + encodeURI(keys.join(",") + "\n" + data));
      element.style.display = 'none';
      element.setAttribute('download', "xpert.csv");
      element.click();
      element.remove();
    });
  }
  return {
    getPID: getPID,
    getAll: getAll,
    getSamples : getSamples,
    getCSV: getCSV,
    search: search,
    write: write,
    deleteDB: deleteDB,
    deleteRec : deleteRec
  };
})();
self.LocalData = (() => {
  function initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("xpertdb", version);
      request.onsuccess = (e) => {
        resolve(e.target.result);
      };
      request.onerror = (e) => {
        console.error(e);
        reject(e);
      };
      request.onupgradeneeded = (e) => {
        db = e.target.result;
        const objStore = db.createObjectStore("xpert_results", { keyPath: "cartridge_sn" });
        objStore.createIndex("search", "search", { multiEntry: true , unique: false});
        objStore.createIndex("sample_id", "sample_id", {unique: false});
        objStore.transaction.oncomplete = (e) => {
          console.log("Database upgraded/created");
        };
      };
    });
  }
  async function write(xpert, update) {
    const db = await initDB();
    const transaction = db.transaction(["xpert_results"], "readwrite");
    const objStore = transaction.objectStore("xpert_results");
    return Promise.all(xpert.map(e => {
      return new Promise((resolve, reject) => {
        e.search = [e.sample_id, e.pid];
        const request = update !== undefined ? objStore.put(e) : objStore.add(e);
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
      });
    }));
  }
  function deleteRec(sn) {
    return new Promise(async (resolve) => {
      const db = await initDB();
      let result =  db.transaction("xpert_results", "readwrite").objectStore("xpert_results").delete(sn);
      result.onsuccess = e => resolve();
    })
  }
  function deleteDB() {
    const dbdel = indexedDB.deleteDatabase("xpertdb");
    return new Promise((resolve) => {
      dbdel.onerror = (e) => {console.log(e)};
      dbdel.onsuccess = (e) => { 
        clearErr();
        showToast("Database Deleted");
        resolve();
      };
      dbdel.onblocked = (e) => {
        showErr("Database Delete Blocked: refresh browser and retry.", "No additional info");
        resolve();
      };
    });
  }
  function search(q, cb) {
    initDB().then(db => {
      const idx = db.transaction("xpert_results").objectStore("xpert_results").index("search");
      const range = IDBKeyRange.bound(q, q + '\uffff');
      let result = idx.openCursor(range);
      let results = [];
      result.onsuccess = e => {
        let cursor = e.target.result;
        if(cursor) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          cb(results);
        }
      };
    });
  }
  async function getAll(keys) {
    const db = await initDB();
    const os = db.transaction("xpert_results").objectStore("xpert_results");
    const xpert = await Promise.all(keys.map(key => {
      return new Promise((resolve, reject) => {
        const result = os.get(key);
        result.onsuccess = (e) => resolve(e.target.result);
        result.onerror = (e) => reject(e);
      });
    }));
    return xpert;
  }
  function getCSV() {
    initDB().then (db => {
      const obs = db.transaction("xpert_results").objectStore("xpert_results");
      let result = obs.openCursor();
      let xpert = [];
      result.onsuccess = (e) => {
        const cursor = e.target.result;
        if(cursor) {
          xpert.push(cursor.value);
          cursor.continue();
        } else {
          let keys = ['SAC_result', 'SAC_Ct', 'HPV_16_result', 'HPV_16_Ct', 'HPV_18_45_result', 'HPV_18_45_Ct', 'P3_result', 'P3_Ct', 'P4_result', 
            'P4_Ct', 'P5_result', 'P5_Ct', 'restrict_result', 'mod_ct_result', 'sample_id', 'test_result', 'status', 'error', 'error_message', 
            'start_time', 'end_time', 'instrument_sn', 'cartridge_sn', 'reagant_lot', 'notes', 'pid', 'uploaded'];
          xpert = calcXpert(xpert);
          xpert = xpert.map(x => {
            return keys.map(key => {
              return x[key] instanceof Date ? luxon.DateTime.fromJSDate(x[key]).toFormat("yyyy-MM-dd HH:mm:ss") : x[key]
            }).join(",");
          }).join("\n");
          let element = document.createElement('a');
          element.setAttribute('href', "data:text/csv;charset=utf-8," + encodeURI(keys.join(",") + "\n" + xpert));
          element.style.display = 'none';
          element.setAttribute('download', "xpert.csv");
          element.click();
          element.remove();
        }
      }
    });
  }
  function getPID(sample_id) {
    return REDCapS.getPID(sample_id);
  }
  return {
    getAll: getAll,
    search: search,
    initDB: initDB,
    write: write,
    deleteDB: deleteDB,
    deleteRec: deleteRec,
    getCSV: getCSV,
    getPID: getPID
  };
})();
self.LocalUtils = (() => {
  async function backup() {
    REDCapS.checkConf();
    let backup = {};
    backup.config = {};
    Object.assign(backup.config, config);
    delete backup.config.RCS;
    delete backup.config.RCD;
    delete backup.config.RCDB;
    backup.db = await new Promise(async function(resolve) {
      db = await LocalData.initDB();
      const obs = db.transaction("xpert_results").objectStore("xpert_results");
      let result = obs.openCursor();
      bdb = [];
      result.onsuccess = async (e) => {
        const cursor = e.target.result;
        if(cursor) {
          bdb.push(cursor.value);
          cursor.continue();
        } else {
          // Convert pdfs to base64
          resolve(await Promise.all(bdb.map(async xpert => {
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
          })));
        }
      }
    });
    let data = {
      content : "fileRepository",
      action : "list",
      format : "json",
      returnFormat : "json"
    };
    const key = await Encryption.getSecret(config.RCS.apikey);
    result = await REDCapS.post(data, key)
    .catch(e => {
      showErr("Unable to get file repository", "REDCap Error: " + e);
    });
    let file = result.find(e => e.name === "Scrapert_Backup.json");
    if (file) {
      data.action = "delete";
      data.doc_id = file.doc_id;
      result = await REDCapS.post(data, key, { dataType: "text"})
      .catch(e => {
        showErr("Unable to delete prior backup", "REDCap Error: " + e);
      });
    }
    data = new FormData();
    data.set("content", "fileRepository");
    data.set("action", "import");
    data.set("returnFormat", "json");
    data.set("file", new Blob([JSON.stringify(backup)], {type: "application/json"}), "Scrapert_Backup.json");
    result = await REDCapS.post(data, key);
    showToast("Backup Complete (Backed up to Specimen REDCap as Scrapert_Backup.json)");
  }
  async function restoreBackup() {
    REDCapS.checkConf();
    let data = {
      content : "fileRepository",
      action : "list",
      format : "json",
      returnFormat : "json"
    };
    const key = await Encryption.getSecret(config.RCS.apikey);
    result = await REDCapS.post(data, key)
    .catch(e => {
      showModal("Unable to get file repository", "REDCap Error: " + e);
    });
    let file = result.find(e => e.name === "Scrapert_Backup.json");
    data = {
      content: "fileRepository",
      action: "export",
      doc_id: file.doc_id,
      returnFormat: "json"
    };
    file = await REDCapS.post(data, key, {dataType: "json"})
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
    // Save the datq (keep our credentials!)
    const RCS = config.RCS;
    const RCD = config.RCD;
    const RCDB = config.RCDB;
    config = file.config;
    config.RCD = RCD;
    config.RCS = RCS;
    config.RCDB = RCDB;
    localStorage.setItem("config", JSON.stringify(config));
    Data.write(file.db, true);
    showToast("Backup Restored");
  }
  return {
    backup: backup,
    restoreBackup: restoreBackup
  }
})();
