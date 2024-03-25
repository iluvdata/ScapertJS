# ScrapertJS

<!-- badges: start -->

<!-- badges: end -->

The goal of ScrapertJS is to scrape values from Xpert HPV result pdfs, save to a browser database and upload to REDCap.

## Installation

```         
git clone https://github.com/iluvdata/ScapertJS
```

## Launching

Browse to the cloned directory and open `index.html` in a browser. Then click on the "Settings" tab and download the `config.js` file to the cloned directory. This file is use to the store the encryption key. We highly recommend to protect it (`chmod 0600 config.js`). Finally enter the various REDCap API and API Token on the settings tab. You should have a functioning app at this point.

## Data Storage

All data is stored in the browser and can be backed up to the REDCap project file repository. Given storage in the browser, we cannot guarantee longevity.
