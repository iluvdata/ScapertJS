self.Encryption = (() => {
  function encrypt(message, callback) {
    let nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    loadKey().then(key => {
      callback(sodium.to_hex(nonce) + "_" + sodium.to_hex(sodium.crypto_secretbox_easy(message, nonce, sodium.from_hex(key))));
    });
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
        showModal("Error", '"config.js" not found. Have you downloaded it to the base directory with "index.html"?',
          "Click on settings to download and set up REDCap API Key.");
        reject('"config.js" not found.');
      };
      script = document.documentElement.firstChild.appendChild(script);
    });
  }
  async function getSecret(secret) {
    if (!secret) return null;
    const key = await loadKey();
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
    $("#confirmKey").click((e) => { 
      // get old key
      getSecret(config.RC.apikey).then((apikey) => {
        let key = sodium.to_hex(sodium.crypto_secretbox_keygen());
        // Reencrypt the key
        let nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
        config.RC.apikey = sodium.to_hex(nonce) + "_" + sodium.to_hex(sodium.crypto_secretbox_easy(apikey, nonce, sodium.from_hex(key)));
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
// start with an empty config
var config = {};
function baseConfig() {
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
    config.RC = {
      api: null,
      apikey: null
    };
    localStorage.setItem("config", JSON.stringify(config));
  }
  config = JSON.parse(localStorage.getItem("config"));
}
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
async function writeTabToDB(xpert, update) {
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
async function updatePID(sample_id, pid) {
  const db = await initDB();
  const obs = db.transaction("xpert_results", "readwrite").objectStore("xpert_results");
  const idx = obs.index("sample_id");
  const only = IDBKeyRange.only(sample_id);
  let result = idx.get(only);
  return new Promise((resolve, reject) => {
    result.onsuccess = e => {
      let xpert = e.target.result;
      xpert.pid = pid;
      xpert.search = [xpert.sample_id, xpert.pid];
      let put = obs.put(xpert);
      // this should be the cartridge_sn
      put.onsuccess = (p) => resolve(p.target.result);
    };
  });
}
async function crfDB(sn, id) {
  const db = await initDB();
  const obs = db.transaction("xpert_results", "readwrite").objectStore("xpert_results");
  let result = await new Promise((resolve, reject) => {
    const res = obs.get(sn);
    res.onsuccess = e => resolve(e.target.result);
    res.onerror = e => reject(e);
  });
  delete result.pdf;
  result.uploaded = new Date();
  result.crf_id = Number.parseInt(id);
  return new Promise((resolve, reject) => {
    res = obs.put(result);
    res.onsuccess = e => resolve({ sn: e.target.result, uploaded: result.uploaded });
    res.onerror = e => reject(e);
  });
}
function deleteDB() {
  $(".modal-footer").prepend(`<button id="confirmDel" class="btn btn-danger">Confirm Delete</button>`);
  $("#myModal").on('hidden.bs.modal', e => { $("#confirmDel").remove(); });
  $("#confirmDel").click((el) => { 
    const dbdel = indexedDB.deleteDatabase("xpertdb");
    dbdel.onerror = (e) => {console.log(e)};
    dbdel.onsuccess = (e) => { 
      clearErr();
      $("#resTbl").addClass("d-none");
      $("#search").val("");
      $("#myModal").modal("hide");
      showToast("Database Deleted");
    };
    dbdel.onblocked = (e) => {
      showErr("Database Delete Blocked: refresh browser and retry.", "No additional info");
      $("#myModal").modal("hide");
    };
      
  });
  showModal("Confirm Delete DB?", "This cannot be undone. Consider backup!");
  
}
function searchDB(q, cb) {
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
async function dbGetAll(keys) {
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
async function getPDFLink(sn) {
  const xpert = (await dbGetAll([sn]))[0];
  let file = undefined;
  if (xpert.uploaded) {
    file =  await REDCap.getPDF(xpert.crf_id).catch(e => {
      clearErr();
      showErr("REDCap: Unable to download PDF file", e.message);
      throw new Error("Unable to get PDF file");
    });
  } else file = new Blob([xpert.pdf], {type: "application/pdf"});
  if (file === undefined) throw new Error("Unable to get PDF file");
  let element = document.createElement('a');
  element.setAttribute('href', URL.createObjectURL(file));
  element.setAttribute("scrapert-file", xpert.sample_id + ".pdf");
  element.style.display = 'none';
  return element;
}
function getPDF(sn) {
  getPDFLink(sn).then(element => {
    element.setAttribute('target', "scrapertjs");
    element.click();
    element.remove();
  });
}
function dlPDF(sn) {
  getPDFLink(sn).then(element => {
    element.setAttribute('download', element.getAttribute("scrapert-file"));
    element.click();
    element.remove();
  });
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