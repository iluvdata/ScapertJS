function pdfExtractTxt(pdfArray) {
  let loadingTask = pdfjsLib.getDocument(pdfArray);
  return loadingTask.promise.then((pdf) => {
    // Loop over pages
    var countPromises = [];
    for(let cPage = 1; cPage <= pdf.numPages; cPage++) {
      countPromises.push(
        pdf.getPage(cPage).then((page) => {
          return page.getTextContent().then((txt) => {
            txt = txt.items.map((item) => {
              return { 
                str: item.str,
                x: item.transform[4],
                y: item.transform[5]
              };
            });
            txt.sort((a, b) => {
              let y = b.y - a.y;
              return y != 0 ? y : a.x - b.x;
            });
            txt = txt.reduce((acc, e, i, arr) => {
              let prev = arr[i-1];
              return acc += (prev !== undefined && prev.y != e.y ? "\n" : " ") + e.str;
            }, "");
            return txt;
          }); // end gettexcontent promise
        }) // end get page promise
      ); // end countPromises push
    } // End for pages
    return Promise.all(countPromises).then((values) => {return values});
  });
}
function fileReaderP(file, fileindex) {
  return new Promise((resolve, reject) => {
    var fr = new FileReader();  
    fr.onload = (e) => {
      resolve({ ab: e.target.result, fileindex: fileindex});
    };
    fr.onerror = reject;
    fr.readAsArrayBuffer(file);
  });
}
function keyed_value(key, txt) {
  return txt.match(new RegExp(`(?<=${key.replaceAll(/\s/g,"\\s")}:\\s{1,30})\\w+`))[0];
}
function keyed_ts(key, txt, tz) {
  return new luxon.DateTime.fromFormat(txt.match(new RegExp(`(?<=${key.replaceAll(/\s/g,"\\s")}:\\s{1,30})\\S{8}\\s\\S{8}`))[0],
     "MM/dd/yy hh:mm:ss", { zone: tz}).toJSDate();
}
function parseXpert(xpert) {
  // parse the results table
  tab = xpert.match(/SAC[\S\s\n]+(?=\n{1}User:)/)[0].replaceAll(/(?<=HPV)\s(?=\d{2})/g, "_");
  tab = tab.split("\n").map(e => e.split(/\s+/))
    .map(e => {
      obj = {};
      obj[`${e[0]}_result`] = e[3];
      obj[`${e[0]}_Ct`] = Number.parseFloat(e[1]);
      return obj; 
    })
    .reduce((acc, e) => { return {...acc, ...e}});
  tab = {...tab,
    sample_id: keyed_value("Sample ID\\*?", xpert),
    test_result: xpert.match(/(?<=Test\sResult:\s+)HPV[\S\s\n]+(?=\n\-\nAnalyte)/)[0].replaceAll(/[\n\s{2,}]/g, " "),
    status: keyed_value("Status", xpert),
    error: keyed_value("Error Status", xpert),
    error_message: xpert.match(/(?<=Errors\n)\S+/)[0],
    start_time: keyed_ts("Start Time", xpert, config.expertTZ),
    end_time: keyed_ts("End Time", xpert, config.expertTZ),
    instrument_sn: keyed_value("Instrument S/N", xpert),
    cartridge_sn: keyed_value("Cartridge S/N\\*?", xpert),
    reagant_lot: keyed_value("Reagent Lot ID\\*?", xpert),
    notes: keyed_value("Notes", xpert)
  };
  return tab;
}