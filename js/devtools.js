chrome.devtools.panels.create("DOMListener", "ico/logo_128.png", "panel.html", function (panel) {});

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  chrome.scripting.executeScript({
    target: { tabId: tabs[0].id },
    func: () => document.title,
  }, (results) => {
    console.log("Title is", results[0].result);
  });
});