# ScrapertJS

<!-- badges: start -->

<!-- badges: end -->

The goal of ScrapertJS is to scrape values from Xpert HPV result pdfs, save to a browser database and upload to REDCap.

## Installation

```         
git clone https://github.com/iluvdata/ScapertJS
```

## Launching

Browse to the cloned directory and open `index.html` in a browser. Then click on the "Settings" tab and download the `config.js` file to the cloned directory. This file is use to the store the encryption key use to protect api keys in the browser. We highly recommend to protect it (`chmod 0600 config.js`). Finally enter the various REDCap API and API Token on the settings tab. You should have a functioning app at this point.

## Data Storage

All data is stored in the browser or in REDCap if you setup a project using the format below.  If stored in the browser it can be backed up to the REDCap project file repository. When data is stored in the browser, we cannot guarantee longevity.

### REDCap Data Storage

To use a REDCap Project as data backend. You can either updload the REDCap project XML file at the time of project creation using `Xpert Test Results.xml` found in the `utils` folder or you can import a data instrument using `instrument.csv` in the `utils` folder. If you do the latter you must reconfigure the project to use `csn` as the record name (rather than the default `record_id`).  You must verify the following:
- Your user an API key for the project
- Your user must have the following permissions
  - `Data` instrument:  "View and Edit" as well as export "Full Data Set"
  - API:  "API Export" and "API Import/Update"